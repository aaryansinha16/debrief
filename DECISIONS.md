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

## D-037 Causal graph: phased fold, content-derived node ids, grant nodes, canonical order
**Accepted · 2026-09-17**
Context: ARCHITECTURE §9 sketches `buildGraph(events)`; P-22 needs a golden graph for the demo
run, deterministic node ids, and immunity to unrelated runs. The demo's four sources interleave
(OTLP spans export at span end, so the proxy's `mcp.*` events precede the `tool.call` they belong
to in `seq` order) and the MCP server, the PaaS and the OTLP tool type are three different
"systems" (`orbital-mcp`, `orbital`, `extension`).
Decision: `buildGraph(events, { runId? })` keeps only one run (default: the run of the lowest
seq), orders events by `(sourceTs to the nanosecond, seq)`, then folds in phases: grants,
tool calls, everything else, LLM→tool `triggers`. Node ids derive from content, never from
position: `principal:<id>`, `agent:<id>`, `grant:<tokenRef|grantId|eventId>`, `llm:<eventId>`,
`tool:<eventId of the tool.call or bare mcp.request>`, `system:<target.system>`,
`resource:<system>:<resource>`, `policy:<eventId>`. A `grant` node type is added to §9's list so
authority lineage (P-25) has a hop to flag; `tool.result`/`mcp.*`/`policy.decision` attach to
their tool by call id, then span (own or parent), then adjacency (`strong`). Edges carry
`eventIds` and the highest confidence seen; nodes carry the events they are the subject of (an
agent node holds its invoke/plan/message events, not every call it made). Output is sorted by
first-attached timeline position then id, so any input order yields byte-identical JSON.
Rejected: seq-based node ids (shift when runs interleave); a single timeline pass (attachment
then depends on sub-millisecond clock agreement between the SDK and the proxy); merging the MCP
server and the PaaS into one system node (they are observed separately and P-23 links them).
Consequences: the demo graph is 25 nodes / 66 edges; tools in the demo have no `authorized_by`
edge because OTLP spans carry no authority — P-23's world correlation supplies it; `GRAPH_VERSION`
bumps whenever this output changes.

