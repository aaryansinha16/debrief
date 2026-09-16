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
