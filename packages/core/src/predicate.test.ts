import { describe, expect, it } from "vitest";
import { evaluatePredicate, type Predicate, type StatTable } from "./index";

const stats: StatTable = [
  { key: 10, value: 3, period: 0 }, // participant 1 full-time score
  { key: 11, value: 1, period: 0 }, // participant 2 full-time score
  { key: 10, value: 2, period: 1 }, // participant 1, period 1
  { key: 11, value: 2, period: 1 }, // participant 2, period 1
];

describe("evaluatePredicate — single", () => {
  type Case = readonly [string, Predicate, boolean, number, number];
  const cases: ReadonlyArray<Case> = [
    [">  holds", { kind: "single", statKey: 10, op: ">", threshold: 2 }, true, 3, 2],
    [">  fails", { kind: "single", statKey: 11, op: ">", threshold: 2 }, false, 1, 2],
    [">= boundary holds", { kind: "single", statKey: 10, op: ">=", threshold: 3 }, true, 3, 3],
    ["=  boundary holds", { kind: "single", statKey: 10, op: "=", threshold: 3 }, true, 3, 3],
    ["=  fails", { kind: "single", statKey: 10, op: "=", threshold: 2 }, false, 3, 2],
    ["<= boundary holds", { kind: "single", statKey: 11, op: "<=", threshold: 1 }, true, 1, 1],
    ["<  holds", { kind: "single", statKey: 11, op: "<", threshold: 2 }, true, 1, 2],
    ["<  boundary fails", { kind: "single", statKey: 11, op: "<", threshold: 1 }, false, 1, 1],
  ];

  it.each(cases)("%s", (_label, predicate, holds, left, right) => {
    const result = evaluatePredicate(predicate, stats);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.holds).toBe(holds);
      expect(result.left).toBe(left);
      expect(result.right).toBe(right);
    }
  });

  it("filters by period when supplied", () => {
    // key 10 is 3 at period 0 but 2 at period 1.
    const p: Predicate = { kind: "single", statKey: 10, period: 1, op: "=", threshold: 2 };
    const result = evaluatePredicate(p, stats);
    expect(result).toEqual({ ok: true, holds: true, left: 2, right: 2 });
  });

  it("reports a missing stat with the offending key (no period)", () => {
    const p: Predicate = { kind: "single", statKey: 999, op: ">", threshold: 0 };
    const result = evaluatePredicate(p, stats);
    expect(result).toEqual({ ok: false, error: { code: "missing-stat", statKey: 999 } });
  });

  it("reports a missing stat including the constrained period", () => {
    const p: Predicate = { kind: "single", statKey: 10, period: 9, op: ">", threshold: 0 };
    const result = evaluatePredicate(p, stats);
    expect(result).toEqual({ ok: false, error: { code: "missing-stat", statKey: 10, period: 9 } });
  });
});

describe("evaluatePredicate — margin", () => {
  it("computes (stat1 - stat2) and compares to threshold (holds)", () => {
    // 3 - 1 = 2, >= 2 holds.
    const p: Predicate = { kind: "margin", statKey1: 10, statKey2: 11, op: ">=", threshold: 2 };
    const result = evaluatePredicate(p, stats);
    expect(result).toEqual({ ok: true, holds: true, left: 2, right: 2 });
  });

  it("handles a negative margin", () => {
    // 1 - 3 = -2 < 0.
    const p: Predicate = { kind: "margin", statKey1: 11, statKey2: 10, op: "<", threshold: 0 };
    const result = evaluatePredicate(p, stats);
    expect(result).toEqual({ ok: true, holds: true, left: -2, right: 0 });
  });

  it("respects the period filter for both stats", () => {
    // period 1: 2 - 2 = 0, = 0 holds.
    const p: Predicate = {
      kind: "margin",
      statKey1: 10,
      statKey2: 11,
      period: 1,
      op: "=",
      threshold: 0,
    };
    const result = evaluatePredicate(p, stats);
    expect(result).toEqual({ ok: true, holds: true, left: 0, right: 0 });
  });

  it("fails when the first margin stat is missing", () => {
    const p: Predicate = { kind: "margin", statKey1: 404, statKey2: 11, op: ">", threshold: 0 };
    const result = evaluatePredicate(p, stats);
    expect(result).toEqual({ ok: false, error: { code: "missing-stat", statKey: 404 } });
  });

  it("fails when the second margin stat is missing", () => {
    const p: Predicate = { kind: "margin", statKey1: 10, statKey2: 405, op: ">", threshold: 0 };
    const result = evaluatePredicate(p, stats);
    expect(result).toEqual({ ok: false, error: { code: "missing-stat", statKey: 405 } });
  });
});
