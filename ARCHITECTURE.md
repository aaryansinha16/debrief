# Debrief — Architecture

> See exactly what your agents did.

Debrief records what AI agents do — under whose authority, against which systems — in a
tamper-evident log, then reconstructs incidents as an immersive, independently verifiable
replay. The unit of truth is the **incident**, not the trace. Observability answers
"is it working"; Debrief answers "what happened, to what, under whose authority, and would
policy have stopped it" — for an engineer at 2am and for a lawyer three weeks later, from the
same signed record.

---

## 0. Scope

**v1 (6 weeks) — in:**
OTLP ingest of `gen_ai.*`/`mcp.*` spans · MCP proxy capture · world hooks (sandbox infra,
Postgres, GitHub) · hash-chained event store with signed Merkle checkpoints · reconstruction
(causal graph, blast radius, authority lineage, divergence, counterfactual) · six web scenes ·
evidence bundle + offline verifier · the "nine seconds" sandbox demo.

**v1 — explicitly out:**
Inline enforcement/blocking (proxy is advisory-only) · LLM re-execution inside counterfactuals ·
public anchoring beyond a stub · SSO, billing, multi-region · mobile layouts.

**Wording rule:** "tamper-evident", never "tamper-proof". "Reconstruction", never "proof of
what happened". The chain proves the record was not altered; it does not prove everything was
recorded.

---

## 1. Requirements

### Functional
| ID | Requirement |
|----|-------------|
| FR-1 | Accept OTLP/HTTP traces (protobuf + JSON) and map GenAI/MCP spans to Debrief events |
| FR-2 | Accept native Debrief events from the MCP proxy and world hooks |
| FR-3 | Append every event to a per-tenant hash chain; sign Merkle checkpoints periodically |
| FR-4 | Serve inclusion + consistency proofs for any event against any later checkpoint |
| FR-5 | Build a deterministic causal graph for a run (or time window across runs) |
| FR-6 | Compute blast radius, authority lineage, and policy divergence for a run |
| FR-7 | Counterfactual: replay recorded events through a different policy and show where execution halts |
| FR-8 | Render the six scenes: Approach, Theatre, Blast, Lineage, Branch, Sealed File |
| FR-9 | Export a signed evidence bundle; verify it offline in a static page with no backend |
| FR-10 | Run the full "nine seconds" demo with one command against a local stack |

### Non-functional
| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1 Integrity | Any modification, deletion, reorder, or insertion of past events is detectable by a third party holding a checkpoint | 100% |
| NFR-2 Privacy | Content capture is opt-in; secrets never persisted; erasure without breaking the chain | redaction before persistence |
| NFR-3 Performance | Ingest ≥ 1,000 events/s per API node; 10k-event run loads in Theatre < 2s; scenes hold 60fps on an integrated-GPU laptop | measured in CI perf job |
| NFR-4 Cost | Zero LLM calls in the hot path; narration opt-in and cached | — |
| NFR-5 Determinism | Same events → same graph, same layout, same camera path | golden-file tests |
| NFR-6 Verifiability | Verifier is a static page using only `packages/chain`; no network needed | — |

### Constraints
Solo builder driving a coding agent · TypeScript end-to-end · Postgres + S3-compatible storage ·
runnable on a laptop via `docker compose` · AWS (ECS/RDS/S3) later · Aaryan's home stack is
NestJS/Postgres/AWS, so the API stays in that shape.

---

## 2. System overview

