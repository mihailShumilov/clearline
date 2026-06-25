/**
 * Deterministic, manually-advanced clock for the replay engine (§11).
 *
 * The agent NEVER reads the wall clock — every timestamp it stamps onto an edge or
 * a log line comes from a {@link Clock}. In a replay the {@link ReplayClock} is
 * advanced explicitly to each recorded update's `ts`, so two runs over the same
 * fixture produce byte-identical timestamps (and therefore identical results).
 */

/** A monotonic source of epoch-millisecond timestamps. */
export interface Clock {
  /** Current time in epoch milliseconds. */
  nowMs(): number;
}

/** Typed clock failures (no bare `throw "string"`, §4). */
export class ClockError extends Error {
  readonly code: "non-integer-ms" | "time-went-backwards";
  constructor(code: "non-integer-ms" | "time-went-backwards", message: string) {
    super(message);
    this.name = "ClockError";
    this.code = code;
    Object.setPrototypeOf(this, ClockError.prototype);
  }
}

/**
 * A deterministic clock whose time is set by hand. There is no access to
 * `Date.now()` anywhere, so replays are reproducible (§11).
 *
 *  - `set(ms)` jumps the clock to an exact instant (may move backwards — used to
 *    initialise the replay to the first update's timestamp).
 *  - `advanceTo(ms)` moves the clock forward to `ms`, rejecting a backwards move so
 *    the replay's timeline stays monotonic with the recorded `ts` sequence.
 */
export class ReplayClock implements Clock {
  #ms: number;

  constructor(startMs = 0) {
    assertIntMs(startMs);
    this.#ms = startMs;
  }

  nowMs(): number {
    return this.#ms;
  }

  /** Set the clock to an exact instant (no monotonicity check). */
  set(ms: number): void {
    assertIntMs(ms);
    this.#ms = ms;
  }

  /**
   * Advance the clock forward to `ms`. A no-op when `ms === now`. Throws a typed
   * {@link ClockError} if `ms` is before the current time — the replay feed is
   * expected to be ordered by `ts`.
   */
  advanceTo(ms: number): void {
    assertIntMs(ms);
    if (ms < this.#ms) {
      throw new ClockError(
        "time-went-backwards",
        `cannot advance clock to ${ms}; already at ${this.#ms}`,
      );
    }
    this.#ms = ms;
  }
}

function assertIntMs(ms: number): void {
  if (!Number.isInteger(ms) || ms < 0) {
    throw new ClockError("non-integer-ms", `clock time must be a non-negative integer, got ${ms}`);
  }
}
