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
3000, 4000, 4100, 5173, 5432 and 8333 free (or change them in `.env` — see
[Configuration](#configuration)).

```sh
git clone https://github.com/aaryansinha16/debrief.git && cd debrief
pnpm run setup            # installs, sets git hooks, writes .env (linked into apps/web) and a signing key
docker compose up -d      # postgres:16 + seaweedfs (S3), healthy in a few seconds
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
said it, `observed` when the system it touched said it, `derived` for the claims and verdicts
Debrief computes. They are never merged.

### Capture Claude Code sessions

```sh
DEBRIEF_API_KEY=dbf_… pnpm --filter @debrief/cli start claude-code install   # --api http://localhost:4000 by default
pnpm --filter @debrief/cli start claude-code uninstall
```

`install` adds one `Stop` and one `SessionEnd` hook to Claude Code's user settings
(`$CLAUDE_CONFIG_DIR/settings.json`, default `~/.claude/settings.json`), never to a project's.
The API URL and key go to `~/.config/debrief/config.json` (mode 600; `--config <dir>` or
`DEBRIEF_CONFIG_DIR` to move it), never into Claude Code's settings. The stored key always holds
`local` trust: given a `third-party` key, install issues a `local` one for this machine and keeps
only that (D-084). `uninstall` puts the settings file back byte for byte when nothing else changed
it since install, otherwise removes only Debrief's hooks (rewriting the file with 2-space
indentation), and deletes the stored key (revoke it with `DELETE /v1/keys/:id`). A symlinked
settings file stays a link. The hook command points at this checkout and this Node binary: run
`install` again after moving either. One installation per Claude Code config.

Each session is a run. On every Stop the hook posts the transcript lines it has not sent yet
(prompts and assistant text as messages, tool uses and results as `tool.call`/`tool.result`,
content with secrets masked on this machine and redacted again at ingest; thinking is never sent)
and, when it changed, the repository's git state as an observed `world.change` with
`witness.trust: local`: HEAD, branch and a per-file diff stat, never file contents. Installing is
the opt-in to content capture; the tenant's capture mode still decides what is kept. The hook never
blocks or fails a turn: it gives up after 1 s, exits 0, and the backlog goes with the next Stop. If
git does not answer in time, no git state is posted for that Stop rather than a guessed one.

`POST /v1/runs/:id/claims` extracts the claims an agent made in a session: one model call per
transcript (`ANTHROPIC_API_KEY`; `CLAIMS_MODEL`, default `claude-opus-5-5`), cached, so asking
again costs nothing. Each claim quotes the agent's own words exactly and is appended as a `derived`
`claim` event; a later call after the session grew appends only the new ones. A session longer than
`CLAIMS_MAX_CHARS` (600,000 characters of agent text) is refused with 413 rather than truncated.

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

Keys are managed with a key. `GET /v1/keys` lists the tenant's keys (prefix, name, trust, dates,
which one is calling), `POST /v1/keys {"name", "trust"?}` issues one and returns the secret once,
`POST /v1/keys/:id/rotate` issues a replacement under the same name and trust and revokes the old
key in the same transaction — the old key fails on the very next request — and
`DELETE /v1/keys/:id` revokes, except the last active key (409; rotate it instead).

Every key holds a trust, `local` (the default) or `third-party`: the most `witness.trust` its
observed events may assert (D-084). A `local` key posting a `third-party` event gets 403 and the
batch is not stored, and no key issues, rotates or revokes a key above its own trust. Give
`third-party` keys only to witnesses that run outside the agent's reach; the key on the agent's
machine (the Claude Code hook) is `local`. `seed` issues a tenant's first key as `third-party`
(`--trust local` for a local one); keys that existed before P-66.1 kept `third-party`.

```sh
curl -s -X POST -H "authorization: Bearer $KEY" localhost:4000/v1/keys/<keyId>/rotate   # {"id":…,"key":"dbf_…","rotatedFrom":…}
```

### Send observed events from your own systems

World hooks post native events to `POST /v1/events` (up to 1000 events or 1 MiB per request).
`sourceId` makes a hook idempotent within its key's trust (a local key cannot pre-empt a
third-party record's id); the server assigns `id`, `ts`, `seq` and the chain fields. An observed
event carries `witness.trust`, at most the trust of the key that posts it.

```sh
curl -X POST localhost:4000/v1/events -H "authorization: Bearer dbf_…" -H 'content-type: application/json' -d '{
  "events": [{
    "source": "world-hook", "provenance": "observed", "kind": "world.change",
    "sourceTs": "2026-09-17T00:00:01.000Z", "sourceId": "orbital:change:1",
    "runId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "actor": { "type": "system", "id": "orbital-infra" },
    "target": { "system": "orbital", "resource": "vol-1", "environment": "production", "operation": "deleteVolume", "risk": "critical" },
    "attrs": { "world.field": "backupExists", "world.before": true, "world.after": false, "witness.trust": "third-party" },
    "summary": "volume vol-1 deleted"
  }]
}'
```

A `traceparent` header on the request the agent made, echoed back by the hook, is how an
observed change is correlated with the reported tool call that caused it.

### Connect GitHub

The GitHub witness reads what GitHub recorded (pushes, pull requests, workflow runs, check runs,
deleted refs) and posts it as observed `world.change` events with `witness.trust: third-party`.
It never reads anything the agent reported. Two modes share one mapping, so the same fixture gives
the same events either way and a redelivered event is stored once (`sourceId` is built from the
content, not the delivery id).

`DEBRIEF_API_KEY` must hold `third-party` trust (`POST /v1/keys {"name": "github", "trust":
"third-party"}` with a third-party key); the witness checks `/v1/me` at startup and exits if the
key holds less or is refused.

GitHub credentials are read-only. For the poller, and for job counts in webhook mode, create a
fine-grained personal access token on the repository with **Actions: read**, **Pull requests: read**,
**Checks: read** and **Contents: read** (Metadata: read comes with it) and nothing else. For
webhooks, add a repository webhook with content type `application/json`, a secret, and the events
`push`, `pull_request`, `workflow_run`, `check_run` and `delete`.

| Variable | Used by | Meaning |
|----------|---------|---------|
| `DEBRIEF_API_KEY` | both | Debrief key; never logged |
| `DEBRIEF_API_URL` | both | default `http://localhost:4000` |
| `GITHUB_WEBHOOK_SECRET` | webhook | the webhook secret; `X-Hub-Signature-256` is checked with a constant-time compare |
| `GITHUB_WEBHOOK_PORT` | webhook | default `8787`, path `/webhook` |
| `GITHUB_TOKEN` | poll, webhook (optional) | the read-only token; in webhook mode it adds job counts to finished runs |
| `GITHUB_REPOS` | poll | `owner/name,owner/name` |
| `GITHUB_POLL_INTERVAL_S` | poll | default `60` |

```sh
export DEBRIEF_API_KEY=dbf_… GITHUB_TOKEN=github_pat_…
GITHUB_REPOS=you/your-repo pnpm --filter @debrief/witness-github-app start poll     # laptop, no public URL
GITHUB_WEBHOOK_SECRET=… pnpm --filter @debrief/witness-github-app start webhook      # behind a tunnel or public URL
pnpm --filter @debrief/witness-github-app start replay                               # recorded fixtures, to try it
```

A finished workflow run carries `ci.jobs.passed`, `ci.jobs.failed`, `ci.jobs.skipped`,
`ci.jobs.cancelled`, `ci.jobs.other` (unfinished or unfamiliar conclusions, never counted as failed) and `ci.jobs.total`, counted from every job of the run's own attempt (paged; if they cannot all be read the run is held back), with `ci.counts.of: jobs`.
These are job counts, not test counts: GitHub's run record has no test results, and the witness
does not guess them (test counts are below). Without a token a webhook run is recorded without counts. The commit SHA is
`commit.sha` and the actor `github.actor`. GitHub exposes no traceparent, so events use the daily
run `witness:github:<yyyy-mm-dd>`. The Events API the poller reads for pushes and deletions lags by
up to a few minutes and lists only recent events; the poller reads the first 50 items of each list, skips runs it has already posted, and backs off on `Retry-After` and an exhausted `X-RateLimit-Remaining`.

Test counts come from a test report the CI produced, never from job counts. When a finished run
has one, the witness posts a second event on the run, `workflow_run.tests`, with
`world.tests.passed`, `world.tests.failed` and `world.tests.skipped` and `ci.tests.source`
(`junit` or `check-run`); a run without a report carries no `world.tests.*`. Two sources are read:

- JUnit XML in an artifact whose name contains `junit` (not expired, at most 10 artifacts of 10 MiB;
  at most 50 `.xml` files, 5 MiB each, 25 MiB in total, measured by the larger of declared and
  actual size; for a re-run attempt the artifact must be newer than the attempt's `run_started_at`).
  The artifact and check-run lists must be complete (a partial list posts nothing). The zip is downloaded with the read-only
  token (Actions: read), unzipped in memory and never stored. Only `<testsuites>` and `<testsuite>`
  roots are read; every `<testcase>` counts, with `<failure>` or `<error>` as failed and `<skipped>`
  as skipped. This repository's CI uploads `junit-reports` (vitest's JUnit reporter, one file per
  package) for exactly this.
- A check run from `github-actions` whose output matches a supported reporter: the title written by
  `EnricoMi/publish-unit-test-result-action` (`2 fail, 2 skipped, 15 pass in 14s` or `All 17 tests
  pass in 14s`, with the action's `#the-symbols` link in the summary; errors count as failed, a
  repeated part is refused) or the `img.shields.io/badge/tests-…` badge in the summary of `dorny/test-reporter`.
  Any other check run is ignored.

Files of one source add up; every kind present (JUnit, each reporter) must agree, and if they do not, or a report is malformed, oversized, empty
or over a limit, no counts are posted and the reason is logged. The poller looks again for 30
minutes at a run posted without a report (a reporter workflow can finish later); the webhook reads
the report when the run completes, so a report that lands later is only picked up by the poller.

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
| `docker compose up -d` | postgres (5432) and seaweedfs, an S3-compatible store (8333) |
| `pnpm dev` | api, web, verifier and Orbital sandbox with reload |
| `pnpm demo:nine-seconds` | seed a tenant, run the incident, wait for a signed checkpoint |
| `pnpm test` · `pnpm lint` · `pnpm typecheck` · `pnpm build` | the CI jobs, locally |
| `pnpm perf:smoke` | headless render of the demo run against the frame budget |
| `pnpm db:migrate` · `pnpm db:generate` | drizzle migrations |
| `pnpm --filter @debrief/api keygen [file]` | a new ed25519 signing key (prints only the public entry) |
| `pnpm --filter @debrief/api seed --tenant <id> [--trust local\|third-party]` | a tenant and a fresh API key (`third-party` by default) |
| `pnpm --filter @debrief/verify build` | `apps/verify/dist/index.html`, the verifier as one file |

## Configuration

Everything is read from `.env` at the repo root (copied from `.env.example` by setup).

A checkout from before P-60.1 ran MinIO: in `.env`, rename `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`
to `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` and `MINIO_PORT` to `S3_PORT`, drop
`MINIO_CONSOLE_PORT`, point `S3_ENDPOINT` at the new port, and remove the old volume with
`docker volume rm debrief_miniodata`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` / `DATABASE_ADMIN_URL` | compose values | app role for the API; superuser for migrations, seeding and tests |
| `POSTGRES_PORT`, `S3_PORT` | 5432, 8333 | host ports for compose; change `S3_ENDPOINT` and the database URLs to match |
| `S3_ENDPOINT`, `S3_BUCKET` | `http://localhost:8333`, `debrief` | blob, bundle and checkpoint storage: any S3-compatible store with presigned GET and path-style addressing (D-082) |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | `debrief`, `debrief-local-only` | store credentials; compose gives SeaweedFS the same pair |
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
