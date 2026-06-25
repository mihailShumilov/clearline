import { describe, expect, it } from "vitest";
import { evaluatePredicate, type Predicate, type Stat } from "@clearline/core";
import { LocalSettlementProvider, OnChainSettlementProvider, SettlementError } from "./index";

const stats: Stat[] = [
  { key: 1, value: 2, period: 0 },
  { key: 2, value: 1, period: 0 },
  { key: 100, value: 3, period: 0 },
];

describe("LocalSettlementProvider", () => {
  it("holds agrees with evaluatePredicate (true case)", async () => {
    const predicate: Predicate = { kind: "single", statKey: 100, op: ">=", threshold: 2 };
    const expected = evaluatePredicate(predicate, stats);
    const outcome = await new LocalSettlementProvider().settle({
      fixtureId: 1,
      predicate,
      statsAtSettle: stats,
    });
    expect(expected.ok && outcome.holds === expected.holds).toBe(true);
    expect(outcome).toEqual({ holds: true, source: "local" });
  });

  it("holds agrees with evaluatePredicate (false case)", async () => {
    const predicate: Predicate = {
      kind: "margin",
      statKey1: 2,
      statKey2: 1,
      op: ">",
      threshold: 0,
    };
    const expected = evaluatePredicate(predicate, stats);
    const outcome = await new LocalSettlementProvider().settle({
      fixtureId: 1,
      predicate,
      statsAtSettle: stats,
    });
    // P2(1) - P1(2) = -1 > 0 is false.
    expect(expected.ok && outcome.holds === expected.holds).toBe(true);
    expect(outcome.holds).toBe(false);
    expect(outcome.source).toBe("local");
  });

  it("throws a typed error when a referenced stat is missing", async () => {
    const predicate: Predicate = { kind: "single", statKey: 999, op: ">=", threshold: 1 };
    await expect(
      new LocalSettlementProvider().settle({ fixtureId: 1, predicate, statsAtSettle: stats }),
    ).rejects.toBeInstanceOf(SettlementError);
  });
});

describe("OnChainSettlementProvider", () => {
  it("throws the typed not-wired error (never fakes a result)", async () => {
    const predicate: Predicate = { kind: "single", statKey: 100, op: ">=", threshold: 2 };
    const provider = new OnChainSettlementProvider();
    await expect(
      provider.settle({ fixtureId: 1, predicate, statsAtSettle: stats }),
    ).rejects.toMatchObject({ code: "not-wired" });
    await expect(
      provider.settle({ fixtureId: 1, predicate, statsAtSettle: stats }),
    ).rejects.toBeInstanceOf(SettlementError);
  });
});
