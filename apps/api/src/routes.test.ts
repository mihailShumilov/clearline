/**
 * Handler tests for the ClearLine API (§7 Phase 6). Exercises `createApp` with an
 * {@link InMemoryRepository} plus fake `health`/`runReplay` via Hono's
 * `app.request(...)` — no network, no miniflare, no D1.
 */
import type { Position } from "@clearline/core";
import type { ReplayResult } from "@clearline/agent";
import type { HealthSnapshotDTO } from "@clearline/chain";
import { describe, expect, it } from "vitest";

import { InMemoryRepository } from "./db/repo";
import { createApp } from "./routes";

/** A healthy two-endpoint snapshot fake. */
const healthySnapshot: HealthSnapshotDTO = {
  endpoints: [
    {
      name: "primary",
      healthy: true,
      slot: "123456",
      latencyMs: 42,
      errorRate: 0,
      consecutiveFailures: 0,
      freshest: true,
    },
    {
      name: "backup-1",
      healthy: true,
      slot: "123450",
      latencyMs: 60,
      errorRate: 0,
      consecutiveFailures: 0,
      freshest: false,
    },
  ],
  healthyCount: 2,
  totalCount: 2,
};

const EXPLORER_URL = "https://explorer.solana.com/tx/REALSIG?cluster=devnet";
const ROOT_PDA = "DaiLyScoresRootsPdaXXXXXXXXXXXXXXXXXXXXXXXXX";
const PROGRAM_ID = "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J";

/** A deterministic real-fixture replay result with on-chain proof. */
function fakeReplayResult(fixtureId = 17588395): ReplayResult {
  const position: Position = {
    edge: {
      fixtureId,
      predicate: { kind: "single", statKey: 1, period: 0, op: ">", threshold: 0 },
      stakeLamports: 1_000_000n,
      priceBps: 18_000,
      claimedAtMs: 0,
    },
    status: "won",
  };
  return {
    fixtureId,
    positions: [position],
    settlements: [
      {
        holds: true,
        source: "onchain",
        signature: "REALSIG",
        explorerUrl: EXPLORER_URL,
        rootPda: ROOT_PDA,
        programId: PROGRAM_ID,
        verifiedOnChain: true,
      },
    ],
    pnlLamports: 800_000n,
    onchain: {
      subscribeExplorer: EXPLORER_URL,
      dailyScoresRootsPda: ROOT_PDA,
      programId: PROGRAM_ID,
      verdictSource: "onchain-recorded",
    },
  };
}

function makeApp(overrides?: {
  repo?: InMemoryRepository;
  health?: () => Promise<HealthSnapshotDTO>;
  runReplay?: (fixtureId?: number) => Promise<ReplayResult>;
}): { app: ReturnType<typeof createApp>; repo: InMemoryRepository } {
  const repo = overrides?.repo ?? new InMemoryRepository();
  const app = createApp({
    repo,
    health: overrides?.health ?? (async () => healthySnapshot),
    runReplay: overrides?.runReplay ?? (async (fixtureId) => fakeReplayResult(fixtureId)),
  });
  return { app, repo };
}

describe("GET /", () => {
  it("returns a JSON route index", async () => {
    const { app } = makeApp();
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; routes: string[] };
    expect(body.name).toBe("@clearline/api");
    expect(body.routes).toContain("POST /api/demo-replay");
  });
});

describe("GET /api/health", () => {
  it("returns ok + the RPC health snapshot", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; rpc: HealthSnapshotDTO };
    expect(body.ok).toBe(true);
    expect(body.rpc.healthyCount).toBe(2);
    expect(body.rpc.endpoints[0]?.name).toBe("primary");
  });

  it("reports ok=false when no endpoint is healthy", async () => {
    const { app } = makeApp({
      health: async () => ({ endpoints: [], healthyCount: 0, totalCount: 0 }),
    });
    const res = await app.request("/api/health");
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });
});

describe("GET /api/agent/status", () => {
  it("is idle with no last replay before any run", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/agent/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; lastReplay: unknown };
    expect(body.state).toBe("idle");
    expect(body.lastReplay).toBeNull();
  });

  it("summarizes the last replay after one runs", async () => {
    const { app } = makeApp();
    await app.request("/api/demo-replay", { method: "POST" });
    const res = await app.request("/api/agent/status");
    const body = (await res.json()) as {
      state: string;
      lastReplay: { fixtureId: number; pnlLamports: string; explorerUrl: string };
    };
    expect(body.lastReplay.fixtureId).toBe(17588395);
    expect(body.lastReplay.pnlLamports).toBe("800000");
    expect(body.lastReplay.explorerUrl).toBe(EXPLORER_URL);
  });
});

