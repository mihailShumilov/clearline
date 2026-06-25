import { describe, expect, it } from "vitest";
import { payoutLamports } from "@clearline/core";
import {
  AgentRunner,
  DEMO_FIXTURE_ID,
  InMemoryPositionStore,
  LocalSettlementProvider,
  ReplayClock,
  loadDemoFixture,
  makeOverGoalsStrategy,
  runDemoReplay,
  type ReplayResult,
} from "./index";

/** Round-trip a ReplayResult through JSON (bigint→string) for deep-equal compares. */
function stable(result: ReplayResult): unknown {
  return JSON.parse(JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

function freshRun(): Promise<ReplayResult> {
  return AgentRunner.runReplay({
    fixture: loadDemoFixture(),
    strategy: makeOverGoalsStrategy(),
    settlement: new LocalSettlementProvider(),
    store: new InMemoryPositionStore(),
    clock: new ReplayClock(),
  });
}

describe("AgentRunner.runReplay", () => {
  it("opens and settles exactly one position on the bundled fixture", async () => {
    const result = await freshRun();
    expect(result.fixtureId).toBe(DEMO_FIXTURE_ID);
    expect(result.positions).toHaveLength(1);
    expect(result.settlements).toHaveLength(1);
    expect(result.settlements[0]).toEqual({ holds: true, source: "local" });
    expect(result.positions[0]?.status).toBe("won");
  });

  it("computes integer P&L = payout - stake on a win", async () => {
    const result = await freshRun();
    // Default strategy: stake 1_000_000 @ 1.8x → payout 1_800_000 → profit 800_000.
    const expected = payoutLamports(1_000_000n, 18_000) - 1_000_000n;
    expect(result.pnlLamports).toBe(expected);
    expect(result.pnlLamports).toBe(800_000n);
  });

  it("is idempotent: two runs produce a deep-equal result", async () => {
    const a = await freshRun();
    const b = await freshRun();
    expect(stable(a)).toEqual(stable(b));
  });

  it("persists the settled position in the store", async () => {
    const store = new InMemoryPositionStore();
    await AgentRunner.runReplay({
      fixture: loadDemoFixture(),
      strategy: makeOverGoalsStrategy(),
      settlement: new LocalSettlementProvider(),
      store,
      clock: new ReplayClock(),
    });
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.position.status).toBe("won");
  });

  it("opens no position when the strategy never fires (all pre-match)", async () => {
    const fixture = loadDemoFixture();
    const preMatchOnly = {
      ...fixture,
      updates: fixture.updates.map((u) => ({ ...u, gameState: "PreMatch" })),
    };
    const result = await AgentRunner.runReplay({
      fixture: preMatchOnly,
      strategy: makeOverGoalsStrategy(),
      settlement: new LocalSettlementProvider(),
      store: new InMemoryPositionStore(),
      clock: new ReplayClock(),
    });
    expect(result.positions).toHaveLength(0);
    expect(result.settlements).toHaveLength(0);
    expect(result.pnlLamports).toBe(0n);
  });

  it("loses (negative P&L) when the predicate does not hold", async () => {
    const fixture = loadDemoFixture();
    // Force a 0-0 final so total goals (0) < threshold (2): predicate fails.
    const goalless = {
      ...fixture,
      updates: fixture.updates.map((u) => ({ ...u, stats: { "1": 0, "2": 0 } })),
    };
    const result = await AgentRunner.runReplay({
      fixture: goalless,
      strategy: makeOverGoalsStrategy(),
      settlement: new LocalSettlementProvider(),
      store: new InMemoryPositionStore(),
      clock: new ReplayClock(),
    });
    expect(result.positions[0]?.status).toBe("lost");
    expect(result.pnlLamports).toBe(-1_000_000n);
  });
});

describe("runDemoReplay", () => {
  it("runs and settles a winning position deterministically", async () => {
    const a = await runDemoReplay();
    const b = await runDemoReplay();
    expect(stable(a)).toEqual(stable(b));
    expect(a.positions[0]?.status).toBe("won");
    expect(a.pnlLamports).toBe(800_000n);
  });

  it("rejects an unknown fixture id", async () => {
    await expect(runDemoReplay(123)).rejects.toThrow();
  });
});