## D-038 World correlation: one link per change, exact by traceparent, strong by token or operation
**Accepted · 2026-09-17**
Context: ARCHITECTURE §8 defines `exact` (same traceparent or sourceId), `strong` (same token
and within ±2 s of a tool call targeting the same system) and `weak` (same system within ±10 s).
In the demo the tool call's own events carry no authority (OTLP spans) and its "system" is the
MCP server (`orbital-mcp`) or the OTLP tool type (`extension`), while the world change names the
PaaS (`orbital`); `sourceId` is not part of the `Event` wire shape.
Decision: `correlateWorld(events, graph, windows?)` returns at most one `WorldLink`
`{worldEventId, toolNodeId, confidence, reason, deltaMs}` per `world.change`, choosing the most
confident then the nearest tool node of the graph's run. `exact` when the change's traceparent
names a span the tool node owns (the OTLP span or the proxy's `_meta` span); a traceparent from
another trace disqualifies the change. `strong` within ±2 s of the tool's [first, last event]
window when the change's `authority.tokenRef|grantId` matches the tool's, or when its
`target.operation` equals the tool name. `weak` within ±10 s when the systems match, with
`orbital` ≈ `orbital-mcp` (dash-prefix relation) and generic tool types ignored.
`applyWorldLinks(graph, links, events)` returns a new graph with `tool → resource` `mutates`
edges at the link's confidence plus `tool → grant|principal` `authorized_by` from the authority
the world saw; the P-22 graph and its golden are untouched.
Rejected: matching `sourceId` (not on the wire); requiring a literal system match for `strong`
(never true across proxy, SDK and PaaS naming); many-to-one links (a change has one cause).
Consequences: weak links exist only as candidates for P-24's toggle; with traceparent stripped
the demo still links `strong` by operation, and a copy of the change 30 s later links nothing.

## D-039 Blast radius: hop waves over resource edges, backups as a derived consequence node
**Accepted · 2026-09-17**
Context: ARCHITECTURE §9 wants `blastRadius(graph, nodeId)` as a BFS over `mutates`/`observes`
edges at confidence ≥ strong, grouped by system, with `recoverable` from world metadata. The
demo's second wave ("backups") has no event of its own: the Orbital hook reports the loss on the
volume's change (`world.field: backupExists true→false`, `world.backupsDeleted: 2`).
Decision: `withConsequences(graph, events)` adds one derived node
`resource:<system>:<resource>/backups` per change that lost backups, attached to its volume by an
`exact` `mutates` edge citing that change, so the BFS reaches it as hop 2. `blastRadius(graph,
origin, events, { includeWeak? })` walks outgoing `mutates`/`observes` edges from the origin
(strong and exact by default; `includeWeak: true` lowers the bar), visiting each resource once,
returning `waves[{hop, resources[{nodeId, system, resource, via, recoverable, reasons}]}]`,
`groups` by system and an overall `recoverable`. A resource is unrecoverable when the change
lost backups or its operation is irreversible (delete/remove/drop/destroy/purge/truncate/kill)
with no `backupExists: true` observed; other mutations are `reversible-operation`, pure reads
`read-only`. Weak edges never traverse unless toggled, so a decoy change linked only by system
proximity is out of the default blast.
Rejected: a per-world-event "consequence" event emitted by the hook (would fabricate observed
events); treating the backups as an attribute of the volume wave (the ripple animates per hop).
Consequences: the demo blast from the second `deleteVolume` is 2 waves, `recoverable: false`;
from `rotateCredential` it is 1 wave, recoverable. Events are passed in because recoverability
reads world attributes the graph does not carry.

## D-040 Authority lineage: hops are holders, tokens handed over annotate the delegate, adopted tokens are hops
**Accepted · 2026-09-17**
Context: ARCHITECTURE §9 wants `authorityLineage(graph, nodeId)` to walk `authorized_by` /
`delegates_to` to the principal and compute `scopeMismatch`; the AC reads "human → coding-agent
→ token", three hops for two grants, and wants the token hop to show both rings.
Decision: `authorityLineage(graph, origin, events)` returns root-first `hops` where each hop is
an authority holder: the principal, each delegate shown with the rings of the token it was
handed (`grantor ≠ grantee`), and a separate `grant` hop for a token an actor adopted itself
(`grantor = grantee`) or whose grantor is unknown when no holder is known. The action's grant is
the tool's `authorized_by` grant (from P-23's world-observed authority); when none was observed
the walk starts from the caller's own grants and `authorityObserved` is false. Grant choice is
time-aware: the latest grant an actor held before the action, else its earliest. Mismatches per
hop: `permissions-exceed-scope` (permissions not covered by any scope entry under colon-prefix
matching with `*`), graded `major` when a permission is a wildcard or leaves the scope's first
segment, else `minor`; `target-outside-scope` (`major`) when the action's descriptor
`environment:resourceClass:operation` is uncovered by the acting hop's scope. `complete` and
`principalId` come from the root hop being a principal or human. Revocations now fold in the
grant pass so a token referenced only by a revoke still resolves.
Rejected: one hop per grant (the AC's three-hop reading and the ring UI want holders); literal
resource matching for targets (scopes name classes, not paths).
Consequences: the demo lineage is Aaryan → coding-agent (minor: `staging:files:read` exceeds
`staging:credentials`) → legacy migration token (major: `account:*`, and
`production:volumes:deleteVolume` outside `staging:credentials`); `rotateCredential` and
unobserved calls resolve to the principal through the staging token.

## D-041 Policy subjects: scopeMismatch is derived per event and true only for major mismatches
**Accepted · 2026-09-17**
Context: the §10 `token-scope-mismatch` rule matches `authority.scopeMismatch`, which is not an
event field. The demo's staging token carries a minor excess (`staging:files:read` outside
`staging:credentials`); a literal reading would deny the benign `rotateCredential` and move the
P-27 freeze frame away from `deleteVolume`. Both `policy` and `reconstruct` need the same scope
arithmetic without depending on each other.
Decision: scope matching lives in `@debrief/schema` (`scopeCovers`, `permissionsExceedingScope`,
`targetDescriptor`, `scopeMismatchOf(authority, target?)` → `{excess, targetOutsideScope?,
severity}`); `severity` is `major` when a permission is a wildcard, leaves every scope's first
segment, or the target descriptor is outside the scope, else `minor`. `policy`'s `subjectOf(event)`
spreads the event and, when it has an authority, adds `authority.scopeMismatch` (true only for
`major`) and `authority.scopeExcess`; `evaluateEvent(event, policy, ctx?)` evaluates that subject
with ctx still winning on lookup, so P-27 can supply lineage-derived facts. `packages/policy`
ships `@debrief/policy/fixtures` (20 events across environment, risk, verb prefix, case, scope
severity and rule order) and the golden `__golden__/prod-guard-decisions.json`; `prod-guard.yaml`
is exported as `@debrief/policy/prod-guard.yaml`. Rule order stays first-match: a production
destructive change made with a mismatched token yields `require_approval`, not `deny`.
Rejected: computing scopeMismatch only in reconstruct (policy could not evaluate a bare event);
treating any excess as a mismatch (denies the demo's rotate).
Consequences: lineage's per-hop severities now come from the shared grader, unchanged in output.

## D-042 Divergence: actionable = tool calls plus unexplained world changes, judged with observed context
**Accepted · 2026-09-17**
Context: ARCHITECTURE §9 wants `divergence(events, policy)` to evaluate "each actionable event"
and take the first non-`allow` as the freeze frame; P-27's AC pins the demo's freeze frame to the
`deleteVolume` call. An OTLP `tool.call` carries no environment, risk or authority, and grants or
unobserved tokens must not move the freeze frame (the adopted `account:*` token predates the
harmless `listVolumes`).
Decision: `divergence(events, policy, graph = reconstructGraph(events))` evaluates, in timeline
order, one primary event per tool node (`tool.call`, else a bare `mcp.request`) and every
`world.change` of the run that no tool explains; grants, approvals and LLM turns are not actions.
A tool's policy context overlays its own target with the correlated world change's target and,
only when the lineage's authority was observed (P-23 link), adds the acting token with
`scopeMismatch`/`scopeExcess` graded against that target; unobserved authority is never
asserted. `evaluateEvent` from `@debrief/policy` does the matching, so ctx wins over the event.
Non-`allow` decisions become `DivergencePoint {eventId, seq, kind, nodeId?, effect, ruleId?,
explanation}`; the first is `freezeFrame`. `reconstructGraph(events, {runId?})` names the full
pipeline (graph → correlation → consequences) for P-28/P-30. `@debrief/reconstruct` now depends
on `@debrief/policy` (both depend on `schema`; policy stays free of reconstruct).
Rejected: evaluating world changes already linked to a call (double-counts one action); treating
`delegation.grant` as actionable (the adoption would be the freeze frame, not the deletion);
asserting the agent's latest token for unobserved calls (flags `listVolumes` first).
Consequences: the demo under `prod-guard.yaml` yields exactly one point — seq 45, the second
`deleteVolume` call, `require_approval` by `prod-destructive-needs-approval`; under `allow-all`
none. A world-only capture (no OTLP) still diverges on the change itself.

## D-043 Counterfactual: replay in timeline order from P-27's freeze frame, prefix untouched
**Accepted · 2026-09-17**
Context: ARCHITECTURE §10 defines the counterfactual as the recorded run replayed under another
policy, halted at the first non-`allow`, with every later event marked and a byte-identical
shared prefix. The freeze frame that matters is P-27's (judged with reconstructed context), and
the halted call's own MCP and world events carry lower `seq`s than its OTLP span.
Decision: timeline ordering (`timelineKey`, `compareKeys`, `sortTimeline`) moves to
`@debrief/schema` so both packages share it. `@debrief/policy` gains `replay(events,
freezeFrame?)` — sorts by timeline, returns `{halted, freezeFrame?, prefix, timeline[{event,
status}], marked}` with statuses `happened` / `freeze-frame` / `would-not-have-happened`; the
prefix is the original event objects in timeline order, so its JSON is identical to the record —
and `counterfactual(events, decide)` for the bare case (`decideWith(policy, ctx?)` judges each
event on its own fields). `@debrief/reconstruct`'s `counterfactual(events, policy, graph?)`
feeds `divergence`'s freeze frame into `replay` over the run's events.
Rejected: ordering by `seq` (would leave the halted call's consequences in the "happened"
prefix); re-deriving decisions inside policy with graph context (policy stays graph-free).
Consequences: the demo under `prod-guard.yaml` halts at seq 45 with 42 prefix events and marks
the observed deletion, the MCP response, the tool result and the closing LLM turn; the proxy's
`mcp.request` for that call sorts a hair before the OTLP span start (two clocks) and stays in
the prefix. The live-feed latency test now takes the best of three appends so a loaded machine
cannot fail the 200 ms budget spuriously.

## D-044 Layout and director: seeded initial positions, fixed ticks, role layers, keyframes anchored to event time
**Accepted · 2026-09-17**
Context: ARCHITECTURE §9 wants `layout(graph, seed)` as a seeded d3-force layout with a fixed
iteration count and positions rounded to 0.01, and `direct(...)` as camera keyframes for the
Theatre. d3-force only consults its `randomSource` to jiggle coincident nodes, so seeding it
alone leaves the output seed-independent, and `Math.round` can yield `-0`, which JSON writes as
`0` but deep equality does not.
Decision: `layout(graph, seed)` draws every node's initial x/y from a mulberry32 stream seeded
by FNV-1a of the seed string (and hands the same stream to d3 as `randomSource`), runs
`forceLink`/`forceManyBody`/`forceCenter`/`forceCollide` for exactly `LAYOUT_ITERATIONS` (300)
ticks with the simulation stopped, rounds to 0.01 with `-0` normalized, and sets `z` from the
node's role (`LAYERS`: principal 6, grant 4, agent 3, policy 2, llm 1, tool 0, system −2,
resource −4) so authority reads above action above the world. `Layout {version, seed,
iterations, positions, bounds}` is what P-30 caches on `runs.layout`, keyed by `LAYOUT_VERSION`
and `GRAPH_VERSION`. `direct(graph, layout, divergence?, blast?)` emits `Keyframe {t, position,
target, fov, easing, label, nodeId?}` with `t` in seconds from the earliest node: one
establishing shot, one `follow` per tool call before the freeze frame (sampled to at most 48),
a `freeze` close-up on the divergence node, one `ripple` per blast wave at +1.5 s each, and a
`pull-back` framing the principal and the freeze frame; without a divergence the film is
establishing → follow → pull-back. `d3-force` (≈10 kB min+gz) enters the catalog.
Rejected: seeding only d3's randomSource (no effect); a single follow shot per second of run
(loses the causal beat); anchoring keyframes to array indexes (the replay clock is time).
Consequences: the demo lays out 26 nodes with distinct positions and films 12 keyframes
(freeze at t = 0.97 s, ripple at 2.47 and 3.97, pull-back at 5.97); same seed twice is
byte-identical, another seed moves every node and every shot.

