/**
 * Zod v4 schemas + inferred types for the TxLINE API surface (§9).
 *
 * Zod v4 idioms used (verified via Context7 against zod 4.4.3):
 *  - `z.looseObject({...})` to tolerate unknown extra keys (replaces `.passthrough()`).
 *  - `z.strictObject({...})` for closed shapes (replaces `.strict()`).
 *  - `z.int()` for safe-integer fields — integers stay integers (§4).
 *  - `error: (issue) => ...` for custom messages (replaces `invalid_type_error`).
 *
 * Note on `format: binary` fields (`hash`, `eventStatRoot`, sub-tree roots): the
 * mainnet OpenAPI marks these `format: binary` (base64 strings), but the DEVNET feed
 * delivers them as JSON `number[]` byte arrays (ADR-0007). They are therefore modelled
 * as {@link MerkleBytesSchema} (`string | number[]`); decoding to fixed 32-byte values
 * is the on-chain layer's concern (`@clearline/chain` `normalizeStatValidation`, §10).
 */
import { z } from "zod";

/**
 * A 32-byte Merkle value on the wire: a base64 string (mainnet OpenAPI `format: binary`)
 * OR a JSON `number[]` of byte values (the devnet feed). Kept as the raw wire value; the
 * on-chain layer normalizes either encoding to bytes (§10, ADR-0007).
 */
export const MerkleBytesSchema = z.union([z.string(), z.array(z.int())]);
export type MerkleBytes = z.infer<typeof MerkleBytesSchema>;

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

