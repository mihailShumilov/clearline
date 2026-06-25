import type { Lamports, MoneyError } from "./money";
import { validatePriceBps, validateStake } from "./money";
import type { Predicate } from "./predicate";

/**
 * An **edge** the agent claims on a fixture (§8): a precise, integer-valued
 * predicate over match statistics, staked at a given decimal price.
 *
 * `claimedAtMs` is the wall-clock time (epoch milliseconds) the edge was claimed.
 * It is **injected** by the caller — this module never reads a clock, preserving
 * purity/determinism (§4, §11 deterministic replay).
 */
export interface Edge {
  readonly fixtureId: number;
  readonly predicate: Predicate;
  readonly stakeLamports: Lamports;
  readonly priceBps: number;
  readonly claimedAtMs: number;
}

/** Typed construction failures for an {@link Edge} (no bare `throw`). */
export type EdgeError =
  | { readonly code: "invalid-money"; readonly cause: MoneyError }
  | { readonly code: "invalid-fixture-id"; readonly fixtureId: number }
  | { readonly code: "invalid-claimed-at"; readonly claimedAtMs: number };

/** Result of {@link makeEdge} — discriminated on `ok`. */
export type EdgeResult =
  | { readonly ok: true; readonly edge: Edge }
  | { readonly ok: false; readonly error: EdgeError };

/** Fields required to construct an {@link Edge}. */
export interface EdgeInput {
  readonly fixtureId: number;
  readonly predicate: Predicate;
  readonly stakeLamports: Lamports;
  readonly priceBps: number;
  readonly claimedAtMs: number;
}

/**
 * Pure constructor/validator for an {@link Edge}. Validates the fixture id (a
 * non-negative integer), the injected claim timestamp (a non-negative integer of
 * epoch milliseconds), and delegates stake/price validation to the money module.
 * Returns a typed {@link EdgeResult}; never throws, no I/O, no clock.
 */
export function makeEdge(input: EdgeInput): EdgeResult {
  if (!Number.isInteger(input.fixtureId) || input.fixtureId < 0) {
    return { ok: false, error: { code: "invalid-fixture-id", fixtureId: input.fixtureId } };
  }
  if (!Number.isInteger(input.claimedAtMs) || input.claimedAtMs < 0) {
    return { ok: false, error: { code: "invalid-claimed-at", claimedAtMs: input.claimedAtMs } };
  }

  const stakeCheck = validateStake(input.stakeLamports);
  if (!stakeCheck.ok) {
    return { ok: false, error: { code: "invalid-money", cause: stakeCheck.error } };
  }
  const priceCheck = validatePriceBps(input.priceBps);
  if (!priceCheck.ok) {
    return { ok: false, error: { code: "invalid-money", cause: priceCheck.error } };
  }

  const edge: Edge = {
    fixtureId: input.fixtureId,
    predicate: input.predicate,
    stakeLamports: input.stakeLamports,
    priceBps: input.priceBps,
    claimedAtMs: input.claimedAtMs,
  };
  return { ok: true, edge };
}
