import { describe, expect, it } from "vitest";
import { evaluatePredicate } from "@clearline/core";
import type { Scores } from "@clearline/txline";
import {
  makeOverGoalsStrategy,
  ReplayClock,
  finalStats,
  loadFixture,
  STAT_KEY_TOTAL_GOALS,
} from "./index";
import { loadDemoFixture } from "./demo";

function update(over: Partial<Scores> & Pick<Scores, "gameState" | "seq">): Scores {
  return loadFixture({
    fixtureId: 555,
    label: "x",
    updates: [
      {
        fixtureId: 555,
        startTime: 1,
        fixtureGroupId: 2,
        competitionId: 3,
        countryId: 0,
        sportId: 1,
        participant1IsHome: true,
        participant2Id: 20,
        participant1Id: 10,
        action: "x",
        id: over.seq,
        ts: 1000 + over.seq,
        connectionId: 1,
        ...over,
      },
    ],
  }).updates[0] as Scores;
}

describe("makeOverGoalsStrategy", () => {
  it("declines before kickoff and on an empty feed", () => {
    const s = makeOverGoalsStrategy();
    const clock = new ReplayClock(1000);
    expect(s.decide([], clock)).toBeNull();
    expect(s.decide([update({ gameState: "PreMatch", seq: 1 })], clock)).toBeNull();
  });

  it("claims an over-1.5-goals single predicate once kicked off", () => {
    const s = makeOverGoalsStrategy();
    const clock = new ReplayClock(1234);
    const edge = s.decide([update({ gameState: "FirstHalf", seq: 1 })], clock);
    expect(edge).not.toBeNull();
    expect(edge?.predicate).toEqual({
      kind: "single",
      statKey: STAT_KEY_TOTAL_GOALS,
      period: 0,
      op: ">=",
      threshold: 2,
    });
    expect(edge?.claimedAtMs).toBe(1234);
    expect(edge?.fixtureId).toBe(555);
  });

  it("is deterministic: same inputs ⇒ identical edge", () => {
    const obs = [update({ gameState: "FirstHalf", seq: 1 })];
    const a = makeOverGoalsStrategy().decide(obs, new ReplayClock(500));
    const b = makeOverGoalsStrategy().decide(obs, new ReplayClock(500));
    expect(a).toEqual(b);
  });

  it("the claimed predicate evaluates true on the bundled fixture's final stats", () => {
    const fixture = loadDemoFixture();
    const edge = makeOverGoalsStrategy().decide(
      [...fixture.updates],
      new ReplayClock(fixture.updates[0]?.ts ?? 0),
    );
    expect(edge).not.toBeNull();
    if (edge === null) return;
    const result = evaluatePredicate(edge.predicate, finalStats(fixture));
    expect(result.ok && result.holds).toBe(true);
  });

  it("returns null when stake/price are invalid (makeEdge rejects)", () => {
    const s = makeOverGoalsStrategy({ priceBps: 9_999 });
    const edge = s.decide([update({ gameState: "FirstHalf", seq: 1 })], new ReplayClock(0));
    expect(edge).toBeNull();
  });
});
