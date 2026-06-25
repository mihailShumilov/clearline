import { describe, expect, it } from "vitest";
import { evaluatePredicate, type Predicate, type Stat } from "@clearline/core";
import {
  LocalSettlementProvider,
  OnChainSettlementProvider,
  RecordedSettlementProvider,
  SettlementError,
  loadRealFixture,
  type RealFixture,
} from "./index";
import wcReal from "./fixtures/wc-real-17588395.json";

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

describe("RecordedSettlementProvider", () => {
  const fixture: RealFixture = loadRealFixture(wcReal);
  // Settle-time stat carrying the chosen stat (key=1, value=1, period=0).
  const chosenStats: Stat[] = [
    {
      key: fixture.chosen.statKey,
      value: fixture.chosen.statValue,
      period: fixture.statValidation.statToProve.period,
    },
  ];

  it("returns holds:true for the recorded true-predicate (value > 0) with full evidence", async () => {
    const truePredicate: Predicate = {
      kind: "single",
      statKey: fixture.chosen.statKey,
      period: 0,
      op: ">",
      threshold: 0,
    };
    const outcome = await new RecordedSettlementProvider(fixture).settle({
      fixtureId: fixture.fixtureId,
      predicate: truePredicate,
      statsAtSettle: chosenStats,
    });
    expect(outcome.holds).toBe(true);
    expect(outcome.source).toBe("onchain");
    expect(outcome.verifiedOnChain).toBe(true);
    expect(outcome.signature).toBe(fixture.onchain.subscribeTxSig);
    expect(outcome.explorerUrl).toBe(fixture.onchain.subscribeExplorer);
    expect(outcome.rootPda).toBe(fixture.onchain.dailyScoresRootsPda);
    expect(outcome.programId).toBe(fixture.onchain.programId);
  });

  it("returns holds:false for the recorded false-predicate (value > 1)", async () => {
    const falsePredicate: Predicate = {
      kind: "single",
      statKey: fixture.chosen.statKey,
      period: 0,
      op: ">",
      threshold: 1,
    };
    const outcome = await new RecordedSettlementProvider(fixture).settle({
      fixtureId: fixture.fixtureId,
      predicate: falsePredicate,
      statsAtSettle: chosenStats,
    });
    expect(outcome.holds).toBe(false);
    expect(outcome.source).toBe("onchain");
  });

  it("local verdict agrees with core evaluatePredicate", async () => {
    const truePredicate: Predicate = {
      kind: "single",
      statKey: fixture.chosen.statKey,
      period: 0,
      op: ">",
      threshold: 0,
    };
    const expected = evaluatePredicate(truePredicate, chosenStats);
    const outcome = await new RecordedSettlementProvider(fixture).settle({
      fixtureId: fixture.fixtureId,
      predicate: truePredicate,
      statsAtSettle: chosenStats,
    });
    expect(expected.ok && outcome.holds === expected.holds).toBe(true);
  });

  it("throws verdict-mismatch when the local verdict contradicts a recorded one", async () => {
    // The recorded true-predicate (value > 0) result is `true`. Feed stats where the
    // chosen stat is 0, so the LOCAL verdict is `false` — a direct contradiction.
    const contradictingStats: Stat[] = [{ key: fixture.chosen.statKey, value: 0, period: 0 }];
    const truePredicate: Predicate = {
      kind: "single",
      statKey: fixture.chosen.statKey,
      period: 0,
      op: ">",
      threshold: 0,
    };
    const provider = new RecordedSettlementProvider(fixture);
    await expect(
      provider.settle({
        fixtureId: fixture.fixtureId,
        predicate: truePredicate,
        statsAtSettle: contradictingStats,
      }),
    ).rejects.toMatchObject({ code: "verdict-mismatch" });
    await expect(
      provider.settle({
        fixtureId: fixture.fixtureId,
        predicate: truePredicate,
        statsAtSettle: contradictingStats,
      }),
    ).rejects.toBeInstanceOf(SettlementError);
  });

  it("throws missing-stat (typed) when the chosen stat is absent", async () => {
    const truePredicate: Predicate = {
      kind: "single",
      statKey: fixture.chosen.statKey,
      period: 0,
      op: ">",
      threshold: 0,
    };
    await expect(
      new RecordedSettlementProvider(fixture).settle({
        fixtureId: fixture.fixtureId,
        predicate: truePredicate,
        statsAtSettle: [],
      }),
    ).rejects.toMatchObject({ code: "missing-stat" });
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
