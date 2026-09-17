# Plan

One point = one branch = one PR. Work strictly in order inside a milestone; stop and report at
each milestone boundary. Tick boxes inside the point's branch. Never renumber; add sub-points as
`P-NN.x`. Every point's **AC** is its acceptance criteria and becomes the PR checklist.

Model guidance per point is in `KICKOFF_PROMPT.md` (★ = run on `fable`).

---

## M0 — Foundation (week 1)

- [x] **P-01 repo: scaffold monorepo** — pnpm workspaces, Turborepo, `tsconfig.base.json`, `packages/config` (eslint, prettier, tsconfig presets), empty `apps/*` and `packages/*` with package.json + `src/index.ts`, `.env.example`, `.gitignore`, `.githooks/commit-msg`, `pnpm setup` script that sets `core.hooksPath`.
  AC: `pnpm setup && pnpm lint && pnpm typecheck` pass; `git commit` with a two-line message or a `Co-Authored-By` trailer is rejected by the hook; a 73-char message is rejected.
- [x] **P-02 ci: GitHub Actions** — lint → typecheck → test → build on PR and main; pnpm cache; `perf-smoke` job stubbed (skips until P-38).
  AC: PR shows four required checks; a failing lint blocks merge (branch protection enabled on `main`, PRs required).
  - [x] **P-02.1 repo: branch protection on `main`** — closed by D-030: not needed while single-developer; `.githooks/pre-push` is the guard.
- [x] **P-03 repo: docker compose** — postgres:16 with init SQL creating `debrief` db + app role, minio with bucket bootstrap, healthchecks.
  AC: `docker compose up -d` healthy in < 30s on a clean machine; `.env.example` matches.
- [x] **P-04 schema: event model** — zod schemas for `Event`, `EventKind`, `Checkpoint`, `Blob`, `Run`; inferred TS types; `EventInput` (without seq/prevHash/hash).
  AC: schemas reject unknown kinds and malformed timestamps; 100% branch coverage on validators.
- [x] **P-05 chain: canonical JSON + hash chain** ★ — RFC 8785 canonicalization, `hashEvent(prev, event)`, `verifyChain(events)` returning the first broken `seq`.
  AC: golden test vectors (10 events) hash identically in Node and jsdom; tampering any field, reordering, or deleting an event is detected with the correct `seq`.
- [x] **P-06 chain: Merkle tree + proofs** ★ — RFC 6962 leaf/node hashing, incremental tree, `inclusionProof(i, n)`, `consistencyProof(m, n)`, verifiers.
  AC: property test (fast-check) — random trees up to 5,000 leaves verify; any bit flip fails; proofs are O(log n) in size.
- [x] **P-07 chain: checkpoints + signing** ★ — Ed25519 via `@noble/ed25519`, `signCheckpoint`, `verifyCheckpoint(pubkeys)`, key id derivation, keypair generation CLI.
  AC: signature verifies in Node and browser; wrong key id or altered `rootHash` fails; keys never logged.
- [x] **P-08 api: NestJS skeleton + Drizzle** — Fastify adapter, config module, pino, `/healthz` `/readyz`, Drizzle setup, migration 0001 (tenants, api_keys, events with append-only grants + trigger, event_sources, blobs, checkpoints, runs, policies, evidence_jobs).
  AC: `pnpm db:migrate` idempotent; an UPDATE or DELETE on `events` raises; bearer-key auth guard rejects bad keys.
- [x] **P-09 api: append path** — events repository with advisory lock, seq assignment, chain hashing via `packages/chain`, `NOTIFY`.
  AC: 1,000 concurrent inserts for one tenant produce a gap-free chain; `verifyChain` over the table passes; p99 append < 15 ms locally.
- [x] **P-10 api: OTLP receiver + gen_ai map** — `POST /v1/traces` protobuf + JSON, `packages/schema/otel-map.ts` pinned to `gen-ai/1.42.0` with OpenInference aliases, span → event mapping per ARCHITECTURE §6.1.
  AC: fixture OTLP payloads (invoke_agent, chat, execute_tool, MCP) map to expected events (golden); unknown spans are counted, not stored; content ignored when capture is `off`.
