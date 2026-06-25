/**
 * Real recorded-fixture model + Zod loader (§11, ADR-0005, ADR-0007).
 *
 * Unlike the SYNTHETIC `RecordedFixture` (`{ fixtureId, label, updates }` whose
 * `updates[]` validate against the live TxLINE `ScoresSchema`), this models the REAL
 * recorded devnet capture in `src/fixtures/wc-real-17588395.json`. That file carries
 * the actual on-chain verdict the agent settled against: the chosen update + stat,
 * the published `daily_scores_roots` PDA, the `validate_stat` subscribe transaction
 * signature + Explorer link, and the two recorded predicate verdicts.
 *
 * We validate ONLY the parts the replay uses. The raw devnet `history` array (987
 * PascalCase updates) is opaque context: it is NOT validated against the camelCase
 * `ScoresSchema` and is typed as `z.array(z.unknown()).optional()`.
 */
import { z } from "zod";

/** The chosen update + stat the on-chain verdict was recorded against. */
export const ChosenSchema = z.strictObject({
  /** Sequence number of the deciding update in the recorded history. */
  seq: z.int(),
  /** The stat key proven on-chain (e.g. `1` → Participant1 score). */
  statKey: z.int(),
  /** The integer stat value at settle time. */
  statValue: z.int(),
});
export type Chosen = z.infer<typeof ChosenSchema>;

/** One recorded on-chain predicate verdict (rule text + boolean result). */
export const RecordedVerdictSchema = z.strictObject({
  /** Human-readable rule, e.g. `"value > 0"`. */
  rule: z.string().min(1),
  /** The verdict the on-chain `validate_stat` returned for this rule. */
  result: z.boolean(),
});
export type RecordedVerdict = z.infer<typeof RecordedVerdictSchema>;

/** The two recorded verdicts: a holding `truePredicate` and a failing `falsePredicate`. */
export const RecordedVerdictsSchema = z.strictObject({
  truePredicate: RecordedVerdictSchema,
  falsePredicate: RecordedVerdictSchema,
});
export type RecordedVerdicts = z.infer<typeof RecordedVerdictsSchema>;

/** The on-chain evidence the verdict was recorded against. */
export const OnChainEvidenceSchema = z.strictObject({
  /** TxLINE program id (base58). */
  programId: z.string().min(1),
  /** Epoch day the `daily_scores_roots` PDA is keyed by. */
  epochDay: z.int(),
  /** The published `daily_scores_roots` PDA (base58). */
  dailyScoresRootsPda: z.string().min(1),
  /** The `validate_stat` subscribe transaction signature (base58). */
  subscribeTxSig: z.string().min(1),
  /** Solana Explorer URL for {@link OnChainEvidence.subscribeTxSig}. */
  subscribeExplorer: z.string().min(1),
  /** The recorded predicate verdicts. */
  verdicts: RecordedVerdictsSchema,
});
export type OnChainEvidence = z.infer<typeof OnChainEvidenceSchema>;

/** The stat the on-chain proof attests (key/value/period). */
export const StatToProveSchema = z.strictObject({
  key: z.int(),
  value: z.int(),
  period: z.int(),
});
export type StatToProve = z.infer<typeof StatToProveSchema>;

/** The stat-validation block; only `statToProve` is consumed by the replay. */
export const StatValidationSchema = z.looseObject({
  statToProve: StatToProveSchema,
});
export type StatValidation = z.infer<typeof StatValidationSchema>;

/**
 * Zod schema for the REAL recorded fixture. Uses {@link z.looseObject} at the top
 * level so unmodelled metadata (`source`, `recordedAt`, …) is tolerated, while every
 * field the replay consumes is strictly validated.
 */
export const RealFixtureSchema = z.looseObject({
  fixtureId: z.int(),
  label: z.string().min(1),
  chosen: ChosenSchema,
  onchain: OnChainEvidenceSchema,
  statValidation: StatValidationSchema,
  /** Opaque raw devnet updates (PascalCase); NOT validated, optional context. */
  history: z.array(z.unknown()).optional(),
});

/** The validated REAL recorded fixture, shaped for the replay. */
export type RealFixture = z.infer<typeof RealFixtureSchema>;

/** Typed loader failure (no bare `throw "string"`, §4). */
export class RealFixtureError extends Error {
  readonly code: "invalid-real-fixture";
  readonly detail: unknown;
  constructor(message: string, detail: unknown) {
    super(message);
    this.name = "RealFixtureError";
    this.code = "invalid-real-fixture";
    this.detail = detail;
    Object.setPrototypeOf(this, RealFixtureError.prototype);
  }
}

/**
 * Parse + validate an unknown JSON value into a {@link RealFixture}. Throws a typed
 * {@link RealFixtureError} (carrying the flattened Zod issues) when the value does
 * not match the contract for the parts we use.
 */
export function loadRealFixture(json: unknown): RealFixture {
  const parsed = RealFixtureSchema.safeParse(json);
  if (!parsed.success) {
    throw new RealFixtureError("real fixture failed validation", z.flattenError(parsed.error));
  }
  return parsed.data;
}
