# ClearLine — Progress

> Living log of what's done and what's next. Append; don't rewrite history.

## Repo / infra

- GitHub: https://github.com/mihailShumilov/clearline (**public**).
- Devnet agent wallet (dedicated, gitignored): `HCbeaJ54rRSEwey2QEd49tgFyrfFYAfpK3kzZ86NKd8P` (funded 5 SOL).
- `pnpm check` green on `main`: **203 passed / 2 skipped**, `packages/core` **100%** coverage.
- 5 PRs merged (all reviewer-gated). Upstream kit issues filed: #8, #9.

## Done

- **Phase 0** Bootstrap — pnpm monorepo, strict TS 6, ESLint 10 flat + Prettier, Vitest gate, `.claude/` (6 subagents + 6 commands), docs.
- **Phase 1** TxLINE client — auth, Zod v4 schemas (incl. 3-stage proof), reads, SSE; verified live end-to-end on devnet (`txline-dev`).
- **Phase 2** Resilience chain (§11b) — `@clearline/chain` sole RPC path; failover/health/metrics; before/after naive 0%/47.5%/71% → pool 100%.
- **Phase 3** Core quant logic — predicate (mirrors `validate_stat`), integer money, settle; 100% covered.
- **Phase 4** On-chain trustless settlement — REAL devnet verdict: fixture 17588395, `value>0`→TRUE / `value>1`→FALSE vs root PDA `CdUmkUdc…Rs3jHQ`. Subscribe tx `rGE1t1g…YA8M`. Free tier = SL1 @ 0 TxL, `weeks%4==0` → `subscribe(1,4)`. ADR-0007.
- **Phase 5** Agent loop + deterministic replay engine — pure/reproducible; settlement provider abstraction.
- **Phase 8 (core)** `/demo-replay` settles on the REAL recorded on-chain verdict deterministically (`runRealDemoReplay`): holds=true, Explorer link + root PDA + integer P&L 800,000 lamports; integrity guard (no fabrication).

## On-chain artifacts

- subscribe tx: https://explorer.solana.com/tx/rGE1t1gAtNJAFCxLsLkKEek7rusKfrsrnqTQcMbCukNZhfdg9Tng3wfuBb5SjrUV3DXBvRqSa5efyPL4ukFYA8M?cluster=devnet (slot 471865973)
- daily_scores_roots PDA (epochDay 20629): `CdUmkUdc4XBKeeq7Kq6JxQvnVMNuDA21mp98x4Rs3jHQ`
- verdicts: `value>0`→TRUE, `value>1`→FALSE (fixture 17588395, seq 988, statKey 1, V=1)

## Next (remaining for full §13)

- **Phase 6** — Hono API on Cloudflare Workers + D1 (positions/edges/settlements/RPC-health/agent-status + replay control); local `wrangler dev`.
- **Phase 7** — Proof-of-Edge dashboard (Vite + React): edges/positions, settlement cards (Explorer + verdict), P&L, live event stream, **RPC Health** panel.
- **Phase 9** — repo public ✅; record the demo video (§13 scenario) — owner action.
- Small follow-ups: a CLI entry to run `/demo-replay`; `verifiedOnChain` should be false for predicates with no recorded on-chain cross-check; live-path normalization of the real fixture's `number[]` proof encoding vs the txline `z.string()` schema.
