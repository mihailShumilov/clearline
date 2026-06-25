---
description: Run the Phase-4 validateStat spike against a completed World Cup fixture on devnet.
argument-hint: "[fixtureId] [seq] [statKey]"
allowed-tools: Read, Write, Edit, Bash, WebFetch
---

Run the on-chain settlement **spike** (CLAUDE.md §7 Phase 4, §10).

1. Pick a COMPLETED World Cup fixture (args `$1`=fixtureId, `$2`=seq, `$3`=statKey if
   given; otherwise choose one from the TxLINE schedule/history).
2. Fetch the three-stage Merkle proof: `GET /api/scores/stat-validation`.
3. Build and submit the TxLINE `validateStat` call (program
   `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`, PDA `["daily_scores_roots", epochDay]`)
   **through `@clearline/chain`** (solana-resilience-kit), proving a predicate.
4. Capture the verdict + transaction signature + Solana Explorer link into
   `docs/PROGRESS.md`. On failure: diagnose with logs + Explorer; never bypass the proof.
5. Record the CPI-vs-verified-verdict decision in `docs/DECISIONS.md`.
