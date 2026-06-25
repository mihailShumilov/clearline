# ClearLine — Submission Checklist (§13)

_The TxODDS Hackathon Challenge 2026 — World Cup. Network: devnet._

- [~] Working **autonomous agent** on Solana **devnet** — agent loop + deterministic
  replay done (`@clearline/agent`); live on-chain settlement proven via the spike;
  wiring the recorded real verdict into the replay (Phase 8) in progress.
- [x] **Live TxLINE ingest** — guest auth, `subscribe`, `activate`, and live World-Cup
      fixtures/scores reads exercised on devnet (`txline-dev.txodds.com`); SSE client
      implemented (continuous live stream is optional for the demo).
- [x] **Trustless settlement** via on-chain `validate_stat` + three-stage Merkle proof —
      **real devnet verdict**: fixture 17588395, `value>0`→TRUE / `value>1`→FALSE against
      root PDA `CdUmkUdc…Rs3jHQ`. Subscribe tx
      [`rGE1t1g…YA8M`](https://explorer.solana.com/tx/rGE1t1gAtNJAFCxLsLkKEek7rusKfrsrnqTQcMbCukNZhfdg9Tng3wfuBb5SjrUV3DXBvRqSa5efyPL4ukFYA8M?cluster=devnet).
- [ ] **Proof-of-Edge dashboard** (positions, edges, settlements + links, P&L, RPC Health) — Phase 7.
- [x] **solana-resilience-kit** sole RPC path; ≥1–3 endpoints; OTel metrics; fault-harness;
      **before/after metrics** (naive 0%/47.5%/71% → pool 100%); upstream issues
      [#8](https://github.com/mihailShumilov/solana-resilience-kit/issues/8)/[#9](https://github.com/mihailShumilov/solana-resilience-kit/issues/9).
- [~] **Deterministic `/demo-replay`** of a real World Cup match — replay engine done;
  wiring the real recorded fixture + on-chain verdict (Phase 8) in progress.
- [x] Quality gates green (`pnpm check`); `packages/core` **100%** coverage; 189 tests.
- [~] Public repo + README + complete `docs/` — repo at github.com/mihailShumilov/clearline
  (**private**; flip public for submission), README + 7 docs present.
- [ ] **Recorded demo video** following the §13 scenario — owner action.

## Links

- Repo: https://github.com/mihailShumilov/clearline (private)
- Devnet program: `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`
- Subscribe tx (Explorer): https://explorer.solana.com/tx/rGE1t1gAtNJAFCxLsLkKEek7rusKfrsrnqTQcMbCukNZhfdg9Tng3wfuBb5SjrUV3DXBvRqSa5efyPL4ukFYA8M?cluster=devnet
- daily_scores_roots PDA: `CdUmkUdc4XBKeeq7Kq6JxQvnVMNuDA21mp98x4Rs3jHQ`
- Dashboard (Pages) / demo video: _tbd_

## Remaining for full §13

Phase 6 (Hono API on Workers + D1), Phase 7 (Proof-of-Edge dashboard incl. RPC Health),
Phase 8 finish (`/demo-replay` on the real fixture), flip repo public, record the video.
