/**
 * Display formatting helpers. Money arrives as a decimal **string** of lamports
 * and is only ever formatted here — never parsed into a float for arithmetic (§4).
 * `BigInt` keeps the integer exact; the fractional SOL part is assembled by string
 * slicing, not division.
 */
import type { Predicate } from "./api/client";

const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Format a lamports string as SOL with a sign, e.g. `+1.250000000 SOL`. */
export function formatSol(lamports: string): string {
  let value: bigint;
  try {
    value = BigInt(lamports);
  } catch {
    return `${lamports} lamports`;
  }
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / LAMPORTS_PER_SOL;
  const frac = (abs % LAMPORTS_PER_SOL).toString().padStart(9, "0");
  const sign = negative ? "-" : "+";
  return `${sign}${whole.toString()}.${frac} SOL`;
}

/** Format a lamports string with grouping, e.g. `1,250,000,000 lamports`. */
export function formatLamports(lamports: string): string {
  let value: bigint;
  try {
    value = BigInt(lamports);
  } catch {
    return lamports;
  }
  return `${value.toLocaleString("en-US")} lamports`;
}

/** Sign of a lamports string: -1, 0, or 1, for styling P&L. */
export function signOf(lamports: string): -1 | 0 | 1 {
  try {
    const v = BigInt(lamports);
    return v < 0n ? -1 : v > 0n ? 1 : 0;
  } catch {
    return 0;
  }
}

/** Basis points → percent string, e.g. `25000` → `250.00%`. */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** A rate in [0,1] → percent, e.g. `0.042` → `4.2%`. */
export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/** Latency ms to one decimal, e.g. `12.34` → `12.3 ms`. */
export function formatLatency(ms: number): string {
  return `${ms.toFixed(1)} ms`;
}

/** Truncate a long base58 string (sig/pda) to `head…tail` for compact display. */
export function truncateMid(value: string, head = 6, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Clock time `HH:MM:SS` from an epoch-ms number. */
export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour12: false });
}

const OP_LABEL: Record<Predicate["op"], string> = {
  ">": ">",
  ">=": "≥",
  "=": "=",
  "<=": "≤",
  "<": "<",
};

/**
 * Human-readable predicate, e.g. `stat[7] > 0` or `stat[1] − stat[2] ≥ 2`. The
 * "P1 score > 0" shorthand is rendered with stat keys since the core model is
 * stat-keyed; the operator is the verdict's exact comparison.
 */
export function describePredicate(predicate: Predicate): string {
  const op = OP_LABEL[predicate.op];
  if (predicate.kind === "single") {
    return `stat[${predicate.statKey}] ${op} ${predicate.threshold}`;
  }
  return `stat[${predicate.statKey1}] − stat[${predicate.statKey2}] ${op} ${predicate.threshold}`;
}
