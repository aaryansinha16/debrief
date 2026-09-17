# Decisions

Compact ADRs. Add a new `D-NNN` when you make a choice the next person would question. Never
edit a decision's Decision text after it is Accepted; supersede it with a new entry.

Format: Status · Date · Context · Decision · Rejected · Consequences.

---

## D-001 Positioning: incident-centric, not observability
**Accepted · 2026-09-16**
Context: LLM observability is a consolidating market (Langfuse → ClickHouse, Galileo → Cisco) and
time-travel debugging is a crowded OSS niche. The unsolved part is reconstruction and evidence
for the day something goes wrong.
Decision: Every feature is judged by "does it help someone understand and prove an incident".
Daily debugging conveniences are out of scope unless they fall out for free.
Rejected: evals, prompt management, cost dashboards, gateway routing.
Consequences: fewer features, sharper demo; some developer requests will be declined.

## D-002 TypeScript end-to-end monorepo
**Accepted · 2026-09-16**
Context: Solo builder driving a coding agent; the chain code must run identically in Node, the
browser, and a static verifier.
Decision: pnpm workspaces + Turborepo; one language everywhere.
Rejected: Python/FastAPI for API and sandbox (two mental models, chain code duplicated);
polyglot per app.
Consequences: OTLP decoding via `@opentelemetry/otlp-transformer`; Python agent frameworks are
supported over the wire, never in-process.

## D-003 API: NestJS on the Fastify adapter with Drizzle
**Accepted · 2026-09-16**
Context: Aaryan's production stack is NestJS/Postgres/AWS; the events table needs SQL-first
control (advisory locks, append-only grants).
Decision: NestJS for structure and DI, Fastify adapter for throughput, Drizzle for SQL-first
migrations and typed queries.
Rejected: bare Fastify (less structure for agent-generated code); Prisma (ORM abstractions
fight append-only and lock semantics).
Consequences: some Nest boilerplate; raw SQL allowed in the events repository only.

## D-004 Store: Postgres append-only events + S3-compatible blobs
**Accepted · 2026-09-16**
Context: v1 scale is thousands of events per second at most; verifiability matters more than
analytics speed.
Decision: Postgres 16 with `REVOKE UPDATE, DELETE` plus a trigger; blobs content-addressed in
MinIO/S3; checkpoints mirrored to object storage with retention lock in prod.
Rejected: ClickHouse (revisit at scale), immudb (extra operational surface), any blockchain
(cost, latency, no benefit over signed checkpoints + optional public anchoring).
Consequences: per-tenant serial append (D-017); monthly partitioning deferred.

## D-005 Integrity: SHA-256 chain + RFC 6962 Merkle + Ed25519 checkpoints + RFC 8785 canonical JSON
**Accepted · 2026-09-16**
Context: Third parties must verify without trusting our database; proofs must be small.
Decision: chain hash for ordering, Merkle tree for O(log n) inclusion/consistency proofs,
Ed25519 signed checkpoints with key ids, JCS canonicalization for cross-runtime reproducibility.
Rejected: chain-only (no efficient proofs); SHA-3 (no ecosystem benefit); anchoring as a v1
requirement (interface only, no-op impl).
Consequences: `packages/chain` has golden tests and is frozen behind an "ask before changing"
rule in `CLAUDE.md`.

## D-006 Counterfactual = policy replay over recorded events; no LLM re-execution
**Accepted · 2026-09-16**
Context: Re-executing an agent with a changed prompt costs tokens, is non-deterministic, and
several OSS tools already do it.
Decision: A counterfactual replays the recorded stream through a different policy and treats
execution as halted at the first non-allow verdict.
Rejected: live branch re-execution (Rewind/Agent VCR style) in v1.
Consequences: deterministic, zero-cost, demo-safe; cannot answer "what would the agent have done
instead" — only "where would it have been stopped".

## D-007 Native OTLP/HTTP receiver, collector-compatible, pinned attribute map
**Accepted · 2026-09-16**
Context: Coding agents already emit OTel GenAI spans; the conventions are still in Development
status and moved to their own repo in June 2026; SDKs disagree on attribute names.
Decision: `/v1/traces` accepts OTLP directly (protobuf + JSON) so users can point an existing
Collector or SDK exporter at it; `packages/schema/otel-map.ts` pins `gen-ai/1.42.0` and
normalizes OpenInference and older names.
Rejected: requiring the OTel Collector; a proprietary SDK as the only path.
Consequences: a mapping table to maintain; drift handled in one file.

