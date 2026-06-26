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
- **Phase 5 (autonomous)** Durable Object alarm + Cron Trigger loop (ADR-0009) — self-runs
  ingest→open→settle on the bundled real fixture under `wrangler dev` (no manual trigger),
  idempotent D1 persistence + structured logs. Verified: cron started the loop → opened +
  settled a `won` position (P&L 800,000) with the real root PDA/Explorer link. Settlement is
  best-effort (LIVE `validate_stat` when the RPC is reachable, else the recorded-and-reconciled
  on-chain verdict — `path` logged). Run it locally:
  `wrangler dev --test-scheduled` then `curl "localhost:8787/__scheduled?cron=*+*+*+*+*"`.
- **Phase 8 (core)** `/demo-replay` settles on the REAL recorded on-chain verdict deterministically (`runRealDemoReplay`): holds=true, Explorer link + root PDA + integer P&L 800,000 lamports; integrity guard (no fabrication).

## On-chain artifacts

- subscribe tx: https://explorer.solana.com/tx/rGE1t1gAtNJAFCxLsLkKEek7rusKfrsrnqTQcMbCukNZhfdg9Tng3wfuBb5SjrUV3DXBvRqSa5efyPL4ukFYA8M?cluster=devnet (slot 471865973)
- daily_scores_roots PDA (epochDay 20629): [`CdUmkUdc4XBKeeq7Kq6JxQvnVMNuDA21mp98x4Rs3jHQ`](https://explorer.solana.com/address/CdUmkUdc4XBKeeq7Kq6JxQvnVMNuDA21mp98x4Rs3jHQ?cluster=devnet)
- verdicts: `value>0`→TRUE, `value>1`→FALSE (fixture 17588395, seq 988, statKey 1, V=1)

## On-chain settlement — three sources, kept honestly distinct

1. **Phase-4 spike (one-off, ADR-0007):** `@coral-xyz/anchor` `.view()` proved `validate_stat`
   discriminates TRUE/FALSE on devnet. Throwaway; `packages/contracts/spike/**`.
2. **Production `OnChainSettlementProvider` (Task 1, LIVE):** the agent's settlement path emits
   the verdict by simulating `validate_stat` through `@clearline/chain` (read-only `.view()`,
   no Anchor, §11b). Verified live against the root PDA above:
   `value>0`→**TRUE**, `value>1`→**FALSE**. Encoder byte-identical to Anchor's (golden vector).
   Reproduce: `ONCHAIN_LIVE=1 pnpm exec vitest run packages/agent/src/onchainLive.test.ts`.
   Note: `.view()` is a simulation → no tx signature; the verdict is verified against the live
   on-chain Merkle root (the `subscribe` tx above is the data-subscription evidence).
3. **`RecordedSettlementProvider` (deterministic replay):** settles on the recorded verdict and
   reconciles it; `verifiedOnChain=true` ONLY when a recorded on-chain result was cross-checked.

## Next (remaining for full §13)

- **Phase 6** — Hono API on Cloudflare Workers + D1 (positions/edges/settlements/RPC-health/agent-status + replay control); local `wrangler dev`.
- **Phase 7** — Proof-of-Edge dashboard (Vite + React): edges/positions, settlement cards (Explorer + verdict), P&L, live event stream, **RPC Health** panel.
- **Phase 9** — repo public ✅; record the demo video (§13 scenario) — owner action.
- Small follow-ups: a CLI entry to run `/demo-replay`; `verifiedOnChain` should be false for predicates with no recorded on-chain cross-check; live-path normalization of the real fixture's `number[]` proof encoding vs the txline `z.string()` schema.
