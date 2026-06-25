---
description: Run the blocking quality gate — format check, ESLint, typecheck, tests (+coverage), build.
allowed-tools: Bash
---

Run `pnpm check` (format:check → lint → typecheck → test --coverage → build) and report
the result. If anything is red, fix it before continuing — this gate is blocking (§4).
`packages/core` must stay ≥90% coverage (branches ≥85). Do not mark a phase done while
`pnpm check` is red.
