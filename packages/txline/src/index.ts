/**
 * @clearline/txline — typed TxLINE (TxODDS Oracle) client.
 * Auth (guest JWT + token activation), SSE ingest, snapshots, and the
 * three-stage Merkle stat-validation proof. All responses Zod-validated (§9).
 */

// Config
export {
  loadTxlineConfig,
  TxlineConfigSchema,
  DEFAULT_API_BASE,
  type TxlineConfig,
} from "./config";

// Errors
export {
  TxlineError,
  httpError,
  validationError,
  networkError,
  configError,
  isTxlineError,
  type TxlineErrorKind,
  type TxlineErrorInfo,
} from "./errors";

// Schemas + inferred types
export {
  TokenResponseSchema,
  ActivationPayloadSchema,
  ScoreStatSchema,
  ProofNodeSchema,
  ProofNodeListSchema,
  ScoresUpdateStatsSchema,
  ScoresBatchSummarySchema,
  ScoresStatValidationSchema,
  FixtureSchema,
  FixtureArraySchema,
  SoccerFixtureScoreSchema,
  ScoreStatMapSchema,
  ScoresSchema,
  ScoresArraySchema,
  type TokenResponse,
  type ActivationPayload,
  type ScoreStat,
  type ProofNode,
  type ScoresUpdateStats,
  type ScoresBatchSummary,
  type ScoresStatValidation,
  type Fixture,
  type SoccerFixtureScore,
  type ScoreStatMap,
  type Scores,
} from "./schemas";

// SSE parser
export { parseSseStream, parseScoresStream, type SseEvent, type ScoresStreamEvent } from "./sse";

// Client
export {
  TxlineClient,
  type TxlineClientOptions,
  type FixturesSnapshotOptions,
  type StatValidationArgs,
  type StreamScoresOptions,
} from "./client";