```
 SOURCES                       CAPTURE                    CORE                        CONSUMERS
 ───────                       ───────                    ────                        ─────────
 Agent frameworks ──OTLP──►  /v1/traces  ─┐
 (Claude Code, Codex,                     │
  LangGraph, custom)                      ├─► Normalize ─► Redact ─► Append (seq, hash) ─► Postgres (events)
                                          │                              │                    │
 MCP servers ──► mcp-proxy ──► /v1/events ┤                              ├─► Blobs ─► S3/MinIO │
                                          │                              │                    │
 World hooks ──► /v1/events ──────────────┘                              └─► Checkpointer ─► checkpoints (Ed25519)
 (sandbox infra, Postgres,                                                                      │
  GitHub)                                                                                       │
                                                                                                ▼
                                             packages/reconstruct ◄── events + blobs ── LISTEN/NOTIFY ── SSE (/v1/live)
                                             (graph, blast, lineage, divergence, layout)          │
                                                        │                                         ▼
                                                        ├─► apps/web  (Approach · Theatre · Blast · Lineage · Branch · Sealed File)
                                                        ├─► packages/evidence ─► bundle.zip ─► apps/verify (static, offline)
                                                        └─► packages/policy (counterfactual replay)
```

Two provenance classes flow through the same pipeline and are never conflated:
- **Reported** — what the agent's instrumentation says it did (OTLP, MCP proxy).
- **Observed** — what the world says changed (world hooks). Reconstruction weights observed
  evidence above reported evidence when they disagree, and shows the disagreement.

---

## 3. Repository layout

```
debrief/
  CLAUDE.md  ARCHITECTURE.md  DECISIONS.md  MEMORY.md  PLAN.md
  package.json  pnpm-workspace.yaml  turbo.json  tsconfig.base.json
  docker-compose.yml            postgres:16, minio
  .githooks/commit-msg          single-line commit enforcement
  .github/workflows/ci.yml      lint · typecheck · test · perf-smoke
  apps/
    api/          NestJS (Fastify adapter) — ingest, chain, reconstruction API, evidence jobs, SSE
    web/          Next.js (app router) + react-three-fiber — the six scenes
    mcp-proxy/    wraps any MCP server (stdio or streamable HTTP); records both sides of every call
    sandbox/      "Orbital" fake PaaS + deterministic scripted agent; the nine-seconds demo
    verify/       Vite static page — verifies an evidence bundle offline
  packages/
    schema/       zod event schema, OTel → Debrief attribute map (version-pinned), TS types
    chain/        canonical JSON, SHA-256 chain, RFC 6962 Merkle, Ed25519 checkpoints, proofs, verifier
    reconstruct/  causal graph, correlation, blast radius, lineage, divergence, seeded layout, auto-director
    policy/       YAML policy DSL, evaluator, counterfactual replay
    evidence/     bundle packer/unpacker, report generator, regulation map
    ui/           design tokens, replay clock, timeline scrubber, shared primitives
    config/       shared eslint / tsconfig / prettier
```

One language (TypeScript) everywhere so the coding agent holds a single mental model and so
`packages/chain` runs unchanged in Node (API), the browser (web), and the static verifier.

---

## 4. Data model

### 4.1 Event (append-only)

```ts
type EventKind =
  | 'principal.session'   // a human started/ended a session that owns runs
  | 'delegation.grant'    // human → agent, agent → sub-agent, token issued (scope + permissions)
  | 'delegation.revoke'
  | 'agent.invoke'        // an agent run/turn started (gen_ai invoke_agent)
  | 'agent.plan'          // planning step, if instrumented
  | 'agent.message'       // agent ↔ agent message (A2A / side channel)
  | 'llm.call'            // chat / text_completion / generate_content
  | 'tool.call'           // execute_tool start (args)
  | 'tool.result'         // execute_tool end (result summary, status)
  | 'mcp.request' | 'mcp.response'
  | 'world.change'        // observed mutation in a real system
  | 'policy.decision'     // evaluator verdict (advisory in v1)
  | 'human.approval'      // approve / reject / timeout
  | 'error';

interface Event {
  id: string;                 // ULID
  tenantId: string;
  seq: bigint;                // per-tenant, strictly monotonic, assigned at append
  ts: string;                 // ingest time, RFC 3339 UTC
  sourceTs: string;           // time reported by the source
  source: 'otlp' | 'mcp-proxy' | 'world-hook' | 'api';
  provenance: 'reported' | 'observed';
  runId: string;              // W3C trace id (32 hex) or synthetic run id
  spanId?: string; parentSpanId?: string;
  kind: EventKind;
  actor: { type: 'human' | 'agent' | 'subagent' | 'system'; id: string; name?: string };
  authority?: { principalId: string; grantId?: string; tokenRef?: string; scope?: string[]; permissions?: string[] };
  target?: { system: string; resource?: string; environment?: 'production' | 'staging' | 'dev' | 'unknown';
             operation?: string; risk?: 'low' | 'medium' | 'high' | 'critical' };
  attrs: Record<string, string | number | boolean>;  // normalized gen_ai.* / mcp.* / hook attrs
  payloadSha256?: string;     // commitment to the (plaintext) payload blob
  summary?: string;           // ≤ 280 chars, redacted, always safe to show
  prevHash: string;           // hex, 64 zeros for seq 0
  hash: string;               // SHA-256(prevHash || canonical(event minus hash))
}
```