## D-008 Tool-call capture via an MCP proxy, advisory-only in v1
**Accepted · 2026-09-16**
Context: MCP is the common tool interface; a proxy sees request and response without
instrumenting the agent.
Decision: `apps/mcp-proxy` wraps stdio or streamable-HTTP servers, records both sides, and may
emit `policy.decision` events without blocking.
Rejected: blocking in v1 (turns a recorder into a gateway; different product surface).
Consequences: enforcement is a later milestone sharing `packages/policy`.

## D-009 World hooks are first-class; provenance is never merged
**Accepted · 2026-09-16**
Context: Instrumentation can lie or omit; incidents are about consequences.
Decision: `world.change` events carry `provenance: observed`; reconstruction weights observed
over reported and renders disagreement instead of averaging it.
Rejected: trusting traces alone.
Consequences: three hook sources in v1 (Orbital sandbox, Postgres trigger, GitHub webhooks);
correlation confidence labels are part of the UI.

## D-010 Content capture opt-in; redaction before persistence; erasure by key destruction
**Accepted · 2026-09-16**
Context: MCP's logging rule forbids credentials, PII, and internal details in logs; DPDP/GDPR
erasure conflicts with an immutable log.
Decision: capture modes `off | summary | on`; a pure redaction pipeline runs before any write;
blobs are content-addressed by plaintext hash and stored encrypted under a per-tenant data key;
erasure destroys the key, leaving the commitment valid.
Rejected: storing plaintext; deleting events.
Consequences: `summary` field on every event so scenes never need blobs.

## D-011 Rendering: react-three-fiber + drei + zustand; custom timeline; no deck.gl or theatre.js in v1
**Accepted · 2026-09-16**
Context: Six scenes share one graph and one clock; the team already ships three.js on the web.
Decision: one r3f canvas per scene, instanced meshes, DOM overlays for text, a canvas-2D
scrubber, zustand replay clock.
Rejected: deck.gl (2.5D data viz, wrong feel for the Theatre); theatre.js (dependency weight;
keyframes are generated, not hand-authored); PixiJS (2D only).
Consequences: perf budget in `ARCHITECTURE.md §11`; CI perf-smoke required.

## D-012 Deterministic seeded layout and auto-director computed in a pure package
**Accepted · 2026-09-16**
Context: The same run must look the same in a postmortem meeting, a PR, and an evidence PDF.
Decision: `packages/reconstruct` computes layout (seeded d3-force, fixed iterations, rounded
positions) and camera keyframes; results cached on the run.
Rejected: client-side live layout (jitters, non-reproducible).
Consequences: golden tests on layout and keyframes; layout version bump invalidates cache.

## D-013 Sandbox: deterministic scripted agent emitting real OTel; fictional "Orbital" PaaS
**Accepted · 2026-09-16**
Context: The demo must never fail on stage and must not name real vendors.
Decision: `apps/sandbox` ships a fake PaaS with tokens/permissions/volumes/backups and a scripted
agent that reproduces the nine-second deletion via genuine `gen_ai.*` spans and MCP calls; a
live-LLM mode exists behind a flag.
Rejected: live LLM as the default (non-deterministic, costs tokens per demo).
Consequences: fixtures double as golden inputs for reconstruction tests.

## D-014 Git workflow: branch per point, micro commits, single-line messages, rebase merges
**Accepted · 2026-09-16**
Context: Owner's rules: separate branch per point, micro commits, PRs, merge, repeat; no
verbose comments; single-line commit messages.
Decision: `p<NN>-<slug>` branches, `area: message` one-liners enforced by
`.githooks/commit-msg` (strips attribution trailers, rejects multi-line or > 72 chars), PRs via
`gh`, `gh pr merge --rebase --delete-branch` so micro commits survive on a linear `main`.
Rejected: squash merges (erase micro commits); merge commits (noise); relying on Claude Code's
`includeCoAuthoredBy`/`attribution` settings alone (reported as unreliable; the hook is the
enforcement).
Consequences: every point is reviewable commit by commit.

## D-015 Verifier is a separate static app sharing `packages/chain`
**Accepted · 2026-09-16**
Context: Verification must not depend on Debrief being up or honest.
Decision: `apps/verify` is a Vite static page deployable to any CDN; it imports only
`packages/chain` and `packages/evidence` (unpacker).
Rejected: verifier route inside `apps/web` (shares runtime with the thing being verified).
Consequences: bundle format must be stable and versioned (`manifest.version`).

## D-016 Evidence bundle format
**Accepted · 2026-09-16**
Context: Legal, compliance, and insurers need something they can open, and that a verifier can check.
Decision: zip with `manifest.json`, `events.jsonl`, `checkpoints.json`, `proofs.json`,
`report.md`, `regulation_map.json`, `SIGNATURE`; the regulation map says "supports", never
"certifies".
Rejected: PDF-only export; proprietary binary format.
Consequences: report generator is template-driven and tested with the demo run.