/** Response of `POST /auth/guest/start`. */
export const TokenResponseSchema = z.strictObject({
  token: z.string().min(1),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

/** Request body of `POST /api/token/activate` (`ActivationPayload`). */
export const ActivationPayloadSchema = z.strictObject({
  txSig: z.string().min(1),
  walletSignature: z.string().min(1),
  /** Empty/omitted = World Cup free tier; otherwise explicit league IDs. */
  leagues: z.array(z.int()).optional(),
});
export type ActivationPayload = z.infer<typeof ActivationPayloadSchema>;

/* -------------------------------------------------------------------------- */
/* Merkle proof primitives                                                     */
/* -------------------------------------------------------------------------- */

/** A single statistic: `{ key, value, period }` — all integers (§8). */
export const ScoreStatSchema = z.strictObject({
  key: z.int(),
  value: z.int(),
  period: z.int(),
});
export type ScoreStat = z.infer<typeof ScoreStatSchema>;

/** One node in a Merkle proof path. `hash` is base64 OR a `number[]` (see {@link MerkleBytesSchema}). */
export const ProofNodeSchema = z.strictObject({
  hash: MerkleBytesSchema,
  isRightSibling: z.boolean(),
});
export type ProofNode = z.infer<typeof ProofNodeSchema>;

/**
 * `List_ProofNode` in the spec is `oneOf [ Nil, ProofNode[] ]`; in JSON this is
 * either `null` or an array. We normalise both to a `ProofNode[]`.
 */
export const ProofNodeListSchema = z
  .array(ProofNodeSchema)
  .nullish()
  .transform((v) => v ?? []);

/** Aggregate update stats for a fixture's score events. */
export const ScoresUpdateStatsSchema = z.strictObject({
  updateCount: z.int(),
  minTimestamp: z.int(),
  maxTimestamp: z.int(),
});
export type ScoresUpdateStats = z.infer<typeof ScoresUpdateStatsSchema>;

/** Per-fixture batch summary; `eventStatsSubTreeRoot` is base64 OR a `number[]`. */
export const ScoresBatchSummarySchema = z.strictObject({
  fixtureId: z.int(),
  updateStats: ScoresUpdateStatsSchema,
  eventStatsSubTreeRoot: MerkleBytesSchema,
});
export type ScoresBatchSummary = z.infer<typeof ScoresBatchSummarySchema>;

/** Response of `GET /api/scores/stat-validation` — the three-stage Merkle proof. */
export const ScoresStatValidationSchema = z.strictObject({
  ts: z.int(),
  statToProve: ScoreStatSchema,
  eventStatRoot: MerkleBytesSchema,
  summary: ScoresBatchSummarySchema,
  statProof: ProofNodeListSchema,
  subTreeProof: ProofNodeListSchema,
  mainTreeProof: ProofNodeListSchema,
  statToProve2: ScoreStatSchema.optional(),
  statProof2: ProofNodeListSchema.optional(),
});
export type ScoresStatValidation = z.infer<typeof ScoresStatValidationSchema>;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A fixture (`GET /api/fixtures/snapshot`). We model the core fields and tolerate
 * unknown extras with `looseObject` so unmodelled additions don't break parsing.
 */
export const FixtureSchema = z.looseObject({
  Ts: z.int(),
  StartTime: z.int(),
  Competition: z.string(),
  CompetitionId: z.int(),
  FixtureGroupId: z.int(),
  Participant1Id: z.int(),
  Participant1: z.string(),
  Participant2Id: z.int(),
  Participant2: z.string(),
  FixtureId: z.int(),
  Participant1IsHome: z.boolean(),
});
export type Fixture = z.infer<typeof FixtureSchema>;

/* -------------------------------------------------------------------------- */
/* Scores                                                                      */
/* -------------------------------------------------------------------------- */

/** A soccer scoreline period bucket (`SoccerScore` is sport-specific; kept loose). */
const SoccerScoreSchema = z.looseObject({}).nullish();

/** `SoccerTotalScore` — period-keyed scores; all members optional & loose. */
const SoccerTotalScoreSchema = z.looseObject({
  H1: SoccerScoreSchema,
  HT: SoccerScoreSchema,
  H2: SoccerScoreSchema,
  ET1: SoccerScoreSchema,
  ET2: SoccerScoreSchema,
  PE: SoccerScoreSchema,
  ETTotal: SoccerScoreSchema,
  Total: SoccerScoreSchema,
});

/** `SoccerFixtureScore` — per-participant total score. */
export const SoccerFixtureScoreSchema = z.looseObject({
  Participant1: SoccerTotalScoreSchema,
  Participant2: SoccerTotalScoreSchema,
});
export type SoccerFixtureScore = z.infer<typeof SoccerFixtureScoreSchema>;

/**
 * `Map_ScoreStatKey` — additionalProperties of int32. Modelled as a record of
 * string keys → integer values.
 */
export const ScoreStatMapSchema = z.record(z.string(), z.int());
export type ScoreStatMap = z.infer<typeof ScoreStatMapSchema>;

/**
 * A single Scores record. We model the core + soccer-relevant fields strictly and
 * tolerate the large multi-sport tail with `looseObject` (§ deliverable 3).
 *
 * `statusSoccerId` is a `oneOf` of empty status objects in the spec, so it is kept
 * permissive (`unknown`) — only its presence matters off-chain.
 */
export const ScoresSchema = z.looseObject({
  // --- core (required by the spec) ---
  fixtureId: z.int(),
  gameState: z.string(),
  startTime: z.int(),
  fixtureGroupId: z.int(),
  competitionId: z.int(),
  countryId: z.int(),
  sportId: z.int(),
  participant1IsHome: z.boolean(),
  participant2Id: z.int(),
  participant1Id: z.int(),
  action: z.string(),
  id: z.int(),
  ts: z.int(),
  connectionId: z.int(),
  seq: z.int(),
  // --- soccer-relevant (optional) ---
  scoreSoccer: SoccerFixtureScoreSchema.optional(),
  statusSoccerId: z.unknown().optional(),
  stats: ScoreStatMapSchema.optional(),
});
export type Scores = z.infer<typeof ScoresSchema>;

/** Array form returned by the snapshot/historical/updates score endpoints. */
export const ScoresArraySchema = z.array(ScoresSchema);

/** Array form returned by the fixtures snapshot endpoint. */
export const FixtureArraySchema = z.array(FixtureSchema);
