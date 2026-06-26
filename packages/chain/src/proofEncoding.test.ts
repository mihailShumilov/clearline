import { describe, expect, it } from "vitest";

import { ChainError } from "./errors";
import { MERKLE_BYTES, normalizeStatValidation, toBytes32, toProofNodes } from "./proofEncoding";

const thirty2 = (fill: number): number[] => Array.from({ length: MERKLE_BYTES }, () => fill);
const b64of = (bytes: number[]): string => Buffer.from(Uint8Array.from(bytes)).toString("base64");

describe("toBytes32", () => {
  it("normalizes a number[] of 32 bytes", () => {
    const out = toBytes32(thirty2(7));
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out).toHaveLength(32);
    expect(out[0]).toBe(7);
  });

  it("normalizes a base64 string of 32 bytes (mainnet encoding)", () => {
    const out = toBytes32(b64of(thirty2(9)));
    expect(out).toHaveLength(32);
    expect(out[31]).toBe(9);
  });

  it("number[] and base64 of the same bytes yield identical results", () => {
    const bytes = thirty2(0).map((_, i) => (i * 7) % 256);
    expect([...toBytes32(bytes)]).toEqual([...toBytes32(b64of(bytes))]);
  });

  it("throws a typed error on the wrong length", () => {
    expect(() => toBytes32([1, 2, 3])).toThrow(ChainError);
    try {
      toBytes32([1, 2, 3]);
    } catch (e) {
      expect((e as ChainError).kind).toBe("onchain");
      expect((e as ChainError).code).toBe("bad_merkle_length");
    }
  });

  it("throws a typed error on a byte out of range", () => {
    const bad = thirty2(0);
    bad[0] = 300;
    expect(() => toBytes32(bad)).toThrow(ChainError);
  });
});

describe("toProofNodes", () => {
  it("maps wire nodes to normalized bytes + sibling flags", () => {
    const out = toProofNodes([
      { hash: thirty2(1), isRightSibling: true },
      { hash: b64of(thirty2(2)), isRightSibling: false },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.isRightSibling).toBe(true);
    expect(out[1]?.hash[0]).toBe(2);
  });
});

describe("normalizeStatValidation", () => {
  const raw = {
    ts: 1_782_356_424_595,
    statToProve: { key: 1, value: 1, period: 0 },
    eventStatRoot: thirty2(3),
    summary: {
      fixtureId: 17_588_395,
      updateStats: {
        updateCount: 2,
        minTimestamp: 1_782_356_424_595,
        maxTimestamp: 1_782_356_500_000,
      },
      eventStatsSubTreeRoot: thirty2(4),
    },
    statProof: [{ hash: thirty2(5), isRightSibling: false }],
    subTreeProof: null,
    mainTreeProof: [{ hash: thirty2(6), isRightSibling: true }],
  };

  it("uses summary.updateStats.minTimestamp as the on-chain targetTs (ADR-0007)", () => {
    const out = normalizeStatValidation(raw);
    expect(out.targetTs).toBe(1_782_356_424_595);
    expect(out.minTimestamp).toBe(1_782_356_424_595);
    expect(out.subTreeProof).toEqual([]); // Nil → []
    expect(out.statA.statToProve.key).toBe(1);
    expect(out.statA.eventStatRoot).toHaveLength(32);
    expect(out.statB).toBeUndefined();
  });

  it("normalizes a two-stat (margin) proof's statB", () => {
    const two = {
      ...raw,
      statToProve2: { key: 2, value: 0, period: 0 },
      statProof2: [{ hash: thirty2(8), isRightSibling: false }],
    };
    const out = normalizeStatValidation(two);
    expect(out.statB?.statToProve.key).toBe(2);
    expect(out.statB?.statProof).toHaveLength(1);
  });

  it("throws a typed bad_proof error on an invalid shape", () => {
    const { ts: _ts, ...rest } = raw;
    expect(() => normalizeStatValidation(rest)).toThrow(ChainError);
    try {
      normalizeStatValidation(rest);
    } catch (e) {
      expect((e as ChainError).code).toBe("bad_proof");
    }
  });
});
