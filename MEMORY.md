# Memory

Working memory for the coding agent. Read fully at every session start. Keep under 150 lines.
Edit in place; do not append a diary. Facts only — no plans (those live in `PLAN.md`) and no
rationale (that lives in `DECISIONS.md`). The last commit of every point is `memory: close P-NN`
and updates the Status block below.

## Status
- Current milestone: M3 Theatre
- Current point: P-38 done (PR pending merge); next is the M3 boundary report, then P-39 (M4) on Opus
- Last merged PR: #38 P-37 freeze frame
- `main` is at: P-37 freeze frame (P-38 merges next)
- Blocked points: none

## Environment facts
- Node 22 (≥ 20 required), pnpm 10.8.1 (`packageManager` pinned), Docker Compose v2, `gh` authenticated as `aaryansinha16`
- Repo: github.com/aaryansinha16/debrief, private, personal free plan
- Ports: api 4000 · web 3000 · verify 5173 · sandbox infra 4100 · postgres 5432 · minio 9000 (console 9001); all overridable from `.env`
- Compose: `docker-compose.yml` — postgres:16-alpine (superuser `postgres`, app role `debrief_app` created by `docker/postgres/init.sh`), minio pinned on quay.io (Docker Hub no longer serves pinned tags), one-shot `minio-init` makes bucket `debrief`; healthy in ~6 s after pull; `docker compose down -v` for a clean slate
- Local creds live in `.env` (copied from `.env.example` by `pnpm run setup`); never commit `.env`; `pnpm run setup` also writes `debrief.signing-key.json` (git-ignored) and appends `BLOB_MASTER_KEY` to `.env` when missing
- Git hooks path is `.githooks` (set by `pnpm run setup`); `commit-msg` enforces one-line messages; `pre-push` refuses pushes to `main`
- CI: `.github/workflows/ci.yml` — jobs lint (incl. prettier --check), typecheck, test (postgres:16 service + a `docker run` MinIO step, `DATABASE_ADMIN_URL` set), build, perf-smoke (blocking since P-38: `pnpm perf:smoke` + `camera:check` on system Chrome/SwiftShader, ~4 min); ~60 s for the four fast jobs
- API: NestJS 12 ESM via `@swc-node/register` (D-025); `pnpm --filter @debrief/api dev|start|db:migrate|keygen`; root `pnpm db:migrate` / `pnpm db:generate`; DB tests create a throwaway database + role from `DATABASE_ADMIN_URL` and skip when it is unset; `GET /v1/me` echoes the resolved key
- Append: `EventsRepository.append(tenantId, inputs)` takes `pg_advisory_xact_lock(hashtextextended(tenant, 0))`, assigns seq/prevHash/hash, inserts the batch, `pg_notify('debrief_events', {tenantId, fromSeq, toSeq})`; `list`/`scan`/`head` read back; rows → events via `toEvent` (nulls stripped so hashes reproduce); measured p99 ≈ 2 ms locally, budget 15 ms local / 200 ms CI (shared runner, informational); `append(tenantId, [{ input, sourceId? }])` returns `{ events, duplicates }` and skips known `(source, sourceId)` via `event_sources`
- OTLP: `POST /v1/traces` (json + x-protobuf, D-026); mapping lives in `packages/schema/src/otel-map.ts`, fixture spans in `@debrief/schema/fixtures`, golden at `@debrief/schema/golden/otel-map.json`; `toOtlpJson()` / `toProtobufObject()` in `apps/api/src/otlp/otlp-json.ts` build request bodies; `OtlpService.stats()` counts spans/accepted/duplicates/ignored
- Native ingest: `POST /v1/events` `{ events: [...] }` per D-027 (server assigns id/ts/tenantId; `sourceId` for idempotency); rate limit `RATE_LIMIT_PER_MINUTE` (tests set it in `process.env` before `createApp()`); `RateLimiter` is one global provider, guard applied with `@UseGuards(RateLimitGuard)` on ingest controllers
- Runs (D-035): `RunsService.observe/settle/get`, `RunsRepository.materialize/list`; `GET /v1/runs?limit&cursor&since`, `/v1/runs/:id`, `/v1/runs/:id/events?limit&cursor&from&to`; `RUN_DEBOUNCE_MS`; tests call `settle()` instead of sleeping
- Reconstruct (D-037): `buildGraph(events, {runId?})` → `CausalGraph {runId, version, nodes, edges}`; `demoRunFixture()`/`DEMO_RUN_ID` from `@debrief/reconstruct/fixtures` (49 real events, both runs); golden at `packages/reconstruct/__golden__/nine-seconds.graph.json`; regenerate via a swc-node script from `apps/api` then `prettier --write`
- Correlation (D-038): `correlateWorld(events, graph)` → `WorldLink[]`, `applyWorldLinks(graph, links, events)` adds tool→resource `mutates` + `authorized_by`; golden `__golden__/nine-seconds.links.json`; synthetic test events via `src/__fixtures__/synthetic.ts` (`ev`, `at`, `ulid`)
- Blast (D-039): `withConsequences(graph, events)` adds `…/backups` resource nodes; `blastRadius(graph, origin, events, {includeWeak?})` → `{waves, groups, recoverable}`; full pipeline = buildGraph → correlateWorld → applyWorldLinks → withConsequences; golden `__golden__/nine-seconds.blast.json`
- Lineage (D-040): `authorityLineage(graph, origin, events)` → `{hops[{nodeId,type,label,authority?,scopeMismatch?}], action, principalId?, complete, authorityObserved, mismatches}`; golden `__golden__/nine-seconds.lineage.json`
- Policy (D-032, D-041): `parsePolicy` (line-numbered `PolicyParseError.issues`), `evaluate(subject, policy, ctx?)`, `evaluateEvent(event, policy, ctx?)`, `subjectOf` derives `authority.scopeMismatch` (major only) via `scopeMismatchOf` in schema; fixtures `@debrief/policy/fixtures` (20 events) + `@debrief/policy/prod-guard.yaml`; golden `packages/policy/__golden__/prod-guard-decisions.json`
- Divergence (D-042): `reconstructGraph(events, {runId?})` = full pipeline; `divergence(events, policy, graph?)` → `{runId, evaluated, points[], freezeFrame?}`; golden `__golden__/nine-seconds.divergence.json` (freeze at seq 45)
- Counterfactual (D-043): schema owns `sortTimeline/timelineKey/compareKeys`; policy `replay(events, freezeFrame?)`/`counterfactual(events, decide)`/`decideWith`; reconstruct `counterfactual(events, policy, graph?)`; golden `__golden__/nine-seconds.counterfactual.json`
- Layout/director (D-044): `layout(graph, seed)` → `{version, seed, iterations, positions{x,y,z}, bounds}` (z by role via `LAYERS`); `direct(graph, layout, divergence?, blast?)` → `Keyframe[]`; goldens `nine-seconds.layout.json`, `nine-seconds.keyframes.json`; rounding helpers normalize `-0`
- Reconstruction API (D-045): `GET /v1/runs/:id/graph?policy=&seed=` → `{graph, layout, keyframes, divergence, cached}`, `GET …/blast?node=&weak=`, `GET …/lineage?node=`, `POST …/divergence|counterfactual` `{policyId|policy}`; `ReconstructionService` caches by head seq, layout persisted in `runs.layout`; sample policies `SAMPLE_POLICIES` in `@debrief/policy`
- Web (D-046): Next 16 app router on **webpack** (`--webpack`, `extensionAlias` for `.js`→`.ts`), Tailwind 4 with `@debrief/ui/tokens.css`; server-only `createApiClient()` from `DEBRIEF_API_URL`/`DEBRIEF_API_KEY`; pages `/runs`, `/runs/[id]`, `/live` (placeholder); `pnpm --filter @debrief/web dev` on `WEB_PORT`; tests render with `react-dom/server`
- Replay (D-047): `@debrief/ui` exports `createReplayClock` (zustand vanilla), `createReplay(events)` (`stateAt/indexAt/timeOf/density`, snapshots every 500), `applyEvent`/`WorldState`, `drawScrubber`, `<Scrubber>`, `useReplayTicker`, `useReplayKeys`, `handleReplayKey`; web `ReplayPanel` on `/runs/[id]`; ui tests run jsdom per file with a mocked 2D context
- Graph scene (D-048): `apps/web/src/scenes/graph-canvas.tsx` (points impostors + line segments, `GraphCanvasProps {scene, hovered, onHover, frameloop, spin, onFrame}`), `graph-view.tsx` (hover card, legend), `lib/scene.ts` (`buildSceneData`, `syntheticScene`), `/api/proof?event=` proxy, `/perf/graph?nodes=|fixture=demo`; `pnpm perf:smoke` = `apps/web/perf/smoke.ts` (puppeteer-core + system Chrome, SwiftShader); far LOD beyond `LOD_NODE_THRESHOLD`=1000 (flat dots, edges only around the hovered node — GL lines cost ~115 µs each on the runner's SwiftShader); CI job `perf-smoke` blocks since P-38
- Camera (D-049): ui `cameraPoseAt(keyframes, seconds)` (golden `packages/ui/__golden__/nine-seconds.camera.json`); web `CinematicCamera` in `graph-canvas.tsx` (drei CameraControls, `controlstart` → manual, play → resume), `RunTheatre` (one clock, duration = film), `/perf/theatre` + `pnpm --filter @debrief/web camera:check` (two playbacks, five keyframes, byte-identical stage/page/pose)
- Subtitles/cards (D-050): api `GET /v1/blobs/:sha256` (404/410/500), web `/api/blob?sha=` proxy, `scenes/subtitles.tsx` (overlay inside `GraphView` children), `scenes/event-cards.tsx` (`loadBlob` prop, `fetchBlob` default); camera check also asserts no subtitle/scrubber overlap and zero blob requests
- World panel (D-051): reducer `ResourceState.changes` + world facts; web `scenes/world-panel.tsx`, `lib/flares.ts` (`flaresAt`), canvas `flares` prop → `lift`; camera check seeks the deletion and asserts panel+flare at one `t`; stage screenshots are strict, page shots informational
- Freeze (D-052): clock `setStop(t)`/`frozenAt`; web `scenes/freeze-frame.tsx` (policy block via `lib/policy-text.ts`, action, consequences from graph edges), overlay over the theatre grid; camera check plays to the freeze at 1280×800 and measures readability
- Blast + perf (D-053, D-054): `lib/ripple.ts` (`rippleOf(blast, scene)` → node/edge waves, `rippleProgress(t, startMs, hops)`, 700 ms per wave), canvas `ripple`/`progress` props → `wave` attribute + `uRipple` uniform in both shaders; theatre ripples from `freezeT`; `/runs/[id]/blast` = `scenes/blast-view.tsx` (`useRippleRun`, one-shot rAF loop) + `scenes/affected-list.tsx`; api client `getBlast(id, node, weak?)`; `RenderMeter` in the canvas (`onRender`, `sync` reads one pixel to await the raster) feeds `PerfResult.renderP95Ms/drawCalls`; smoke gates demo median ≥ 58 fps, 5k ≥ 45 fps, demo render p95 ≤ 16.7 ms, draw calls ≤ 200; camera check also gates theatre/blast draw calls and the blast settling (`/perf/blast`, `window.__blast`)
- Live (D-036): `GET /v1/live?since=<seq>&run=<id>` (or `Last-Event-ID`), SSE `event`/`run` frames with `id: <seq>`, `: keepalive` every `LIVE_HEARTBEAT_MS`; `LiveService.subscribe/headSeq`; tests use a real listening server and a small SSE parser
- Checkpoints (D-028): `CheckpointerService` (`observe`, `runDue(now)`, `checkpointTenant`), `TreeCache.treeFor(tenant, size)`, `CheckpointsRepository`; `GET /v1/checkpoints`, `GET /v1/proof?event=|seq=`, `/.well-known/debrief-keys.json`; config `SIGNING_KEY_FILE|SIGNING_KEY_SECRET`, `S3_*` (fallback `MINIO_ROOT_*`), `CHECKPOINT_INTERVAL_MS`, `CHECKPOINT_EVERY_EVENTS`; api tests use the RFC 8032 seed as `SIGNING_KEY_SECRET` and need MinIO on `S3_ENDPOINT`
- Redaction + blobs (D-029): `redactText/redactEvent/redactContent` in `packages/schema/src/redaction.ts`, fixtures at `@debrief/schema/redaction-fixtures`; `EventsRepository.append` redacts every event (needs `TenantKeysService`); `BlobsService.put/get/find`, `TenantKeysService.keyFor/saltFor/destroy`; capture `summary` → snippet in summary, `on` → sealed blob + `payloadSha256`; `CaptureService.apply()` is shared by OTLP and `/v1/events` (which accepts a `content` bag ≤ 256 KiB with content-attribute keys)
- MCP proxy (D-031): `apps/mcp-proxy` — `pnpm --filter @debrief/mcp-proxy start --key dbf_… [--api url] [--session id] -- <server cmd>` (or `DEBRIEF_API_KEY`/`DEBRIEF_API_URL`); `SessionRecorder` is pure and unit-tested; the conformance test spawns `@modelcontextprotocol/server-everything` direct and proxied; `redactSecrets()` masks before events leave the host; HTTP mode: `--upstream <url> [--listen port]`; `--capture off|summary|on`, `--policy file.yaml` (advisory `policy.decision`, D-032)
- Policy core (D-032): `packages/policy` — `parsePolicy`, `evaluate`, `lookup` (longest dotted key wins), verb-prefix string matching; §10 sample at `packages/policy/src/__fixtures__/prod-guard.yaml`; P-26 adds fixtures/tests, not the core
- Orbital infra (D-033): `apps/sandbox/src/infra` — `pnpm --filter @debrief/sandbox start:infra` on `SANDBOX_PORT` (4100), needs `DEBRIEF_API_KEY`; tokens `STAGING_TOKEN` (`tok-stg-7f3a`, scope+perms staging) and `ACCOUNT_TOKEN` (`tok-acct-9c1d`, scope staging, perms `account:*`) in `state.ts`; the leak is `nova/staging/.env.backup`; `POST /api/reset`; `traceparent` header → `attrs.traceparent` + `runId`
- Orbital MCP server: `pnpm --filter @debrief/sandbox start:mcp` (stdio; `ORBITAL_API_URL`, `ORBITAL_TOKEN` default staging); tools take an optional `token` arg so an agent can use a token it found; `_meta.traceparent` (injected by the proxy) becomes the infra `traceparent` header; infra errors come back as `isError` tool results (`Orbital 403: …credential_mismatch`)
- Agent (D-034): `pnpm --filter @debrief/sandbox agent --key dbf_… [--api] [--orbital] [--policy] [--live]`; run infra with `ORBITAL_HOOK_SYNC=1` for deterministic order; a full scripted run is 49 events (9 llm.call, 8 tool pairs, 2 grants, 2 world.change); `--live` needs `ANTHROPIC_API_KEY`; tests fake both Debrief and the Messages API
- Demo: `pnpm demo:nine-seconds [--no-compose] [--api-port] [--infra-port] [--live]` — compose up (postgres, minio), migrate, `pnpm --filter @debrief/api seed --tenant … --capture on` (prints the key JSON), start api (`CHECKPOINT_INTERVAL_MS=1000`) + infra (`ORBITAL_HOOK_SYNC=1`), run the agent, wait for a stable checkpoint ≥ 40 events, print run id + `verifyUrl`; ~7 s warm, ~13 s from clean volumes; the demo test needs `DATABASE_URL` + `DATABASE_ADMIN_URL` + S3/signing/blob env (CI creates the app role and migrates before `pnpm test`)
- Tooling: TypeScript 5.9 (7.x is out but typescript-eslint peer range is < 6.1), ESLint 10 flat config, vitest 4, turbo 2; versions for ts/vitest/@types/node live in the pnpm `catalog:`
- Packages are `@debrief/<dir>`; tsconfig presets `@debrief/config/tsconfig/{base,node,browser}.json` (root `tsconfig.base.json` only points at base); pure packages use `browser`
- Chain: `@noble/hashes` sha256, own RFC 8785 `canonicalize`, byte layout in D-022; `MerkleTree` caches complete subtrees, verifiers follow RFC 9162 (D-023), goldens are the CT 8-leaf vectors; `signCheckpoint`/`verifyCheckpoint` + key ids per D-024; `pnpm --filter @debrief/api keygen [file]` writes a 0600 signing-key file and prints only the public entry; vitest runs every chain test in both `node` and `jsdom` projects; `nineSecondsFixture()` in `packages/chain/src/fixtures.ts` is the 10-event demo story
- Schema: zod 4 (`z.strictObject`, `z.iso.datetime`); wire encoding rules in D-021; a package with tests uses `vitest run --coverage` with 100% thresholds in its `vitest.config.ts` and `include: ["src", "*.config.ts"]` in tsconfig

## Conventions that are easy to forget
- Branch `p<NN>-<slug>`; commit `area: one line`; PR title `P-NN area: title`
- Merge with `gh pr merge --rebase --delete-branch`, then `git switch main && git pull --ff-only`
- Tick the PLAN box inside the point's branch, never on main
- `events` is append-only: no UPDATE/DELETE anywhere, migrations included
- Pure packages (`chain`, `reconstruct`, `policy`, `schema`, `evidence`) must run in the browser
- Attribute names for OTel are normalized in exactly one place: `packages/schema/otel-map.ts`
- The fictional PaaS is "Orbital"; never use real vendor names in fixtures
- Lint bans `any` and default exports in `.ts`; config `.js` files are exempt (tools need `export default`)

## Gotchas learned
- The production minifier inlines a single-use module const into a default parameter: a `now = wallClock` hook argument became a new function per render and restarted the effect every frame (dev builds and unit tests never showed it); never put a default-parameter function in effect deps
- Under SwiftShader `gl.finish()` returns immediately and uncapped rAF runs at 1000+ fps while the raster lags; only `readPixels` waits for the frame, so render cost is measured that way and cadence at the vsync-capped median
- Anything the stage draws must be a pure function of the clock and the camera: a uniform computed in an effect (old `uScale`) or camera-controls damping made screenshots history-dependent; `setLookAt` re-invalidates, so only call it on pose changes
- CI timing assertions must be judged at a percentile (the 2-vCPU runner stalls 20–30 ms while api's Postgres tests run in parallel); headless Chrome on the runner renders WebGL with SwiftShader — count triangles, not draw calls
- Turbopack cannot resolve the packages' `.js`→`.ts` imports; the web app must build with `--webpack` (D-046); relative imports inside `apps/web` are extensionless
- A heredoc inside an `&&` chain ends the chain: later commands run even if an earlier step failed (bit twice: P-05, P-28); keep heredocs on their own lines or write files first
- On Linux, killing a `pnpm --filter … start` wrapper leaves its `node` grandchild alive; orchestrators must spawn `node --import @swc-node/register/esm-register` directly
- `docker compose up -d --wait` exits 1 because the one-shot `minio-init` has exited; wait on `postgres minio` explicitly, then `up -d minio-init`
- macOS has no `timeout` binary; hold stdin open with `(printf …; sleep n) |` when smoke-testing the proxy
- The reference MCP server exits on stdin EOF before answering if the whole request batch arrives with the EOF
- `git checkout apps/api/drizzle/meta` after `drizzle-kit generate` also reverts the journal entry; regenerate instead of restoring
- The redaction marker `[secret:…]` must not re-match the assignment rule (lookbehind on `[`) or masking runs forever
- Tests must not call `loadConfig()` for one setting: CI has no `.env`, so `DATABASE_URL` is absent there
- Passing `undefined` to a test helper with a default parameter triggers the default; use `null` to mean "omit the header"
- A per-route `@UseGuards` class provided in two modules yields two instances; share state through a global provider instead
- Always `git switch -c p<NN>-<slug>` before the first edit of a point; the pre-push hook caught one attempt to push six commits from `main` (recovered with `git branch` + `git reset --hard origin/main`)
- `@opentelemetry/otlp-transformer` cannot deserialize requests; the receiver decodes with protobufjs from `apps/api/proto`
- JSON imports under NodeNext need `with { type: 'json' }`; the schema package exports its golden as `@debrief/schema/golden/otel-map.json`
- Drizzle wraps driver errors: assert on `error.cause.code` (`23505` duplicate key), not the message
- postgres.js `listen()` must be awaited before the triggering write or the notification is missed
- jsonb normalises `-0` to `0`; canonical hashes still match because both stringify as `0`
- Turbo 2 strict env strips variables from task processes; anything tests read from the environment must be listed in `turbo.json` `passThroughEnv` (a local `.env` hides this)
- Property tests under jsdom and tests that spawn loader-backed Node processes exceed vitest's 5 s default on the CI runner: `chain` has `testTimeout: 120_000`, `mcp-proxy` and `sandbox` have `60_000` in their vitest configs
- A Homebrew postgres on Aaryan's machine owns `127.0.0.1:5432`; the compose one is mapped to 5434 in `.env` (`POSTGRES_PORT`, both `DATABASE_*_URL`)
- Drizzle's extra-config callbacks (indexes) only run when a table is used; `src/db/schema.ts` is coverage-excluded for that reason
- `TRUNCATE events` fails on the FK from `event_sources` before the trigger fires; test with `TRUNCATE events CASCADE`
- `@noble/ed25519` v3 sync API needs `ed.hashes.sha512 = sha512`; set once in `packages/chain/src/checkpoint.ts`
- `tsx` runs workspace TS with `.js`-extension imports; Node's native type stripping cannot (no extension rewriting) — the app runtime story is decided in P-08
- fast-check v4 has no named `fc` export: `import * as fc from 'fast-check'`
- An inclusion proof verifies for any tree size with the same path shape; bind the size with the signed checkpoint, never infer it from the proof
- Never put a heredoc inside a `&&` chain: the list ends at the heredoc and every later statement runs unconditionally; `gh pr close --delete-branch` also deletes the local branch and switches to main
- The tool layer decodes `\uXXXX` in Bash heredocs and Write content into raw bytes; assemble such escapes in Python from `chr(92)` placeholders instead
- Regenerate `__golden__/chain-vectors.json` with a throwaway vitest test that writes `chainEvents(nineSecondsFixture())`; nothing is committed for it
- Test files may use `!` and dynamic `delete`; src may not (lint override in `packages/config/eslint.js`)
- Vite/vitest resolve tsconfig `extends` through the pnpm symlink path, not the realpath: presets must extend `./base.json`, never `../../../…`
- Imports inside packages use `.js` extensions so the same source works under NodeNext later
- On Aaryan's machine another project's `minio` container holds 9000/9001; set `MINIO_PORT=9100`, `MINIO_CONSOLE_PORT=9101`, `S3_ENDPOINT=http://localhost:9100` in `.env`
- `pnpm setup` is a pnpm built-in and shadows the script; always `pnpm run setup`
- commit-msg requires a lowercase letter after `area: ` — write `api: add otlp receiver`, not `api: OTLP receiver`
- Branch protection and rulesets return 403 on a private repo under the free plan; `.githooks/pre-push` is the local substitute
- Root `.md` files and `pnpm-lock.yaml` are prettier-ignored on purpose; do not "fix" their formatting

## Open questions for Aaryan
- Interpretations taken without a spec (revisit if wrong): `EventInput` is literally `Event` minus seq/prevHash/hash (server-assigned `tenantId`/`ts`/`id` settled in P-11); `Run.status` is `active | ended` until P-20 needs more; wire encoding is D-021, chain byte layout is D-022

## Next up
- M3 boundary report, then P-39 (M4, first non-★ point after the Theatre) — see PLAN.md