- [x] **P-11 api: native events endpoint** — `POST /v1/events` batch, idempotency on `(source, sourceId)`, size caps, per-key rate limit.
  AC: replaying the same batch twice stores once; oversize batch returns 413; rate limit returns 429 with `Retry-After`.
- [x] **P-12 api: checkpointer** — scheduled worker (1,000 events or 60 s), writes signed checkpoints, mirrors to object storage, `GET /v1/checkpoints`, `GET /v1/proof?event=`, `/.well-known/debrief-keys.json`.
  AC: after ingesting the P-10 fixtures, a proof for any event verifies against the latest checkpoint using only `packages/chain`.
- [x] **P-13 api: redaction + blobs** — pure redaction pipeline (secrets, PII, size caps) with version stamp; blob store (MinIO) with envelope encryption; capture modes `off | summary | on`; `summary` derivation.
  AC: fixture prompts containing keys/JWTs/emails are redacted before any write (asserted via DB inspection); blob round-trips; destroying the tenant data key makes plaintext unrecoverable while `verifyChain` still passes.

**M0 exit:** ingest fixtures → chain verifies → proof verifies. Report and pause.

---

## M1 — Capture (week 2)

- [x] **P-14 proxy: stdio MCP proxy** — spawn a server as child process, relay JSON-RPC, record `mcp.request/response` with redaction, emit to `/v1/events`, propagate `traceparent`.
  AC: wrapping a reference MCP server passes its own test suite unchanged; every `tools/call` yields a request/response pair with latency.
- [x] **P-15 proxy: streamable-HTTP mode + config** — remote server forwarding, `--capture`, `--tenant-key`, `--policy` (advisory `policy.decision` events).
  AC: same assertions as P-14 over HTTP; advisory decisions appear in the stream without blocking.
- [x] **P-16 sandbox: Orbital infra service** — fake PaaS API (projects, environments, volumes, backups, tokens with scope vs permissions), emits `world.change` (observed) to `/v1/events`.
  AC: deleting a volume with backups emits one `world.change` with `backupExists: true → false`; token scope and permissions are both on every mutation event.
- [ ] **P-17 sandbox: Orbital MCP server** — tools `readFile`, `listVolumes`, `deleteVolume`, `rotateCredential` over the infra API.
  AC: works behind `mcp-proxy`; args and results are redacted per P-13.
- [ ] **P-18 sandbox: scripted agent** — deterministic agent (OTel JS SDK, real `gen_ai.*` spans) that reproduces the incident: credential mismatch → finds a token in an unrelated file → `deleteVolume` on a production id → backups gone. `--live` flag swaps in Claude via API.
  AC: run twice → identical event kinds/order (ts excluded); exactly one `world.change` with `environment: production`; `delegation.grant` shows scope `staging:credentials` with permissions `account:*`.
- [ ] **P-19 sandbox: `pnpm demo:nine-seconds`** — seeds tenant + key, starts services, runs the agent, prints run id and a verify URL.
  AC: from a clean `docker compose up`, completes in < 60 s; exit code 0; the run has ≥ 40 events.
- [ ] **P-20 api: runs materialization + read API** — debounced run summary on ingest; `GET /v1/runs`, `/v1/runs/:id`, `/v1/runs/:id/events` (cursor).
  AC: demo run appears with correct counts and `riskMax: critical`; cursor pagination is stable under concurrent ingest.
- [ ] **P-21 api: SSE live feed** — `GET /v1/live` via LISTEN/NOTIFY, `since` cursor, heartbeat.
  AC: a client receives the demo run's events within 200 ms of append; reconnect with `since` yields no gaps or duplicates.

**M1 exit:** the incident is captured with both provenances. Report and pause.

---

## M2 — Reconstruction (week 3)

- [ ] **P-22 reconstruct: causal graph** ★ — `buildGraph(events)`, tool-result attachment (call id → span → adjacency), delegation and messaging edges.
  AC: golden graph for the demo run; adding an unrelated run does not change it; deterministic node ids.
