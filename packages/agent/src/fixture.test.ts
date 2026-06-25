import { describe, expect, it } from "vitest";
import {
  FixtureError,
  finalStats,
  loadFixture,
  STAT_KEY_P1_SCORE,
  STAT_KEY_P2_SCORE,
  STAT_KEY_TOTAL_GOALS,
  SETTLE_PERIOD,
  type RecordedFixture,
} from "./index";
import { loadDemoFixture } from "./demo";

const validUpdate = {
  fixtureId: 1,
  gameState: "FullTime",
  startTime: 1000,
  fixtureGroupId: 2,
  competitionId: 3,
  countryId: 0,
  sportId: 1,
  participant1IsHome: true,
  participant2Id: 20,
  participant1Id: 10,
  action: "FullTime",
  id: 1,
  ts: 1_000_000,
  connectionId: 1,
  seq: 1,
  stats: { "1": 3, "2": 1 },
};

describe("loadFixture", () => {
  it("validates and returns a well-formed fixture", () => {
    const fixture = loadFixture({ fixtureId: 1, label: "ok", updates: [validUpdate] });
    expect(fixture.fixtureId).toBe(1);
    expect(fixture.updates).toHaveLength(1);
  });

  it("loads the bundled synthetic World-Cup fixture", () => {
    const fixture = loadDemoFixture();
    expect(fixture.fixtureId).toBe(900001);
    expect(fixture.updates.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects a malformed fixture (missing required field)", () => {
    expect(() => loadFixture({ fixtureId: 1, label: "x", updates: [{ bad: true }] })).toThrow(
      FixtureError,
    );
  });

  it("rejects an empty updates array", () => {
    expect(() => loadFixture({ fixtureId: 1, label: "x", updates: [] })).toThrow(FixtureError);
  });

  it("rejects a non-object input", () => {
    expect(() => loadFixture(42)).toThrow(FixtureError);
  });
});

describe("finalStats", () => {
  it("extracts P1/P2/total from the last update's stats map", () => {
    const fixture = loadFixture({ fixtureId: 1, label: "ok", updates: [validUpdate] });
    expect(finalStats(fixture)).toEqual([
      { key: STAT_KEY_P1_SCORE, value: 3, period: SETTLE_PERIOD },
      { key: STAT_KEY_P2_SCORE, value: 1, period: SETTLE_PERIOD },
      { key: STAT_KEY_TOTAL_GOALS, value: 4, period: SETTLE_PERIOD },
    ]);
  });

  it("falls back to scoreSoccer.Total.score when stats map is absent", () => {
    const noStats = {
      ...validUpdate,
      stats: undefined,
      scoreSoccer: {
        Participant1: { Total: { score: 2 } },
        Participant2: { Total: { score: 0 } },
      },
    };
    const fixture = loadFixture({ fixtureId: 1, label: "ok", updates: [noStats] });
    expect(finalStats(fixture)).toEqual([
      { key: STAT_KEY_P1_SCORE, value: 2, period: SETTLE_PERIOD },
      { key: STAT_KEY_P2_SCORE, value: 0, period: SETTLE_PERIOD },
      { key: STAT_KEY_TOTAL_GOALS, value: 2, period: SETTLE_PERIOD },
    ]);
  });

  it("uses the LAST update for settle-time stats", () => {
    const fixture = loadFixture({
      fixtureId: 1,
      label: "ok",
      updates: [
        { ...validUpdate, seq: 1, stats: { "1": 0, "2": 0 } },
        { ...validUpdate, seq: 2, stats: { "1": 5, "2": 2 } },
      ],
    });
    expect(finalStats(fixture)).toEqual([
      { key: STAT_KEY_P1_SCORE, value: 5, period: SETTLE_PERIOD },
      { key: STAT_KEY_P2_SCORE, value: 2, period: SETTLE_PERIOD },
      { key: STAT_KEY_TOTAL_GOALS, value: 7, period: SETTLE_PERIOD },
    ]);
  });

  it("defaults to 0 when neither stats nor scoreSoccer carry a score", () => {
    const empty = { ...validUpdate, stats: undefined };
    const fixture: RecordedFixture = loadFixture({
      fixtureId: 1,
      label: "ok",
      updates: [empty],
    });
    expect(finalStats(fixture)).toEqual([
      { key: STAT_KEY_P1_SCORE, value: 0, period: SETTLE_PERIOD },
      { key: STAT_KEY_P2_SCORE, value: 0, period: SETTLE_PERIOD },
      { key: STAT_KEY_TOTAL_GOALS, value: 0, period: SETTLE_PERIOD },
    ]);
  });
});
