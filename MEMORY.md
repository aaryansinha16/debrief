# Memory

Working memory for the coding agent. Read fully at every session start. Keep under 150 lines.
Edit in place; do not append a diary. Facts only — no plans (those live in `PLAN.md`) and no
rationale (that lives in `DECISIONS.md`). The last commit of every point is `memory: close P-NN`
and updates the Status block below.

## Status
- Current milestone: M0 Foundation
- Current point: P-03 (not started)
- Last merged PR: #2 P-02 ci
- `main` is at: P-02 ci workflow
- Blocked points: P-02.1 branch protection (needs Pro or public repo)

## Environment facts
- Node 22 (≥ 20 required), pnpm 10.8.1 (`packageManager` pinned), Docker Compose v2, `gh` authenticated as `aaryansinha16`
- Repo: github.com/aaryansinha16/debrief, private, personal free plan
- Ports: api 4000 · web 3000 · verify 5173 · sandbox infra 4100 · postgres 5432 · minio 9000 (console 9001)
- Local creds live in `.env` (copied from `.env.example` by `pnpm run setup`); never commit `.env`
- Git hooks path is `.githooks` (set by `pnpm run setup`); `commit-msg` enforces one-line messages; `pre-push` refuses pushes to `main`
- CI: `.github/workflows/ci.yml` — jobs lint (incl. prettier --check), typecheck, test, build; perf-smoke is `if: false` until P-38; ~40 s per PR
- Tooling: TypeScript 5.9 (7.x is out but typescript-eslint peer range is < 6.1), ESLint 10 flat config, vitest 4, turbo 2; versions for ts/vitest/@types/node live in the pnpm `catalog:`
- Packages are `@debrief/<dir>`; tsconfig presets `@debrief/config/tsconfig/{node,browser}.json`; pure packages use `browser`

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
- `pnpm setup` is a pnpm built-in and shadows the script; always `pnpm run setup`
- commit-msg requires a lowercase letter after `area: ` — write `api: add otlp receiver`, not `api: OTLP receiver`
- Branch protection and rulesets return 403 on a private repo under the free plan; `.githooks/pre-push` is the local substitute
- Root `.md` files and `pnpm-lock.yaml` are prettier-ignored on purpose; do not "fix" their formatting

## Open questions for Aaryan
- Branch protection on `main` needs GitHub Pro or a public repo; until decided, P-02 AC "failing lint blocks merge" is enforced only by discipline + pre-push hook
- Interpretations taken without a spec (revisit if wrong): `seq` is a JSON integer on the wire and in the hash input (bigint only in Postgres); chain hash input is `bytes(prevHash) ‖ utf8(canonical(event \ hash))` with hex-encoded `hash`/`prevHash`; `ts` must end in `Z`, `sourceTs` may carry an offset; `EventInput` is literally `Event` minus seq/prevHash/hash (server-assigned `tenantId`/`ts`/`id` settled in P-11); "100% branch coverage" = v8 lines+branches over `packages/schema/src/**`; P-03 "< 30 s" excludes image pulls; `packages/chain` hashes with `@noble/hashes`, not WebCrypto (jsdom lacks `subtle`)

## Next up
- P-03 repo: docker compose (see PLAN.md)