`summary` exists so every scene can render without ever touching a blob. Blobs are for drill-down.

### 4.2 Blob
`{ sha256, tenantId, size, mime, encrypted: boolean, keyId?, storageKey, createdAt }`.
Content-addressed by the SHA-256 of the **plaintext**. Stored encrypted (AES-256-GCM) under a
per-tenant data key; the data key is wrapped by a tenant KEK (local file in dev, KMS in AWS).
Erasure = destroy the data key. The event's `payloadSha256` commitment stays valid, so the chain
still verifies after erasure; only the plaintext is gone.

### 4.3 Checkpoint
```ts
interface Checkpoint {
  tenantId: string; treeSize: bigint; rootHash: string;   // Merkle root over event hashes [0, treeSize)
  headHash: string;                                        // chain hash at treeSize-1 (belt and braces)
  ts: string; keyId: string; signature: string;            // Ed25519 over canonical(checkpoint minus signature)
  anchor?: { kind: 'rfc3161' | 'rekor'; ref: string };     // v1: stub, nullable
}
```
Emitted every 1,000 events or 60 seconds, whichever first. Also written to S3 with Object Lock in
prod so the DB alone cannot rewrite history.

### 4.4 Run (materialized)
`{ id, tenantId, principalId, agentName, startedAt, endedAt, eventCount, status, riskMax,
divergenceCount, layout?: LayoutJson, graphVersion }` — recomputed on ingest (debounced) and
on demand. Layout is cached here because it is seeded and deterministic (NFR-5).

### 4.5 Policy
`{ id, tenantId, name, yaml, version, createdAt }` — see §10 for the DSL.

### 4.6 Tables and constraints
- `events(tenant_id, seq)` primary; indexes on `(tenant_id, run_id, seq)`, `(tenant_id, ts)`,
  `(tenant_id, kind)`. `REVOKE UPDATE, DELETE` from the app role **and** a trigger that raises on
  UPDATE/DELETE. Monthly partitioning is a later migration, not v1.
- `event_sources(tenant_id, source, source_id)` unique — idempotency for OTLP retries.
- `blobs`, `checkpoints`, `runs`, `policies`, `evidence_jobs`, `tenants`, `api_keys`.

---

## 5. Integrity design

1. **Canonical JSON** — RFC 8785 (JCS) so hashes are reproducible across Node and browser.
2. **Hash chain** — `hash_n = SHA-256(hash_{n-1} ‖ canonical(event_n \ hash))`. Detects
   modification and reorder; a gap breaks `seq` continuity.
3. **Merkle tree** — RFC 6962 hashing (`0x00‖leaf`, `0x01‖left‖right`) over event hashes.
   Gives O(log n) inclusion proofs and consistency proofs between checkpoints, so a verifier
   holding an old checkpoint can confirm the log only grew.
