/**
 * A tiny seeded, deterministic PRNG (mulberry32).
 *
 * The replay engine is intentionally fully deterministic (§11), so randomness is
 * never used to alter the decision or settlement path. This RNG exists only to make
 * any incidental "randomness" reproducible: given the same seed it yields the same
 * sequence on every run and every machine, so a replay is byte-identical.
 *
 * No crypto guarantees — this is for reproducibility, not security.
 */

/** A deterministic random-number source. */
export interface Rng {
  /** Next float in `[0, 1)`. */
  next(): number;
  /** Next unsigned 32-bit integer. */
  nextUint32(): number;
}

/**
 * mulberry32 — a fast 32-bit seeded generator. The same `seed` always produces the
 * same stream. The seed is coerced to a uint32 so any integer is accepted.
 */
export function createRng(seed: number): Rng {
  // Coerce to uint32; default deterministic seed if a non-finite value sneaks in.
  let state = (Number.isFinite(seed) ? seed : 0) >>> 0;

  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };

  return {
    nextUint32,
    next(): number {
      return nextUint32() / 0x1_0000_0000;
    },
  };
}
