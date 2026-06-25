import { describe, expect, it } from "vitest";
import { RealFixtureError, loadRealFixture } from "./index";
import wcReal from "./fixtures/wc-real-17588395.json";

describe("loadRealFixture", () => {
  it("validates the bundled REAL recorded fixture", () => {
    const fixture = loadRealFixture(wcReal);
    expect(fixture.fixtureId).toBe(17588395);
    expect(fixture.chosen).toEqual({ seq: 988, statKey: 1, statValue: 1 });
    expect(fixture.onchain.programId).toBe("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
    expect(fixture.onchain.dailyScoresRootsPda).toBe(
      "CdUmkUdc4XBKeeq7Kq6JxQvnVMNuDA21mp98x4Rs3jHQ",
    );
    expect(fixture.onchain.subscribeExplorer).toMatch(
      /^https:\/\/explorer\.solana\.com\/tx\/.+\?cluster=devnet$/,
    );
    expect(fixture.onchain.verdicts.truePredicate).toEqual({ rule: "value > 0", result: true });
    expect(fixture.onchain.verdicts.falsePredicate).toEqual({ rule: "value > 1", result: false });
    expect(fixture.statValidation.statToProve).toEqual({ key: 1, value: 1, period: 0 });
  });

  it("treats `history` as opaque optional context (kept, not validated)", () => {
    const fixture = loadRealFixture(wcReal);
    expect(Array.isArray(fixture.history)).toBe(true);
    expect(fixture.history?.length).toBe(987);
  });

  it("loads when `history` is absent", () => {
    const { history: _omitted, ...rest } = wcReal as Record<string, unknown>;
    const fixture = loadRealFixture(rest);
    expect(fixture.history).toBeUndefined();
    expect(fixture.fixtureId).toBe(17588395);
  });

  it("throws a typed RealFixtureError on a malformed fixture (missing onchain)", () => {
    const { onchain: _dropped, ...malformed } = wcReal as Record<string, unknown>;
    expect(() => loadRealFixture(malformed)).toThrowError(RealFixtureError);
  });

  it("throws a typed RealFixtureError when chosen is the wrong shape", () => {
    const malformed = {
      ...(wcReal as Record<string, unknown>),
      chosen: { seq: 1, statKey: "not-an-int", statValue: 1 },
    };
    let error: unknown;
    try {
      loadRealFixture(malformed);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(RealFixtureError);
    expect((error as RealFixtureError).code).toBe("invalid-real-fixture");
  });
});