4. **Signed checkpoints** — Ed25519 (`@noble/ed25519`), key id in the checkpoint, public keys
   published at `/.well-known/debrief-keys.json` and embedded in every evidence bundle.
5. **Off-box copy** — checkpoints mirrored to object storage with retention lock (prod).
6. **Anchoring stub** — interface for RFC 3161 timestamping or Sigstore Rekor; v1 ships the
   interface and a no-op implementation.
7. **Single writer per tenant** — `pg_advisory_xact_lock(hash(tenant_id))` around append so
   `seq` and `prevHash` never race. Throughput is per-tenant serial; fine for v1.

What this proves: the events you are shown are exactly the events that were appended, in order,
since the checkpoint you trust. What it does not prove: that the agent's instrumentation told the
truth. That is why world hooks exist and why provenance is shown, never hidden.

---

## 6. Ingest

### 6.1 OTLP (`POST /v1/traces`)
Decode `ExportTraceServiceRequest` with `@opentelemetry/otlp-transformer`. Map spans by
`gen_ai.operation.name` (conventions are still "Development" status — pin `gen-ai/1.42.0` and
normalize in `packages/schema/otel-map.ts`; also accept OpenInference names).

| Span | Event(s) |
|------|----------|
| `invoke_agent` / `create_agent` | `agent.invoke` (attrs: `gen_ai.agent.name`, `gen_ai.agent.id`, `gen_ai.conversation.id`) |
| `chat` / `text_completion` / `generate_content` | `llm.call` (model requested + served, tokens, finish reason) |
| `execute_tool` | `tool.call` on start, `tool.result` on end (`gen_ai.tool.name`, `gen_ai.tool.call.id`, status) |
| `retrieval` | `tool.call` with `target.system = 'retriever'` |
| MCP client/server spans (`mcp.method.name = tools/call`) | enrich matching `tool.*` or create `mcp.*` |
| anything else | `error` if status ERROR, else dropped but counted |

Content (`gen_ai.input.messages`, `gen_ai.output.messages`) is honored only when the tenant's
capture mode is `on`; it goes through redaction (§6.4) and into a blob.

### 6.2 Native events (`POST /v1/events`)
Batch of `Event` minus `seq/prevHash/hash`. Used by `mcp-proxy` and world hooks. Idempotent via
`(source, sourceId)`.

### 6.3 Ordering and append
`normalize → redact → BEGIN → advisory lock(tenant) → seq = last+1 → prevHash = last.hash →
hash → INSERT → NOTIFY debrief_events → COMMIT`. Checkpointer runs as a separate worker in the API
process (`@nestjs/schedule`), not on the ingest path.

### 6.4 Redaction pipeline (runs before anything is persisted)
- Secret patterns (API keys, JWTs, private keys, connection strings) → replaced with `[secret:<8-char sha>]`.
- Allowlisted attribute keys are kept verbatim; everything else in free text is size-capped.
- PII detectors (email, phone, card-like numbers) → hashed with a per-tenant salt.
- MCP's own logging rule applies: never persist credentials, PII, or internal system details.
The pipeline is pure, unit-tested with fixtures, and its version is stamped on each event (`attrs['debrief.redaction.v']`).

---

## 7. Capture: MCP proxy

`apps/mcp-proxy` sits between an MCP client (Claude Code, Cursor, a custom agent) and any MCP
server. Two modes: spawn a stdio server as a child process; or forward to a remote streamable-HTTP
server. For every `tools/call` it emits `mcp.request` (tool, redacted args, `mcp.session.id`,
`traceparent` if the client sent one) and `mcp.response` (status, latency, result summary,
payload blob if capture is on). It also emits `delegation.grant` when it can see the token/scope
the server was started with (config-declared in v1).

Advisory policy: the proxy can evaluate the tenant policy and emit `policy.decision` events
without blocking. Blocking is a later milestone (the shared module with Mukhtiyar).

Config: `debrief-proxy --server "npx orbital-mcp" --tenant-key dbf_... --capture off|summary|on`.

