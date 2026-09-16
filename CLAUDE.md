# Debrief

Tamper-evident recorder for AI agents plus immersive, verifiable incident reconstruction.
TypeScript monorepo (pnpm + Turborepo). Read `ARCHITECTURE.md` before touching a package for
the first time. `PLAN.md` is the ordered backlog; `DECISIONS.md` is why things are the way they
are; `MEMORY.md` is your working memory across sessions.

## Session start (every time)
1. Read `MEMORY.md` fully. Then read the current point in `PLAN.md`.
2. `git switch main && git pull --ff-only`. Confirm `git status` is clean.
3. Confirm tools: `node -v` (≥ 20), `pnpm -v`, `docker compose version`, `gh auth status`.
4. Do not start coding until the point's acceptance criteria are restated in one line.

## Commands
- `pnpm setup` — installs deps, sets `core.hooksPath .githooks`, copies `.env.example`
- `docker compose up -d` — postgres:16 (5432), minio (9000/9001)
- `pnpm dev` — api :4000 · web :3000 · verify :5173 · sandbox infra :4100
- `pnpm test` / `pnpm test -- --filter <pkg>` — vitest
- `pnpm lint` · `pnpm typecheck` · `pnpm build`
- `pnpm db:migrate` · `pnpm db:generate` — drizzle-kit
- `pnpm demo:nine-seconds` — seeds and runs the incident end to end
- `pnpm perf:smoke` — headless render of the demo run, asserts frame time

## Workflow — non-negotiable
One PLAN point = one branch = one PR. Never commit to `main`. Never force-push. Never rewrite
merged history.

1. Branch from fresh `main`: `git switch -c p<NN>-<slug>` (e.g. `p05-chain-hash`).
2. Micro commits: one logical change each, only when lint + typecheck + affected tests pass.
   A point usually lands as 3–12 commits. If a commit touches more than ~150 lines, split it.
3. Commit message: **one line, imperative, ≤ 72 chars, area prefix, no body, no trailers,
   no attribution lines.** `git commit -m "chain: add rfc6962 merkle proofs"`.
   Area prefixes: `repo ci api web chain schema reconstruct policy evidence proxy sandbox verify ui docs memory`.
   The `.githooks/commit-msg` hook rejects anything else. Do not bypass it (`--no-verify` is forbidden).
4. Last commit on the branch: `memory: close P-<NN>` updating `MEMORY.md` (status, gotchas, next).
5. PR: `gh pr create --title "P-<NN> <area>: <title from PLAN.md>" --body "<acceptance criteria as a checklist>"`.
   Then `gh pr checks --watch`. Fix CI on the same branch with more micro commits.
6. Merge: `gh pr merge --rebase --delete-branch`. Then `git switch main && git pull --ff-only`.
7. Tick the point in `PLAN.md` inside the branch (same PR), never on main afterwards.
8. Repeat with the next point. Stop and report at each milestone boundary (`M0 … M5`).

Ask before: adding a dependency > 200 kB min+gz, changing the event schema or chain format,
touching anything under `packages/chain`'s hashing/signing, or deviating from `PLAN.md` order.
Otherwise proceed without asking; a blocked point gets a note in `MEMORY.md` and you move to the
next unblocked point in the same milestone.

## Code rules
- **No verbose comments.** No narration ("added this to…"), no docstrings that restate the
  name, no commented-out code. A comment is allowed only for a non-obvious invariant or a
  spec reference (`// RFC 6962 §2.1`), and it is one line.
- TypeScript strict. No `any` (use `unknown` + narrowing). No default exports except Next.js pages.
- Pure packages (`chain`, `reconstruct`, `policy`, `schema`, `evidence`) do no I/O and have no
  Node-only imports; they must run in the browser.
- Validate at boundaries with zod; trust types inside.
- Errors: throw typed errors in packages; map to HTTP in `apps/api` only.
- Tests live next to code as `*.test.ts`. Golden files under `__golden__/`. Every package rule
  in `ARCHITECTURE.md` with a number (seq, hash, proof, layout) gets a golden test.
- Formatting is Prettier's job; never hand-format. Never rename or move files as a side effect.
- Names: `camelCase` values, `PascalCase` types, `kebab-case` files, `SCREAMING_SNAKE` env vars.

## Domain rules (do not violate)
- `events` is append-only. Never write an UPDATE or DELETE against it, in code or migrations.
- Hashing input is canonical JSON (RFC 8785). Any change to what is hashed is a schema change → ask.
- Redaction runs before persistence, always. Never log payloads, tokens, or full prompts.
- "tamper-evident", "reconstruction". Never "tamper-proof", never "proof of what happened".
- No LLM call in the ingest or reconstruction path. Narration is opt-in in the API only.
- `provenance` (reported vs observed) is never merged or hidden in the UI.
- Sandbox uses the fictional PaaS "Orbital". No real vendor names in fixtures.

## Definition of done (per point)
Acceptance criteria in `PLAN.md` met · lint, typecheck, tests green locally and in CI ·
new behavior has a test · `MEMORY.md` updated · PR merged with rebase · branch deleted.

## Files you maintain
- `MEMORY.md` — keep under 150 lines; edit in place, do not append forever.
- `PLAN.md` — tick boxes, add sub-points only with `P-NN.x` ids, never renumber.
- `DECISIONS.md` — add a `D-NNN` entry when you make a choice the next person would question.