## D-045 Reconstruction endpoints: per-process event cache keyed by head seq, layout persisted on runs
**Accepted · 2026-09-17**
Context: ARCHITECTURE §13 lists `/graph`, `/blast`, `/lineage`, `/divergence` and
`/counterfactual` under `/v1/runs/:id`; P-30 wants them under 300 ms warm with a cache that
invalidates on new events or a layout version bump. The layout (300 force ticks) is the only
expensive step; graph, correlation, blast, lineage and divergence are milliseconds.
Decision: `ReconstructionService.load` keys an in-process cache by tenant+run and by the run's
head `seq` (`EventsRepository.headOfRun`), so any appended event misses the cache and rebuilds
from the events table (paged by 1000). The layout is persisted on `runs.layout` as
`{layoutVersion, graphVersion, headSeq, seed, layout}` with `runs.graph_version` set from
`GRAPH_VERSION`; it is reused only when both versions, the head seq and the seed match, and only
the default seed (the run id) is persisted — `?seed=` overrides compute on the fly. `GET /graph`
returns the graph, layout, director keyframes and the divergence under `?policy=` (a sample id,
default `prod-guard`) plus `cached: {events, layout}`; `GET /blast?node=&weak=` and
`GET /lineage?node=` 404 on unknown nodes; `POST /divergence` and `POST /counterfactual` take
`{policyId}` (a sample from `@debrief/policy`'s `SAMPLE_POLICIES`) or `{policy}` YAML, answer
200, and turn `PolicyParseError` into a 400 carrying the line-numbered issues. `runs` gains its
first non-materialization write (the layout cache), `events` stays append-only.
Rejected: caching in Postgres only (a warm request would still reload events); invalidating on
`runs.eventCount` (debounced, so stale for a moment after ingest); a policy store (P-4x).
Consequences: the demo run's cold `/graph` builds and stores the layout; the warm call is
served from memory well inside the budget; a late event or a stale `layoutVersion` in the row
forces a rebuild on the next call. `apps/api` now depends on `@debrief/reconstruct` and
`@debrief/policy`.

## D-046 Web app: Next 16 on webpack with a .js→.ts extension alias, system font stacks, tokens in CSS and TS
**Accepted · 2026-09-17**
Context: ARCHITECTURE §11 fixes the stack (Next.js app router, React 19, Tailwind). The pure
packages import each other with `.js` suffixes (Node ESM in `api`/`proxy` needs them);
Turbopack, Next 16's default bundler, does not map `.js` imports onto `.ts`/`.tsx` sources in
workspace packages, so `next build` failed on `@debrief/schema`. Google-hosted fonts would be
fetched at build time, which makes CI depend on the network.
Decision: `apps/web` builds and serves with `next build --webpack` / `next dev --webpack` and a
`resolve.extensionAlias` of `.js → [.ts, .tsx, .js]`; workspace packages are listed in
`transpilePackages` and keep their `.js` import style, while files inside `apps/web` use
extensionless relative imports (the Next convention). Fonts are system stacks (`FONTS.sans`,
`FONTS.mono`), no downloads. Design tokens live in `@debrief/ui` twice on purpose: `tokens.ts`
for TS consumers (scenes, tests) and `tokens.css` as a Tailwind 4 `@theme` block imported from
`globals.css`; a test asserts every TS token appears in the CSS. The API client runs on the
server only (`DEBRIEF_API_URL`, `DEBRIEF_API_KEY` read from `process.env`, never shipped to the
browser), validates every response with the `@debrief/schema` zod schemas, and `/runs` is
`force-dynamic` so the build never contacts the API. `next typegen` runs before `tsc` in the
`typecheck` script because `next-env.d.ts` references generated route types; it is gitignored.
Rejected: Turbopack (no extension aliasing for linked packages — revisit when it lands);
emitting `dist/` for pure packages (would change every consumer); `next/font/google` (network
at build); a client-side fetch with the key (leaks the tenant key).
Consequences: Lighthouse on the built `/runs` page scored performance 99 / accessibility 100 /
best-practices 96 locally (147 KiB total, 20 ms TBT); the web package has its own vitest config
(`oxc.jsx` automatic) and tests components with `react-dom/server`, no DOM library yet.

## D-047 Replay: vanilla zustand clock, copy-on-write world reducer with 500-event snapshots, canvas scrubber
**Accepted · 2026-09-17**
Context: ARCHITECTURE §11 specifies the replay clock shape and "world state at t is a reducer
over events ≤ t with memoized snapshots every 500 events so seeking is O(500)"; P-32 needs a
scrubber with event density and divergence markers plus keyboard control, testable without a
browser.
Decision: `createReplayClock(duration)` is a `zustand/vanilla` store (`t` in ms from the run's
first event, `rate` from a fixed set, `play/pause/toggle/seek/tick`) so scenes subscribe with
`useStore` and tests drive it directly; `useReplayTicker` advances it from
`requestAnimationFrame` only while playing. `createReplay(events)` orders events on the
timeline axis, keeps a snapshot every 500 applied events, answers `indexAt(t)` by binary search
and `stateAt(t)` by folding at most 500 events onto the nearest snapshot; `applyEvent` is
copy-on-write (touched resources and tokens are replaced, never mutated) so snapshots stay
valid. `WorldState` tracks observed resources (`world.field/after` per resource, last operation,
mutation count), tokens through grants and revocations, and per-kind counts. The scrubber is a
pure `drawScrubber(ctx, frame)` over a minimal context interface (density bars in dim cyan,
ember divergence markers, a ringed freeze frame, the playhead) wrapped by a `<Scrubber>` React
component that measures its wrapper, redraws on clock change, seeks on click (snapping to a
marker within 6 px) and shows marker labels on hover; `handleReplayKey` implements space,
←/→ (one event), [ ] (previous/next marker), Home/End. `packages/ui` may contain React (it is
not in the pure list) but still does no I/O; it is tested in jsdom with a mocked 2D context.
Rejected: a React-only store (scenes and tests need the clock outside React); mutating
reducers (would corrupt snapshots); SVG for the scrubber (10k-event density bars are cheaper
on canvas).
Consequences: seeking anywhere in a 10k-event synthetic run folds ≤ 500 events and stays far
under 16 ms (asserted as the worst of 300 random seeks); the run page mounts a `ReplayPanel`
with the scrubber, markers from `POST /divergence` under `prod-guard`, a subtitle from the
current event's `summary`, and a compact world/token readout that P-36 will grow.

## D-048 Graph scene: point-sprite sphere impostors, one draw call per layer, proof proxied server-side
**Accepted · 2026-09-17**
Context: ARCHITECTURE §11 wants the Theatre's causal graph as instanced r3f nodes and edge
tubes within ≤ 200 draw calls, and P-33's AC wants 5k nodes at ≥ 45 fps on the CI runner. The
runner has no GPU: headless Chrome renders WebGL through SwiftShader, where 5k instanced,
lit, 80-triangle icosahedrons measured 6 fps. The verify affordance must open an inclusion
proof, but the browser never holds the tenant key.
Decision: nodes are a single `THREE.Points` draw with a custom `ShaderMaterial` — each vertex
carries position, colour, radius, an `observed` ring flag and a hover lift; the vertex shader
sizes the point by perspective (`radius · 2 · viewportScale / depth`, clamped 2–96 px) and the
fragment shader draws a lit sphere disc, an ember annulus for observed nodes and discards
outside the circle. Edges are one `LineSegments` draw with per-vertex colour (stage-edge for
reported, dim ember for observed, additive). Provenance is derived per node and edge from the
events behind it (`observed` only when every event is observed) and is shown in the fill ring,
the hover card and a legend that never leaves the stage. Hover raycasts the points (threshold 4
units) and lifts the point; the DOM hover card shows type, id, label, provenance, event count,
the first event `summary` and a "verify inclusion proof" link to `/api/proof?event=`, a Next
route handler that calls `GET /v1/proof` with the server key and passes the API's status
through (404 until a checkpoint covers the event). `frameloop="demand"` on the run page; the
perf page (`/perf/graph?nodes=&fixture=demo`) renders with `always`, spins, and publishes
`window.__perf` (mean/p95 frame, fps) after a 4 s window; `pnpm perf:smoke` builds nothing,
starts `next start`, drives the system Chrome with puppeteer-core under
`--use-angle=swiftshader`, and asserts demo ≥ 58 fps (requestAnimationFrame caps at 60) and 5k
synthetic ≥ 45 fps. The CI `perf-smoke` job now runs with `continue-on-error` and becomes
blocking in P-38. `three` (~150 kB min+gz) and `@react-three/fiber` enter the catalog under §11;
`@react-three/drei` is added for P-34.
Rejected: instanced meshes for nodes (400k lit triangles a frame on SwiftShader); `Playwright`
(a 150 MB browser download when the runner already ships Chrome); a client-side proof fetch
(needs the key).
Level of detail: the runner's SwiftShader (Subzero backend, 2 vCPUs) measured 5,000 shaded
points at 40–42 fps and 7,498 `GL_LINES` at 3–4 fps (≈ 115 µs per line, opaque or blended, short
or long), so beyond `LOD_NODE_THRESHOLD` (1000 nodes) the scene switches to far LOD: nodes are
flat 1.5–6 px dots with no `discard` (observed nodes tinted ember), and edges are drawn only
around the hovered node (`edgesTouching`); the stats line says so. Below the threshold every
edge is drawn and nodes are shaded impostors.
Consequences: on the runner the demo (26 nodes, 71 edges) renders at 60.0 fps and 5,000
synthetic nodes at 59.8 fps (p95 frame 17 ms), both at the requestAnimationFrame cap; the
`perf-smoke` job prints per-layer diagnostics (`PERF_DIAG=1`); `graph-canvas.tsx` and
`perf-probe.tsx` are excluded from unit coverage (WebGL) and covered by the smoke instead; the
run page shows the stage above the replay panel — time binding and the camera arrive with
P-34/P-35.

## D-049 Cinematic camera: pose is a pure function of the clock; drags take over, play hands back
**Accepted · 2026-09-17**
Context: ARCHITECTURE §11 drives drei `CameraControls` from the auto-director keyframes; P-34's
AC wants playback from t=0 to reproduce the same camera path frame-for-frame, with golden
screenshots at five keyframes, and manual orbit that takes over on input and resumes on play.
The director's ripple and pull-back shots sit after the last event, and a rasterizer-dependent
PNG golden would differ between the runner's SwiftShader and a laptop GPU.
Decision: `@debrief/ui` gains `cameraPoseAt(keyframes, t)`: between keyframes the next
keyframe's easing (linear, ease-out, ease-in-out) shapes a lerp of position, target and fov; at
or before the first keyframe the first pose holds, after the last the last does. The pose is a
pure function of `t`, so any two playbacks that visit the same times render the same frames —
no smoothing state. `CinematicCamera` (inside the canvas) reads the shared clock each frame and
calls `setLookAt(…, false)` with `smoothTime` 0; a `controlstart` event flips it to manual, and
the clock's `playing` turning true hands control back. `RunTheatre` owns one clock for the stage
and the scrubber, with a duration of `max(events, last keyframe)` so the film outlasts the
events; Home/End and `]` now seek the clock's edges. The golden is twofold: the pure path
(`packages/ui/__golden__/nine-seconds.camera.json`, poses at every keyframe and midpoint) and a
determinism check, `pnpm --filter @debrief/web camera:check`, which opens `/perf/theatre` (the
demo run reconstructed in the browser, clock exposed via `onClock`), plays from t=0, pauses at
establishing, follow, freeze, ripple and pull-back, seeks exactly onto each, screenshots the
stage canvas and the page and reads the pose — twice — and requires byte-identical screenshots
and poses. The PNGs are written to `apps/web/perf/out/` (ignored) for eyeballing; the CI
`perf-smoke` job runs the check after the fps smoke.
Rejected: committing PNG goldens (renderer-dependent); `smoothTime` easing in camera-controls
(frame-rate dependent, so not reproducible); a separate clock for the camera.
Consequences: the check ran three times locally with all fifteen comparisons identical;
keyframe `t` is seconds while the clock is milliseconds, converted at one place.

## D-050 Subtitles and event cards: summaries drive playback, blobs are read only on a click
**Accepted · 2026-09-17**
Context: ARCHITECTURE §4 says `summary` exists so every scene can render without touching a
blob and blobs are for drill-down; §11 puts reasoning subtitles in a DOM overlay synced to the
clock. P-35's AC forbids any blob fetch during playback and any overlap between subtitles and
the scrubber. There was no read route for blobs.
Decision: `GET /v1/blobs/:sha256` serves the decrypted, already-redacted capture document to
its tenant only (404 for another tenant or an unknown digest, 410 once the tenant key is
destroyed, 500 on an integrity mismatch), content-addressed so it is `immutable`. The web app
proxies it as `/api/blob?sha=` with the server key. On the stage, `Subtitles` renders the
current event (`#seq kind · provenance` and its `summary`, italic for `llm.call`) as a
pointer-events-free overlay inside the graph view, above the stats line and legend — the
scrubber lives in the replay panel below, so the two cannot overlap; the camera check now reads
both bounding boxes at every keyframe and fails on intersection. Beside the stage, `EventCards`
lists the reasoning and tool events (`llm.call`, `tool.call`, `tool.result`, `mcp.request`,
`mcp.response`) up to the clock, newest first, the current one highlighted; a card expands to a
fixed set of gen-ai/MCP attributes and, when the event carries `payloadSha256`, a
"show captured content" button whose click is the only path to the proxy. The check also
counts `/api/blob` requests across two full playbacks and requires zero.
Rejected: prefetching blobs for cards in view (violates the AC and the §4 principle);
subtitles in the replay panel (would sit next to the scrubber); a generic attrs dump (tokens and
ids belong to the card, the rest to the event drawer of P-36/M4).
Consequences: capture mode `summary` runs show "no captured content" on every card; the
theatre layout is stage + a 20 rem card column on md+, stacked on narrow screens.

## D-051 World panel and flares: one clock value drives the panel and the stage; sprites sized from the projection
**Accepted · 2026-09-17**
Context: ARCHITECTURE §11 wants a world-state side panel derived from the reducer with values
that animate on change; P-36's AC wants the deletion's backups transition on screen in the same
frame as the graph flare. The reducer only knew the latest field values, and the demo reports
the loss as `backupExists true→false` with `backupsDeleted: 2` on the volume's change.
Decision: the reducer keeps, per resource, the last change of every field
(`changes[field] = {before?, after, eventId}`) and folds every non-control `world.*` attribute
(`backupsDeleted`, `rowsOrBytes`) into `fields` as facts. `WorldPanel` renders the reducer at
the clock: volumes (backups derived as `N → 0` from `backupsDeleted` when `backupExists` turned
false, bytes, last op), files, credentials, any other class, and tokens (holder, scope, perms
with wildcards in ember). A value whose last change is the current event remounts under a key
and plays the ember `flash` keyframe, striking through the previous value. `flaresAt(replay, t)`
lifts the resource node of every `world.change` within the last 800 ms (strength fading with
age); `RunTheatre` subscribes to `t`, computes the flares and hands them to the canvas, whose
`lift` attribute now merges hover and flare and invalidates after each upload. Because panel
values and flares are both pure functions of the same `t` in the same render, the AC holds by
construction; the camera check seeks to the deletion, reads the backups cell (`2 → 0`, flashing)
and the flare set from one `evaluate`, and requires agreement at the identical `t`.
Two determinism fixes fell out of the check: `CinematicCamera` now touches the controls only
when the pose changes and converges camera-controls' residual damping with `update(1)` (a
paused clock no longer keeps demand-mode frames coming), and the point-sprite size is
`radius · viewportHeight · projectionMatrix[1][1] / depth`, a pure function of camera and
viewport — the previous `uScale` uniform captured whatever `fov` the camera had at the last
resize, which made screenshots history-dependent. The check disables CSS animations and
scrollbars on its page; its full-page comparison is informational (Chrome's compositor jitters
±1 at a column edge), the stage and pose comparisons stay strict.
Rejected: animating with wall-clock timers in React (drifts from the clock); fetching the
Orbital state for the panel (the panel must show only what events prove).
Consequences: the replay panel keeps only transport controls; the compact world/token readout
moved into the side column above the event cards.

