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

// Settlement providers
export {
  LocalSettlementProvider,
  OnChainSettlementProvider,
  SettlementError,
  type SettlementProvider,
  type SettlementOutcome,
  type SettleArgs,
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
export { AgentRunner, type RunReplayArgs, type ReplayResult } from "./agent";

// Demo
export { runDemoReplay, loadDemoFixture, DEMO_SEED, DEMO_FIXTURE_ID } from "./demo";
