/**
 * Direct tests for {@link InMemoryRepository}: idempotent upserts, bigint-as-string
 * round-tripping, event sequencing, and the derived agent status.
 */
import type { Predicate } from "@clearline/core";
import { describe, expect, it } from "vitest";

import { InMemoryRepository } from "./repo";

const predicate: Predicate = { kind: "single", statKey: 1, period: 0, op: ">", threshold: 0 };

describe("InMemoryRepository", () => {
  it("upserts a position by id (idempotent) and keeps money as strings", async () => {
    const repo = new InMemoryRepository();
    await repo.savePosition({
      id: "fixture:1",
      fixtureId: 1,
      predicate,
      stakeLamports: "1000000",
      priceBps: 18_000,
      status: "open",
      pnlLamports: "0",
      claimedAtMs: 10,
    });
    await repo.savePosition({
      id: "fixture:1",
      fixtureId: 1,
      predicate,
      stakeLamports: "1000000",
      priceBps: 18_000,
      status: "won",
      pnlLamports: "800000",
      claimedAtMs: 10,
    });
    const rows = await repo.listPositions();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("won");
    expect(rows[0]?.pnlLamports).toBe("800000");
    expect(typeof rows[0]?.stakeLamports).toBe("string");
  });

  it("assigns a monotonic sequence id to events and lists them in order", async () => {
    const repo = new InMemoryRepository();
    const a = await repo.appendEvent({ ts: 1, kind: "a", data: { n: 1 } });
    const b = await repo.appendEvent({ ts: 2, kind: "b", data: { n: 2 } });
    expect(b).toBe(a + 1);
    const events = await repo.listEvents();
    expect(events.map((e) => e.kind)).toEqual(["a", "b"]);
  });

  it("derives idle/lastReplay agent status from the latest settlement", async () => {
    const repo = new InMemoryRepository();
    expect((await repo.agentStatus()).lastReplay).toBeNull();

    await repo.savePosition({
      id: "fixture:17588395",
      fixtureId: 17588395,
      predicate,
      stakeLamports: "1000000",
      priceBps: 18_000,
      status: "won",
      pnlLamports: "800000",
      claimedAtMs: 0,
    });
    await repo.saveSettlement({
      id: "settle:17588395:0",
      positionId: "fixture:17588395",
      holds: true,
      source: "onchain",
      explorerUrl: "https://explorer.solana.com/tx/SIG?cluster=devnet",
      createdAtMs: 99,
    });

    const status = await repo.agentStatus();
    expect(status.state).toBe("idle");
    expect(status.lastReplay?.fixtureId).toBe(17588395);
    expect(status.lastReplay?.pnlLamports).toBe("800000");
    expect(status.lastReplay?.verdictSource).toBe("onchain-recorded");
  });
});
