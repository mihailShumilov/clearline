# ClearLine — Submission Checklist (§13)

_The TxODDS Hackathon Challenge 2026 — World Cup. Network: devnet._

- [ ] Working **autonomous agent** running on Solana **devnet**.
- [ ] **Live TxLINE ingest** (World Cup SSE) as the agent's real input.
- [ ] **Trustless settlement** via on-chain `validateStat` + three-stage Merkle proof,
      with a **real devnet transaction/verdict** linked on Solana Explorer.
- [ ] **Proof-of-Edge dashboard**: positions, edges, settlements (proof links), P&L,
      and a live **RPC Health** panel.
- [ ] **solana-resilience-kit** is the sole RPC path; ≥2–3 endpoints; OTel metrics;
      fault-harness coverage; **before/after metrics** + **≥1 upstream issue/PR**.
- [ ] **Deterministic `/demo-replay`** of a real World Cup match.
- [ ] Quality gates green (`pnpm check`); `packages/core` ≥90% coverage.
- [ ] Public repo + README quickstart + complete `docs/`.
- [ ] **Recorded demo video** following the §13 scenario.

## Links (fill in)

- Repo: _tbd_
- Devnet program / settlement tx: _tbd_
- Dashboard (Pages) / local run: _tbd_
- Demo video: _tbd_