- [ ] **P-23 reconstruct: world correlation** ★ — `exact/strong/weak` linking of `world.change` to tool calls.
  AC: demo `deleteVolume` links `exact` (traceparent); with traceparent stripped it links `strong`; a decoy mutation 30 s later links nothing.
- [ ] **P-24 reconstruct: blast radius** — waves over `mutates/observes` ≥ strong, grouping, recoverable flags.
  AC: demo blast = 2 waves (volume, backups), `recoverable: false`; toggling weak edges on includes the decoy.
- [ ] **P-25 reconstruct: authority lineage** — walk to principal, `scopeMismatch` from grant scope vs permissions vs target.
  AC: demo lineage is human → coding-agent → token; mismatch flagged on the token hop with both rings' values.
- [ ] **P-26 policy: DSL + evaluator** — YAML parser (zod), dotted-path matching, any-of arrays, `evaluate`.
  AC: the three sample rules from ARCHITECTURE §10 evaluate correctly on 20 fixture events; malformed YAML gives line-numbered errors.
- [ ] **P-27 reconstruct: divergence** — run policy over a run, `DivergencePoint[]`, freeze frame selection.
  AC: demo run under `prod-guard.yaml` diverges at the `deleteVolume` call; under `allow-all` diverges nowhere.
- [ ] **P-28 policy: counterfactual replay** — branched timeline, `would-not-have-happened` marking, shared prefix.
  AC: demo counterfactual halts at the freeze frame; events after it are marked; prefix events byte-identical.
- [ ] **P-29 reconstruct: seeded layout + auto-director** ★ — seeded d3-force, rounded positions, keyframe generator (establishing → follow → freeze → ripple → pull-back).
  AC: layout and keyframes are golden-tested; changing the seed changes output; same seed twice is identical.
- [ ] **P-30 api: reconstruction endpoints** — `/graph`, `/blast`, `/lineage`, `/divergence`, `/counterfactual`; layout cached on `runs`.
  AC: demo run endpoints return in < 300 ms warm; cache invalidates on new events or layout version bump.

**M2 exit:** every scene has data. Report and pause.

---

## M3 — Theatre (week 4)

- [ ] **P-31 web: scaffold + design tokens** — Next.js app router, Tailwind, `packages/ui` tokens (stage, ember, cyan, text), fonts, layout shell, API client, run list page.
  AC: `/runs` lists the demo run; Lighthouse performance ≥ 90 on the list page.
- [ ] **P-32 ui: replay clock + scrubber** — zustand clock, canvas-2D scrubber with event density, snapshot reducer every 500 events, keyboard (space, ←/→, [ ]).
  AC: seeking anywhere in a 10k-event fixture updates world state in < 16 ms; scrubber shows divergence markers.
- [ ] **P-33 web: causal graph scene** ★ — r3f canvas, instanced nodes/edges from `/graph`, hover cards from `summary`, provenance styling (reported vs observed), verify affordance opening the proof.
  AC: demo graph renders at 60 fps (perf-smoke); 5k synthetic nodes stay ≥ 45 fps on the CI runner.
- [ ] **P-34 web: cinematic camera** ★ — drei `CameraControls` driven by auto-director keyframes with easing; manual orbit takes over on input and resumes on play.
  AC: pressing play from t=0 reproduces the same camera path frame-for-frame (golden screenshots at 5 keyframes).
- [ ] **P-35 web: reasoning subtitles + event cards** — DOM overlay of `summary` synced to the clock; expandable cards for llm/tool events; blob drill-down only on click.
  AC: no blob fetch occurs during playback; subtitles never overlap the scrubber.
- [ ] **P-36 web: world-state panel** — live side panel (volumes, backups, files, tokens) derived from the reducer; values animate on change.
  AC: at the deletion event the panel shows backups 1 → 0 in the same frame as the graph flare.
- [ ] **P-37 web: freeze frame + split view** — at the first divergence, time freezes; split shows policy text vs the action; "continue" resumes.
  AC: the freeze happens exactly at the divergence `seq`; split view is readable at 1280×800.
