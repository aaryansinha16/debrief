# Witness pivot — kickoff prompt

> Historical: the prompt that started the pivot, kept as given. ARCHITECTURE §18, DECISIONS
> D-077–D-081 and PLAN M6–M9 supersede it wherever they differ.

Paste everything below the line into a fresh Claude Code session (VS Code panel, Plan mode on)
at the repo root. This is the lead session. It plans first; you approve the plan before any code.

---

We are pivoting Debrief from "flight recorder + post-mortem theatre" to **the independent witness
for AI agents**: it extracts the claims an agent makes about its own work, checks each claim
against what the touched systems themselves recorded, surfaces side effects the agent never
mentioned, and seals the result into a receipt an outsider can verify offline.

Keep: packages/chain, schema (redaction), reconstruct (graph, correlation), evidence, apps/verify,
the replay clock, the API ingest path, the git workflow and code rules in CLAUDE.md.
Retire from the default experience: the ambient swarm, the 3D stage as default view, the YAML
branch editor, Orbital as the headline demo (keep it as a test fixture).

## Step 1 — docs only, one PR (P-60 docs: witness pivot)

1. ARCHITECTURE.md: add §18 "Witness" covering the claim model, verdicts (holds | contradicted |
   no-witness, each citing event ids), unreported side effects, witness adapters, the receipt page.
2. DECISIONS.md: add
   - D-077 Claims are extracted by an LLM after a session ends, off the ingest and verdict paths;
     every claim must cite a transcript span or it is dropped.
   - D-078 Verdicts are deterministic code over observed events; uncertain means "no witness";
     no LLM decides a verdict.
   - D-079 Real vendor names are allowed inside `packages/witness-*` and `apps/witnesses/*`
     (fixtures stay synthetic); Orbital stays the sandbox. This amends CLAUDE.md's domain rule.
   - D-080 Visual language replaced by the Witness canvas (night ground, Instrument Serif + Geist,
     claim beams, integrity ring, said/saw rails, paper receipt with seal); D-071–D-076 superseded.
3. PLAN.md: add milestones M6–M9 below with these points, each with acceptance criteria:
   - M6 Claims: P-61 schema `claim` + `verdict` event kinds · P-62 Claude Code transcript capture via
     a Stop hook (`debrief claude-code install` writes the hook) · P-63 claim extraction with cited
     spans · P-64 `packages/verdict` (pure, golden-tested) · P-65 unreported side effects.
   - M7 Witnesses (parallel): P-66 GitHub (Actions, PRs, pushes) · P-67 Postgres/Neon · P-68 Vercel ·
     P-69 Stripe · P-70 CloudTrail.
   - M8 Surfaces: P-71 tokens + fonts from the canvas, remove ambient swarm · P-72 Claim check page ·
     P-73 Replay with said/saw rails · P-74 Receipt share page + hosted verify · P-75 phone nudge
     (PWA push or Telegram).
   - M9 Ship: P-76 local mode without Docker (ask before starting: storage change) · P-77
     `npx debrief init` for Claude Code · P-78 landing + film · P-79 deploy to my Coolify VPS.
4. CLAUDE.md: add a "Parallel lanes" section (below) and the D-079 amendment.
5. Add `.claude/worktrees/` to .gitignore.

Stop after the PR is open and show me the plan diff.

## Parallel lanes (add to CLAUDE.md)

- Lane A — this lead session, main checkout: M6 in order. Only Lane A edits PLAN.md and MEMORY.md.
- Lane B — a second session started with `claude --worktree ui`: M8, using the ui-craftsman agent.
  Starts after P-61 merges.
- Lane C — witness-adapter subagents, launched by Lane A in the background, one per M7 point,
  each in its own worktree. Start after P-61 merges; at most 2 running at once.
- Every PR gets a `reviewer` subagent pass before merge; fix blockers on the same branch.
- P-64 gets a `claim-skeptic` pass before merge.
- Other lanes put "Notes for memory" in their PR body; Lane A folds them into MEMORY.md after merging.