## D-017 Single writer per tenant via `pg_advisory_xact_lock`
**Accepted · 2026-09-16**
Context: `seq` and `prevHash` must never race.
Decision: append is serialized per tenant inside the transaction.
Rejected: optimistic retry on unique violation (thundering herd on bursts).
Consequences: throughput is per-tenant serial; sharded streams are a later change.

## D-018 Live feed via Postgres LISTEN/NOTIFY; no Redis in v1
**Accepted · 2026-09-16**
Context: One API node, one web app; keep the local stack to two containers.
Decision: `NOTIFY debrief_events` on append; SSE endpoint fans out in-process.
Rejected: Redis Streams / NATS (revisit with multiple API nodes).
Consequences: SSE reconnect uses `since` cursor; no message durability beyond the DB itself.

## D-019 Enforcement and approvals deferred; shared later with the UPI mandate product
**Accepted · 2026-09-16**
Context: The same policy/mandate evaluator is needed by the planned UPI agent-mandate layer.
Decision: `packages/policy` is written as a standalone, I/O-free module with a stable API so it
can be lifted into a gateway or another product without change.
Rejected: coupling policy evaluation to the API's DB models.
Consequences: policy DSL has its own versioning and golden tests.

## D-020 commit-msg hook rejects attribution trailers instead of stripping them
**Accepted · 2026-09-17** · supersedes the "strips attribution trailers" clause of D-014
Context: D-014 and the kickoff hook stripped `Co-Authored-By` and similar lines; the P-01
acceptance criteria and `CLAUDE.md` say such a commit is rejected.
Decision: any `Co-Authored-By`, `Claude-Session`, `Signed-off-by`, or "Generated with" line fails
the commit outright; the hook only strips `#` comment lines and trailing whitespace.
Rejected: silently rewriting the message (hides that the agent tried to add a trailer).
Consequences: a commit with an injected trailer fails loudly and must be re-issued clean.

## D-021 Wire encoding fixed by `packages/schema`: safe integers, lowercase hex, strict objects
**Accepted · 2026-09-17**
Context: RFC 8785 canonical JSON has no bigint; hashes must be reproducible across Node and the
browser; unknown keys would silently change what is hashed.
Decision: `seq` and `treeSize` are JSON integers in `[0, 2^53−1]` on the wire and in hash input
(`bigint` only in Postgres columns); `hash`, `prevHash`, `rootHash`, `headHash`, `payloadSha256`
are 64-char lowercase hex and Ed25519 `signature` is 128-char lowercase hex; every object schema
is strict (unknown keys rejected); `ts` must be UTC (`Z`), `sourceTs` may carry an offset.
Rejected: bigint-as-string on the wire (awkward for every client, no benefit under 2^53 events);
base64 signatures (two encodings in one record); passthrough objects (hash drift).
Consequences: any client field outside the schema is a 400, not an `attrs` entry; ARCHITECTURE
§4.1's `seq: bigint` reads as the storage type.

## D-022 Chain hash byte layout and verifier strictness
**Accepted · 2026-09-17**
Context: ARCHITECTURE §5 gives `hash_n = SHA-256(hash_{n-1} ‖ canonical(event_n \ hash))` without
saying how `hash_{n-1}` is encoded, what canonicalization tolerates, or what `verifyChain` assumes
about the slice it is given.
Decision: `hash = SHA-256(bytes(prevHash) ‖ utf8(JCS(event without hash)))`, where `prevHash` is
decoded from hex to 32 raw bytes and the canonical form includes `prevHash` and `seq`. `canonicalize`
implements RFC 8785 directly: plain objects and arrays only, undefined properties omitted; undefined
elements, non-finite numbers, bigint, Dates and class instances are errors. `verifyChain` starts at
seq 0 from the genesis hash unless `startSeq`/`prevHash` are pinned, and reports the expected seq at
the first failing position with a reason (`seq`, `prev-hash`, `hash`, `head`); truncation is only
detectable when `headHash` is supplied.
Rejected: concatenating the hex text of `prevHash` (two encodings of one value); delegating to
JSON.stringify with `toJSON` (Dates silently serialize); lenient slice verification by default
(a chain missing its first events would verify).
Consequences: golden vectors in `packages/chain/__golden__` pin all of this; any change is a schema
change under the "ask before" rule.