- [ ] **P-38 web: blast ripple + perf pass** ★ — ripple shader by wave, affected list; instancing audit, `frameloop="demand"` when paused, dpr cap, CI `perf-smoke` enabled.
  AC: ≤ 200 draw calls in every scene; demo run p95 frame ≤ 16.7 ms on the CI runner; `perf-smoke` is now a required check.

**M3 exit:** the Theatre demo is watchable end to end. Report and pause.

---

## M4 — Approach, Lineage, Branch (week 5)

- [ ] **P-39 web: Approach scene** — live canvas: system slabs, instanced agents with trails from SSE, leash lines to principals, risk-zone pulse, click → open run.
  AC: 5k simulated agents at ≥ 45 fps; a new critical event pulses its zone within 200 ms.
- [ ] **P-40 web: Lineage scene** — d3-hierarchy SVG tree, mismatch hop highlight, scope/permissions rings, link to the grant event.
  AC: demo mismatch is visible without interaction; tree is keyboard navigable.
- [ ] **P-41 web: Branch scene** — dual timelines from one clock, YAML policy editor with validation, counterfactual request, greyed post-halt events.
  AC: editing the sample policy re-branches in < 500 ms; invalid YAML shows inline errors.
- [ ] **P-42 api: narration (opt-in)** — Claude API call producing sentences that each cite event ids; reject uncited sentences; cache by run + events hash.
  AC: demo narrative has ≥ 5 sentences, all cited; second call is served from cache with zero model calls.

**M4 exit:** all six scenes exist (Sealed File pending). Report and pause.

---

## M5 — Evidence and launch (week 6)

- [ ] **P-43 evidence: bundle packer/unpacker** — zip per ARCHITECTURE §12, export policy (summaries always, content optional), detached signature.
  AC: bundle for the demo run unpacks and verifies with `packages/chain` only; altering any byte of `events.jsonl` fails verification.
- [ ] **P-44 evidence: report generator + regulation map** — `report.md` template (timeline, divergence, lineage, blast, glossary), `regulation_map.json` with "supports" wording.
  AC: report renders for the demo run with no empty sections; map lists EU AI Act Art. 12 elements, AI AGENT Act record elements, SOC 2 CC7.2/7.3.
- [ ] **P-45 api+web: Sealed File** — async evidence job, S3 download URL, seal animation, checklist from the regulation map, link to verifier.
  AC: job completes in < 10 s for the demo run; the page verifies the bundle client-side before offering download.
- [ ] **P-46 verify: static verifier** — Vite app, drop zip or paste hash, link-by-link chain animation, pins failing `seq`, optional live key fetch.
  AC: works offline from `file://`; a tampered bundle shows the exact broken `seq`; bundle ≤ 300 kB gz.
- [ ] **P-47 chain: anchoring interface** — `Anchor` interface with no-op and RFC 3161 stub; checkpoint carries `anchor` when present.
  AC: interface tested with a fake TSA; no-op default leaves checkpoints unchanged.
- [ ] **P-48 web: landing page + demo capture** — `/` with the two-minute story, embedded WebM captured from the Theatre (`MediaRecorder`), "verify this incident" CTA.
  AC: landing loads < 1 s on 3G-fast; video ≤ 8 MB; CTA opens the verifier with the demo bundle.
- [ ] **P-49 docs: README + quickstart** — install, point an OTel exporter at Debrief, wrap an MCP server with the proxy, run the demo, verify a bundle.
  AC: a new machine follows the README to a verified demo bundle in < 15 minutes (timed).
- [ ] **P-50 api: hardening** — API key management endpoints, rate-limit tuning, request size limits, security headers, dependency audit clean.
  AC: `pnpm audit` has no high/critical; OWASP headers present; rotating a key invalidates the old one immediately.

**M5 exit:** public demo + verifier live. Final report.

---

## Parking lot (not scheduled)
- Enforcing proxy with approval workflow (shares `packages/policy`; joins the UPI mandate product)
- Public anchoring to Sigstore Rekor
- CloudTrail and Kubernetes audit hooks
- Live LLM counterfactual branch (Rewind-style) as an explicit opt-in
- Multi-node ingest with sharded streams
- Mobile layouts for the Theatre
