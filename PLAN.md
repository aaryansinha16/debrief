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
- [x] **P-17 sandbox: Orbital MCP server** — tools `readFile`, `listVolumes`, `deleteVolume`, `rotateCredential` over the infra API.
  AC: works behind `mcp-proxy`; args and results are redacted per P-13.
- [x] **P-18 sandbox: scripted agent** — deterministic agent (OTel JS SDK, real `gen_ai.*` spans) that reproduces the incident: credential mismatch → finds a token in an unrelated file → `deleteVolume` on a production id → backups gone. `--live` flag swaps in Claude via API.
  AC: run twice → identical event kinds/order (ts excluded); exactly one `world.change` with `environment: production`; `delegation.grant` shows scope `staging:credentials` with permissions `account:*`.
- [x] **P-19 sandbox: `pnpm demo:nine-seconds`** — seeds tenant + key, starts services, runs the agent, prints run id and a verify URL.
  AC: from a clean `docker compose up`, completes in < 60 s; exit code 0; the run has ≥ 40 events.
- [x] **P-20 api: runs materialization + read API** — debounced run summary on ingest; `GET /v1/runs`, `/v1/runs/:id`, `/v1/runs/:id/events` (cursor).
  AC: demo run appears with correct counts and `riskMax: critical`; cursor pagination is stable under concurrent ingest.
- [x] **P-21 api: SSE live feed** — `GET /v1/live` via LISTEN/NOTIFY, `since` cursor, heartbeat.
  AC: a client receives the demo run's events within 200 ms of append; reconnect with `since` yields no gaps or duplicates.

**M1 exit:** the incident is captured with both provenances. Report and pause.

---

## M2 — Reconstruction (week 3)

- [x] **P-22 reconstruct: causal graph** ★ — `buildGraph(events)`, tool-result attachment (call id → span → adjacency), delegation and messaging edges.
  AC: golden graph for the demo run; adding an unrelated run does not change it; deterministic node ids.
- [x] **P-23 reconstruct: world correlation** ★ — `exact/strong/weak` linking of `world.change` to tool calls.
  AC: demo `deleteVolume` links `exact` (traceparent); with traceparent stripped it links `strong`; a decoy mutation 30 s later links nothing.
- [x] **P-24 reconstruct: blast radius** — waves over `mutates/observes` ≥ strong, grouping, recoverable flags.
  AC: demo blast = 2 waves (volume, backups), `recoverable: false`; toggling weak edges on includes the decoy.
- [x] **P-25 reconstruct: authority lineage** — walk to principal, `scopeMismatch` from grant scope vs permissions vs target.
  AC: demo lineage is human → coding-agent → token; mismatch flagged on the token hop with both rings' values.
- [x] **P-26 policy: DSL + evaluator** — YAML parser (zod), dotted-path matching, any-of arrays, `evaluate`.
  AC: the three sample rules from ARCHITECTURE §10 evaluate correctly on 20 fixture events; malformed YAML gives line-numbered errors.
- [x] **P-27 reconstruct: divergence** — run policy over a run, `DivergencePoint[]`, freeze frame selection.
  AC: demo run under `prod-guard.yaml` diverges at the `deleteVolume` call; under `allow-all` diverges nowhere.
- [x] **P-28 policy: counterfactual replay** — branched timeline, `would-not-have-happened` marking, shared prefix.
  AC: demo counterfactual halts at the freeze frame; events after it are marked; prefix events byte-identical.
- [x] **P-29 reconstruct: seeded layout + auto-director** ★ — seeded d3-force, rounded positions, keyframe generator (establishing → follow → freeze → ripple → pull-back).
  AC: layout and keyframes are golden-tested; changing the seed changes output; same seed twice is identical.
- [x] **P-30 api: reconstruction endpoints** — `/graph`, `/blast`, `/lineage`, `/divergence`, `/counterfactual`; layout cached on `runs`.
  AC: demo run endpoints return in < 300 ms warm; cache invalidates on new events or layout version bump.

**M2 exit:** every scene has data. Report and pause.

---

## M3 — Theatre (week 4)

- [x] **P-31 web: scaffold + design tokens** — Next.js app router, Tailwind, `packages/ui` tokens (stage, ember, cyan, text), fonts, layout shell, API client, run list page.
  AC: `/runs` lists the demo run; Lighthouse performance ≥ 90 on the list page.