---

## 8. Capture: world hooks and correlation

Three v1 sources of `world.change` (provenance `observed`):

| Source | Mechanism | Fields |
|--------|-----------|--------|
| Sandbox "Orbital" infra | emits natively from its API layer | project, environment, resource, operation, rowsOrBytes, backupExists |
| Postgres | audit trigger writing to `debrief_audit` + a poller (logical decoding later) | table, op, rowCount, txid, appUser |
| GitHub | webhooks: push, pull_request, delete, release | repo, ref, before/after SHA, actor |

**Correlation** (in `packages/reconstruct/correlate.ts`) links world events to the tool call that
caused them, with a confidence label:
- `exact` — same `traceparent` (the tool's HTTP client propagated it) or same `sourceId`.
- `strong` — same actor token/app user **and** within ±2s of a `tool.call`/`tool.result` pair
  targeting the same system.
- `weak` — same system, within ±10s, no actor match. Rendered dashed, never used for blast radius
  without a UI toggle.

---

## 9. Reconstruction engine (`packages/reconstruct`)

Pure functions over an ordered event array. No I/O. Deterministic.

```ts
interface Node { id: string; type: 'principal'|'agent'|'subagent'|'llm'|'tool'|'system'|'resource'|'policy'|'human'; ts: string; eventIds: string[] }
interface Edge { from: string; to: string; type: 'triggers'|'calls'|'returns'|'authorized_by'|'delegates_to'|'mutates'|'observes'|'messages'; confidence: 'exact'|'strong'|'weak' }
interface CausalGraph { nodes: Node[]; edges: Edge[]; runId: string; version: string }
```

- `buildGraph(events)` — folds events into nodes/edges; tool results attach to their calls by
  `gen_ai.tool.call.id`, then by span parentage, then by adjacency.
- `blastRadius(graph, nodeId)` — BFS over `mutates`/`observes` edges with confidence ≥ `strong`;
  groups touched resources by system; marks `recoverable` from world metadata (`backupExists`,
  reversible op). Returns ordered waves so the ripple animates by hop.
- `authorityLineage(graph, nodeId)` — walks `authorized_by`/`delegates_to` up to the principal;
  computes `scopeMismatch` when a grant's declared `scope` is narrower than the `permissions` it
  actually carried, or when the action's target falls outside the scope.
- `divergence(events, policy)` — evaluates each actionable event; returns `DivergencePoint[]`
  (`{ eventId, ruleId, effect, explanation }`). The first non-`allow` is the freeze frame.
- `layout(graph, seed)` — seeded force layout (d3-force with a seeded RNG), fixed iteration count,
  positions rounded to 0.01. Cached on the run.
- `direct(graph, layout, divergence, blast)` — the **auto-director**: produces camera keyframes
  `{ t, position, target, fov, easing, label }` for the Theatre: establishing → follow the agent →
  freeze at divergence → ripple → pull back to lineage. Deterministic given inputs.
- `narrate(run)` (opt-in, in the API not the package): asks Claude for a plain-language summary
  where every sentence must cite event ids; the API rejects sentences without citations.

---

## 10. Policy and counterfactual (`packages/policy`)

```yaml
version: 1
defaults: allow
rules:
  - id: prod-destructive-needs-approval
    match: { target.environment: production, target.risk: [high, critical], target.operation: [delete, drop, truncate, transfer] }
    effect: require_approval
  - id: token-scope-mismatch
    match: { authority.scopeMismatch: true }
    effect: deny
  - id: unknown-environment-destructive
    match: { target.environment: unknown, target.operation: [delete, drop, truncate] }
    effect: require_approval
```

`evaluate(event, ctx) → { effect: 'allow'|'deny'|'require_approval', ruleId?, explanation }`.
Match keys are dotted paths into the event; values are scalars or arrays (any-of).

**Counterfactual** = replay the recorded events through a different policy. Execution is
treated as halted at the first non-`allow`; every later event in the run is marked `would-not-
have-happened`. No LLM is re-executed (see DECISIONS D-006). The result is a second timeline that
shares a prefix with the original and diverges at the freeze frame.

---

## 11. Web: rendering architecture (`apps/web`)

**Stack:** Next.js (app router), React 19, TypeScript, `@react-three/fiber` + `@react-three/drei`,
`zustand` (replay + scene state), TanStack Query (data), SSE for live, `d3-hierarchy` for the
lineage tree, custom canvas-2D timeline, Tailwind for chrome. No component library for the scenes.

**Replay clock** (`packages/ui/replay-clock.ts`): `{ t, rate, playing, seek(t), play(), pause() }`.
Scenes subscribe; world state at `t` is a reducer over events ≤ `t` with memoized snapshots every
500 events so seeking is O(500).

**Design language:** near-black stage, one warm accent for risk (ember), one cool accent for
authority (cyan), off-white text, monospace for ids. Time is the primary control; everything
eases; nothing snaps. Every glyph has a hover card that shows the event `summary` and a
"verify" affordance that opens the inclusion proof.

| Scene | Route | Technique |
|-------|-------|-----------|
| Approach (live) | `/live` | r3f. Systems as extruded slabs placed by the seeded layout; agents as one `InstancedMesh` (≥ 5k) moving along cached trails; leash lines to principals via `LineSegments`; risk zones pulse via a shader uniform; SSE feed → zustand |
| Theatre | `/runs/[id]/replay` | r3f causal graph (instanced nodes, edge tubes), drei `CameraControls` driven by the auto-director keyframes, scrubber bound to the replay clock, reasoning subtitles as DOM overlay, world-state side panel, freeze-frame split view at the first divergence |
| Blast | `/runs/[id]/blast` | same graph; ripple shader expanding wave-by-wave from the node; affected list grouped by system with recoverable flags |
| Lineage | `/runs/[id]/lineage` | SVG tree (d3-hierarchy); mismatch hop highlighted; scope vs permissions rendered as two overlapping rings |
| Branch | `/runs/[id]/branch` | dual timelines rendered from the same clock; YAML policy editor → `POST counterfactual` → second timeline halts and greys the rest |
| Sealed File | `/runs/[id]/evidence` | export form, seal animation on job completion, download + link to verifier, regulation-map checklist |

**Performance budget:** ≤ 200 draw calls per scene; `dpr` capped at 1.5; `frameloop="demand"`
when paused; no postprocessing except optional bloom on pulses; a CI perf-smoke test renders
the demo run headless and asserts frame time.

**Video export:** `MediaRecorder` on the canvas → WebM, for postmortem meetings. Stretch.

---

## 12. Evidence bundle and verifier

`bundle.zip`:
```
manifest.json      version, tenant, runIds, time range, keyId, publicKey, redaction policy, generatedAt
events.jsonl       redacted per export policy (summaries always; blobs only if export.includeContent)
checkpoints.json   the checkpoint(s) the events are proven against
proofs.json        inclusion proof per event + consistency proof between included checkpoints
report.md          timeline, divergence points, lineage, blast radius, regulation map, glossary
regulation_map.json  which bundle sections support which requirement (EU AI Act Art. 12 elements, AI AGENT Act record elements, SOC 2 CC7.x) — "supports", never "certifies"
SIGNATURE          detached Ed25519 over SHA-256(manifest.json)
```

`apps/verify` (Vite, static, no backend): drop the zip or paste a hash → re-derives every event
hash, checks chain continuity, verifies each inclusion proof against the checkpoint root, verifies
the checkpoint signature against the embedded public key (and optionally against the live
`/.well-known` key), and animates the chain lighting up link by link. Any failure pins the
exact `seq` where verification broke.

---

## 13. API (v1)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/v1/traces` | OTLP/HTTP protobuf or JSON |
| POST | `/v1/events` | native batch, idempotent |
| GET | `/v1/runs?cursor&since` | list |
| GET | `/v1/runs/:id` | run summary |
| GET | `/v1/runs/:id/events?cursor&from&to` | paged, ordered by seq |
| GET | `/v1/runs/:id/graph` | CausalGraph + layout + director keyframes |
| GET | `/v1/runs/:id/blast?node=` | waves |
| GET | `/v1/runs/:id/lineage?node=` | tree + mismatches |
| POST | `/v1/runs/:id/divergence` | body: policy id or yaml |
| POST | `/v1/runs/:id/counterfactual` | body: policy yaml → branched timeline |
| POST | `/v1/runs/:id/narrative` | opt-in, cached |
| POST | `/v1/runs/:id/evidence` → GET `/v1/evidence/:jobId` | async job, S3 download URL |
| GET | `/v1/checkpoints?tenant` · GET `/v1/proof?event=` | proofs |
| GET | `/.well-known/debrief-keys.json` | public keys |
| GET | `/v1/live` | SSE: new events, new runs, new divergences |
| GET · POST | `/v1/keys` | list the tenant's keys · issue one (secret shown once) |
| POST | `/v1/keys/:id/rotate` | new key under the same name, old one revoked in the same transaction |
| DELETE | `/v1/keys/:id` | revoke; 409 for the last active key |

Auth: `Authorization: Bearer dbf_<key>` per tenant. Single org per deployment in v1.
Rate limits per key per minute in three buckets: ingest (600), read (1200), expensive (30:
jobs, narration, key management). Bodies: 8 MiB on the two ingest routes, 256 KiB elsewhere.
Every response carries the OWASP secure headers (CSP `default-src 'none'`, HSTS, `nosniff`,
`DENY` framing, `no-referrer`, `no-store` unless the route sets its own cache policy).

---

## 14. Security and threat model

| Threat | Mitigation |
|--------|------------|
| Insider edits or deletes events in Postgres | DB grants + trigger; chain + Merkle mismatch against off-box signed checkpoints; verifier pins the seq |
| Duplicate or replayed ingest | `(source, sourceId)` idempotency |
| Agent instrumentation lies or omits | world hooks (observed) vs reported; disagreement surfaced, not averaged |
| Secrets/PII in prompts or tool args | redaction before persistence; capture off by default; MCP logging rule enforced |
| Signing key compromise | key id in every checkpoint; rotation = new key id; old checkpoints remain verifiable against the old public key |
| Malicious evidence bundle | verifier trusts only the public key you give it; manifest signature checked first |
| DoS on ingest | per-key rate limits in three buckets; batch size and body caps; advisory lock keeps append serial per tenant |
| Leaked API key | rotate from any live key: the old hash stops resolving in the same transaction; keys are stored as sha256, shown once |

---

## 15. Deployment

- **Local:** `docker compose up` (postgres, minio) + `pnpm dev` (api :4000, web :3000,
  verify :5173, sandbox infra :4100). One `pnpm demo:nine-seconds` command seeds and runs the incident.
- **AWS (later):** ECS Fargate (api, web), RDS Postgres, S3 with Object Lock for checkpoints and
  bundles, KMS for tenant KEKs, CloudFront for `verify` as a static site.

---

## 16. Observability of Debrief itself
Pino structured logs, OTel traces for the API (yes, we drink our own coffee), `/healthz` and
`/readyz`, metrics: ingest rate, append latency p50/p99, checkpoint lag, redaction hit counts.

---

## 17. What we would revisit at scale
- Per-tenant serial append → sharded streams per (tenant, run) with a merge index.
- Postgres events table → ClickHouse or partitioned Postgres with tiered blobs.
- LISTEN/NOTIFY → NATS or Redis Streams for fan-out.
- Layout on the API → precomputed at checkpoint time for very large runs.
- Advisory proxy → enforcing gateway with approval workflows (shares the policy module).
