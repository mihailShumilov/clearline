---
description: Ship a phase — run the gate + acceptance, Conventional Commit, open a PR, and run the reviewer subagent.
argument-hint: "<phase-number>"
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

Ship **Phase $1** of ClearLine.

1. Run `/check` (must be green).
2. Re-run the phase's **acceptance test** from `CLAUDE.md` §7 and show the evidence
   (output, and a real devnet tx/Explorer link if the phase produces one).
3. Update `docs/PROGRESS.md` (done / next) and `docs/DECISIONS.md` (any ADR).
4. Commit with a Conventional Commit message (`feat(phaseN): …`). Push the branch.
5. Open a PR with `gh pr create` (summary + acceptance evidence + checklist).
6. Launch the **reviewer** subagent on the PR. Address REQUEST CHANGES; only then
   squash-merge into `main`. Do not advance phases on a red gate or an unaddressed review.
