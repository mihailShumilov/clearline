# ClearLine

**An autonomous agent that settles sports edges trustlessly on Solana — fed by TxLINE's
on-chain-anchored World Cup data.**

ClearLine ingests live TxLINE (TxODDS Oracle) World Cup scores, forms a deterministic
**edge** (an integer predicate over match statistics), and at match end **settles
trustlessly**: it fetches a three-stage Merkle proof and submits it to the TxLINE
on-chain `validateStat` instruction, which verifies the statistic against the published
`daily_scores_roots` Merkle root. No trusted reporter sits in the settlement path. Every
position, settlement, and the live **RPC health** are shown on a Proof-of-Edge dashboard.

All RPC runs through [**solana-resilience-kit**](https://github.com/mihailShumilov/solana-resilience-kit)
(health-aware multi-RPC failover, correct send/confirm, OpenTelemetry) — ClearLine is a
production polygon for it.

> Network: **Solana devnet only**. See [`CLAUDE.md`](./CLAUDE.md) for the full spec.

## Monorepo

| Path                 | What                                                                              |
| -------------------- | --------------------------------------------------------------------------------- |
| `packages/core`      | Pure, integer-only decision/settlement math (≥90% covered).                       |
| `packages/txline`    | Typed TxLINE client (auth, SSE ingest, snapshots, stat-validation).               |
| `packages/chain`     | The only RPC path: solana-resilience-kit pool + OTel + Codama clients.            |
| `packages/agent`     | Ingest → decide → open → settle orchestration.                                    |
| `packages/contracts` | `clearline_settlement` Anchor program.                                            |
| `apps/api`           | Hono on Cloudflare Workers — REST + SSE + agent loop (Durable Object + Cron), D1. |
| `apps/dashboard`     | Proof-of-Edge dashboard (Vite + React) with the RPC Health panel.                 |

## Quickstart

```bash
# prerequisites: Node >=20, pnpm 9, Rust + anchor-cli (Phase 4), solana CLI on devnet
pnpm install

# quality gate: format check + ESLint + strict typecheck + tests (+coverage) + build
pnpm check

# run a package's tests
pnpm --filter @clearline/core test
```

### Secrets (never committed)

Copy `.env.example` → `.env` (Node scripts) and/or `.dev.vars` (wrangler dev). Fill
`TXLINE_JWT` / `TXLINE_API_TOKEN` (Phase 1) and `SOLANA_AGENT_SECRET` (a dedicated
devnet keypair). Deployed Workers use `wrangler secret put`.

## Status

Built in phases (see `docs/PROGRESS.md`). Currently bootstrapping (Phase 0).