## D-023 Merkle proofs: RFC 6962 generation, RFC 9162 verification, cached complete subtrees
**Accepted · 2026-09-17**
Context: ARCHITECTURE §5 names RFC 6962 hashing but not the proof algorithms, the incremental
structure, or what a verifier may conclude from an inclusion proof.
Decision: leaf and node hashing per RFC 6962 §2.1; `PATH`/`PROOF` generation per RFC 6962
§2.1.1–2.1.2 over index ranges; verification per RFC 9162 §2.1.3.2 and §2.1.4.2 using integer
arithmetic (no 32-bit shifts) so sizes up to 2^53 work. `MerkleTree` keeps every complete-subtree
hash, so `rootAt(n)` and proofs at any earlier size come from cache with only the right spine
recomputed. Proofs and roots are lowercase hex; consistency needs 1 ≤ first ≤ second. An
inclusion proof verifies for every tree size that yields the same path shape — the signed
checkpoint's `treeSize` is what binds the size, never the proof.
Rejected: frontier-only trees (cannot prove earlier leaves); bit-shift arithmetic (truncates at
2^31); requiring the exact size in inclusion verification (not what the RFC algorithm computes).
Consequences: O(n) hashes of memory per tree; the API rebuilds a tenant's tree from stored event
hashes (P-12). Golden vectors are the Certificate Transparency 8-leaf test vectors.

## D-024 Checkpoint signing: key id derivation, signed body, and secret-key handling
**Accepted · 2026-09-17**
Context: ARCHITECTURE §4.3 and §5 name Ed25519 and "key id in the checkpoint" but give no
derivation, and say public keys are published without saying how secrets are produced or stored.
Decision: `keyId` is the first 16 hex chars of SHA-256 over the raw 32-byte public key; the keys
document lists `{ keyId, alg, publicKey }`. The signature is Ed25519 over
`utf8(JCS(checkpoint minus signature))`, so `keyId` is inside the signed body; `signCheckpoint`
derives `keyId` from the secret key and callers cannot choose it. `verifyCheckpoint` reports
`unknown-key`, `unsupported-alg`, `key-id-mismatch` or `signature`. The keygen CLI
(`pnpm --filter @debrief/api keygen [file]`) writes `{ keyId, alg, publicKey, secretKey }` to a
0600 file, refuses to overwrite, prints only the public entry; `*.signing-key.json` is git-ignored.
Rejected: the full SHA-256 as key id (64 chars in every checkpoint); JWK or base64 key encodings
(one encoding, lowercase hex, per D-021); printing the secret to stdout (shell history, CI logs).
Consequences: rotation is a new key plus a new entry; old checkpoints verify against the old entry.
The API loads the signing-key record from a path or env variable in P-12.