- [x] **P-32 ui: replay clock + scrubber** — zustand clock, canvas-2D scrubber with event density, snapshot reducer every 500 events, keyboard (space, ←/→, [ ]).
  AC: seeking anywhere in a 10k-event fixture updates world state in < 16 ms; scrubber shows divergence markers.
- [x] **P-33 web: causal graph scene** ★ — r3f canvas, instanced nodes/edges from `/graph`, hover cards from `summary`, provenance styling (reported vs observed), verify affordance opening the proof.
  AC: demo graph renders at 60 fps (perf-smoke); 5k synthetic nodes stay ≥ 45 fps on the CI runner.
- [x] **P-34 web: cinematic camera** ★ — drei `CameraControls` driven by auto-director keyframes with easing; manual orbit takes over on input and resumes on play.
  AC: pressing play from t=0 reproduces the same camera path frame-for-frame (golden screenshots at 5 keyframes).
- [x] **P-35 web: reasoning subtitles + event cards** — DOM overlay of `summary` synced to the clock; expandable cards for llm/tool events; blob drill-down only on click.
  AC: no blob fetch occurs during playback; subtitles never overlap the scrubber.
- [x] **P-36 web: world-state panel** — live side panel (volumes, backups, files, tokens) derived from the reducer; values animate on change.
  AC: at the deletion event the panel shows backups 1 → 0 in the same frame as the graph flare.
- [x] **P-37 web: freeze frame + split view** — at the first divergence, time freezes; split shows policy text vs the action; "continue" resumes.
  AC: the freeze happens exactly at the divergence `seq`; split view is readable at 1280×800.
- [x] **P-38 web: blast ripple + perf pass** ★ — ripple shader by wave, affected list; instancing audit, `frameloop="demand"` when paused, dpr cap, CI `perf-smoke` enabled.
  AC: ≤ 200 draw calls in every scene; demo run p95 frame ≤ 16.7 ms on the CI runner; `perf-smoke` is now a required check.

**M3 exit:** the Theatre demo is watchable end to end. Report and pause.

---

## M4 — Approach, Lineage, Branch (week 5)

- [x] **P-39 web: Approach scene** — live canvas: system slabs, instanced agents with trails from SSE, leash lines to principals, risk-zone pulse, click → open run.
  AC: 5k simulated agents at ≥ 45 fps; a new critical event pulses its zone within 200 ms.
- [x] **P-40 web: Lineage scene** — d3-hierarchy SVG tree, mismatch hop highlight, scope/permissions rings, link to the grant event.
  AC: demo mismatch is visible without interaction; tree is keyboard navigable.
- [x] **P-41 web: Branch scene** — dual timelines from one clock, YAML policy editor with validation, counterfactual request, greyed post-halt events.
  AC: editing the sample policy re-branches in < 500 ms; invalid YAML shows inline errors.
- [x] **P-42 api: narration (opt-in)** — Claude API call producing sentences that each cite event ids; reject uncited sentences; cache by run + events hash.
  AC: demo narrative has ≥ 5 sentences, all cited; second call is served from cache with zero model calls.

**M4 exit:** all six scenes exist (Sealed File pending). Report and pause.

---

## M5 — Evidence and launch (week 6)

- [x] **P-43 evidence: bundle packer/unpacker** — zip per ARCHITECTURE §12, export policy (summaries always, content optional), detached signature.
  AC: bundle for the demo run unpacks and verifies with `packages/chain` only; altering any byte of `events.jsonl` fails verification.
- [x] **P-44 evidence: report generator + regulation map** — `report.md` template (timeline, divergence, lineage, blast, glossary), `regulation_map.json` with "supports" wording.
  AC: report renders for the demo run with no empty sections; map lists EU AI Act Art. 12 elements, AI AGENT Act record elements, SOC 2 CC7.2/7.3.
- [x] **P-45 api+web: Sealed File** — async evidence job, S3 download URL, seal animation, checklist from the regulation map, link to verifier.
  AC: job completes in < 10 s for the demo run; the page verifies the bundle client-side before offering download.
