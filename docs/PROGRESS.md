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

## Phase 4 — On-chain spike ✅ (devnet, executed)

Wallet funded (5 SOL); the throwaway spike (`packages/contracts/spike/validate_scores_onchain.ts`,
`tsx` + `@coral-xyz/anchor`) ran the full TxLINE devnet flow and produced a **real** verdict:

- Guest auth on `txline-dev.txodds.com` → JWT (200). TxL **Token-2022** ATA created/found:
  `7aWmfsDtEThFNDVoMfCuPvJMHNyvLKnW5fjE67ycMrna`.
- **Free tier cost RESOLVED:** on-chain `pricing_matrix` row `rowId=1` has
  `price_per_week_token = 0` → the World-Cup SL1 tier is **free** (no TxL, no USDT faucet
  needed; only SOL for ATA rent + fees). `subscribe(1, weeks)` requires `weeks % 4 == 0`
  (program error `6041 InvalidWeeks` on `weeks=1`, despite the example's `subscribe(1,1)`),
  so we call **`subscribe(1, 4)`** — still free.
- **subscribe txSig:** `rGE1t1gAtNJAFCxLsLkKEek7rusKfrsrnqTQcMbCukNZhfdg9Tng3wfuBb5SjrUV3DXBvRqSa5efyPL4ukFYA8M`
  → https://explorer.solana.com/tx/rGE1t1gAtNJAFCxLsLkKEek7rusKfrsrnqTQcMbCukNZhfdg9Tng3wfuBb5SjrUV3DXBvRqSa5efyPL4ukFYA8M?cluster=devnet
  (confirmed slot 471865973; program `6pW64…wyP2J` invoked).
- Sign `"{txSig}:{leagues}:{jwt}"` (ed25519/nacl) → `POST /api/token/activate` (200) → API
  token. JWT + token saved to gitignored `.dev.vars`.
- **Fixture chosen:** `17588395` (World Cup, South Africa 1–0 South Korea, completed),
  **seq 988**, **statKey 1** (Participant1_Score), value **V = 1**. (Terminal seq has a
  shallow sub-tree proof; deep mid-match seqs exhaust the 1.4M CU budget — see DECISIONS.)
- **Root PDA:** `daily_scores_roots` for epochDay 20629 (from `summary.updateStats.minTimestamp`,
  NOT top-level `ts` — see DECISIONS) = `CdUmkUdc4XBKeeq7Kq6JxQvnVMNuDA21mp98x4Rs3jHQ` (exists on devnet).
- **`validate_stat` `.view()` (read-only simulation, no fee) — TWO verdicts:**
  - predicate `value > 0` (i.e. `>= 1`) → **TRUE** (program return data `AQ==` = `0x01`).
  - predicate `value > 1` (i.e. `>= 2`) → **FALSE**.
  - Program logs walked the full chain: account integrity → on-chain root (interval 36) →
    fixture-level → Stage 1 (Stat→Event) → Stage 2 (Event→Fixture) → predicate eval.
- **Real recorded fixture for replay:** `packages/agent/src/fixtures/wc-real-17588395.json`
  (full 987-update score sequence + 3-stage proof + on-chain verdicts; no secrets). Kept
  alongside the synthetic `wc-sample.json` (ADR-0005).

## On-chain artifacts

- Phase 4 spike subscribe tx: `rGE1t1g…ukFYA8M`
  (https://explorer.solana.com/tx/rGE1t1gAtNJAFCxLsLkKEek7rusKfrsrnqTQcMbCukNZhfdg9Tng3wfuBb5SjrUV3DXBvRqSa5efyPL4ukFYA8M?cluster=devnet).
- `validate_stat` verdicts (read-only `.view()`, no on-chain tx): TRUE (`value>0`) / FALSE
  (`value>1`) for fixture 17588395 seq 988 statKey 1 (V=1) against root PDA
  `CdUmkUdc4XBKeeq7Kq6JxQvnVMNuDA21mp98x4Rs3jHQ`.
- ClearLine `clearline_settlement` program + settlement tx(s): _pending (Phase 4b)._
