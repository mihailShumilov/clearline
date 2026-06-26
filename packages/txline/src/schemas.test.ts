import { describe, expect, it } from "vitest";

import {
  ActivationPayloadSchema,
  FixtureArraySchema,
  FixtureSchema,
  ProofNodeListSchema,
  ProofNodeSchema,
  ScoreStatSchema,
  ScoresArraySchema,
  ScoresSchema,
  ScoresStatValidationSchema,
  TokenResponseSchema,
} from "./schemas";

describe("TokenResponseSchema", () => {
  it("parses the { token } guest-start shape", () => {
    const out = TokenResponseSchema.parse({ token: "eyJhbGciOi.fakejwt.payload" });
    expect(out.token).toMatch(/^eyJ/);
  });

  it("rejects an empty token", () => {
    expect(TokenResponseSchema.safeParse({ token: "" }).success).toBe(false);
  });

  it("rejects unknown extra keys (strictObject)", () => {
    expect(TokenResponseSchema.safeParse({ token: "x", extra: 1 }).success).toBe(false);
  });
});

describe("ActivationPayloadSchema", () => {
  it("parses the OpenAPI example payload with leagues", () => {
    const example = {
      txSig:
        "5kb6gnsSu1inDF9nCVV3WcgKryyBFGFkrYS28Sp1avS8mq6Xcw6iq3yzkBTjmq8bGptgqYTXPmjyWECzKzUxYG3C",
      walletSignature: "2BvM...",
      leagues: [501, 804, 202],
    };
    const out = ActivationPayloadSchema.parse(example);
    expect(out.leagues).toEqual([501, 804, 202]);
  });

  it("parses without leagues (World Cup free tier)", () => {
    const out = ActivationPayloadSchema.parse({ txSig: "sig", walletSignature: "ws" });
    expect(out.leagues).toBeUndefined();
  });

  it("requires txSig and walletSignature", () => {
    expect(ActivationPayloadSchema.safeParse({ txSig: "a" }).success).toBe(false);
    expect(ActivationPayloadSchema.safeParse({ walletSignature: "b" }).success).toBe(false);
  });

  it("rejects non-integer league ids", () => {
    expect(
      ActivationPayloadSchema.safeParse({ txSig: "a", walletSignature: "b", leagues: [1.5] })
        .success,
    ).toBe(false);
  });
});

describe("ScoreStatSchema", () => {
  it("parses integer key/value/period and round-trips", () => {
    const stat = { key: 1, value: 3, period: 0 };
    const out = ScoreStatSchema.parse(stat);
    expect(out).toEqual(stat);
  });

  it("rejects floats (integers stay integers)", () => {
    expect(ScoreStatSchema.safeParse({ key: 1.2, value: 3, period: 0 }).success).toBe(false);
  });
});

describe("ProofNodeSchema / ProofNodeListSchema", () => {
  it("parses a proof node", () => {
    const node = { hash: "YmFzZTY0aGFzaA==", isRightSibling: true };
    expect(ProofNodeSchema.parse(node)).toEqual(node);
  });

  it("normalises null List_ProofNode (Nil) to an empty array", () => {
    expect(ProofNodeListSchema.parse(null)).toEqual([]);
    expect(ProofNodeListSchema.parse(undefined)).toEqual([]);
  });

  it("parses an array of proof nodes", () => {
    const nodes = [
      { hash: "aGFzaDE=", isRightSibling: false },
      { hash: "aGFzaDI=", isRightSibling: true },
    ];
    expect(ProofNodeListSchema.parse(nodes)).toEqual(nodes);
  });

  it("accepts a number[] hash encoding (the devnet feed, ADR-0007)", () => {
    const node = { hash: Array.from({ length: 32 }, (_, i) => i), isRightSibling: false };
    const out = ProofNodeSchema.parse(node);
    expect(Array.isArray(out.hash)).toBe(true);
    expect(out.hash).toHaveLength(32);
  });
});