- [x] **P-46 verify: static verifier** — Vite app, drop zip or paste hash, link-by-link chain animation, pins failing `seq`, optional live key fetch.
  AC: works offline from `file://`; a tampered bundle shows the exact broken `seq`; bundle ≤ 300 kB gz.
- [x] **P-47 chain: anchoring interface** — `Anchor` interface with no-op and RFC 3161 stub; checkpoint carries `anchor` when present.
  AC: interface tested with a fake TSA; no-op default leaves checkpoints unchanged.
- [x] **P-48 web: landing page + demo capture** — `/` with the two-minute story, embedded WebM captured from the Theatre (`MediaRecorder`), "verify this incident" CTA.
  AC: landing loads < 1 s on 3G-fast; video ≤ 8 MB; CTA opens the verifier with the demo bundle.
- [x] **P-49 docs: README + quickstart** — install, point an OTel exporter at Debrief, wrap an MCP server with the proxy, run the demo, verify a bundle.
  AC: a new machine follows the README to a verified demo bundle in < 15 minutes (timed).
- [x] **P-50 api: hardening** — API key management endpoints, rate-limit tuning, request size limits, security headers, dependency audit clean.
  AC: `pnpm audit` has no high/critical; OWASP headers present; rotating a key invalidates the old one immediately.
- [x] **P-50.1 repo: web reads the root `.env`** — setup links `apps/web/.env.local` → `../../.env` so `next dev`/`next start` see `DEBRIEF_API_KEY`; Next drops `AGENTS.md`/`CLAUDE.md` into `apps/web` in dev, git-ignored.
  AC: after `pnpm run setup` + key in `.env`, `/runs/<id>` renders without `ApiNotConfiguredError`.

- [x] **P-51 web: the Theatre, legible** — replace the unlabeled 3D stage on `/runs/[id]` with a zoned 2D map + a narrative that play together, then refresh the visual language across the app.
- [x] **P-51.1 web: theatre map + narrative** — story-time pacing (each event gets a beat), `lib/map-layout.ts` (zones: people · agent · tokens · model · tools · systems · staging · production), `scenes/map-scene.tsx` (SVG, labeled nodes, traversed edges, agent cursor, divergence + blast highlights), `scenes/narrative.tsx` (transcript that follows the clock), `RunTheatre` recomposed with bounded columns and controls under the stage.
  AC: every node on the stage is labeled; the page never grows with playback; the current event is visible on the map and in the transcript at any t; the demo run plays ≥ 15 s at 1×; the freeze frame stays inside the stage.
- [x] **P-51.2 web: theatre check + film on the map** — `/perf/theatre` renders the map, `camera:check` becomes `theatre:check` (deterministic frames at fixed t, freeze legibility, no overlap; blast and branch checks kept), `capture:demo` films the map, landing film re-captured.
  AC: CI perf-smoke green on the new check; `public/demo/theatre.webm` shows the map.
- [x] **P-51.3 web+ui: visual refresh** — control components (play/pause glyph button, segmented rate, links), header, run list, run header, typography scale, scrubber styling, landing matched.
  AC: no native `<select>` or bare text buttons on the run pages; one type scale documented in `packages/ui`; screenshots of `/runs`, `/runs/[id]`, `/live` reviewed by Aaryan.

- [x] **P-52 web: a stage of this generation** — Aaryan's second review: the map is legible but the app still looks and moves like a document. Depth, light and motion everywhere; the Theatre rebuilt in WebGL.
- [x] **P-52.1 web: motion system** — Inter + JetBrains Mono, glass surfaces and glow tokens, an ambient WebGL field behind every page (off on perf pages and under reduced motion), route entrance transitions, hover/press micro-interactions, run cards; `pnpm dev` honours `WEB_PORT`/`VERIFY_PORT`.
  AC: every page has the field, glass panels and the fonts; perf-smoke, theatre and landing checks unchanged and green; `prefers-reduced-motion` disables the field and the entrances.
- [x] **P-52.2 web: the 3D stage** — three.js/r3f stage from the same map model: zones as lit platforms, nodes as glowing objects with DOM labels, light packets travelling the edges, a camera that flies toward the active zone, shockwave at the freeze, ring of light for the blast; every animation a function of the story clock so a seek is deterministic.
  AC: theatre check green (labels, determinism at fixed t, freeze readable, ripple), demo ≥ 55 fps on a laptop GPU, ≤ 200 draw calls, story reads without the transcript.
