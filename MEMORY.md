# Memory

Working memory for the coding agent. Read fully at every session start. Keep under 150 lines.
Edit in place; do not append a diary. Facts only — no plans (those live in `PLAN.md`) and no
rationale (that lives in `DECISIONS.md`). The last commit of every point is `memory: close P-NN`
and updates the Status block below.

## Status
- Current milestone: M0 Foundation
- Current point: P-01 (not started)
- Last merged PR: none
- `main` is at: initial commit
- Blocked points: none

## Environment facts
- Node ≥ 20, pnpm 9, Docker Compose v2, `gh` authenticated as the repo owner
- Ports: api 4000 · web 3000 · verify 5173 · sandbox infra 4100 · postgres 5432 · minio 9000 (console 9001)
- Local creds live in `.env` (copied from `.env.example` by `pnpm setup`); never commit `.env`
- Git hooks path is `.githooks` (set by `pnpm setup`); `commit-msg` enforces one-line messages
- CI: `.github/workflows/ci.yml` runs lint → typecheck → test → perf-smoke on every PR

## Conventions that are easy to forget
- Branch `p<NN>-<slug>`; commit `area: one line`; PR title `P-NN area: title`
- Merge with `gh pr merge --rebase --delete-branch`, then `git switch main && git pull --ff-only`
- Tick the PLAN box inside the point's branch, never on main
- `events` is append-only: no UPDATE/DELETE anywhere, migrations included
- Pure packages (`chain`, `reconstruct`, `policy`, `schema`, `evidence`) must run in the browser
- Attribute names for OTel are normalized in exactly one place: `packages/schema/otel-map.ts`
- The fictional PaaS is "Orbital"; never use real vendor names in fixtures

## Gotchas learned
- (none yet — add one line per gotcha, newest first, delete when fixed upstream)

## Open questions for Aaryan
- (none yet — one line each; remove when answered and record the answer in DECISIONS.md if durable)

## Next up
- P-01 repo scaffold (see PLAN.md)
