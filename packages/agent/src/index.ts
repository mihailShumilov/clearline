/**
 * @clearline/agent — the autonomous decision/settlement loop + deterministic
 * replay engine (§7 Phase 5, §11).
 *
 * Ingest tick → decide (core) → open position → settle (provider) on completion.
 * Everything is injectable (clock/rng/logger/store/settlement) so the replay path is
 * pure and reproducible; a live run swaps in real providers.
 */

// Logger
export { noopLogger, consoleLogger, type Logger, type LogFields } from "./logger";

// Clock
export { ReplayClock, ClockError, type Clock } from "./clock";

// RNG
export { createRng, type Rng } from "./rng";

// Fixture
export {
  loadFixture,
  finalStats,
  RecordedFixtureSchema,
  FixtureError,
  STAT_KEY_P1_SCORE,
  STAT_KEY_P2_SCORE,
  STAT_KEY_TOTAL_GOALS,
  SETTLE_PERIOD,
  type RecordedFixture,
} from "./fixture";

// Strategy
export { makeOverGoalsStrategy, type Strategy, type OverGoalsStrategyOptions } from "./strategy";

// Real recorded fixture
export {
  loadRealFixture,
  RealFixtureSchema,
  RealFixtureError,
  ChosenSchema,
  OnChainEvidenceSchema,
  RecordedVerdictsSchema,
  RecordedVerdictSchema,
  StatToProveSchema,
  StatValidationSchema,
  type RealFixture,
  type Chosen,
  type OnChainEvidence,
  type RecordedVerdicts,
  type RecordedVerdict,
  type StatToProve,
  type StatValidation,
} from "./realFixture";

// Settlement providers
export {
  LocalSettlementProvider,
  RecordedSettlementProvider,
  OnChainSettlementProvider,
  RecordedProofSource,
  LiveProofSource,
  SettlementError,
  type SettlementErrorCode,
  type SettlementProvider,
  type SettlementOutcome,
  type SettleArgs,
  type ProofSource,
  type ResolvedProof,
  type SeqResolution,
  type OnChainSettlementOptions,
} from "./settlement";

// Store
export {
  InMemoryPositionStore,
  StoreError,
  type PositionStore,
  type StoredPosition,
  type PositionPatch,
} from "./store";

// Runner
export {
  AgentRunner,
  type RunReplayArgs,
  type ReplayResult,
  type ReplayOnChainProof,
} from "./agent";

// Demo
export {
  runDemoReplay,
  runRealDemoReplay,
  settleRealFixtureOnChain,
  settleRealFixtureBestEffort,
  realTruePredicate,
  loadDemoFixture,
  loadRealDemoFixture,
  DEMO_SEED,
  DEMO_FIXTURE_ID,
  REAL_FIXTURE_ID,
  type SettlementPath,
} from "./demo";