## D-052 Freeze frame: a stop point in the clock, the split over the whole theatre, consequences beside the action
**Accepted · 2026-09-17**
Context: ARCHITECTURE §11 puts a freeze-frame split view at the first divergence; P-37's AC
wants the freeze exactly at the divergence `seq` and a split readable at 1280×800. Playback
ticks are frame-sized, so a naive check would overshoot the event, and the OTLP `tool.call` at
the divergence carries only `{system, operation}` — the production volume, its risk and the lost
backups live on the correlated `world.change`.
Decision: the replay clock gains `stopAt`/`frozenAt`: a tick that would cross the stop lands
exactly on it, pauses and sets `frozenAt`; `play()` from there continues past it and `seek()`
clears the freeze, so scrubbing never traps the viewer and playing again from before the stop
freezes again. `RunTheatre` sets the stop to the freeze frame's event time and renders
`FreezeFrame` as an overlay over the whole theatre grid (stage plus side column, not the stage
alone, which left 343 px columns at 1280 px): left, the verdict and explanation with the matched
rule's YAML block cut from the policy text (`ruleBlock`), right, the action (kind, provenance,
summary, actor, target, token with scope in cyan and permissions in ember) followed by its
observed consequences — the `world.change` events the graph attributes to the frozen tool node
via `mutates`/`observes` edges, with resource, environment, risk, the field transition and the
world facts. "continue" plays on, "stay here" dismisses without moving, space also continues.
The camera check plays from the start at 1280×800, waits for the freeze and requires the
overlay's seq to equal the subtitle's, playback stopped, both columns ≥ 400 px and inside the
viewport with no horizontal overflow, and every text node ≥ 13 px; it screenshots the split for
eyeballing. The playback passes continue through the freeze the way a viewer would.
Rejected: freezing in the director keyframes (the film would stall with no explanation);
detecting the crossing in React (a frame late); one-shot freezes (a replayed run must freeze
every time it is played from before the divergence).
Consequences: the freeze keyframe of the film (rounded to 0.97 s) and the clock's stop
(the exact 973 ms) differ by a few milliseconds; the camera holds the close-up either way.

