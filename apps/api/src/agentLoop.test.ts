import { describe, expect, it } from "vitest";
import type { ChainPool } from "@clearline/chain";
import { noopLogger } from "@clearline/agent";

import {
  DEFAULT_INTERVAL_MS,
  INGEST_TICKS,
  MIN_INTERVAL_MS,
  clampIntervalMs,
  initialLoopState,
  stepLoop,
  type LoopDeps,
  type LoopState,
} from "./agentLoop";
import { InMemoryRepository } from "./db/repo";

/**
 * A stub pool. `getSlot` succeeds when `reachable` (so the loop takes the LIVE path) and
 * throws otherwise (forcing the recorded fallback); `simulateTransaction` returns a canned
 * validate_stat verdict.
 */
function fakePool(returnDataBase64: string, reachable = true): ChainPool {
  const simulate = async (): Promise<unknown> => ({
    value: {
      err: null,
      logs: [],
      returnData: {
        programId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
        data: [returnDataBase64, "base64"],
      },
    },
  });
  const getSlot = () => ({
    send: async (): Promise<bigint> => {
      if (!reachable) throw new Error("AllEndpointsFailedError");
      return 12_345n;
    },
  });
  const rpc = { simulateTransaction: () => ({ send: simulate }), getSlot };
  return { rpc: () => rpc } as unknown as ChainPool;
}

/** Drive the loop to completion, returning the terminal state. */
async function runToDone(deps: LoopDeps): Promise<LoopState> {
  let state = initialLoopState(1000);
  // Bound the iterations so a logic bug can't loop forever in the test.
  for (let i = 0; i < 20 && state.phase !== "done"; i += 1) {
    state = await stepLoop(state, deps);
  }
  return state;
}

describe("stepLoop — autonomous ingest→decide→open→settle", () => {
  it("opens then settles ≥1 position with a verifiable on-chain verdict", async () => {
    const repo = new InMemoryRepository();
    let clock = 1_000_000;
    const deps: LoopDeps = {
      repo,
      pool: fakePool("AQ=="), // value > 0 → TRUE
      logger: noopLogger,
      now: () => (clock += 1000),
    };

    const final = await runToDone(deps);
    expect(final.phase).toBe("done");

    const positions = await repo.listPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0]?.status).toBe("won");
    // Stake 1_000_000 @ 1.8x → +800_000 lamports integer profit.
    expect(positions[0]?.pnlLamports).toBe("800000");

    const settlements = await repo.listSettlements();
    expect(settlements).toHaveLength(1);
    expect(settlements[0]?.holds).toBe(true);
    expect(settlements[0]?.source).toBe("onchain");
    expect(settlements[0]?.rootPda).toBe("CdUmkUdc4XBKeeq7Kq6JxQvnVMNuDA21mp98x4Rs3jHQ");

    const events = await repo.listEvents();
    const kinds = events.map((e) => e.kind);
    expect(kinds.filter((k) => k === "agent.ingest").length).toBe(INGEST_TICKS);
    expect(kinds).toContain("position.open");
    expect(kinds).toContain("position.settle");
  });

  it("is idempotent — a second run upserts the same position/settlement (no duplicates)", async () => {
    const repo = new InMemoryRepository();
    let clock = 2_000_000;
    const deps: LoopDeps = {
      repo,
      pool: fakePool("AQ=="),
      logger: noopLogger,
      now: () => (clock += 1000),
    };

    await runToDone(deps);
    await runToDone(deps);

    expect(await repo.listPositions()).toHaveLength(1);
    expect(await repo.listSettlements()).toHaveLength(1);
  });

  it("settles holds:false when the on-chain verdict is false (AA==)", async () => {
    const repo = new InMemoryRepository();
    let clock = 3_000_000;
    const deps: LoopDeps = {
      repo,
      pool: fakePool("AA=="),
      logger: noopLogger,
      now: () => (clock += 1000),
    };

    // value > 0 is TRUE off-chain, so a false on-chain verdict is a divergence → the
    // settle phase throws (never fabricates); the loop surfaces it rather than persisting.
    await expect(runToDone(deps)).rejects.toMatchObject({ code: "verdict-mismatch" });
  });

  it("falls back to the recorded on-chain verdict when the RPC is unreachable", async () => {
    const repo = new InMemoryRepository();
    let clock = 4_000_000;
    // reachable=false → getSlot throws → recorded-and-reconciled verdict (still verifiable).
    const deps: LoopDeps = {
      repo,
      pool: fakePool("AQ==", false),
      logger: noopLogger,
      now: () => (clock += 1000),
    };

    const final = await runToDone(deps);
    expect(final.phase).toBe("done");

    const positions = await repo.listPositions();
    expect(positions[0]?.status).toBe("won");
    const settlements = await repo.listSettlements();
    expect(settlements).toHaveLength(1);
    expect(settlements[0]?.holds).toBe(true);
    expect(settlements[0]?.source).toBe("onchain");

    const settleEvent = (await repo.listEvents()).find((e) => e.kind === "position.settle");
    expect((settleEvent?.data as { path?: string })?.path).toBe("onchain-recorded");
  });

  it("clamps a negative/NaN/too-fast interval to the default floor", () => {
    expect(clampIntervalMs(-100)).toBe(DEFAULT_INTERVAL_MS);
    expect(clampIntervalMs(Number.NaN)).toBe(DEFAULT_INTERVAL_MS);
    expect(clampIntervalMs(10)).toBe(DEFAULT_INTERVAL_MS); // below MIN
    expect(clampIntervalMs(MIN_INTERVAL_MS)).toBe(MIN_INTERVAL_MS);
    expect(clampIntervalMs(2_000)).toBe(2_000);
  });

  it("stays done once terminal", async () => {
    const repo = new InMemoryRepository();
    const deps: LoopDeps = { repo, pool: fakePool("AQ=="), logger: noopLogger, now: () => 1 };
    const done: LoopState = { phase: "done", tick: 5, intervalMs: 1000, fixtureId: 17_588_395 };
    expect((await stepLoop(done, deps)).phase).toBe("done");
  });
});
