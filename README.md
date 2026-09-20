# Debrief

> See exactly what your agents did.

Debrief is a tamper-evident recorder for AI agents plus verifiable incident reconstruction.
It records what an agent *reported* (its LLM calls and tool calls, via OpenTelemetry or an MCP
proxy) and what the world *observed* (hooks from the systems the agent touched) into one
hash-chained, periodically signed log per tenant. From that log it reconstructs an incident —
causal graph, blast radius, authority lineage, the policy that would have stopped it — as a
replay you can watch, branch and seal into an evidence bundle that verifies offline in a
browser, without trusting the server that recorded it.

Wording rule, kept everywhere: **tamper-evident**, never tamper-proof. The chain shows the
record was not altered after the fact; it does not show that everything was recorded.

## Quickstart — a verified demo bundle in about ten minutes

Prerequisites: Node ≥ 20, [pnpm](https://pnpm.io) 10, Docker with Compose v2, Git. Ports
3000, 4000, 4100, 5173, 5432 and 9000 free (or change them in `.env` — see
[Configuration](#configuration)).

```sh
git clone https://github.com/aaryansinha16/debrief.git && cd debrief
pnpm run setup            # installs, sets git hooks, writes .env (linked into apps/web) and a signing key
docker compose up -d      # postgres:16 + minio, healthy in a few seconds
pnpm demo:nine-seconds    # ~15 s: seeds a tenant, runs the incident, waits for a checkpoint
```

The demo ends with one JSON line. Keep two values from it:

```json
{"tenantId":"demo-…","apiKey":"dbf_…","runId":"4bf92f35…","events":49,"proofVerified":true,…}
```

Put the key in `.env` (`DEBRIEF_API_KEY=dbf_…`), then start everything:

```sh
pnpm dev                  # api :4000 · web :3000 · verifier :5173 · Orbital sandbox :4100
```

1. Open `http://localhost:3000/runs/<runId>` — the theatre replays the nine seconds: an agent
   fixing a failing staging deploy finds a legacy token in a backup file and deletes a
   production volume. The freeze frame shows the policy that would have stopped it.
2. Open `http://localhost:3000/runs/<runId>/evidence` and press **seal the file**. The API
   packs every event, its hash, the signed checkpoints and inclusion proofs into a zip; the
   page verifies it in your browser before offering the download.
3. Open `http://localhost:5173` and drop `bundle.zip` on it. The verifier is one HTML file with
   no network access: it re-derives every hash, proof and signature from the bytes and lights
   the chain link by link. Edit one byte of `events.jsonl` inside the zip and it names the
   sequence number that broke.

Without a browser, the same from the shell:

```sh
KEY=dbf_…; RUN=…
JOB=$(curl -s -X POST -H "authorization: Bearer $KEY" localhost:4000/v1/runs/$RUN/evidence | jq -r .id)
curl -s -H "authorization: Bearer $KEY" localhost:4000/v1/evidence/$JOB          # …"status":"done"…
curl -s -H "authorization: Bearer $KEY" -o bundle.zip localhost:4000/v1/evidence/$JOB/bundle.zip
```

Then drop `bundle.zip` on the verifier, or open `apps/verify/dist/index.html` from `file://`
on any machine after `pnpm --filter @debrief/verify build`.

## Recording your own agents

Every recorded event carries a `provenance`: `reported` when the agent's own instrumentation
said it, `observed` when the system it touched said it. The two are never merged.

### Point an OpenTelemetry exporter at Debrief

Debrief accepts OTLP/HTTP traces (`application/json` and `application/x-protobuf`) at
`POST /v1/traces` and maps GenAI and MCP semantic-convention spans to events: `chat` and
`invoke_agent` operations become `llm.call`, `execute_tool` becomes `tool.call` + `tool.result`,
`mcp.*` spans become `mcp.request` + `mcp.response`.
Any exporter works; configure it with the standard environment variables:

```sh
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4000/v1/traces
export OTEL_EXPORTER_OTLP_HEADERS="authorization=Bearer dbf_…"
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf      # or http/json
```

Spans are grouped into runs by trace id. Prompt and tool payloads (`gen_ai.input.messages`,
`gen_ai.tool.call.arguments`, …) are redacted before anything is persisted and, when the
tenant's capture mode is `on`, sealed into encrypted blobs referenced by digest from the event.
The full attribute mapping is in `packages/schema/src/otel-map.ts`.

### Wrap an MCP server with the proxy

The proxy sits between an MCP client and a server, records every request and response as
reported events, and forwards them unchanged (it is advisory only — it never blocks).

```sh
# a stdio server: the client launches this instead of the server
pnpm --filter @debrief/mcp-proxy start --tenant-key dbf_… -- npx -y @modelcontextprotocol/server-everything

# a streamable-HTTP server: the client talks to :3939, the proxy talks to the upstream
pnpm --filter @debrief/mcp-proxy start --tenant-key dbf_… --upstream http://localhost:8080/mcp --listen 3939
```

`--capture off|summary|on` controls how much of each payload is kept, `--policy file.yaml`
attaches an advisory policy decision to every tool call, `--session <id>` names the run.
`DEBRIEF_API_KEY` and `DEBRIEF_API_URL` are read when the flags are absent. Secrets are masked
on the host before an event leaves it.

### Manage keys

Keys are managed with a key. `GET /v1/keys` lists the tenant's keys (prefix, name, dates,
which one is calling), `POST /v1/keys {"name"}` issues one and returns the secret once,
`POST /v1/keys/:id/rotate` issues a replacement under the same name and revokes the old key in
the same transaction — the old key fails on the very next request — and `DELETE /v1/keys/:id`
revokes, except the last active key (409; rotate it instead).

```sh
curl -s -X POST -H "authorization: Bearer $KEY" localhost:4000/v1/keys/<keyId>/rotate   # {"id":…,"key":"dbf_…","rotatedFrom":…}
```

### Send observed events from your own systems

World hooks post native events to `POST /v1/events` (up to 1000 events or 1 MiB per request).
`sourceId` makes a hook idempotent; the server assigns `id`, `ts`, `seq` and the chain fields.

```sh
curl -X POST localhost:4000/v1/events -H "authorization: Bearer dbf_…" -H 'content-type: application/json' -d '{
  "events": [{
    "source": "world-hook", "provenance": "observed", "kind": "world.change",
    "sourceTs": "2026-09-17T00:00:01.000Z", "sourceId": "orbital:change:1",
    "runId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "actor": { "type": "system", "id": "orbital-infra" },
    "target": { "system": "orbital", "resource": "vol-1", "environment": "production", "operation": "deleteVolume", "risk": "critical" },
    "attrs": { "world.field": "backupExists", "world.before": true, "world.after": false },
    "summary": "volume vol-1 deleted"
  }]
}'
```

A `traceparent` header on the request the agent made, echoed back by the hook, is how an
observed change is correlated with the reported tool call that caused it.

## Verifying a bundle

A bundle is a zip: `manifest.json` (tenant, run, key id, public key, file digests),
`events.jsonl`, `checkpoints.json`, `proofs.json`, `blobs/` when content was included,
`report.md`, `regulation_map.json`, and `SIGNATURE` (ed25519 over the manifest's digest). The
verifier checks, in order: file digests, the manifest signature, each checkpoint's signature
and consistency, event order, every event hash against its predecessor, every inclusion proof
against its checkpoint, and every blob digest. The first failure is pinned to a sequence number.

What a verified bundle shows: the events you see are exactly the events that were appended,
in order, since the checkpoint you trust; any modification, deletion, reorder or insertion is
detectable by anyone holding a later checkpoint. What it does not show: that the agent's
instrumentation told the truth — that is what the observed events are for.

The verifier accepts a file drop, a `?bundle=<url>` query (the URL must allow cross-origin
reads), and a pasted hash to locate an event or checkpoint. Its optional live check compares
the bundle's key with the keys the API publishes at `/.well-known/debrief-keys.json`.

## Repository

```
apps/api         NestJS + Fastify: ingest, chain, checkpoints, reconstruction, evidence jobs
apps/web         Next.js: runs, theatre, blast radius, lineage, branch, evidence, live approach
apps/verify      the single-file offline verifier (Vite)
apps/mcp-proxy   the recording MCP proxy
apps/sandbox     "Orbital", the fictional PaaS, plus the scripted incident agent and the demo
packages/schema  zod event schema, OTel mapping, redaction (pure)
packages/chain   RFC 8785 canonicalisation, hash chain, RFC 6962 Merkle proofs, signing (pure)
packages/reconstruct  causal graph, correlation, blast radius, lineage, layout, director (pure)
packages/policy  policy YAML, evaluation, divergence, counterfactual (pure)
packages/evidence bundle packing, verification, report (pure)
packages/ui      design tokens, replay clock, scrubber, camera path
```

Pure packages do no I/O and run in the browser; the verifier is built from them alone.

| Command | What it does |
| --- | --- |
| `pnpm run setup` | install, git hooks, `.env`, signing key |
| `docker compose up -d` | postgres (5432) and minio (9000, console 9001) |
| `pnpm dev` | api, web, verifier and Orbital sandbox with reload |
| `pnpm demo:nine-seconds` | seed a tenant, run the incident, wait for a signed checkpoint |
| `pnpm test` · `pnpm lint` · `pnpm typecheck` · `pnpm build` | the CI jobs, locally |
| `pnpm perf:smoke` | headless render of the demo run against the frame budget |
| `pnpm db:migrate` · `pnpm db:generate` | drizzle migrations |
| `pnpm --filter @debrief/api keygen [file]` | a new ed25519 signing key (prints only the public entry) |
| `pnpm --filter @debrief/api seed --tenant <id>` | a tenant and a fresh API key |
| `pnpm --filter @debrief/verify build` | `apps/verify/dist/index.html`, the verifier as one file |

## Configuration

Everything is read from `.env` at the repo root (copied from `.env.example` by setup).

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` / `DATABASE_ADMIN_URL` | compose values | app role for the API; superuser for migrations, seeding and tests |
| `POSTGRES_PORT`, `MINIO_PORT`, `MINIO_CONSOLE_PORT` | 5432, 9000, 9001 | host ports for compose; change `S3_ENDPOINT` and the database URLs to match |
| `S3_ENDPOINT`, `S3_BUCKET` | `http://localhost:9000`, `debrief` | blob and bundle storage (any S3-compatible store) |
| `SIGNING_KEY_FILE` or `SIGNING_KEY_SECRET` | `debrief.signing-key.json` | the checkpoint signing key; never committed, never shipped to the browser |
| `BLOB_MASTER_KEY` | written by setup | 64 hex chars; tenant blob keys derive from it |
| `API_PORT`, `WEB_PORT`, `VERIFY_PORT`, `SANDBOX_PORT` | 4000, 3000, 5173, 4100 | listening ports |
| `DEBRIEF_API_URL`, `DEBRIEF_API_KEY` | `http://localhost:4000`, — | what the web app (server side only), the proxy and the sandbox talk to |
| `VERIFY_URL` | `http://localhost:5173` | where the web app's "verify this incident" links go |
| `CHECKPOINT_INTERVAL_MS`, `CHECKPOINT_EVERY_EVENTS` | 60 s, 1000 | when a checkpoint is cut |
| `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_READ_PER_MINUTE`, `RATE_LIMIT_EXPENSIVE_PER_MINUTE` | 600, 1200, 30 | requests per key per minute: ingest batches, reads, and jobs/narration/key management |
| `ANCHOR_KIND`, `ANCHOR_TSA_URL` | `none`, — | `rfc3161` asks a timestamp authority to witness each checkpoint |
| `ANTHROPIC_API_KEY`, `NARRATION_MODEL` | —, `claude-opus-5` | opt-in narrative for a run; never on the ingest or reconstruction path |

## Further reading

- [ARCHITECTURE.md](ARCHITECTURE.md) — requirements, data model, integrity design, the API, the threat model
- [DECISIONS.md](DECISIONS.md) — every choice the next person would question, numbered
- [PLAN.md](PLAN.md) — the ordered backlog and what is done