## D-053 Blast ripple: a wave attribute and one progress uniform, driven by the clock in the theatre and by a one-shot loop on the blast page
**Accepted · 2026-09-17**
Context: ARCHITECTURE §11 wants the blast scene to ripple "wave-by-wave from the node" over
the same graph, with an affected list grouped by system carrying recoverable flags; the
director already books ripple shots after the freeze. The stage must stay a pure function of
the clock (D-049) and within the draw-call budget.
Decision: `rippleOf(blast, scene)` maps `blastRadius` onto scene indices — the origin is
wave 0, each resource the hop that reached it, and an edge carries the wave of the node it
reaches when it leaves the previous wave along a `mutates`/`observes` edge; everything else is
−1. The node and edge geometries gain a `wave` attribute and the shaders one `uRipple`
uniform, the front's position in waves: a node tints toward ember and gets the ember ring once
the front has passed (`clamp(uRipple − wave, 0, 1)`), pulses in size while the front is on it,
and everything outside the blast dims while a ripple is active; an edge lights as the front
travels it. Nothing is added to the draw list (still points + line segments). In the theatre
`progress = (t − freezeT) / 700 ms`, so the ripple leaves the frozen action the moment the
viewer continues and scrubbing back turns it off; on `/runs/[id]/blast` (`BlastView`) a
requestAnimationFrame loop plays it once from page load, "ripple again" restarts it, and the
frame loop stays on demand (each step invalidates one frame, none after it settles). The
affected list (`AffectedList`) groups by system, shows the wave, the edge it came through, the
recoverable flag and the reasons, and lights each row as the front reaches it.
Rejected: a separate highlight mesh per wave (more draw calls, and two sources of truth for
which node is lit); driving the theatre ripple from the director's keyframes (the camera and
the ripple would drift apart when the viewer drags the camera); looping the ripple forever on
the blast page (a page that never settles never stops rendering).
Consequences: `RunTheatre` and the run page take the blast for the freeze node (one extra
`GET …/blast` per page load); `GraphView` takes `blast` + `progress`. The ripple hook reads
`performance.now()` in place — a clock passed as a default parameter was inlined by the
production minifier into a new function per render, restarting the effect every frame
(unit tests and the dev build could not see it; the blast probe in the camera check can).

