/**
 * The agent's decision policy — a PURE, deterministic strategy (§4, §8, §11).
 *
 * STRATEGY ("over 1.5 goals"): as soon as the match has kicked off (the agent has
 * observed at least one live update whose `gameState` is not the pre-match state),
 * claim the edge that the **final total goals (Participant1 + Participant2) ≥ 2**,
 * expressed as a `single` predicate over the synthesised total-goals stat
 * (`STAT_KEY_TOTAL_GOALS`, see `finalStats`). The decision depends only on the
 * observed `Scores` sequence and the injected clock, so it is fully reproducible.
 *
 * The strategy decides at most once per fixture; on every later tick it returns the
 * same `Edge` would-be only if asked again, but the runner calls `decide` per tick
 * and acts on the first non-null result (idempotency lives in the runner/store).
 */
import type { ComparisonOp, Edge, Lamports, Predicate } from "@clearline/core";
import { makeEdge } from "@clearline/core";
import type { Scores } from "@clearline/txline";
import type { Clock } from "./clock";
import { STAT_KEY_TOTAL_GOALS, SETTLE_PERIOD } from "./fixture";

/** A pure, deterministic decision policy. */
export interface Strategy {
  /**
   * Inspect the observed updates (in arrival order) and either claim one {@link Edge}
   * or decline (`null`). Deterministic: same inputs ⇒ same output. The clock is read
   * only to stamp `claimedAtMs` — never the wall clock (§11).
   */
  decide(observed: ReadonlyArray<Scores>, clock: Clock): Edge | null;
}

/** Tunable parameters for {@link makeOverGoalsStrategy} (all integers, §4). */
export interface OverGoalsStrategyOptions {
  /** Total-goals threshold; the predicate is `total >= threshold`. Default `2`. */
  readonly threshold?: number;
  /** Stake in lamports. Default `1_000_000n`. */
  readonly stakeLamports?: Lamports;
  /** Decimal odds in basis points (`10000 = 1.0x`). Default `18_000` (1.8x). */
  readonly priceBps?: number;
  /** `gameState` value that means "not yet kicked off". Default `"PreMatch"`. */
  readonly preMatchState?: string;
}

const DEFAULTS = {
  threshold: 2,
  stakeLamports: 1_000_000n,
  priceBps: 18_000,
  preMatchState: "PreMatch",
} as const;

/**
 * Build the "over 1.5 goals" strategy (final total goals ≥ `threshold`).
 *
 * Declines until at least one observed update shows the match has kicked off
 * (a `gameState` other than `preMatchState`). On the first such tick it claims the
 * `single` total-goals predicate. `makeEdge` validates stake/price/fixtureId; an
 * invalid construction yields `null` (the agent simply doesn't open a position)
 * rather than a throw, keeping `decide` total.
 */
export function makeOverGoalsStrategy(options: OverGoalsStrategyOptions = {}): Strategy {
  const threshold = options.threshold ?? DEFAULTS.threshold;
  const stakeLamports = options.stakeLamports ?? DEFAULTS.stakeLamports;
  const priceBps = options.priceBps ?? DEFAULTS.priceBps;
  const preMatchState = options.preMatchState ?? DEFAULTS.preMatchState;

  const op: ComparisonOp = ">=";
  const predicate: Predicate = {
    kind: "single",
    statKey: STAT_KEY_TOTAL_GOALS,
    period: SETTLE_PERIOD,
    op,
    threshold,
  };

  return {
    decide(observed, clock): Edge | null {
      if (observed.length === 0) {
        return null;
      }
      const kickedOff = observed.some((u) => u.gameState !== preMatchState);
      if (!kickedOff) {
        return null;
      }

      const first = observed[0];
      if (first === undefined) {
        return null;
      }

      const result = makeEdge({
        fixtureId: first.fixtureId,
        predicate,
        stakeLamports,
        priceBps,
        claimedAtMs: clock.nowMs(),
      });
      return result.ok ? result.edge : null;
    },
  };
}
