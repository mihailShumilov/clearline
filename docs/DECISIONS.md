# ClearLine — Decision Records (ADR)

Short, append-only architecture decisions.

## ADR-0001 — Reconstructed specification

**Context:** the original `CLAUDE.md` was absent from the repo.
**Decision:** reconstruct a best-effort spec from the solana-resilience-kit README, the
live TxLINE docs, and a standard §0→9 hackathon structure; owner approved it before any
build. Versions pinned from live `npm view` (June 2026).
**Status:** Accepted.

## ADR-0002 — Cloudflare-first runtime (Workers + D1)

**Context:** the agent needs a recurring ingest loop and persistence; owner chose
Cloudflare-first over a Node runtime.
**Decision:** API + agent run on Cloudflare Workers; persistence is D1 via
`drizzle-orm/d1`. The ingest loop is a Durable Object (alarm) + Cron Trigger polling
TxLINE snapshots (free tier has a 60s delay, no rate limits — polling suffices) rather
than a held SSE socket. Local dev uses `wrangler dev` (miniflare, no login). Dashboard →
Cloudflare Pages.
**Consequences:** deploy + `wrangler secret put` + remote D1 need `wrangler login` (a
manual owner step); local build/test/replay need no login.
**Status:** Accepted.

## ADR-0003 — Codama clients, not the Anchor TS client at runtime

**Context:** solana-resilience-kit is built on `@solana/kit` (web3.js v2);
`@coral-xyz/anchor`'s TS client uses web3.js v1 `Connection`.
**Decision:** generate `@solana/kit`-native clients via **Codama** from both the
ClearLine and TxLINE IDLs; send every transaction through solana-resilience-kit's
`TransactionSender`. Anchor (Rust) is used only to author/build the program.
**Consequences:** honors §11b ("no bare @solana/kit RPC"); avoids the v1/v2 split.
**Status:** Accepted.

## ADR-0004 — Internal packages consumed as bundled source

**Context:** internal `@clearline/*` packages are consumed by Workers (esbuild), Vite,
tsx, and Vitest — never run as raw Node ESM from `dist/`.
**Decision:** use `moduleResolution: "Bundler"` with extensionless TS imports; the
bundler/test-runner resolves source. Each internal package's `main`/`types`/`exports`
point at **`./src/index.ts`** (not `dist/`), so cross-package consumers (agent → core/
txline/chain) and Vitest/esbuild/wrangler resolve TS source directly — the emitted
`dist/` (extensionless ESM) is NOT runnable under raw Node ESM and is used only as a
compile/declaration sanity check by `pnpm -r build`.
**Status:** Accepted. Revisit only if a package must be published or run as raw Node ESM
(then switch to `NodeNext` + explicit `.js` import extensions, and export `dist/`).

## ADR-0005 — Deterministic historical replay for the demo

**Context:** live World Cup matches end before judging.
**Decision:** snapshot one real completed fixture's score sequence + stat-validation
proof; replay it through the same pipeline with a `ReplayClock` + seeded source (mirrors
the resilience-kit manual-clock harness). On-chain settlement uses the recorded proof
against the real devnet root, so the verdict is reproducible.
**Status:** Accepted.

## ADR-0006 — Devnet on-chain flow + hosts (Phase 4 recon)

**Decision/record (from the TxLINE docs + `github.com/txodds/tx-on-chain`):**

- **Devnet API host is `https://txline-dev.txodds.com`** (`/auth/guest/start` → HTTP 200).
  The on-chain example's `oracle-dev.txodds.com` is unreachable (HTTP 000) — stale. Prod
  is `txline.txodds.com`. ClearLine selects the host via `TXLINE_API_BASE` (configurable).
- **Activation flow** (from `backup/examples/data_validation/validate_scores_onchain.ts`):
  guest `POST /auth/guest/start` → create the TxL **Token-2022** ATA → `subscribe(service_level_id, weeks)`
  (the free World-Cup tier is **service level 1**; example calls `subscribe(1, 1)`) →
  sign `"{txSig}:{leagues.join(',')}:{jwt}"` with the wallet (ed25519) → `POST /api/token/activate`
  `{ txSig, walletSignature, leagues: [] }` → API token.
- **`validate_stat`** args (IDL): `ts:i64, fixture_summary:ScoresBatchSummary,
fixture_proof:ProofNode[], main_tree_proof:ProofNode[], predicate:TraderPredicate,
stat_a:StatTerm, stat_b:Option<StatTerm>, op:Option<BinaryExpression>` → `bool`;
  account `daily_scores_merkle_roots` (PDA `["daily_scores_roots", epochDay:u16]`).
- The saved `packages/contracts/idl/txoracle.json` carries **mainnet** address
  (`9ExbZjAapQww…`) + constants (TxL mint `Zhw9…`, `SUBSCRIPTION_PRICE_TOKEN=25_000_000`
  = 25 TxL/wk, 6 decimals). The instruction/type **interface is shared**; for devnet
  override `address` → `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` and mint →
  `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG` for Codama generation.
