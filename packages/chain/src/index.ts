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

export {
  ChainError,
  chainClusterError,
  chainConfigError,
  chainOnchainError,
  isChainError,
} from "./errors";
export type { ChainErrorInfo, ChainErrorKind } from "./errors";

export { DEFAULT_MAX_SLOT_LAG, createChainPool } from "./pool";
export type { ChainPool, ChainPoolDeps } from "./pool";

export { createChainSender } from "./sender";
export type { ChainSender, ChainSenderOptions } from "./sender";

export { toHealthSnapshot } from "./health";
export type { HealthEndpointDTO, HealthSnapshotDTO } from "./health";

// Proof-encoding normalization (number[] vs base64) for the three-stage Merkle proof.
export {
  MERKLE_BYTES,
  MerkleBytesWireSchema,
  ProofNodeWireSchema,
  ProofNodeListWireSchema,
  normalizeStatValidation,
  toBytes32,
  toProofNodes,
} from "./proofEncoding";
export type {
  MerkleBytesWire,
  ProofNodeWire,
  NormalizedProofNode,
  NormalizedStatTerm,
  NormalizedStatValidation,
} from "./proofEncoding";

// On-chain trustless settlement: encode + simulate TxLINE `validate_stat` (§10).
export {
  TXLINE_PROGRAM_ID_DEVNET,
  VALIDATE_STAT_DISCRIMINATOR,
  DAILY_SCORES_ROOTS_SEED,
  DEFAULT_COMPUTE_UNIT_LIMIT,
  DEFAULT_SIM_FEE_PAYER,
  MS_PER_DAY,
  encodeValidateStatData,
  epochDayFromTs,
  deriveDailyScoresRootsPda,
  validateStatOnChain,
} from "./validateStat";
export type {
  OnChainComparison,
  OnChainPredicate,
  ValidateStatVerdict,
  ValidateStatOptions,
} from "./validateStat";

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
