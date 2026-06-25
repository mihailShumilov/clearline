/**
 * @clearline/chain — the project's ONLY RPC path (§11b).
 *
 * Wraps solana-resilience-kit (`ResilientRpcPool`, `TransactionSender`,
 * `HealthMonitor`, `CreditRateLimiter`, metrics, lifecycle events) over ≥2–3
 * devnet endpoints with a devnet cluster guard. Everything else in the repo
 * obtains its kit RPC from `createChainPool` — no bare `@solana/kit` RPC
 * anywhere else.
 */
export {
  ALLOWED_CLUSTER,
  ChainConfigSchema,
  ChainEndpointSchema,
  DEFAULT_DEVNET_RPC,
  loadChainConfig,
} from "./config";
export type { ChainConfig, ChainEndpoint } from "./config";

export { ChainError, chainClusterError, chainConfigError, isChainError } from "./errors";
export type { ChainErrorInfo, ChainErrorKind } from "./errors";

export { DEFAULT_MAX_SLOT_LAG, createChainPool } from "./pool";
export type { ChainPool, ChainPoolDeps } from "./pool";

export { createChainSender } from "./sender";
export type { ChainSender, ChainSenderOptions } from "./sender";

export { toHealthSnapshot } from "./health";
export type { HealthEndpointDTO, HealthSnapshotDTO } from "./health";

export { runLandingBench } from "./bench/landing";
export type { LandingBenchConfig, LandingBenchResult } from "./bench/landing";

// Re-export the kit metrics/event sinks so callers configure observability
// through the chain package rather than importing the kit directly (§11b).
export {
  InMemoryMetrics,
  LifecycleEmitter,
  OtelMetrics,
  CreditRateLimiter,
} from "solana-resilience-kit";
export type { EndpointHealth, Metrics, SendConfig, SendResult } from "solana-resilience-kit";
