import { describe, expect, it } from "vitest";
import type { ChainPool } from "@clearline/chain";
import { evaluatePredicate, type Predicate, type Stat } from "@clearline/core";
import {
  LocalSettlementProvider,
  OnChainSettlementProvider,
  RecordedProofSource,
  RecordedSettlementProvider,
  SettlementError,
  loadRealFixture,
  type RealFixture,
} from "./index";
import wcReal from "./fixtures/wc-real-17588395.json";

/**
 * A minimal {@link ChainPool} whose `simulateTransaction` returns canned return-data —
 * lets us drive {@link OnChainSettlementProvider} without a live RPC. (The full simulate
 * path is covered live-style with MockEndpoint in `@clearline/chain`'s validateStat test.)
 */
function fakePool(returnDataBase64: string | null, err: unknown = null): ChainPool {
  const send = async (): Promise<unknown> => ({
    value: {
      err,
      logs: [],
      returnData:
        returnDataBase64 === null
          ? null
          : {
              programId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
              data: [returnDataBase64, "base64"],
            },
    },
  });
  const rpc = { simulateTransaction: () => ({ send }) };
  return { rpc: () => rpc } as unknown as ChainPool;
}

/** The recorded fixture's raw three-stage proof (bundled), for the on-chain provider. */
const realFixture: RealFixture = loadRealFixture(wcReal);
const recordedProof = (): RecordedProofSource =>
  new RecordedProofSource(realFixture.statValidation as unknown);
const onChainStat = (value: number): Stat[] => [
  { key: realFixture.chosen.statKey, value, period: realFixture.statValidation.statToProve.period },
];

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

describe("RecordedSettlementProvider — honest verifiedOnChain", () => {
  const fixture: RealFixture = loadRealFixture(wcReal);

  it("verifiedOnChain is true ONLY when a recorded verdict was cross-checked", async () => {
    // value > 0 reconciles against the recorded truePredicate verdict.
    const reconciled = await new RecordedSettlementProvider(fixture).settle({
      fixtureId: fixture.fixtureId,
      predicate: {
        kind: "single",
        statKey: fixture.chosen.statKey,
        period: 0,
        op: ">",
        threshold: 0,
      },
      statsAtSettle: onChainStat(fixture.chosen.statValue),
    });
    expect(reconciled.verifiedOnChain).toBe(true);

    // value > 5 has NO recorded counterpart — evidence is surfaced but the verdict was
    // not itself reconciled, so verifiedOnChain must be false (no fabrication).
    const unreconciled = await new RecordedSettlementProvider(fixture).settle({
      fixtureId: fixture.fixtureId,
      predicate: {
        kind: "single",
        statKey: fixture.chosen.statKey,
        period: 0,
        op: ">",
        threshold: 5,
      },
      statsAtSettle: onChainStat(fixture.chosen.statValue),
    });
    expect(unreconciled.holds).toBe(false);
    expect(unreconciled.verifiedOnChain).toBe(false);
    expect(unreconciled.source).toBe("onchain");
  });
});

describe("OnChainSettlementProvider (live trustless path)", () => {
  const truePredicate: Predicate = {
    kind: "single",
    statKey: realFixture.chosen.statKey,
    period: 0,
    op: ">",
    threshold: 0,
  };

  it("returns the real on-chain verdict (AQ== → holds:true) with evidence", async () => {
    const provider = new OnChainSettlementProvider({
      pool: fakePool("AQ=="),
      proofSource: recordedProof(),
      evidence: {
        signature: realFixture.onchain.subscribeTxSig,
        explorerUrl: realFixture.onchain.subscribeExplorer,
      },
    });
    const outcome = await provider.settle({
      fixtureId: realFixture.fixtureId,
      predicate: truePredicate,
      statsAtSettle: onChainStat(realFixture.chosen.statValue),
    });
    expect(outcome.holds).toBe(true);
    expect(outcome.source).toBe("onchain");
    expect(outcome.verifiedOnChain).toBe(true);
    expect(outcome.rootPda).toBe(realFixture.onchain.dailyScoresRootsPda);
    expect(outcome.programId).toBe(realFixture.onchain.programId);
    expect(outcome.signature).toBe(realFixture.onchain.subscribeTxSig);
  });

  it("returns holds:false for the recorded FALSE predicate (AA==)", async () => {
    const provider = new OnChainSettlementProvider({
      pool: fakePool("AA=="),
      proofSource: recordedProof(),
    });
    const outcome = await provider.settle({
      fixtureId: realFixture.fixtureId,
      predicate: { ...truePredicate, threshold: 1 },
      statsAtSettle: onChainStat(realFixture.chosen.statValue),
    });
    expect(outcome.holds).toBe(false);
    expect(outcome.verifiedOnChain).toBe(true);
  });

  it("throws verdict-mismatch when the on-chain verdict contradicts the off-chain decision", async () => {
    // Off-chain: value(1) > 0 = true; force the on-chain sim to say false (AA==).
    const provider = new OnChainSettlementProvider({
      pool: fakePool("AA=="),
      proofSource: recordedProof(),
    });
    await expect(
      provider.settle({
        fixtureId: realFixture.fixtureId,
        predicate: truePredicate,
        statsAtSettle: onChainStat(realFixture.chosen.statValue),
      }),
    ).rejects.toMatchObject({ code: "verdict-mismatch" });
  });

  it("throws verdict-mismatch when the observed value diverges from the proven value", async () => {
    const provider = new OnChainSettlementProvider({
      pool: fakePool("AQ=="),
      proofSource: recordedProof(),
    });
    await expect(
      provider.settle({
        fixtureId: realFixture.fixtureId,
        predicate: truePredicate,
        statsAtSettle: onChainStat(realFixture.chosen.statValue + 4), // observed != proven
      }),
    ).rejects.toMatchObject({ code: "verdict-mismatch" });
  });

  it("throws unsupported-predicate for a margin (two-stat) predicate", async () => {
    const provider = new OnChainSettlementProvider({
      pool: fakePool("AQ=="),
      proofSource: recordedProof(),
    });
    const margin: Predicate = { kind: "margin", statKey1: 1, statKey2: 2, op: ">", threshold: 0 };
    await expect(
      provider.settle({
        fixtureId: realFixture.fixtureId,
        predicate: margin,
        statsAtSettle: stats,
      }),
    ).rejects.toMatchObject({ code: "unsupported-predicate" });
  });

  it("never fabricates: a typed SettlementError on any divergence", async () => {
    const provider = new OnChainSettlementProvider({
      pool: fakePool("AA=="),
      proofSource: recordedProof(),
    });
    await expect(
      provider.settle({
        fixtureId: realFixture.fixtureId,
        predicate: truePredicate,
        statsAtSettle: onChainStat(realFixture.chosen.statValue),
      }),
    ).rejects.toBeInstanceOf(SettlementError);
  });
});
