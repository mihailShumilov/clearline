import { describe, expect, it } from "vitest";
import { makeEdge, type EdgeInput, type Predicate } from "./index";

const predicate: Predicate = { kind: "single", statKey: 10, op: ">", threshold: 2 };

function baseInput(overrides: Partial<EdgeInput> = {}): EdgeInput {
  return {
    fixtureId: 42,
    predicate,
    stakeLamports: 1_000n,
    priceBps: 20_000,
    claimedAtMs: 1_700_000_000_000,
    ...overrides,
  };
}

describe("makeEdge", () => {
  it("constructs a valid edge", () => {
    const result = makeEdge(baseInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.edge).toEqual({
        fixtureId: 42,
        predicate,
        stakeLamports: 1_000n,
        priceBps: 20_000,
        claimedAtMs: 1_700_000_000_000,
      });
    }
  });

  it("accepts a zero fixtureId and zero claimedAtMs", () => {
    const result = makeEdge(baseInput({ fixtureId: 0, claimedAtMs: 0 }));
    expect(result.ok).toBe(true);
  });

  it("rejects a negative fixtureId", () => {
    const result = makeEdge(baseInput({ fixtureId: -1 }));
    expect(result).toEqual({ ok: false, error: { code: "invalid-fixture-id", fixtureId: -1 } });
  });

  it("rejects a non-integer fixtureId", () => {
    const result = makeEdge(baseInput({ fixtureId: 1.5 }));
    expect(result).toEqual({ ok: false, error: { code: "invalid-fixture-id", fixtureId: 1.5 } });
  });

  it("rejects a negative claimedAtMs", () => {
    const result = makeEdge(baseInput({ claimedAtMs: -1 }));
    expect(result).toEqual({ ok: false, error: { code: "invalid-claimed-at", claimedAtMs: -1 } });
  });

  it("rejects a non-integer claimedAtMs", () => {
    const result = makeEdge(baseInput({ claimedAtMs: 1.2 }));
    expect(result).toEqual({ ok: false, error: { code: "invalid-claimed-at", claimedAtMs: 1.2 } });
  });

  it("propagates a stake validation failure as invalid-money", () => {
    const result = makeEdge(baseInput({ stakeLamports: 0n }));
    expect(result).toEqual({
      ok: false,
      error: { code: "invalid-money", cause: { code: "non-positive-stake", stakeLamports: 0n } },
    });
  });

  it("propagates a price validation failure as invalid-money", () => {
    const result = makeEdge(baseInput({ priceBps: 9_999 }));
    expect(result).toEqual({
      ok: false,
      error: { code: "invalid-money", cause: { code: "price-below-one", priceBps: 9_999 } },
    });
  });
});