## D-025 API runtime: NestJS 12 (ESM) run through `@swc-node/register`; timestamps stored as text
**Accepted · 2026-09-17**
Context: Nest's DI needs `emitDecoratorMetadata`, which esbuild-based runners (tsx) cannot emit;
the workspace packages are ESM sources with `.js`-extension imports that Node's type stripping
cannot resolve. Event `ts`/`sourceTs` are part of the hashed canonical form, so the database
must return them byte-identical.
Decision: `apps/api` is ESM on NestJS 12 and runs as
`node --env-file-if-exists=../../.env --import @swc-node/register/esm-register src/main.ts` for
dev, start and the migration CLI; vitest uses `unplugin-swc` for the same reason. Migrations are
drizzle-kit SQL applied by `runMigrations({ adminUrl, appRole })` (one connection, `SET
debrief.app_role` read by the migration's `DO` block for grants); the app role gets SELECT/INSERT
on `events`, `event_sources`, `blobs`, `checkpoints`, no DELETE anywhere, and a statement-level
trigger raises on UPDATE/DELETE/TRUNCATE of `events` for every role. `events.ts`, `source_ts`,
`checkpoints.ts` and `runs.started_at/ended_at` are `text` columns holding the RFC 3339 strings
as hashed; the API writes `ts` as `toISOString()` so `(tenant_id, ts)` sorts chronologically.
API keys are `dbf_` + 43 base64url chars, stored as SHA-256 hex; the guard resolves the hash and
attaches `{ keyId, tenantId, captureMode }` to the request; `/healthz`, `/readyz` are `@Public()`.
Rejected: CommonJS Nest with `require(esm)`; a `tsc` build of every workspace package just to run
the API; `timestamptz` columns (lossy round-trip breaks hashes); `@Inject()` on every parameter to
keep tsx (fights every Nest idiom).
Consequences: prod runs the same loader until a bundling point is scheduled; `drizzle-kit
generate` output is committed under `apps/api/drizzle` and its `meta` is prettier-ignored.

## D-026 OTLP ingest: own decoder over vendored protos; content never enters `attrs`
**Accepted · 2026-09-17**
Context: `@opentelemetry/otlp-transformer` only serializes requests (exporter side), so a receiver
needs its own decoder. The gen-ai conventions are still evolving and OpenInference is common in
the wild. Content attributes must never be persisted unredacted (D-010), but P-13 owns redaction.
Decision: the OTLP trace protos (opentelemetry-proto v1.11.0) are vendored under `apps/api/proto`
and decoded with `protobufjs`; OTLP/JSON is validated with zod. Both produce the plain `OtelSpan`
shape that `packages/schema/otel-map.ts` maps. Attribute names are pinned to gen-ai 1.42.0 with
an alias table (deprecated gen_ai names, OpenInference `llm.*`, `tool.*`, `input.value`,
`output.value`, `openinference.span.kind`); the canonical name wins when both appear. Every
content attribute (`gen_ai.input.messages`, `gen_ai.output.messages`, system instructions, tool
arguments/results, `llm.input_messages.*`, `retrieval.documents.*`, …) is split out of `attrs`
into a separate `content` bag that is dropped entirely when capture is `off` and left for P-13
otherwise; the receiver does not persist it yet. `execute_tool` and `retrieval` spans yield a
`tool.call` (start) and `tool.result` (end) pair; MCP spans yield `mcp.request`/`mcp.response`;
unknown operations become `error` events when the span status is ERROR and are otherwise counted
and reported in `partialSuccess` with `rejectedSpans: 0`. `sourceId` is `traceId:spanId[:suffix]`
and `event_sources` makes replays idempotent per `(source, sourceId)`. String arrays are stored
comma-joined; other arrays and kvlists as JSON strings. `sourceTs` keeps nanosecond precision.
Rejected: deep-importing the transformer's generated protobuf module (internal path); dropping
retrieval results (loses the evidence the demo needs); JSON-encoding every array (unreadable
`finish_reasons`).
Consequences: `pnpm --filter @debrief/api` carries ~8 MB body limit and a protobuf content-type
parser; gzip request bodies are not yet accepted (P-50).

## D-027 Native events: server-assigned identity, sourceId idempotency, in-process rate limit
**Accepted · 2026-09-17**
Context: ARCHITECTURE §6.2 says `/v1/events` takes "Event minus seq/prevHash/hash", but `id`,
`ts` and `tenantId` are the server's to assign (the tenant comes from the key, `ts` is ingest
time), and idempotency must survive client retries without trusting client ids.
Decision: the wire schema is `EventInput` minus `id`/`ts`/`tenantId`, plus an optional
`sourceId` (≤ 512 chars); `source` is limited to `mcp-proxy | world-hook | api`; objects are
strict, so a client-supplied `id`, `ts` or `tenantId` is a 400. Idempotency is per
`(tenantId, source, sourceId)` through `event_sources`; events without a `sourceId` are stored
on every request. Attributes with content names (per `isContentAttribute`) are rejected with 400
so nothing unredacted reaches `attrs`; NUL characters are rejected (Postgres text cannot hold
them). Caps: 1,000 events or 1 MiB per batch → 413. Rate limit: fixed 60 s window per API key
(`RATE_LIMIT_PER_MINUTE`, default 600) shared by `/v1/events` and `/v1/traces`, in-process only,
answering 429 with `Retry-After` and `X-RateLimit-*` headers.
Rejected: accepting client ids (duplicate-key 500s on retry); sliding-window or token-bucket
limiters (more state for no v1 benefit); a shared limiter store (D-018: no Redis in v1).
Consequences: multi-node ingest would multiply the effective limit; the response returns
`{ accepted, duplicates, events: [{ id, seq }] }` so a client can correlate its batch.

