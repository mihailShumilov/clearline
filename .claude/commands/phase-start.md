---
description: Start a ClearLine phase — create the feature branch, scaffold, and restate the acceptance test.
argument-hint: "<phase-number>"
allowed-tools: Read, Bash, Grep, Glob
---

Start **Phase $1** of ClearLine.

1. Read `CLAUDE.md` §7 for Phase $1's scope and **acceptance test**.
2. Ensure `main` is clean, then create branch `feat/phase$1-<slug>` (slug from the
   phase title).
3. List the concrete deliverables and the exact acceptance criterion you will prove.
4. Note any blocker from `CLAUDE.md` "Blockers / open questions" that touches this phase.
5. Do NOT advance to Phase $((1+1)) until this acceptance passes via `/check` + the
   phase test.