- [x] **P-52.3 web: landing hero + pages + film** — WebGL hero on the landing loaded after `load` (budget kept), reveal animations, lineage/blast/evidence pages on glass, film re-captured from the 3D stage.
  AC: landing < 1 s on Fast 3G still; film shows the 3D stage; screenshots reviewed by Aaryan.

- [x] **P-52.4 web: the field** — Aaryan's review of P-52: the particle background reads as childish. Replace it with a drifting mesh gradient and a cloud of small boxes tumbling in depth, both reacting to the cursor (boxes pushed aside and lit within reach, a highlight that follows the pointer); the landing gets the same in 2D within its budget.
  AC: no round particles anywhere; the cursor visibly moves the field on `/runs` and `/`; reduced motion gets the still gradient; perf-smoke, theatre and landing checks green.
- [x] **P-52.5 web: the swarm** — Aaryan's review of P-52.4: a uniform field of boxes is not a cloud. Replace it with one swarm of small boxes that flock into a cloud of no fixed shape: lobes breathe, split and rejoin, the swarm reforms every few seconds and wanders the page; the cursor scatters it. The landing gets the same swarm in 2D within its budget.
  AC: the boxes visibly form one moving cloud rather than filling the viewport; its shape changes over 20 s without a reload; the cursor scatters boxes within reach; reduced motion gets the still gradient; perf-smoke, theatre and landing checks green.
- [x] **P-52.6 web: the splash and the call** — Aaryan's review of P-52.5: the pointer highlight trailed to the right and should be a jiggling splash; the page still looks empty; a click should make the swarm run to that point. Snappier frame-rate-independent follow, a four-harmonic splash rim, twice the boxes in bigger lobes, and a click that calls the whole swarm over before it blooms back out. Landing gets the same.
  AC: the highlight sits under a still pointer within a few px; its rim wobbles; ≥ 1200 boxes; a click gathers the swarm at the point within a second and it releases after; theatre and landing checks green.

**M5 exit:** public demo + verifier live. Final report.

---

## Witness pivot

Debrief becomes the independent witness for AI agents (ARCHITECTURE §18, D-077–D-081): the claims
an agent makes about its work, checked against what the touched systems recorded, sealed into a
receipt anyone verifies offline. Lanes per CLAUDE.md: A runs M6, C runs the M7 adapters in the
background, B runs M8 in its own worktree.

- [x] **P-60 docs: witness pivot** — ARCHITECTURE §18, D-077–D-081, milestones M6–M9, CLAUDE.md parallel lanes and amended domain rules (D-077, D-079), commit areas `claims verdict witness cli`, the lane agents in `.claude/agents/` with `.worktreeinclude`, the Witness canvas in `docs/design/`, `.claude/worktrees/` ignored.
  AC: docs on `main`; the commit-msg hook accepts `claims|verdict|witness|cli` and still rejects unknown areas; `.claude/agents/` holds reviewer, claim-skeptic, ui-craftsman and witness-adapter; `prettier --check .` green.
- [x] **P-60.1 repo: audit clean, MinIO replaced, weekly CI** — dependencies upgraded until `pnpm audit --audit-level high` is clean (next 16.4.3, MCP SDK 1.32.2, vite 8.3.5, zod 4.6.7, puppeteer-core 25.16.0; body-parser, undici and source-map-js re-resolved); SeaweedFS replaces MinIO in compose, CI, `.env.example` and README (D-082); CI also runs weekly on main.
  AC: `pnpm audit --audit-level high` clean at the same level with no ignores; the CI test job green against SeaweedFS with the presigned GET exercised; the bucket exists at startup; Object Lock evaluated and documented; a weekly scheduled run on main.

---

## M6 — Claims (Lane A)

- [x] **P-61 schema: claim, verdict and world.read kinds** — **ask before starting** (event schema change; the ask covers how verdict provenance is marked and whether `witness.trust` stays an `attrs` key or becomes a field; approved 2026-10-26 as D-083). zod schemas for `claim` (§18.3), `verdict` (§18.4), `world.read` (access without change, §18.6) and witness trust `local | third-party`; wire encoding and redaction cover claim text.
  AC: a `holds` or `contradicted` verdict without evidence ids or without trust is rejected, as is a claim without a span; existing goldens (chain vectors, otel map, nine-seconds graph) are byte-identical; 100% branch coverage on the new validators; one fixture event of each new kind hashes identically in Node and jsdom.
