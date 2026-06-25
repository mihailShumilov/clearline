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

- **Phase 0:** dependency pinned (`1.2.0`; peer `@solana/kit ^6.10.0`).
- **Phase 2 — DONE.** `@clearline/chain` is the single RPC chokepoint. Implemented:
  - `loadChainConfig` — Zod-validated, env-injected, **devnet-only** (rejects
    `mainnet-beta`/`testnet` at the boundary, §5); primary + up to two backups.
  - `createChainPool` — `ResilientRpcPool` over the configured endpoints with a
    `HealthMonitor` (`maxSlotLag` default `150n`), optional `CreditRateLimiter`,
    a `Metrics` sink (default `InMemoryMetrics`, injectable `OtelMetrics`), and a
    shared `LifecycleEmitter`. Returns a narrow typed handle
    `{ rpc(), health(), metrics, events, endpointNames, transport }`.
  - `createChainSender` — wraps `TransactionSender` with a **devnet `clusterGuard`**
    (`mode: "throw"`); shares the pool's metrics + events.
  - `toHealthSnapshot` — pure, JSON-serializable DTO for the RPC Health panel
    (bigint slot → decimal string, freshest flag, healthy/total counts).
- **Tests:** deterministic, via `solana-resilience-kit/testing` (manual clock +
  injected `sleep`). 24 passing + 1 opt-in live devnet test (`CHAIN_LIVE`).
  Covered: happy-path `getSlot`, 429 failover (serve-path + freshness-probe
  ejection), drop failover, freshness routing (lagging node deprioritized),
  devnet cluster-guard confirm + mainnet-guard block, `toHealthSnapshot` mapping,
  and the before/after landing bench.

## Confirmed kit + @solana/kit API signatures (against the installed `.d.ts`)

- `new ResilientRpcPool({ endpoints: { name, transport }[], freshnessAware?,
maxAttempts?, hedge?, healthMonitor?, rateLimiter?, metrics?, events? })`
  → `.rpc(): Rpc<SolanaRpcApi>`, `.health(): EndpointHealth[]`, `.transport: RpcTransport`.
- `new HealthMonitor({ endpointNames: string[], maxSlotLag?: bigint,
failureThreshold?, latencyAlpha? })`.
- `new CreditRateLimiter({ creditsPerWindow, windowMs, weights?, now? })`.
- `new TransactionSender(rpc: Rpc<SolanaRpcApi>, { sleep?, metrics?, events?,
clusterGuard?: { expected: Cluster, mode?: "warn"|"throw"|"off", detector? } })`
  → `sendAndConfirm(SendConfig): Promise<SendResult>`. `SendConfig` =
  `{ wireTransaction, signature, lastValidBlockHeight: bigint, rebroadcastIntervalMs?,
commitment?, txId? }`; `SendResult` = `{ signature, outcome, slot, rebroadcasts }`.
- `EndpointHealth` = `{ name, healthy, slot: bigint|null, latencyMs, errorRate,
consecutiveFailures, lastError }`.
- `InMemoryMetrics` (`successRate()`), `OtelMetrics({ serviceName, otlpEndpoint?, meter? })`.
- `LifecycleEmitter` events used: `connection:failover { from,to,reason }`,
  `connection:health { endpoint,healthy,slot }`, `connection:cluster-detected/-mismatch`,
  `transaction:*`.
- Testing entry: `new MockCluster({ initialSlot?, initialBlockHeight?,
genesisHash?, defaultLandingDelaySlots?, blockhashSeed? })` with
  `advanceSlots(n)`, `scheduleLanding(sig, slots)`, `scheduleFailure(sig, err?)`;
  `new MockEndpoint(cluster, { name?, faults?, rngSeed? })` exposing `.transport`,
  mutable `.faults: EndpointFaultProfile` (`dropRate`, `errorRate`, `rate429Rate`,
  `slotLag`, `latencyMs`, `offline`) and `.stats` counters.