## D-028 Checkpointer: in-process interval worker, per-tenant cached trees, best-effort mirror
**Accepted · 2026-09-17**
Context: ARCHITECTURE §4.3 asks for a checkpoint every 1,000 events or 60 s, mirrored to object
storage, with proofs served against it; §6.3 names `@nestjs/schedule`.
Decision: `CheckpointerService` runs a plain `setInterval` (`CHECKPOINT_INTERVAL_MS`, unref'd) and
is told the head seq by the ingest paths (`observe`), never awaited by them. A tenant is cut when
`pending ≥ CHECKPOINT_EVERY_EVENTS` or when the interval has elapsed since its last checkpoint.
Cutting: head seq → `treeSize = seq + 1`, merkle root from a per-tenant `MerkleTree` kept in
memory and extended from the events table on demand (`TreeCache`, rebuilt lazily after restart),
`signCheckpoint` with the process key, `INSERT … ON CONFLICT DO NOTHING`. Leaves are the raw
32-byte event hashes. Mirroring writes `checkpoints/<tenant>/<treeSize padded 16>.json` through an
`ObjectStore` (S3/MinIO via `@aws-sdk/client-s3`, path style); failures are retried on later runs
from an in-memory pending set. The signing key comes from `SIGNING_KEY_FILE` (keygen JSON,
resolved against the repo root) or `SIGNING_KEY_SECRET`; `pnpm run setup` generates the file.
`GET /v1/proof?event=|seq=` answers with the latest checkpoint covering the event plus the RFC
6962 inclusion path, and verifies it before answering; `/.well-known/debrief-keys.json` is public.
Rejected: `@nestjs/schedule` (a dependency for one interval); rebuilding the tree per proof (O(n)
each); a `mirrored_at` column (DB is not the source of truth for the off-box copy); blocking
ingest on the checkpoint.
Consequences: O(n) memory per tenant tree; multi-node would need one checkpointer leader;
`S3_*` credentials fall back to `MINIO_ROOT_*` in local config.

## D-029 Redaction lives in `packages/schema`, runs inside `append`; blobs are sealed per tenant
**Accepted · 2026-09-17**
Context: ARCHITECTURE §6.4 wants one pure, versioned redaction pipeline that both the API and
the MCP proxy (P-14) apply before anything is persisted; §4.2 wants content-addressed blobs
whose plaintext dies with a per-tenant data key while the chain keeps verifying.
Decision: `packages/schema/src/redaction.ts` (pure, browser-safe) masks secrets with
`[secret:<8 hex of sha256>]` (unsalted, so the same credential correlates across events), and
hashes email/phone/Luhn-valid card numbers with a per-tenant salt as `[email:…]` etc.; free text
is capped at 4,096 chars, summaries at 280; `attrs['debrief.redaction.v']` stamps the version.
Rules cover PEM keys, JWTs, connection strings, vendor prefixes (`sk-`, `ghp_`, `AKIA`, `xox`,
`AIza`, our `dbf_`, Orbital's `orb_live_`), `Bearer` tokens and `name = value` assignments,
including JSON-escaped quotes. `EventsRepository.append` applies `redactEvent` (attrs, summary,
actor.name, target.resource/operation, authority.tokenRef) so no ingest path can skip it;
identifiers (actor.id, target.system, principalId) stay verbatim. Capture `summary` adds a
redacted ≤ 120-char quote to the event summary; `on` additionally seals the redacted content
document (`{ sourceId, content }`) with AES-256-GCM under the tenant data key and sets
`payloadSha256` to the plaintext digest. Data keys are random 32 bytes wrapped with
`BLOB_MASTER_KEY` (AES-256-GCM, aad `dek:<tenant>:<keyId>`) in `tenant_keys`, which also holds the
PII salt; `destroy()` nulls the wrapped key. Native `/v1/events` still rejects content-named attrs.
Rejected: a separate `packages/redaction` (one more package for one file); redacting in each
controller (bypassable); AES-KW for wrapping (GCM is what Node ships); storing raw content when
capture is `on` (D-010).
Consequences: redaction is lossy by design and the version must bump when rules change; blobs
are written before the append dedupes, so OTLP retries re-`put` (cheap: content-addressed).

## D-030 No server-side branch protection while the repo is single-developer
**Accepted · 2026-09-17**
Context: GitHub gates branch protection and rulesets behind Pro for private personal repos
(P-02.1). Aaryan is the only developer.
Decision: leave `main` unprotected server-side; the `.githooks/pre-push` hook plus the
one-branch-per-point workflow are the enforcement. Revisit when a second developer or a public
repo appears.
Consequences: the P-02 "failing lint blocks merge" criterion is enforced by discipline; P-02.1
is closed.

## D-031 MCP proxy: JSON-RPC relay with per-request traceparent, client-side secret masking
**Accepted · 2026-09-17**
Context: ARCHITECTURE §7 wants both sides of every MCP call recorded with redaction and a
`traceparent` propagated; P-14's "passes its own test suite unchanged" cannot be taken literally
because the reference server's tests are in-process unit tests with a mock server.
Decision: the proxy relays newline-delimited JSON-RPC between the client and a spawned server,
touching only client→server requests: it injects `params._meta.traceparent`
(`00-<traceId>-<spanId>-01`), keeping an incoming traceparent's trace id and using its span as
parent, otherwise a per-session trace id. Every request with an id becomes an `mcp.request`
event immediately and an `mcp.response` when the matching id answers, carrying
`mcp.latency_ms`, `mcp.status` and `jsonrpc.error.code`; `tools/call` adds `gen_ai.tool.name`,
a `target` (`system` = server name from `initialize`) and content under
`gen_ai.tool.call.arguments/result`; other methods put params/result under `mcp.request.params`
/ `mcp.response.result`. Content is masked with `redactSecrets` (no salt needed) before leaving
the host and again by the API, which now accepts an optional `content` bag on `/v1/events` and
runs it through the same `CaptureService` as OTLP. Events are batched (100 or 250 ms) and
retried with backoff; the relay never waits on the API. Server-initiated requests,
notifications and unmatched responses pass through untouched. Conformance is proven by running
one client suite (ping, tools/list, three tool calls incl. an unknown tool, resources, prompts)
against `@modelcontextprotocol/server-everything` directly and through the proxy and requiring
identical results.
Rejected: recording notifications (no request/response pair, mostly `list_changed` noise);
per-session events only (loses latency per call); blocking the relay until the API acks.
Consequences: `initialize` snippets quote the protocol version (harmless); a client that already
uses `_meta.traceparent` gets exact correlation with world hooks in P-23.

## D-032 Policy DSL core built in P-15; verb-prefix matching; proxy HTTP mode as a relay
**Accepted · 2026-09-17**
Context: P-15 needs advisory `policy.decision` events but the DSL is scheduled for P-26; building
a throwaway format for the proxy would mean two formats. ARCHITECTURE §10 shows
`target.operation: [delete, drop, …]` while the sandbox tools are named `deleteVolume`.
Decision: `packages/policy` gets its core now — `parsePolicy(yaml)` (zod-validated, every
issue carries a YAML line/column, `PolicyParseError`), `evaluate(subject, policy, ctx)` (first
matching rule wins, else `defaults`), `lookup` with dotted paths where the longest existing key
wins at each level (so `attrs.gen_ai.tool.name` reaches the dotted attribute). String values
match case-insensitively, exactly or as a verb prefix ending at a camelCase/`_`/`-` boundary
(`delete` matches `deleteVolume`, not `deleted`; `prod` does not match `production`). Arrays are
any-of on both sides; `ctx` supplies derived fields (`authority.scopeMismatch`) and overrides the
subject. The proxy evaluates each `tools/call` request event against `--policy` and emits a
`policy.decision` only when a rule matched (`policy.mode: advisory`, `policy.effect`,
`policy.rule.id`, `policy.explanation`, `policy.subject` = the request's sourceId, same span as
the request); the request is forwarded regardless. `--capture off` strips content at the proxy;
`summary`/`on` send it and the tenant's server-side mode decides. HTTP mode is a pure relay:
POST bodies are parsed for recording and `_meta.traceparent` injection, responses (JSON or SSE)
are copied to the client byte-for-byte while a side tap records them; GET/DELETE pass through;
the recorder is bound to the upstream `Mcp-Session-Id` once `initialize` returns one.
Rejected: a proxy-only mini policy format; emitting an `allow` decision for every call (noise);
rewriting SSE frames (risk of breaking resumability); requiring `--listen` (a free port is
printed instead).
Consequences: P-26 now owns fixtures, the 20-event evaluation test and any DSL additions rather
than the core; `--tenant-key` (ARCHITECTURE §7) and `--key` are aliases.

## D-033 Orbital infra: permissions enforced, scope only declared; one change event per mutation
**Accepted · 2026-09-17**
Context: the nine-seconds story turns on a token whose declared scope (`staging:credentials`)
is narrower than what it can actually do (`account:*`). ARCHITECTURE §8 wants `world.change`
events with `backupExists`, project, environment, resource, operation, rowsOrBytes.
Decision: Orbital tokens carry both `scope` (declared) and `permissions` (`<env>:<resource>:
<action>` with `*` wildcards; `account:*` is everything); only permissions are enforced, and a
refusal is a 403 `credential_mismatch` that emits nothing. Every mutation (`deleteVolume`,
`rotateCredential`) records exactly one `world.change` with `provenance: observed`, actor
`orbital-infra`, the token's full `authority` (principal, tokenRef, scope, permissions), a
`target` with environment/operation/risk (production delete = critical), and
`world.field/before/after` — deleting a volume folds its backups into that one event
(`backupExists: true → false`). A `traceparent` request header is copied into `attrs.traceparent`
and its trace id becomes `runId`; otherwise `runId` is `orbital:unattributed`. The seed lives in
`seedState()` and `POST /api/reset` restores it for repeatable demo runs. The hook posts one
event per change with retries and never blocks the API response.
Rejected: emitting separate backup-deleted events (the AC wants one); enforcing scope (the
mismatch would never happen); reusing the proxy's emitter (apps do not import apps).
Consequences: P-17's MCP server must forward `_meta.traceparent` as the `traceparent` header for
exact correlation; without a Debrief key the service logs and serves but emits nothing.

## D-034 Scripted agent: real OTel spans, sync capture chain for deterministic order, live mode via a manual loop
**Accepted · 2026-09-17**
Context: P-18 wants an agent that reproduces the incident identically on every run, using real
`gen_ai.*` spans, with `--live` swapping in Claude. Three independent emitters (agent OTLP,
proxy, world hook) would interleave nondeterministically.
Decision: the agent (`apps/sandbox/src/agent`) uses the OTel JS SDK with an OTLP/JSON exporter
to `/v1/traces` and a `SimpleSpanProcessor`, force-flushing after every chat span and every tool
span; it starts the MCP proxy with `--sync` and the demo infra with `ORBITAL_HOOK_SYNC=1`, so
every event is acknowledged by the API before the message that caused it is relayed. That yields
one fixed order per tool call: `llm.call`, `mcp.request`, (`world.change`), `mcp.response`,
`tool.call`, `tool.result`; the root `agent.invoke` span closes last. Each `execute_tool` span's
traceparent is passed in `_meta`, so proxy events and world changes share the agent's trace and
parent span. The agent emits `principal.session` and two `delegation.grant`s natively: the
human-issued staging token at start and, when it reads the leaked token, an introspected
(`GET /api/tokens/self`) grant showing scope `staging:credentials` with permissions `account:*`.
`--live` keeps the same spans and MCP path but lets `claude-opus-5` choose tools through a manual
tool loop (`client.beta.messages.create` with `fallbacks: "default"`, adaptive thinking by default,
no forced tool choice); it is tested against a scripted fake of the Messages API.
Rejected: a fixed per-run trace id (replays would dedupe against each other); recording order by
timestamps (ts is excluded from the AC on purpose); the SDK tool runner (each MCP call needs its
own span around the proxy transport).
Consequences: sync mode adds a round-trip per relayed message and is for demos, not production
proxies; `mcp initialize` events carry the proxy's session trace, not the agent's.

## D-035 Runs: materialized from events in SQL, debounced per run, seq cursors for events
**Accepted · 2026-09-17**
Context: ARCHITECTURE §4.4 wants a run summary recomputed on ingest (debounced) and on demand;
P-20 needs cursor pagination that stays stable while events keep arriving.
Decision: `RunsRepository.materialize` recomputes a run from the events table in three queries
(aggregates, first principal, first agent actor) and upserts `runs`; `principalId` is the first
`authority.principalId` or `principal.session` actor, `agentName` the first agent/subagent actor,
`status` is `ended` once an `agent.invoke` (root span end) exists, `riskMax` is the highest
`target.risk`, `divergenceCount` counts `policy.decision` events whose effect is not `allow`
until P-27 replaces it. Ingest paths call `RunsService.observe`, which debounces per
(tenant, run) by `RUN_DEBOUNCE_MS` (250) and never blocks the request; `GET /v1/runs/:id`
materializes on demand when the row is missing. `GET /v1/runs` pages newest-first with a
`(startedAt, id)` keyset cursor; `GET /v1/runs/:id/events` pages by `seq` with the last served
seq as the cursor (append-only + monotonic ⇒ no gaps or duplicates under concurrent ingest),
plus `from`/`to` seq bounds. Cursors are base64url and validated on the way in.
Rejected: incrementing counters on each append (drifts on replays and dedupes); offset paging
(shifts under inserts); `sourceTs` for run times (client clocks).
Consequences: every distinct `runId` becomes a run, including the proxy's `initialize` session
trace and `orbital:unattributed`; the web list may filter those later.

## D-036 Live feed: one LISTEN connection, per-subscriber catch-up from seq, SSE ids are seqs
**Accepted · 2026-09-17**
Context: ARCHITECTURE §13 and D-018 want `GET /v1/live` over Postgres LISTEN/NOTIFY with a
`since` cursor and heartbeats; the AC needs sub-200 ms delivery and gap-free resumes.
Decision: `LiveService` holds one `sql.listen('debrief_events')` per process. A NOTIFY only
wakes subscribers of that tenant; each subscriber then reads forward from its own `lastSeq`
(batches of 500) until caught up, so coalesced or dropped notifications cannot lose events and
a resume is the same code path as a wake-up. The SSE `id` of every `event` frame is the seq, so
browsers resend it as `Last-Event-ID`; `?since=<seq>` does the same explicitly and `?run=<id>`
filters to one run. Without either cursor the stream starts at the tenant's current head (a
live feed, not a replay). `run` frames announce the first event of each run seen on the stream;
`: keepalive` comments go out every `LIVE_HEARTBEAT_MS` (15 s). Streams are ended on module
shutdown so `app.close()` does not wait on them. Auth is the bearer key (the web app streams
with `fetch`, not `EventSource`).
Rejected: trusting the NOTIFY payload's seq range (misses coalesced notifies); a per-subscriber
LISTEN (connection per client); `?key=` in the URL for EventSource (keys in logs).
Consequences: catch-up reads hit the events table per subscriber per wake-up (cheap: PK range
scan); `divergence` frames arrive with P-27.
