import type { ComparisonOp } from "./comparison";
import { compareInt } from "./comparison";
import type { StatTable } from "./stat";
import { findStat } from "./stat";

/**
 * A single-stat predicate: `stat(statKey).value op threshold`.
 *
 * Mirrors the on-chain `validateStat(predicate, stat1, operator?)` single-stat
 * form (§8, §10). `period` is optional; when present the stat must match both
 * `statKey` and `period`, otherwise the first stat with `statKey` is used.
 */
export interface SinglePredicate {
  readonly kind: "single";
  readonly statKey: number;
  readonly period?: number;
  readonly op: ComparisonOp;
  readonly threshold: number;
}

/**
 * A two-stat "margin" predicate: `(stat(statKey1).value - stat(statKey2).value) op
 * threshold`.
 *
 * Mirrors the on-chain `validateStat(predicate, stat1, stat2, operator)` form with
 * the documented binary operator `{ subtract: {} }` (stat1.value − stat2.value),
 * §8/§10. Both stats are looked up with the same optional `period`.
 */
export interface MarginPredicate {
  readonly kind: "margin";
  readonly statKey1: number;
  readonly statKey2: number;
  readonly period?: number;
  readonly op: ComparisonOp;
  readonly threshold: number;
}

/** Discriminated union of all supported predicate shapes (§8). */
export type Predicate = SinglePredicate | MarginPredicate;

/**
 * Typed evaluation failure. The only way evaluation can fail is a referenced stat
 * being absent from the {@link StatTable}; modelled as a discriminated union so new
 * failure modes can be added exhaustively without resorting to `throw`.
 */
export type PredicateError = {
  readonly code: "missing-stat";
  /** The stat key that could not be found. */
  readonly statKey: number;
  /** The period that was required, when the predicate constrained one. */
  readonly period?: number;
};

/**
 * Result of {@link evaluatePredicate}. On success, `left` and `right` are the two
 * integer operands that were compared (`left op right === holds`), making the
 * verdict auditable against the on-chain `validateStat` result.
 */
export type PredicateResult =
  | { readonly ok: true; readonly holds: boolean; readonly left: number; readonly right: number }
  | { readonly ok: false; readonly error: PredicateError };

function missingStat(statKey: number, period?: number): PredicateResult {
  // Preserve `exactOptionalPropertyTypes`: only attach `period` when constrained.
  const error: PredicateError =
    period === undefined
      ? { code: "missing-stat", statKey }
      : { code: "missing-stat", statKey, period };
  return { ok: false, error };
}

/**
 * Pure, total evaluation of a {@link Predicate} against a {@link StatTable}.
 *
 * Mirrors the on-chain `validateStat` semantics exactly so the agent's off-chain
 * decision and the on-chain verdict always agree (§8, §10): a single predicate
 * compares `stat.value op threshold`; a margin predicate compares
 * `(stat1.value - stat2.value) op threshold`. No I/O, no clock, no randomness;
 * integer arithmetic only. Returns a typed {@link PredicateResult} — never throws.
 */
export function evaluatePredicate(predicate: Predicate, stats: StatTable): PredicateResult {
  switch (predicate.kind) {
    case "single": {
      const stat = findStat(stats, predicate.statKey, predicate.period);
      if (stat === undefined) {
        return missingStat(predicate.statKey, predicate.period);
      }
      const left = stat.value;
      const right = predicate.threshold;
      return { ok: true, holds: compareInt(predicate.op, left, right), left, right };
    }
    case "margin": {
      const stat1 = findStat(stats, predicate.statKey1, predicate.period);
      if (stat1 === undefined) {
        return missingStat(predicate.statKey1, predicate.period);
      }
      const stat2 = findStat(stats, predicate.statKey2, predicate.period);
      if (stat2 === undefined) {
        return missingStat(predicate.statKey2, predicate.period);
      }
      const left = stat1.value - stat2.value;
      const right = predicate.threshold;
      return { ok: true, holds: compareInt(predicate.op, left, right), left, right };
    }
  }
}
