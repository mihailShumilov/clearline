# @clearline/contracts — `clearline_settlement` (Anchor)

> Scaffolded in **Phase 4**. Not yet a workspace TS package (no `package.json`),
> so pnpm ignores it until the Anchor project + Codama-generated client land.

The on-chain ClearLine settlement program:

- **`Position`** account — `{ predicate, stakeLamports, status, settlement }`.
- **`open`** — record an edge/predicate as an open position.
- **`settle`** — finalize a position against a TxLINE statistic proven via the
  three-stage Merkle proof. The exact mechanism (CPI into the TxLINE
  `validateStat` instruction vs. recording an independently verified verdict) is
  decided after the Phase-4 devnet spike and documented in `docs/DECISIONS.md`.

TxLINE devnet program: `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`.
Daily scores root PDA: `["daily_scores_roots", epochDay:u16]`.

Build (Phase 4+): `anchor build` → IDL → `codama` generates a `@solana/kit`
client consumed by `@clearline/chain`. All transactions are sent through
solana-resilience-kit (§11b).
