import { describe, expect, it } from "vitest";
import { payoutLamports, PRICE_BPS_ONE, validatePriceBps, validateStake } from "./index";

describe("validateStake", () => {
  it("accepts a positive stake", () => {
    expect(validateStake(1n)).toEqual({ ok: true });
  });

  it("rejects a zero stake", () => {
    expect(validateStake(0n)).toEqual({
      ok: false,
      error: { code: "non-positive-stake", stakeLamports: 0n },
    });
  });

  it("rejects a negative stake", () => {
    expect(validateStake(-5n)).toEqual({
      ok: false,
      error: { code: "non-positive-stake", stakeLamports: -5n },
    });
  });
});

describe("validatePriceBps", () => {
  it("accepts exactly 1.0x (10000 bps)", () => {
    expect(validatePriceBps(PRICE_BPS_ONE)).toEqual({ ok: true });
  });

  it("accepts odds above 1.0x", () => {
    expect(validatePriceBps(25_000)).toEqual({ ok: true });
  });

  it("rejects odds below 1.0x", () => {
    expect(validatePriceBps(9_999)).toEqual({
      ok: false,
      error: { code: "price-below-one", priceBps: 9_999 },
    });
  });

  it("rejects a fractional (non-integer) price", () => {
    expect(validatePriceBps(15_000.5)).toEqual({
      ok: false,
      error: { code: "non-integer-price", priceBps: 15_000.5 },
    });
  });
});

describe("payoutLamports", () => {
  type Case = readonly [string, bigint, number, bigint];
  const cases: ReadonlyArray<Case> = [
    ["1.0x returns the stake", 1_000n, 10_000, 1_000n],
    ["2.0x doubles the stake", 1_000n, 20_000, 2_000n],
    ["2.5x", 1_000n, 25_000, 2_500n],
    ["rounds down a fractional lamport", 3n, 15_000, 4n], // 3 * 15000 / 10000 = 4.5 -> 4
    ["rounds down toward zero", 1n, 19_999, 1n], // 19999 / 10000 = 1.9999 -> 1
    ["large bigint stays exact", 1_000_000_000_000n, 13_750, 1_375_000_000_000n],
  ];

  it.each(cases)("%s", (_label, stake, priceBps, expected) => {
    expect(payoutLamports(stake, priceBps)).toBe(expected);
  });

  it("payout is always >= stake for price >= 1.0x", () => {
    expect(payoutLamports(7n, PRICE_BPS_ONE)).toBeGreaterThanOrEqual(7n);
  });
});
