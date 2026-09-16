# Kickoff — model, settings, hook, and the first prompt

This file is for you (Aaryan), not for the repo. Put `ARCHITECTURE.md`, `CLAUDE.md`,
`DECISIONS.md`, `MEMORY.md`, `PLAN.md` at the repo root; keep this file outside the repo or under `docs/`.

## 1. Which model

Claude Code supports Fable, Opus 5, Sonnet 5 and Haiku 4.5. Recommendation for this build:

| Use | Model | Why |
|-----|-------|-----|
| Driver for the whole build | **Opus 5** — `/model opus` | The picker's own default for complex everyday tasks, with 1M context — enough to hold the monorepo, `ARCHITECTURE.md` and `PLAN.md` at once without thrashing |
| ★ points in `PLAN.md` (P-05/06/07 chain, P-22/23 graph + correlation, P-29 layout + director, P-33/34 3D scene + camera, P-38 perf pass) | **Fable** — `/model fable` | Deep, self-verifying reasoning where a subtle bug costs a week (crypto, determinism, shader perf). Needs Claude Code ≥ 2.1.170, burns your limits ~2× faster than Opus, is unavailable under Zero Data Retention, and a safety classifier can re-route a session to Opus — that's expected, not an error |
| Routine points (scaffolds, endpoints, pages, docs) | **Sonnet 5** or the `opusplan` hybrid (Opus plans, Sonnet executes) | Saves limits with no quality loss on well-specified points |
| — | Haiku 4.5 | Not for this build |

Practical rhythm: start each session on `opus`; switch with `/model fable` when you reach a ★
point, switch back after. Run `claude update` first so `fable` appears in `/model`.

## 2. `.claude/settings.json` (project, committed in P-01)

```json
{
  "includeCoAuthoredBy": false,
  "attribution": { "commit": "", "pr": "" },
  "permissions": {
    "allow": [
      "Bash(pnpm:*)",
      "Bash(git:*)",
      "Bash(gh:*)",
      "Bash(docker compose:*)",
      "Bash(node:*)"
    ],
    "deny": [
      "Bash(git push --force:*)",
      "Bash(git push -f:*)",
      "Bash(git commit --no-verify:*)",
      "Bash(git commit -n:*)",
      "Bash(rm -rf:*)"
    ]
  }
}
```

Two cautions. The attribution settings are the documented way to drop the `Co-Authored-By` /
"Generated with Claude Code" lines, but users have reported them being ignored in some code
paths, and a newer `Claude-Session:` trailer that bypasses them. So the settings are a courtesy;
the git hook below is the enforcement. And check the permission-rule syntax against the settings
docs for your Claude Code version before relying on the deny list.

## 3. `.githooks/commit-msg` (created in P-01; `pnpm setup` runs `git config core.hooksPath .githooks`)

```bash
#!/usr/bin/env bash
set -euo pipefail
f="$1"
tmp="$(mktemp)"
grep -vE '^(🤖 Generated with|Co-Authored-By:|Claude-Session:|Signed-off-by:)' "$f" \
  | grep -v '^#' | sed -e 's/[[:space:]]*$//' | grep -v '^$' > "$tmp" || true
lines=$(wc -l < "$tmp" | tr -d ' ')
if [ "$lines" -ne 1 ]; then
  echo "commit-msg: exactly one non-empty line required (got $lines)" >&2; rm -f "$tmp"; exit 1
fi
msg="$(cat "$tmp")"
if [ "${#msg}" -gt 72 ]; then
  echo "commit-msg: 72 chars max (got ${#msg})" >&2; rm -f "$tmp"; exit 1
fi
if ! printf '%s' "$msg" | grep -qE '^(repo|ci|api|web|chain|schema|reconstruct|policy|evidence|proxy|sandbox|verify|ui|docs|memory): [a-z]'; then
  echo "commit-msg: use 'area: lowercase imperative message'" >&2; rm -f "$tmp"; exit 1
fi
printf '%s\n' "$msg" > "$f"
rm -f "$tmp"
```

`chmod +x .githooks/commit-msg`. It strips attribution trailers, then rejects anything that
isn't exactly one line, ≤ 72 chars, `area: message`. Rebase merges on GitHub keep these
messages untouched, so `main` stays a clean list of one-liners.

## 4. Before the first session (10 minutes)

1. `gh repo create debrief --private --clone` → copy the five repo files in → `git add -A && git commit -m "repo: add planning documents"` → `git push`.
   (This one commit is the only direct commit to `main`; enable branch protection right after.)
2. GitHub → Settings → Branches → protect `main`: require a PR, require status checks (add the four CI checks after P-02), no force pushes.
3. `gh auth login` on the machine; `docker compose version`; Node ≥ 20; `pnpm` installed.
4. `claude update`, then `claude` in the repo, `/model opus`.
5. Paste the prompt below. Use plan mode for step 2 of the prompt, then let it execute.

## 5. The initial prompt

```
You are working in the Debrief repository. Read CLAUDE.md, MEMORY.md and PLAN.md in full, then
ARCHITECTURE.md sections 0–6. Read DECISIONS.md only when a point references one.

Then, in order:

1. Verify the environment exactly as CLAUDE.md "Session start" specifies. If anything is missing,
   stop and tell me what to install. Do not work around a missing tool.

2. In plan mode: restate the acceptance criteria for P-01 through P-05 in five lines total, one
   per point. Then list anything in PLAN.md or ARCHITECTURE.md that is contradictory or
   underspecified for milestone M0, one line each. For anything that does not block P-01, pick the
   most conservative interpretation and note it in MEMORY.md under "Open questions". Wait for my
   go-ahead before leaving plan mode.

3. Execute P-01 end to end following CLAUDE.md "Workflow" exactly: fresh branch from main, micro
   commits with one-line messages, "memory: close P-01" as the last commit, PR whose body is the
   AC checklist, wait for CI, rebase-merge, delete the branch, pull main.

4. Continue through P-02 … P-13 the same way without asking for permission between points. Ask
   only for the items under "Ask before" in CLAUDE.md. If a point is blocked, record why in
   MEMORY.md and continue with the next unblocked point in M0.

5. At the end of M0, stop. Report: merged PRs (number, title, commit count), what the chain golden
   vectors cover, every deviation from PLAN.md, and the open questions in MEMORY.md.

Rules that override everything else:
- Never commit to main. Never force-push. Never use --no-verify. Never rewrite merged history.
- Commit messages are one line, "area: message", no body, no trailers.
- No comments in code except a one-line non-obvious invariant or a spec reference. No docstrings
  that restate names. No commented-out code.
- events is append-only. Redaction runs before persistence. No LLM call in the ingest or
  reconstruction path.
- Say "tamper-evident", never "tamper-proof".
- Every point ends with a green CI run and an updated MEMORY.md.
```

## 6. Prompt for every later session

```
Read MEMORY.md, then the current point in PLAN.md. Confirm main is clean and up to date.
Restate the point's acceptance criteria in one line, then execute it per CLAUDE.md "Workflow".
Continue through the milestone; stop at the milestone boundary with the same report format as
before. If this is a ★ point, remind me to switch the model before you start.
```

## 7. What to watch in the first three PRs

- The hook actually rejects a two-line message (test it yourself once).
- Commits are small and each one builds; if a PR arrives as one giant commit, say so and the
  agent will split next time.
- `MEMORY.md` stays under 150 lines and the "Gotchas" section fills with real things.
- No comments creeping into the code. Grep the diff for `//` and `/*` on every review.