## D-054 Perf pass: cost with the raster awaited, cadence at the median, draw calls from renderer.info; perf-smoke blocks
**Accepted · 2026-09-17**
Context: P-38's AC is ≤ 200 draw calls in every scene, a demo p95 frame ≤ 16.7 ms on the CI
runner and `perf-smoke` as a required check. On the runner Chrome renders through SwiftShader
in the GPU process: requestAnimationFrame is vsync-capped, so frame intervals cannot show a
p95 under 16.7 ms even for a trivial scene, and `--disable-frame-rate-limit` makes the
interval meaningless (the renderer queues commands at 1000+ fps while the raster lags).
`gl.finish()` returns at once through the command buffer; only a `readPixels` waits for the
raster.
Decision: the canvas gets a `RenderMeter` (mounted only when `onRender` is given) that wraps
`renderer.render`, reports `renderer.info.render.calls` per frame and, with `sync`, reads one
pixel after the call so the measured time is the frame's cost. The perf probe reports
`renderP50Ms`/`renderP95Ms`/`drawCalls`; the smoke keeps the vsync-capped median fps
(demo ≥ 58, 5k synthetic ≥ 45) as the throughput signal and adds a second pass per scene
with the raster awaited, failing when the demo's render p95 exceeds 16.7 ms
(`PERF_RENDER_P95_MS`) or any scene draws more than 200 calls. The camera check asserts the
theatre's and the blast page's draw calls (`window.__theatre.drawCalls`, `window.__blast`)
and that the blast ripple settles on its own with every affected row lit. The `perf-smoke`
job and its smoke step lose `continue-on-error`. Audit: every scene is two draw calls
(points + line segments; the far LOD is one when nothing is hovered), `dpr` stays capped at
1.5, the run and blast pages run `frameloop="demand"` (a paused clock and a settled ripple
produce no frames), the perf page alone runs `always`.
Rejected: judging the interval p95 (vsync jitter puts it at 16.8–17.3 ms regardless of
scene cost); uncapped rAF; a `finish()`-based timer.
Consequences: the smoke takes four page loads (~40 s) instead of two; the cost numbers on the
runner are the ones to watch when a scene grows.

