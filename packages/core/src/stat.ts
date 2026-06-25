/**
 * Score statistics — mirrors the TxLINE `ScoreStat` shape (§8, §10).
 *
 * Every field is an integer by contract (§4: scores are integers, no
 * floating-point). The numbers are treated as integers by the consumers of this
 * module; nothing here coerces or rounds, so callers must supply integers.
 *
 *  - `key`    — the statistic identifier (e.g. full-time score for a participant).
 *  - `value`  — the integer value of that statistic.
 *  - `period` — the match period the statistic was recorded in (e.g. full time,
 *               half time). Used to disambiguate stats that share a `key`.
 */
export interface Stat {
  readonly key: number;
  readonly value: number;
  readonly period: number;
}

/**
 * An immutable collection of {@link Stat}s for a single fixture snapshot. A plain
 * `ReadonlyArray` is used rather than a map because a `(key, period)` pair is the
 * lookup unit and `key` alone is not necessarily unique across periods.
 */
export type StatTable = ReadonlyArray<Stat>;

/**
 * Pure, total lookup of a single statistic by `key` and (optionally) `period`.
 *
 * Returns the first matching {@link Stat}, or `undefined` when none matches. When
 * `period` is omitted the first stat with the given `key` (in array order) is
 * returned; when supplied, both `key` and `period` must match. No I/O, no clock,
 * no mutation.
 */
export function findStat(stats: StatTable, key: number, period?: number): Stat | undefined {
  for (const stat of stats) {
    if (stat.key !== key) {
      continue;
    }
    if (period !== undefined && stat.period !== period) {
      continue;
    }
    return stat;
  }
  return undefined;
}
