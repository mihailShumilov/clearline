/**
 * Integer money & odds (§4: money/odds/scores are integers — no floating-point in
 * any settlement or P&L path).
 *
 *  - Stakes and payouts are denominated in **lamports** as `bigint`, so amounts are
 *    exact and never lose precision.
 *  - Decimal odds (the multiplier a winning stake returns, e.g. 2.5x) are expressed
 *    in **basis points** (`priceBps`): `10000 bps = 1.0000x`. CONVENTION: a valid
 *    price is `>= 10000` (i.e. odds of at least 1.0x — a winner never receives less
 *    than its stake). `priceBps` is a plain integer `number` because it is a bounded
 *    multiplier, not a balance; all money arithmetic that uses it is done in
 *    `bigint`.
 */

/** Lamports — the integer base unit of SOL. Always exact (`bigint`). */
export type Lamports = bigint;

/** One whole multiplier (1.0000x) expressed in basis points. */
export const PRICE_BPS_ONE = 10_000;

/** Typed validation failures for the money/odds inputs (no bare `throw`). */
export type MoneyError =
  | { readonly code: "non-positive-stake"; readonly stakeLamports: Lamports }
  | { readonly code: "price-below-one"; readonly priceBps: number }
  | { readonly code: "non-integer-price"; readonly priceBps: number };

/** Result of a money/odds validation — discriminated on `ok`. */
export type MoneyValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: MoneyError };

/**
 * Validates a stake: must be strictly positive. Pure & total.
 */
export function validateStake(stakeLamports: Lamports): MoneyValidation {
  if (stakeLamports <= 0n) {
    return { ok: false, error: { code: "non-positive-stake", stakeLamports } };
  }
  return { ok: true };
}

/**
 * Validates decimal odds in basis points: must be a non-fractional integer and at
 * least `1.0x` (`>= PRICE_BPS_ONE`). Pure & total.
 */
export function validatePriceBps(priceBps: number): MoneyValidation {
  if (!Number.isInteger(priceBps)) {
    return { ok: false, error: { code: "non-integer-price", priceBps } };
  }
  if (priceBps < PRICE_BPS_ONE) {
    return { ok: false, error: { code: "price-below-one", priceBps } };
  }
  return { ok: true };
}

/**
 * Gross payout (stake returned **plus** profit) for a winning stake, in lamports.
 *
 * `payout = floor(stakeLamports * priceBps / 10000)`. ROUNDING RULE: integer
 * division truncates toward zero (round **down**), so the house never over-pays a
 * fractional lamport. Computed entirely in `bigint` — no floating-point.
 *
 * Inputs are assumed pre-validated via {@link validateStake} /
 * {@link validatePriceBps}; this function does not re-validate so it stays a pure
 * arithmetic primitive. With `priceBps >= 10000` the payout is always `>= stake`.
 */
export function payoutLamports(stakeLamports: Lamports, priceBps: number): Lamports {
  return (stakeLamports * BigInt(priceBps)) / BigInt(PRICE_BPS_ONE);
}