describe("ScoresStatValidationSchema", () => {
  const single = {
    ts: 1_700_000_000_000,
    statToProve: { key: 1, value: 2, period: 0 },
    eventStatRoot: "ZXZlbnRSb290",
    summary: {
      fixtureId: 99,
      updateStats: {
        updateCount: 5,
        minTimestamp: 1_700_000_000_000,
        maxTimestamp: 1_700_000_900_000,
      },
      eventStatsSubTreeRoot: "c3ViVHJlZQ==",
    },
    statProof: [{ hash: "cA==", isRightSibling: true }],
    subTreeProof: null,
    mainTreeProof: [{ hash: "bQ==", isRightSibling: false }],
  };

  it("parses a single-stat validation with a Nil subTreeProof", () => {
    const out = ScoresStatValidationSchema.parse(single);
    expect(out.subTreeProof).toEqual([]);
    expect(out.statProof).toHaveLength(1);
    expect(out.statToProve2).toBeUndefined();
  });

  it("parses a two-stat validation", () => {
    const two = {
      ...single,
      statToProve2: { key: 2, value: 1, period: 0 },
      statProof2: [{ hash: "cTI=", isRightSibling: true }],
    };
    const out = ScoresStatValidationSchema.parse(two);
    expect(out.statToProve2?.value).toBe(1);
    expect(out.statProof2).toHaveLength(1);
  });

  it("rejects a missing required field", () => {
    const { ts: _ts, ...rest } = single;
    expect(ScoresStatValidationSchema.safeParse(rest).success).toBe(false);
  });

  it("parses a number[]-encoded validation (the devnet feed)", () => {
    const bytes32 = Array.from({ length: 32 }, (_, i) => i % 256);
    const devnet = {
      ...single,
      eventStatRoot: bytes32,
      summary: { ...single.summary, eventStatsSubTreeRoot: bytes32 },
      statProof: [{ hash: bytes32, isRightSibling: true }],
      mainTreeProof: [{ hash: bytes32, isRightSibling: false }],
    };
    const out = ScoresStatValidationSchema.parse(devnet);
    expect(Array.isArray(out.eventStatRoot)).toBe(true);
    expect(out.statProof[0]?.hash).toHaveLength(32);
  });
});

describe("FixtureSchema", () => {
  const fixture = {
    Ts: 1_700_000_000_000,
    StartTime: 1_700_100_000_000,
    Competition: "FIFA World Cup",
    CompetitionId: 501,
    FixtureGroupId: 12,
    Participant1Id: 100,
    Participant1: "Team A",
    Participant2Id: 200,
    Participant2: "Team B",
    FixtureId: 9_000_000_001,
    Participant1IsHome: true,
  };

  it("parses core fields", () => {
    expect(FixtureSchema.parse(fixture).FixtureId).toBe(9_000_000_001);
  });

  it("tolerates unknown extra keys (looseObject)", () => {
    const out = FixtureSchema.parse({ ...fixture, SomeFutureField: { nested: 1 } }) as Record<
      string,
      unknown
    >;
    expect(out["SomeFutureField"]).toEqual({ nested: 1 });
  });

  it("parses an array of fixtures", () => {
    expect(FixtureArraySchema.parse([fixture])).toHaveLength(1);
  });
});

describe("ScoresSchema", () => {
  const core = {
    fixtureId: 42,
    gameState: "in_play",
    startTime: 1_700_100_000_000,
    fixtureGroupId: 12,
    competitionId: 501,
    countryId: 1,
    sportId: 1,
    participant1IsHome: true,
    participant2Id: 200,
    participant1Id: 100,
    action: "update",
    id: 7,
    ts: 1_700_000_500_000,
    connectionId: 123_456_789,
    seq: 3,
  };

  it("parses the core + soccer-relevant fields", () => {
    const out = ScoresSchema.parse({
      ...core,
      scoreSoccer: { Participant1: { Total: { v: 1 } }, Participant2: { Total: { v: 0 } } },
      statusSoccerId: { H21: {} },
      stats: { "1": 2, "2": 1 },
    });
    expect(out.fixtureId).toBe(42);
    expect(out.stats).toEqual({ "1": 2, "2": 1 });
    expect(out.scoreSoccer).toBeDefined();
  });

  it("tolerates the multi-sport tail (looseObject)", () => {
    const out = ScoresSchema.parse({
      ...core,
      dataBasketball: { Action: "x" },
      possession: 1,
      lineups: [],
    }) as Record<string, unknown>;
    expect(out["possession"]).toBe(1);
  });

  it("requires the core seq/ts/action fields", () => {
    const { seq: _seq, ...rest } = core;
    expect(ScoresSchema.safeParse(rest).success).toBe(false);
  });

  it("parses an array of score records", () => {
    expect(ScoresArraySchema.parse([core])).toHaveLength(1);
  });
});