describe("list endpoints", () => {
  it("return empty collections before any replay", async () => {
    const { app } = makeApp();
    const positions = (await (await app.request("/api/positions")).json()) as {
      positions: unknown[];
    };
    const settlements = (await (await app.request("/api/settlements")).json()) as {
      settlements: unknown[];
    };
    const edges = (await (await app.request("/api/edges")).json()) as { edges: unknown[] };
    expect(positions.positions).toEqual([]);
    expect(settlements.settlements).toEqual([]);
    expect(edges.edges).toEqual([]);
  });
});

describe("POST /api/demo-replay", () => {
  it("persists positions+settlements and returns the verdict + Explorer link", async () => {
    const { app, repo } = makeApp();
    const res = await app.request("/api/demo-replay", { method: "POST" });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      fixtureId: number;
      pnlLamports: string;
      positions: Array<{ stakeLamports: string; status: string }>;
      settlements: Array<{ holds: boolean; explorerUrl: string | null }>;
      onchain: { subscribeExplorer: string; verdictSource: string } | null;
    };

    // bigints serialized as strings
    expect(body.pnlLamports).toBe("800000");
    expect(body.positions[0]?.stakeLamports).toBe("1000000");
    expect(body.positions[0]?.status).toBe("won");

    // verdict + Explorer link
    expect(body.settlements[0]?.holds).toBe(true);
    expect(body.settlements[0]?.explorerUrl).toBe(EXPLORER_URL);
    expect(body.onchain?.subscribeExplorer).toBe(EXPLORER_URL);
    expect(body.onchain?.verdictSource).toBe("onchain-recorded");

    // persisted to the repo
    const positions = await repo.listPositions();
    const settlements = await repo.listSettlements();
    expect(positions).toHaveLength(1);
    expect(positions[0]?.pnlLamports).toBe("800000");
    expect(settlements).toHaveLength(1);
    expect(settlements[0]?.explorerUrl).toBe(EXPLORER_URL);

    // surfaced through the read endpoints
    const edges = (await (await app.request("/api/edges")).json()) as {
      edges: Array<{ fixtureId: number; priceBps: number }>;
    };
    expect(edges.edges[0]?.fixtureId).toBe(17588395);
    expect(edges.edges[0]?.priceBps).toBe(18_000);
  });

  it("is idempotent — re-running does not duplicate rows", async () => {
    const { app, repo } = makeApp();
    await app.request("/api/demo-replay", { method: "POST" });
    await app.request("/api/demo-replay", { method: "POST" });
    expect(await repo.listPositions()).toHaveLength(1);
    expect(await repo.listSettlements()).toHaveLength(1);
  });

  it("accepts an explicit fixtureId in the body", async () => {
    const seen: Array<number | undefined> = [];
    const { app } = makeApp({
      runReplay: async (fixtureId) => {
        seen.push(fixtureId);
        return fakeReplayResult(fixtureId ?? 17588395);
      },
    });
    const res = await app.request("/api/demo-replay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixtureId: 900001 }),
    });
    expect(res.status).toBe(200);
    expect(seen).toEqual([900001]);
  });

  it("returns 400 on a Zod-validation failure", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/demo-replay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixtureId: -5 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("bad-request");
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it("returns 400 on malformed JSON", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/demo-replay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown body field (strict schema)", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/demo-replay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bogus: 1 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/events (SSE)", () => {
  it("emits stored events then a heartbeat", async () => {
    const { app, repo } = makeApp();
    await repo.appendEvent({ ts: 111, kind: "replay.done", data: { fixtureId: 17588395 } });

    const res = await app.request("/api/events");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    expect(text).toContain("event: replay.done");
    expect(text).toContain("17588395");
    expect(text).toContain("event: heartbeat");
  });

  it("replays an event appended by a prior demo-replay", async () => {
    const { app } = makeApp();
    await app.request("/api/demo-replay", { method: "POST" });
    const res = await app.request("/api/events");
    const text = await res.text();
    expect(text).toContain("event: replay.done");
    expect(text).toContain(EXPLORER_URL);
  });
});
