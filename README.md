# ClearLine

**An autonomous agent that settles sports edges trustlessly on Solana — fed by TxLINE's
on-chain-anchored World Cup data.**

ClearLine ingests live TxLINE (TxODDS Oracle) World Cup scores, forms a deterministic
**edge** (an integer predicate over match statistics), and at match end **settles
trustlessly**: it fetches a three-stage Merkle proof and submits it to the TxLINE on-chain
`validate_stat` instruction, which verifies the statistic against the published
`daily_scores_roots` Merkle root. No trusted reporter sits in the settlement path. Every
edge, settlement (with its Solana Explorer link), running P&L, and the live **RPC health**
are shown on a Proof-of-Edge dashboard.

All RPC runs through [**solana-resilience-kit**](https://github.com/mihailShumilov/solana-resilience-kit)
(health-aware multi-RPC failover, correct send/confirm, OpenTelemetry) — ClearLine is a
production polygon for it.

> Network: **Solana devnet only**. Full spec in [`CLAUDE.md`](./CLAUDE.md); decisions in
> [`docs/DECISIONS.md`](./docs/DECISIONS.md); progress in [`docs/PROGRESS.md`](./docs/PROGRESS.md).

## Proven on devnet 🎯

`validate_stat` (read-only `.view()`) verified a real predicate against the on-chain root:

- Fixture **17588395** (South Africa 1–0 South Korea), seq 988, statKey 1 (P1 score = 1).
- **`value > 0` → TRUE**, **`value > 1` → FALSE** vs root PDA `CdUmkUdc4XBKeeq7Kq6JxQvnVMNuDA21mp98x4Rs3jHQ`.
- Subscribe tx: [`rGE1t1g…YA8M`](https://explorer.solana.com/tx/rGE1t1gAtNJAFCxLsLkKEek7rusKfrsrnqTQcMbCukNZhfdg9Tng3wfuBb5SjrUV3DXBvRqSa5efyPL4ukFYA8M?cluster=devnet) · TxLINE program `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`.

solana-resilience-kit before/after (fault harness, seed 1): under primary failure the
naive client lands **0% / 47.5% / 71%** while the resilient pool lands **100%**.

## Monorepo

| Path                 | What                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `packages/core`      | Pure, integer-only decision/settlement math (predicate mirrors `validate_stat`); **100% covered**. |
| `packages/txline`    | Typed TxLINE client (auth, Zod v4 schemas, reads, SSE).                                            |
| `packages/chain`     | The **only** RPC path: solana-resilience-kit pool + health + OTel.                                 |
| `packages/agent`     | Ingest → decide → open → settle; deterministic replay; settlement providers.                       |
| `packages/contracts` | TxLINE IDL + the on-chain settlement spike (devnet `validate_stat`).                               |
| `apps/api`           | Hono API on Cloudflare Workers + D1 (positions/settlements/RPC-health/SSE/demo-replay).            |
| `apps/dashboard`     | Proof-of-Edge dashboard (Vite + React) incl. the RPC Health panel.                                 |

## Quickstart

```bash
# prerequisites: Node >=20, pnpm 9 (Rust + anchor-cli only for the on-chain spike)
pnpm install
pnpm check        # format + ESLint 10 + strict typecheck + tests (+coverage) + build
```

### Run the demo (the §13 scenario)

```bash
# 1. API on Cloudflare Workers + local D1 (no wrangler login needed)
pnpm --filter @clearline/api exec wrangler d1 migrations apply clearline --local
pnpm --filter @clearline/api dev          # → http://localhost:8787

# 2. Dashboard
pnpm --filter @clearline/dashboard dev    # → http://localhost:5173
```

Then in the dashboard: watch the **RPC Health** panel, click **Run demo replay** — the
agent forms its edge on fixture 17588395 and settles it on the **real recorded on-chain
verdict**, surfacing the **Solana Explorer link** and P&L. See [`docs/SUBMISSION.md`](./docs/SUBMISSION.md)
for the full video script. Headless proof: `POST http://localhost:8787/api/demo-replay`.

### Secrets (never committed)

Copy `.env.example` → `.dev.vars` (for `wrangler dev`) / `.env` (Node scripts). The
dedicated devnet agent wallet and `TXLINE_*` tokens live there (gitignored).

## Status

Phases 0–8 complete (agent, resilience, core, **live on-chain trustless settlement**,
API, dashboard, deterministic replay). Remaining: flip the repo public + record the demo
video (§13). 203 tests, `packages/core` 100% covered, `pnpm check` green.
