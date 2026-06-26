# ClearLine — Submission Checklist (§13)

_The TxODDS Hackathon Challenge 2026 — World Cup. Network: devnet._

- [x] Working **autonomous agent** on Solana **devnet** — `@clearline/agent` runs the
      ingest→decide→open→settle pipeline. It **self-runs** on a Durable Object alarm + Cron
      Trigger (ADR-0009) with no manual trigger (verified under `wrangler dev`), and is also
      callable on-demand via `POST /api/demo-replay`.
- [x] **Live TxLINE ingest** — guest auth, `subscribe`, `activate`, live World-Cup
      fixtures/scores read on devnet (`txline-dev.txodds.com`); SSE client implemented.
- [x] **Trustless settlement** via on-chain `validate_stat` + three-stage Merkle proof —
      verified against the published `daily_scores_roots` root, **with the verdict now emitted
      by the agent's own production `OnChainSettlementProvider`** (read-only `.view()` through
      `@clearline/chain`; the encoder is byte-identical to the Anchor coder). Live devnet
      result: fixture 17588395, `value>0`→TRUE / `value>1`→FALSE vs root PDA `CdUmkUdc…Rs3jHQ`.
      Honest scope — three distinct sources (see `docs/PROGRESS.md`):
      (1) the one-off Phase-4 Anchor spike; (2) the **live** production provider
      (`ONCHAIN_LIVE=1 vitest`, no tx signature — `validate_stat` is read-only by design);
      (3) the deterministic replay's recorded-and-reconciled verdict. The autonomous loop uses
      (2) when the RPC is reachable and falls back to (3) under `wrangler dev` local, where the
      public devnet RPC IP-blocks the workerd egress (ADR-0009). Subscribe tx (data-subscription
      evidence): [`rGE1t1g…YA8M`](https://explorer.solana.com/tx/rGE1t1gAtNJAFCxLsLkKEek7rusKfrsrnqTQcMbCukNZhfdg9Tng3wfuBb5SjrUV3DXBvRqSa5efyPL4ukFYA8M?cluster=devnet).
- [x] **Proof-of-Edge dashboard** — edges/positions, settlement cards (Explorer + verdict),
      P&L, live SSE ticker, and the headline **RPC Health** panel (Vite + React).
- [x] **solana-resilience-kit** sole RPC path; ≥1–3 endpoints; OTel; fault-harness;
      **before/after** (naive 0%/47.5%/71% → pool 100%); upstream issues
      [#8](https://github.com/mihailShumilov/solana-resilience-kit/issues/8)/[#9](https://github.com/mihailShumilov/solana-resilience-kit/issues/9).
- [x] **Deterministic `/demo-replay`** of a real World Cup match — `runRealDemoReplay`,
      idempotent, settles on the recorded on-chain verdict.
- [x] Quality gates green (`pnpm check`); `packages/core` **100%** coverage (branches 100%);
      **231 passed / 3 skipped** (packages) + **24 passed** (`apps/api`, own vitest config).
- [x] **Public repo** + README + complete `docs/` — repo is public; README + 8 docs done.
- [ ] **Recorded demo video** following the script below — owner action.

## Links

- Repo: https://github.com/mihailShumilov/clearline (public)
- **Live dashboard:** https://clearline-dashboard.pages.dev/
- **Live API:** https://clearline-api.mschumilow.workers.dev
- Devnet program: `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`
- Subscribe tx: https://explorer.solana.com/tx/rGE1t1gAtNJAFCxLsLkKEek7rusKfrsrnqTQcMbCukNZhfdg9Tng3wfuBb5SjrUV3DXBvRqSa5efyPL4ukFYA8M?cluster=devnet
- daily_scores_roots PDA: `CdUmkUdc4XBKeeq7Kq6JxQvnVMNuDA21mp98x4Rs3jHQ`
- Demo video: _tbd (owner)_

## Demo script (concrete — for the recording)

```bash
# Terminal A — API on Workers + local D1
pnpm --filter @clearline/api exec wrangler d1 migrations apply clearline --local
pnpm --filter @clearline/api dev          # http://localhost:8787
# Terminal B — dashboard
pnpm --filter @clearline/dashboard dev    # http://localhost:5173
```

1. **Hook (15s):** "ClearLine — an autonomous agent that settles sports edges trustlessly
   on Solana, using TxLINE's on-chain-anchored World Cup data."
2. **RPC Health (20s):** show the panel (endpoints, slot freshness, latency). Optionally
   point a backup at a dead URL via `.dev.vars` to show failover keeps health green —
   the solana-resilience-kit story (naive 0% → pool 100%).
3. **Edge + settlement (40s):** click **Run demo replay** → the agent forms its edge on
   fixture 17588395 and settles on the **real on-chain verdict**; the settlement card
   shows TRUE + the **Solana Explorer link** + the `daily_scores_roots` PDA + P&L. Stress:
   no trusted reporter — the proof verifies against the on-chain Merkle root.
4. **Reproducibility (15s):** re-run — identical edge + verdict (deterministic replay).
5. **Close (10s):** recap trustlessness + the resilience-kit before/after metrics.

## Remaining (owner)

Record the video (script above). Optional: deploy API (Workers+D1) + dashboard (Pages) — needs
`wrangler login`.