- **Funding:** every live step needs devnet SOL (ATA rent + fees). `request_devnet_faucet`
  yields testnet USDT; `purchase_subscription_token_usdt` buys TxL if the free tier still
  requires a non-zero `price_per_week_token` (TBD — resolve once funded).
  **Status:** Accepted (recon). Live execution blocked on devnet SOL (faucet 429).

## ADR-0007 — Phase-4 on-chain spike (LIVE devnet result)

**Context:** wallet funded (5 SOL); we ran the spike against the devnet TxLINE program
`6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` and recorded the real behaviour.

**Findings (all evidence-backed; see PROGRESS.md for txSig/Explorer):**

- **Free-tier cost = ZERO TxL.** On-chain `pricing_matrix` `rowId=1` has
  `price_per_week_token = 0`. The World-Cup SL1 tier needs **no TxL and no USDT faucet** —
  only SOL for the Token-2022 ATA rent + tx fees. Resolves the OPEN free-tier question.
- **`subscribe` weeks must be a multiple of 4** on the deployed devnet program
  (`weeks=1` → error `6041 InvalidWeeks`, despite the official example's `subscribe(1,1)` —
  the devnet build differs from the example). ClearLine calls `subscribe(1, 4)` (still free).
- **`validate_stat` `ts` arg = `summary.updateStats.minTimestamp`**, NOT the top-level
  `validation.ts`. The program uses this `ts` both for the `daily_scores_roots` PDA seed
  AND matches it to the batch payload; `validation.ts` (and `maxTimestamp`) → error
  `6010 TimestampMismatch`. (The docs MDX example is correct here; the `validate_scores`
  example passing `validation.ts` is wrong for this devnet build.)
- **Devnet feed encodes 32-byte roots/hashes as JSON `number[]` arrays**, not the base64
  strings the mainnet OpenAPI `format: binary` implied. Pass them straight through.
  NOTE: the recorded fixture (`packages/agent/src/fixtures/wc-real-17588395.json`) therefore
  stores `eventStatRoot`/proof `hash` as `number[]`, which diverges from
  `txline/schemas.ts` `ScoresStatValidationSchema` (`z.string()`). The Phase-5 replay layer
  must normalize (`number[]` → bytes) rather than `.parse()` the saved file with that schema
  directly — or the txline schema should accept both encodings.
- **`validate_stat` returns `bool` via Solana return-data**, decoded by Anchor `.view()`
  (read-only simulation, no fee, no signature). The saved mainnet IDL omits the `returns`
  field, which blocks `.view()`; the devnet-patched IDL adds `returns: "bool"`.
- **Compute budget:** terminal-seq proofs (shallow sub-tree, depth 1) cost ~150k CU and fit
  the 1.4M limit; deep mid-match seqs (sub-tree depth 6) exceed it (`ProgramFailedToComplete`).
  Pick the terminal update; set `setComputeUnitLimit(1_400_000)`.
- **Result:** for fixture 17588395 seq 988 statKey 1 (V=1) against the live root PDA, the
  on-chain check **discriminated correctly** — predicate `value > 0` → TRUE (return `AQ==`),
  `value > 1` → FALSE.

**Decisions:**

- **Spike uses `@coral-xyz/anchor` (web3.js v1)** — sanctioned for this isolated, throwaway
  risk node only (ADR-0003 still governs product code: the runtime `OnChainSettlementProvider`
  in `packages/chain` will use `@solana/kit` + Codama-generated clients, sent via
  solana-resilience-kit). The spike lives in `packages/contracts/spike/**`, outside the TS
  workspace gate (eslint/tsconfig/prettier ignore it); `packages/contracts` has its own
  `package.json` with the spike-only deps and is excluded from `pnpm -r typecheck/build`.
- **ClearLine `settle` records an independently-verified verdict (NOT a CPI into
  TxLINE `validateStat`).** Rationale: `validate_stat` is a read-style instruction that
  returns a bool by return-data and does not mutate state; verifying it is a free `.view()`.
  CPI-ing into it from `clearline_settlement` would add ~150k+ CU per settlement, couple us
  to its weeks/ts/encoding quirks, and gain nothing — the proof is already verifiable against
  the public `daily_scores_roots` root. So `clearline_settlement.settle` takes the
  off-chain-computed verdict (the agent first runs the same `validate_stat` `.view()` to
  confirm the proof on-chain) and records it on the Position. Resolves the OPEN settle-mechanism
  question.

**Status:** Accepted.

## OPEN (to resolve in-phase)

- _(resolved)_ Stat-validation auth header convention → Bearer + `X-Api-Token` (Phase 1, API.md).
- _(resolved by ADR-0007)_ ClearLine `settle` mechanism → record independently-verified verdict
  (no CPI).
- _(resolved by ADR-0007)_ Free-tier `subscribe` TxL cost → zero (SL1 `price_per_week_token = 0`).