- **@solana/kit (verified in `@solana/rpc` re-export):**
  `createDefaultRpcTransport({ url: ClusterUrl }): RpcTransport`,
  `createSolanaRpcFromTransport(transport): Rpc<SolanaRpcApi>`, and the
  `devnet(url)` brand helper. `RpcTransport` is re-exported by `@solana/kit`
  (via `@solana/rpc` → `@solana/rpc-spec`).

## Metrics (before / after)

Measured by `runLandingBench` (`packages/chain/src/bench/landing.ts`, exercised by
`bench/landing.test.ts`) against the deterministic `solana-resilience-kit/testing`
cluster. "Landing" = a `getSlot` read returns without throwing. The **naive**
client is pinned to a single faulty primary (the status quo most dApps ship); the
**resilient** client is `createChainPool` over the same faulty primary + a clean
backup. All rows use the committed default **`seed: 1`**, so they reproduce
exactly (the 100% row is also asserted in `bench/landing.test.ts`).

| Scenario (injected primary failure) | Attempts | Naive client        | With kit (pool)      |
| ----------------------------------- | -------- | ------------------- | -------------------- |
| 100% primary failure (drop / 503)   | 50       | **0.0%** (0/50)     | **100.0%** (50/50)   |
| 50% primary failure                 | 200      | **47.5%** (95/200)  | **100.0%** (200/200) |
| 25% primary failure                 | 200      | **71.0%** (142/200) | **100.0%** (200/200) |

Reproduce: `runLandingBench({ primaryErrorRate, attempts, seed: 1 })`
(`packages/chain/src/bench/landing.ts`).

Takeaway: under any primary degradation the pool's failover lifts the landing
rate to 100% by routing to the healthy backup, while the naive single-endpoint
client inherits the primary's failure rate one-for-one.

Correctness (expired-vs-confirmed) is exercised separately in `sender.test.ts`:
with a devnet-genesis mock cluster and an injected `sleep` that advances the
clock, a scheduled landing resolves to `outcome: "confirmed"` and is recorded in
`metrics.landings`; a mainnet-genesis cluster is blocked by the `clusterGuard`
before any broadcast (`primary.stats.sends === 0`).

## Findings → issues / PRs (friction worth an upstream issue)

1. **`RpcTransport` is not re-exported from a stable public path for consumers.**
   The kit's `pool.d.ts` imports `RpcTransport` from `@solana/rpc-spec`, but that
   package is **not a direct dependency of a kit consumer**, so
   `import type { RpcTransport } from "@solana/rpc-spec"` fails to resolve under
   pnpm's strict node-linker. Works only via `@solana/kit` (which re-exports it).
   _Suggestion:_ re-export `RpcTransport` (and `ResilientEndpoint.transport`'s
   type) from the kit's own entry, or document that consumers must import it from
   `@solana/kit`, not `@solana/rpc-spec`. Candidate upstream doc/types issue.

2. **Freshness-aware routing means a consistently-bad endpoint never reaches the
   serve path, so per-request metrics (`rpc.rate_limited`, `rpc.request.failures`)
   are NOT recorded for it.** With `freshnessAware: true` (the default), the
   pre-request `getSlot` probe detects the bad endpoint and `rankByFreshness`
   drops it, so the real request goes straight to the healthy node. The bad
   endpoint's failures are then only visible via `health()` (probe failures feed
   `HealthMonitor`, but the probe path does **not** call
   `metrics.recordRateLimited` / `metrics.recordRequest`). A dashboard that keys
   "failover happened" off `rpc.rate_limited` will under-count. _Suggestion:_
   have `probe()` feed the metrics sink too (e.g. `recordRequest(..., ok=false)`
   and `recordRateLimited` on a 429 probe), so probe-detected degradation is
   observable in OTel, not only in `health()`. Candidate upstream enhancement.
   _Workaround in ClearLine:_ the RPC Health panel reads `toHealthSnapshot(health())`
   (per-endpoint `healthy` / `errorRate` / `consecutiveFailures`) as the primary
   signal, and treats the request metrics as a secondary, serve-path-only view.

Both are minor; neither blocks the integration. No bug caused incorrect behavior —
the pool failed over and served correctly in every injected-fault scenario.
