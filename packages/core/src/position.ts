import type { Edge } from "./edge";
import type { Lamports } from "./money";
import { payoutLamports } from "./money";

/**
 * Lifecycle status of a position (§8).
 *  - `open`  — claimed, not yet settled.
 *  - `won`   — settled, predicate held.
 *  - `lost`  — settled, predicate did not hold.
 *  - `void`  — settled with no P&L (e.g. fixture abandoned / stake returned).
 */
export type PositionStatus = "open" | "won" | "lost" | "void";

/** A position is an {@link Edge} plus its current lifecycle status (§8). */
export interface Position {
  readonly edge: Edge;
  readonly status: PositionStatus;
}

/**
 * P&L MODEL (integer lamports, no floating-point — §4):
 *  - WIN  ⇒ profit = `payoutLamports(stake, priceBps) - stake` (the net gain; the
 *           gross payout returns the stake plus this profit).
 *  - LOSS ⇒ pnl = `-stake` (the entire stake is forfeited).
 * `void` positions and already-settled positions produce a typed error rather than
 * a P&L number, so settlement is idempotent and total.
 */
export type SettleError =
  | { readonly code: "already-settled"; readonly status: "won" | "lost" }
  | { readonly code: "void-position" };

/** Outcome of settling an open position. */
export type SettleOutcome = {
  readonly status: "won" | "lost";
  readonly pnlLamports: Lamports;
};

/** Result of {@link settle} — discriminated on `ok`. */
export type SettleResult =
  | { readonly ok: true; readonly outcome: SettleOutcome }
  | { readonly ok: false; readonly error: SettleError };

/**
 * Settles an open position against a boolean verdict (typically the result of
 * `evaluatePredicate` / on-chain `validateStat`). Pure & total: no I/O, no clock.
 *
 * A `true` verdict wins (profit = gross payout − stake); `false` loses (pnl =
 * −stake). Settling a position that is already `won`/`lost`, or that is `void`,
 * returns a typed {@link SettleError} instead of throwing — making the operation
 * idempotent for the agent's settlement loop.
 */
export function settle(position: Position, verdict: boolean): SettleResult {
  switch (position.status) {
    case "won":
    case "lost":
      return { ok: false, error: { code: "already-settled", status: position.status } };
    case "void":
      return { ok: false, error: { code: "void-position" } };
    case "open": {
      const { stakeLamports, priceBps } = position.edge;
      if (verdict) {
        const pnlLamports = payoutLamports(stakeLamports, priceBps) - stakeLamports;
        return { ok: true, outcome: { status: "won", pnlLamports } };
      }
      return { ok: true, outcome: { status: "lost", pnlLamports: -stakeLamports } };
    }
  }
}
