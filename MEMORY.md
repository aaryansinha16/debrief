# Memory

Working memory for the coding agent. Read fully at every session start. Keep under 150 lines.
Edit in place; do not append a diary. Facts only — no plans (those live in `PLAN.md`) and no
rationale (that lives in `DECISIONS.md`). The last commit of every point is `memory: close P-NN`
and updates the Status block below.

## Status
- Current milestone: M0 Foundation
- Current point: P-05 (not started) ★ fable
- Last merged PR: #4 P-04 schema
- `main` is at: P-04 event schema
- Blocked points: P-02.1 branch protection (needs Pro or public repo)

## Environment facts
- Node 22 (≥ 20 required), pnpm 10.8.1 (`packageManager` pinned), Docker Compose v2, `gh` authenticated as `aaryansinha16`
- Repo: github.com/aaryansinha16/debrief, private, personal free plan
- Ports: api 4000 · web 3000 · verify 5173 · sandbox infra 4100 · postgres 5432 · minio 9000 (console 9001); all overridable from `.env`
- Compose: `docker-compose.yml` — postgres:16-alpine (superuser `postgres`, app role `debrief_app` created by `docker/postgres/init.sh`), minio pinned on quay.io (Docker Hub no longer serves pinned tags), one-shot `minio-init` makes bucket `debrief`; healthy in ~6 s after pull; `docker compose down -v` for a clean slate
- Local creds live in `.env` (copied from `.env.example` by `pnpm run setup`); never commit `.env`
- Git hooks path is `.githooks` (set by `pnpm run setup`); `commit-msg` enforces one-line messages; `pre-push` refuses pushes to `main`
- CI: `.github/workflows/ci.yml` — jobs lint (incl. prettier --check), typecheck, test, build; perf-smoke is `if: false` until P-38; ~40 s per PR
- Tooling: TypeScript 5.9 (7.x is out but typescript-eslint peer range is < 6.1), ESLint 10 flat config, vitest 4, turbo 2; versions for ts/vitest/@types/node live in the pnpm `catalog:`
- Packages are `@debrief/<dir>`; tsconfig presets `@debrief/config/tsconfig/{base,node,browser}.json` (root `tsconfig.base.json` only points at base); pure packages use `browser`
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
- Vite/vitest resolve tsconfig `extends` through the pnpm symlink path, not the realpath: presets must extend `./base.json`, never `../../../…`
- Imports inside packages use `.js` extensions so the same source works under NodeNext later
- On Aaryan's machine another project's `minio` container holds 9000/9001; set `MINIO_PORT=9100`, `MINIO_CONSOLE_PORT=9101`, `S3_ENDPOINT=http://localhost:9100` in `.env`
- `pnpm setup` is a pnpm built-in and shadows the script; always `pnpm run setup`
- commit-msg requires a lowercase letter after `area: ` — write `api: add otlp receiver`, not `api: OTLP receiver`
- Branch protection and rulesets return 403 on a private repo under the free plan; `.githooks/pre-push` is the local substitute
- Root `.md` files and `pnpm-lock.yaml` are prettier-ignored on purpose; do not "fix" their formatting

## Open questions for Aaryan
- Branch protection on `main` needs GitHub Pro or a public repo; until decided, P-02 AC "failing lint blocks merge" is enforced only by discipline + pre-push hook
- Interpretations taken without a spec (revisit if wrong): chain hash input is `bytes(prevHash) ‖ utf8(canonical(event \ hash))`; `EventInput` is literally `Event` minus seq/prevHash/hash (server-assigned `tenantId`/`ts`/`id` settled in P-11); `Run.status` is `active | ended` until P-20 needs more; `packages/chain` hashes with `@noble/hashes`, not WebCrypto (jsdom lacks `subtle`); wire encoding is now D-021

## Next up
- P-05 chain: canonical JSON + hash chain ★ (see PLAN.md)
