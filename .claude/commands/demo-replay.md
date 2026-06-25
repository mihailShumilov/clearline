---
description: Deterministically replay a real completed World Cup fixture through the full ClearLine pipeline.
argument-hint: "<fixtureId>"
allowed-tools: Read, Write, Edit, Bash
---

Run the deterministic **historical replay** for fixture `$1` (CLAUDE.md §11).

1. Use the pre-snapshotted score sequence + stat-validation proof fixture for `$1`
   (fetch and snapshot it first if missing).
2. Drive the recorded updates through the SAME agent pipeline via the `ReplayClock` +
   seeded source (no wall clock, no randomness) → edge → position → on-chain settlement
   using the recorded proof against the real devnet root.
3. Assert the run is **idempotent**: the edge and settlement verdict are byte-identical
   across two runs. Print the position, verdict, P&L, and Explorer link.

This is the path used to record the demo video — keep output clean and legible.