- [x] **P-61.1 ci: time the sandbox demo alone** — CI's test job runs every package but the sandbox first, then the sandbox by itself, so the demo's < 60 s budget (P-19) is measured without every other suite competing for the runner; main went red on it once (62 s at 78f0c4b, 64–66 s on #66), after the ui seek budget had done the same (fixed in #64).
  AC: the sandbox tests run in their own CI step after the rest, even when that step fails; the 60 s budget is unchanged; CI green on main.
- [ ] **P-62 cli: Claude Code capture via a Stop hook** — new `apps/cli` (bin `debrief`); `debrief claude-code install|uninstall` writes or removes a Stop hook in Claude Code's settings; the hook posts new transcript lines (`sourceId` = line uuid) and the repo's git state as an observed `world.change` with `witness.trust: local`; it never blocks or fails a turn.
  AC: install writes user-scope settings only and no settings file ever holds the API key; installing twice leaves one hook entry and `uninstall` restores the original settings; a synthetic transcript posted twice is stored once; with the API down the hook exits 0 in < 2 s and the backlog uploads on the next Stop; secrets in the fixture transcript are redacted before persistence (DB inspection); git state arrives as observed with `witness.trust: local`, and a Stop with no git change posts none; the hook's key holds `local` trust (D-084).
- [ ] **P-63 claims: extraction with cited spans** — `packages/claims` (pure: prompt, parser, predicate catalogue, span validator) + `apps/api/src/claims/` (one model call per settled session, cached by transcript hash, appends `claim` events, 503 without `ANTHROPIC_API_KEY`), per D-077.
  AC: a claim whose span is missing, out of range or does not re-read to its text is dropped and counted; every claim emitted for the fixture sessions re-reads exactly; hedged sentences ("should pass", "I think") come out `hedged`; a second run on the same transcript makes zero model calls; ingest and verdict code import nothing from `claims`; claim events pass `eventInputSchema` before they are appended (`EventsRepository.append` does not validate).
- [ ] **P-64 verdict: packages/verdict** ★ — pure, browser-safe, one versioned checker per predicate over observed events (§18.4, D-078); uncertain is `no-witness`; each verdict records the trust that backed it; late evidence appends a superseding verdict.
  AC: golden verdicts for the fixture sessions; property test: every verdict other than `no-witness` cites ≥ 1 observed event id inside its subject and window; removing all observed events turns every verdict into `no-witness`; reordering or duplicating events changes nothing; hedged claims are never scored; a verdict backed only by local evidence carries `trust: local` and is labelled so; checkers read `witness.trust` only on observed events and count a missing or unknown value as `local`; `tests.passed` may be contradicted by `ci.jobs.failed > 0`, but job counts alone never produce `holds`, and a claim with a test count and no `world.tests.*` evidence is `no-witness` (D-085); the `claim-skeptic` pass (≥ 10 adversarial fixtures, one of them all jobs green with 3 tests skipped in the session) is green before merge.
- [ ] **P-65 verdict: unreported side effects** ★ — `sideEffects(claims, events, graph)`: every observed `world.change` that `correlateWorld` links at ≥ strong to the session's tool calls and that no asserted claim covers (§18.5); `correlateWorld` (§8) gains the witness keys of §18.6.
  AC: a fixture Stripe webhook-endpoint deletion surfaces as a side effect citing the world event, the tool call and `exact` confidence through the request id; an access key id links `strong`; a human change in the same window with no link is not blamed; weak links are listed apart and never counted; the nine-seconds goldens are byte-identical; golden file.
- [ ] **P-65.1 api: session check** — runs claims → verdicts → side effects when a session settles and again when observed events land in its window; appends `verdict` events; `GET /v1/sessions`, `GET /v1/sessions/:id/check`.
  AC: the fixture session's check returns claims, verdicts with evidence ids and trust, and side effects; a late witness event appends a superseding verdict and the check returns the latest; no verdict cites an event that is not in the chain; verdict events pass `eventInputSchema` before they are appended.

**M6 exit:** a fixture session plus fixture witness events produce the claim check end to end through the API. Report and pause.

**M6.5 exit** (after P-65.1, P-66.1 and Lane C's P-66 and P-66.2): the first real claim check on this repo, from a live Claude Code session, with the local git and GitHub CI witnesses. Report and pause.

---

## M7 — Witnesses (Lane C, parallel)

One adapter per point: `packages/witness-<system>` (pure mapping) + `apps/witnesses/<system>` (I/O),
built by the witness-adapter agent in its own worktree, at most two at once. P-66 starts as soon as
P-61 merges. Common AC for every point: a mapping golden over recorded-shape synthetic payloads; a
replayed fixture produces the expected events end to end against the local API; a redelivered event
is stored once; signatures are checked where the vendor signs; read-only credentials only; every
event carries `witness.trust: third-party`; a README section "Connect <system>".

- [x] **P-66 witness: GitHub (Actions, PRs, pushes)** — webhooks push, pull_request, workflow_run, check_run, delete; a poller mode (REST, read-only token) for an API with no public URL, which M6.5 uses on a laptop.
  AC: common AC; a finished workflow run maps to a `world.change` on the run with passed/failed/skipped counts; commit SHA and actor land in `attrs` (§18.6); the poller and the webhooks produce the same events for the same fixture.
  Done (#66): the counts are job counts, `ci.jobs.*` with `ci.counts.of: jobs`, because GitHub's run record holds no test results (D-085).
- [x] **P-66.1 api: bind witness trust to the posting key** (Lane A, before P-62) — `api_keys.trust` `local | third-party` is the most `witness.trust` a key's observed events may assert; key management never climbs above the caller's trust (D-084).
  AC: a batch with an observed event asserting more than its key's trust gets 403 naming the event and stores nothing; a `third-party` key may assert either; no key issues, rotates or revokes a key above its own trust and rotation keeps the trust; keys issued before the migration keep `third-party` and new keys default to `local`; `seed --trust`; `/v1/me` and `/v1/keys` show the trust; the GitHub witness exits at startup on a key below `third-party`.
- [ ] **P-66.2 witness: test results from CI** (Lane C, after P-66.1; before M6.5) — JUnit XML artifacts and test-reporter check-run output parsed into `world.tests.{passed,failed,skipped}` on the run, third-party trust (D-085).
  AC: common AC; a fixture JUnit artifact (several files, nested suites, a skipped and an errored case) maps to exact counts on the run, an error counted as failed; a test-reporter check run's output maps to the same counts; a run without a report carries no `world.tests.*`; a malformed or oversized report posts no counts and logs why; artifacts are read with the read-only token and never stored; the poller and the webhooks agree.
- [ ] **P-67 witness: Postgres/Neon** — audit log per branch (pgaudit or the §8 trigger); Neon branch → environment.
  AC: common AC; a fixture UPDATE on the production branch maps to a `world.change` with a row count and no row values anywhere in the event; a SELECT maps to `world.read`; migrations carry the schema hash.
- [ ] **P-68 witness: Vercel** — deployment webhooks (created, ready, error, promoted).
  AC: common AC; preview and production deployments map to their environments with commit SHA and duration.
- [ ] **P-69 witness: Stripe** — event log and webhooks through a restricted read key; livemode → environment.
  AC: common AC; a fixture `webhook_endpoint.deleted` carries its request id and idempotency key in `attrs` (P-65 links them `exact`; the M7 exit checks the link).
- [ ] **P-70 witness: AWS CloudTrail** — management events as `world.change`, data events as `world.read`.
  AC: common AC; a fixture `DeleteObject` carries its access key id in `attrs` (P-65 links it `strong`); `GetObject` maps to `world.read`; the README's IAM policy is read-only.

**M7 exit:** the canvas's seven claims (`docs/design/artboards/claim-check.dc.html`) on recorded-shape fixtures: every verdict follows from its checker and cites its evidence or names the missing witness; the two contradictions and the Stripe side effect surface; a verdict backed only by the local git witness is labelled `local`. The split is compared with the canvas's 4 holds · 2 contradicted · 1 no witness and every difference is explained in the report, never forced. Report and pause.

---

## M8 — Surfaces (Lane B, ui-craftsman, from `docs/design/`)

- [ ] **P-71 web+ui: tokens and fonts from the canvas, remove the ambient swarm** — `docs/design/tokens.json` → `@debrief/ui` tokens and the Tailwind theme; Instrument Serif, Geist, Geist Mono; the ambient canvas, wash, swarm and the landing's 2D twin deleted; dot-grid ground; one verdict component (icon + word + color); the 3D stage and the branch editor leave the navigation (routes stay).
  AC: a test pins the tokens to `tokens.json`; no WebGL context on pages without a scene; text tokens ≥ 4.5:1 contrast; perf-smoke, theatre and landing checks green.
- [ ] **P-72 web: claim check page** — `/sessions/[id]` per `claim-check.dc.html`: verdict headline, integrity ring, claim beams, unreported side effects, witnesses.
  AC: screenshots at 1440 and 390 attached; each claim row links its transcript span and its evidence events; verdicts backed only by local evidence say so; no-witness rows name the missing witness; keyboard reachable; static under reduced motion; a CI probe renders the fixture session.
- [ ] **P-73 web: replay with said/saw rails** — `/sessions/[id]/replay` per `replay.dc.html`, on the replay clock.
  AC: frames at a fixed t are identical across seeks (a check like `theatre:check`); the said and saw rails never merge; the divergence burst sits at the contradicting event's t; static under reduced motion.
- [ ] **P-74 web+verify: receipt share page and hosted verify** — `POST /v1/receipts` seals sessions in a window into a bundle with claims, verdicts and witnesses; `/r/[receiptId]` per `receipt.dc.html`; `apps/verify` hosted.
  AC: the author previews the receipt (claim text and summaries exactly as shared) before a share link exists; the page verifies with no API call besides fetching the zip (network log in the check); a one-byte tamper fails and pins the seq; verdicts re-derived in the browser match the sealed ones and show their trust; claim text and summaries only, never content blobs; a revoked receipt returns 404 and the chain still verifies.
- [ ] **P-75 web: phone nudge** — PWA push or Telegram when a settled session has a contradicted claim or an unreported side effect, per `phone-nudge.dc.html`.
  AC: the channel choice is recorded in a D- entry; a contradicted fixture session sends exactly one notification within 10 s of settling; the payload carries no transcript text or secrets; the card opens the claim check.

**M8 exit:** the four canvas screens work on fixture data. Report and pause.

---

## M9 — Ship

- [ ] **P-76 api: local mode without Docker** — **ask before starting** (storage change): an embedded database and filesystem blobs so a laptop runs Debrief without Docker.
  AC: with Docker stopped, the fixture session ingests, chains, checkpoints and verifies; append-only is enforced in local mode (test); chain goldens unchanged; Docker mode unchanged.
- [ ] **P-77 cli: `npx debrief init` for Claude Code** — one command: starts or points at an API, creates a key, runs `claude-code install`, prints the first claim check URL.
  AC: a fresh machine reaches its first claim check in < 5 minutes (timed); re-running is idempotent; `npm pack` contents and the bin are checked.
- [ ] **P-78 web: landing and film** — the landing retold as the witness, the film captured from the claim check, replay and receipt.
  AC: < 1 s on Fast 3G; film ≤ 8 MB; the CTA opens a sample receipt that verifies in the browser.
- [ ] **P-79 repo: deploy to the Coolify VPS** — api, web, verify and the witnesses on Aaryan's Coolify VPS with TLS, secrets in Coolify, backups for Postgres and object storage.
  AC: the public URL serves the landing, a sample receipt that verifies, and `/healthz`; a redeploy keeps the chain and checkpoints; no signing key in any image; a runbook in the README.

**M9 exit:** public — `npx debrief init` to a shared receipt. Final report.

---

## Parking lot (not scheduled)
- Enforcing proxy with approval workflow (shares `packages/policy`; joins the UPI mandate product)
- Public anchoring to Sigstore Rekor
- Kubernetes audit hooks
- Live LLM counterfactual branch (Rewind-style) as an explicit opt-in
- Multi-node ingest with sharded streams
- Mobile layouts for the Theatre
