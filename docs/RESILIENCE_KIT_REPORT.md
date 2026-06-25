# solana-resilience-kit — Production Polygon Report (§11b)

ClearLine is a real-world proving ground for **solana-resilience-kit**
(local: `../superteam-solana-rps-sdk`; upstream:
`github.com/mihailShumilov/solana-resilience-kit`, pinned `1.2.0`).

## Integration goals

- `@clearline/chain` is the **only** RPC path; ≥2–3 devnet endpoints with real failover.
- OpenTelemetry instruments exported and surfaced on the dashboard's **RPC Health** panel:
  `rpc.request.latency_ms`, `rpc.request.failures`, `rpc.rate_limited`,
  `tx.rebroadcasts`, `tx.landings`, `rpc.endpoint.slot`.
- Coverage via `solana-resilience-kit/testing` (drops, expiry, 429, slot lag).

## Status

- Phase 0: dependency pinned (1.2.0; peer `@solana/kit ^6.9.0`). Integration begins Phase 2.

## Metrics (before / after) — fill from runs

| Scenario                          | Naive client | With kit | Notes                           |
| --------------------------------- | ------------ | -------- | ------------------------------- |
| Landing rate under injected drops | _tbd_        | _tbd_    | fault harness                   |
| Failover latency on primary 429   | _tbd_        | _tbd_    |                                 |
| Expired-vs-confirmed correctness  | _tbd_        | _tbd_    | bounded by lastValidBlockHeight |

## Findings → issues / PRs

- _none yet_ (log each friction with a repro + upstream issue/PR link).
