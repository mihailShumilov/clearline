import { describe, expect, it } from "vitest";
import { findStat, type Stat, type StatTable } from "./index";

const stats: StatTable = [
  { key: 1, value: 3, period: 0 },
  { key: 2, value: 1, period: 0 },
  { key: 1, value: 5, period: 1 },
];

describe("findStat", () => {
  it("returns the first stat matching key when period is omitted", () => {
    expect(findStat(stats, 1)).toEqual<Stat>({ key: 1, value: 3, period: 0 });
  });

  it("matches both key and period when period is supplied", () => {
    expect(findStat(stats, 1, 1)).toEqual<Stat>({ key: 1, value: 5, period: 1 });
  });

  it("returns undefined when the key is absent", () => {
    expect(findStat(stats, 99)).toBeUndefined();
  });

  it("returns undefined when the key exists but the period does not", () => {
    expect(findStat(stats, 2, 7)).toBeUndefined();
  });

  it("returns undefined for an empty table", () => {
    expect(findStat([], 1)).toBeUndefined();
  });

  it("skips stats with a matching key but wrong period before finding the match", () => {
    // key 1 appears at period 0 then period 1; requesting period 1 must skip the
    // period-0 entry and return the period-1 entry.
    expect(findStat(stats, 1, 1)?.value).toBe(5);
  });
});
