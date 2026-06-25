# ClearLine — Progress

> Living log of what's done and what's next. Append; don't rewrite history.

## Repo / infra

- GitHub: https://github.com/mihailShumilov/clearline (private; flip public for §13 at Phase 9).
- Devnet agent wallet (dedicated, gitignored): `HCbeaJ54rRSEwey2QEd49tgFyrfFYAfpK3kzZ86NKd8P`.
- `pnpm check` green on `main`: 144 passed / 2 skipped (10 suites + chain), `packages/core` 100% coverage.

## Phase 0 — Bootstrap ✅ (merged)

pnpm workspace, strict TS 6, ESLint 10 flat + Prettier, Vitest+coverage gate, `.claude/`
(settings + 6 subagents + 6 commands), docs set, reconstructed `CLAUDE.md` (Cloudflare-first).

## Phase 1 — TxLINE client ✅ code merged (PR #1) — live read deferred

`@clearline/txline`: env-injected config, typed `TxlineError`, Zod v4 schemas
(`ScoresStatValidation` 3-stage proof, `Scores`, `Fixture`, …), `TxlineClient`
(guest session, activate, fixtures/scores/historical/stat-validation, `streamScores`),
pure SSE parser. 58 tests + 1 opt-in live. **`/auth/guest/start` verified live** → `{token}`.

- ⏳ Token-gated live read pending the on-chain `subscribe` (Blocker A) — task #11.

## Phase 2 — Resilience chain layer ✅ (merged, PR #2)

`@clearline/chain` = sole RPC path over `solana-resilience-kit@1.2.0`: `createChainPool`
(pool + HealthMonitor + CreditRateLimiter + metrics + events), `createChainSender`
(devnet clusterGuard), `toHealthSnapshot` (RPC Health DTO). Deterministic fault-harness
tests. **Before/after (seed=1): naive 0%/47.5%/71.0% → pool 100%** under 100%/50%/25%
primary failure. Upstream issues filed: kit
[#8](https://github.com/mihailShumilov/solana-resilience-kit/issues/8),
[#9](https://github.com/mihailShumilov/solana-resilience-kit/issues/9).

## Phase 3 — Core quant logic ✅ (merged, PR #1)

`@clearline/core`: `Predicate` (single + margin) mirroring on-chain `validateStat`,
`evaluatePredicate` (auditable left/right), integer money (`Lamports`/`priceBps`/
`payoutLamports`), `settle`. 62 tests, **100% coverage**.

## Next — Phase 4 (on-chain settlement, RISK NODE)

Spike-first: prove a predicate via the 3-stage Merkle proof against the devnet
`daily_scores_roots` root using TxLINE `validateStat`. Then `clearline_settlement`
Anchor program + Codama kit client.

- **BLOCKER (funding):** devnet faucet is 429-rate-limiting airdrops to the agent wallet.
  The on-chain `subscribe` (→ API token → token-gated reads + proof data) needs SOL.
  Retry the faucet later, or fund `HCbeaJ54rRSEwey2QEd49tgFyrfFYAfpK3kzZ86NKd8P` via
  faucet.solana.com (manual). The `validateStat` verify itself is a `.view()` simulation
  (no fee), but obtaining the proof data needs the API token first.
- Reference: TxLINE devnet IDL doc + on-chain examples `github.com/txodds/tx-on-chain`.

## On-chain artifacts (fill as produced)

- Phase 4 spike tx / Explorer link: _pending (blocked on wallet funding)_
- Settlement tx(s): _pending_