## D-055 Edges are screen-space quads, not GL lines; far dots skip the depth buffer
**Accepted · 2026-09-17**
Context: the first blocking `perf-smoke` run put the demo scene at a render p50 of 16.2 ms
and p95 of 18.5 ms with the raster awaited on the runner (SwiftShader Subzero, 2 vCPU), over
P-38's 16.7 ms budget, while 5,000 far-LOD points cost 13.7 ms. The demo draws 26 sprites and
71 edges: on that rasterizer a GL line primitive costs on the order of a hundred microseconds,
so the 71 lines were most of the frame, and the 5k scene's cost was per-point setup.
Decision: `edgeQuads(buffers)` expands every segment into four vertices (`position`, the far
end as `other`, a `side` of ±1 that flips at the far end, colour, wave) and two indexed
triangles; the edge vertex shader trims the segment at the near plane in view space (the way
three's fat lines do), projects both ends, offsets the vertex by `side × 0.75 px` along the
screen-space normal and keeps the near end's depth, so an edge is a 1.5-device-pixel quad at
any distance and a segment crossing the near plane still projects straight. The material is
double-sided and still one draw call. Far-LOD dots are capped at 4 px and drawn with depth
test and write off: their order is invisible at that size and the software rasterizer pays
per fragment for the depth compare. The smoke's diagnostics now also print the render floor
(one node), the demo's nodes-only and edges-only cost, so the next regression is attributable
without a bisect.
Rejected: keeping GL lines and raising the budget (the budget is the point); three's
`LineSegments2` (instanced fat lines with per-segment uniforms and a heavier shader than the
scene needs); dropping edges from the far LOD entirely (already the case beyond a hover).
Consequences: edges are 1.5 px wide instead of 1 px on high-DPI screens; the geometry is four
vertices per edge (8,000 for the 2,000-edge near-LOD ceiling, still trivial); the camera check
screenshots changed once with this commit and are byte-identical between passes as before.

## D-056 Approach scene: one store fed by a same-origin SSE proxy, typed-array motion fields, points beyond a thousand agents
**Accepted · 2026-09-17**
Context: ARCHITECTURE §11 wants `/live` to show systems as slabs placed by the seeded layout,
agents as one instanced draw moving along cached trails, leashes to principals, risk zones
pulsing via a shader uniform and the SSE feed in zustand; P-39's AC is 5k simulated agents at
≥ 45 fps and a critical event pulsing its zone within 200 ms. The key never reaches the
browser, so the browser cannot open `/v1/live` itself, and on the CI runner's SwiftShader every
primitive costs microseconds and every fragment tens of nanoseconds (D-055).
Decision: `GET /api/live` (Next route handler) opens `/v1/live` with the server-side key and
streams the body through unchanged as `text/event-stream`, forwarding `since`, `run` and
`Last-Event-ID`, so the browser's `EventSource` reconnects without gaps. `createApproachStore`
(zustand vanilla) is the scene's model: one run is one agent (name from the first agent actor,
principal from `authority.principalId` or a human actor), one `target.system` is one zone, a
critical or high event stamps the zone's `pulseAt` and `lastPulse`; `seedRuns` starts from
the run list. Positions are derived from the sets alone — zones evenly along an arc, principals
along a row, the order rotated by the seed (`zonePositions`, `principalPositions`) — so a set of
names always lands the same way and a newcomer re-spreads the others, which the fields ease
to their new slot. `AgentField`/`ZoneField` keep per-frame motion in typed arrays: an agent
flies from where it is to its lane beside the zone over 1.6 s (smoothstep, a small arc in z),
samples its trail every 90 ms, dims 20 s after its last event, and its slot compacts when the
store evicts it; nothing snaps. The canvas draws five things in five draw calls: slabs as one
`InstancedMesh` whose pulse decays from the instance's `pulseAt` against `uNow`, agents as one
`Points` draw of round impostors, trails as one `Points` draw of aged samples, leashes as one
quad-line mesh, principals as one `Points` draw; beyond `LOD_AGENT_THRESHOLD` (1,000) trails
and leashes are not drawn and agents switch to flat capped dots without depth. The frame loop
stays on demand: a store change invalidates, and a frame re-invalidates only while something is
in flight or a pulse is younger than `PULSE_MS`. `/perf/approach?agents=` runs the same view on
`createSimulation` (a fictional fleet: 1 % of agents turn each 100 ms tick, a critical call
every 900 ms) with the loop always on and reports cadence, draw calls and the time from a
critical event reaching the store to the first frame drawn after it; the smoke gates 5k agents
at ≥ 45 fps median, every pulse drawn within 200 ms and ≤ 200 draw calls.
Rejected: `EventSource` straight at the API with the key in the URL (keys in logs, D-036);
hash-placed zones (two of the demo's three systems landed 26 units apart); a React state per
agent (5k × 60 Hz through the reconciler); trails as line strips (a 1,000-agent trail set
would be 6k lines, the runner's most expensive primitive); instanced meshes for agents (5k
icosahedrons ran at 6 fps on SwiftShader in P-33).
Consequences: `MAX_AGENTS` (10,000) caps the store, evicting the oldest idle agents; the arc
holds up to `MAX_ZONES` (64) slabs and the row `MAX_PRINCIPALS` (256) markers; the live page
starts at the tenant's head, so events between the run-list fetch and the stream's open are
not shown until the next one arrives. Locally 5k agents render at the vsync cap with 18 ms
pulse latency; the runner's numbers land in the PR's perf-smoke log.
