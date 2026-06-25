import { describe, expect, it } from "vitest";
import { settle, type Edge, type Position, type PositionStatus, type Predicate } from "./index";

const predicate: Predicate = { kind: "single", statKey: 10, op: ">", threshold: 2 };

function edge(stakeLamports: bigint, priceBps: number): Edge {
  return { fixtureId: 1, predicate, stakeLamports, priceBps, claimedAtMs: 0 };
}

function position(status: PositionStatus, stakeLamports = 1_000n, priceBps = 25_000): Position {
  return { edge: edge(stakeLamports, priceBps), status };
}

describe("settle", () => {
  it("wins: profit = payout - stake", () => {
    // 2.5x of 1000 = 2500 gross; profit = 1500.
    const result = settle(position("open", 1_000n, 25_000), true);
    expect(result).toEqual({ ok: true, outcome: { status: "won", pnlLamports: 1_500n } });
  });

  it("wins at 1.0x yields zero profit", () => {
    const result = settle(position("open", 1_000n, 10_000), true);
    expect(result).toEqual({ ok: true, outcome: { status: "won", pnlLamports: 0n } });
  });

  it("loses: pnl = -stake", () => {
    const result = settle(position("open", 1_000n, 25_000), false);
    expect(result).toEqual({ ok: true, outcome: { status: "lost", pnlLamports: -1_000n } });
  });

  it("win profit rounds down with fractional odds", () => {
    // 3 lamports at 1.5x => floor(4.5) = 4 gross; profit = 1.
    const result = settle(position("open", 3n, 15_000), true);
    expect(result).toEqual({ ok: true, outcome: { status: "won", pnlLamports: 1n } });
  });

  it("rejects settling an already-won position", () => {
    const result = settle(position("won"), false);
    expect(result).toEqual({ ok: false, error: { code: "already-settled", status: "won" } });
  });

  it("rejects settling an already-lost position", () => {
    const result = settle(position("lost"), true);
    expect(result).toEqual({ ok: false, error: { code: "already-settled", status: "lost" } });
  });

  it("rejects settling a void position", () => {
    const result = settle(position("void"), true);
    expect(result).toEqual({ ok: false, error: { code: "void-position" } });
  });
});
