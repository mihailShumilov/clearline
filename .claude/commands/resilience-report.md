---
description: Append before/after metrics and findings to docs/RESILIENCE_KIT_REPORT.md (§11b).
allowed-tools: Read, Write, Edit, Bash, WebFetch
---

Update `docs/RESILIENCE_KIT_REPORT.md` for the solana-resilience-kit mandate (§11b).

1. Summarize the current integration state in `packages/chain` (endpoints, failover,
   OTel instruments wired, fault-harness coverage).
2. Record **before/after metrics** (e.g. landing rate with kit on vs. a naive client,
   failover latency, 429 avoidance) from the latest run or the fault harness.
3. List any new friction/bug → open a GitHub issue on
   `github.com/mihailShumilov/solana-resilience-kit` (and a PR if you have a fix);
   link them in the report.
4. Note any missing scenario worth adding upstream.
