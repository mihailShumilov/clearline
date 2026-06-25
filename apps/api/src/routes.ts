/**
 * The ClearLine API surface — a Hono app built from injected dependencies so the
 * handlers are unit-testable with fakes and no miniflare/D1 (§7 Phase 6).
 *
 * All I/O is JSON, validated with Zod at the boundary (`unknown` → parsed). Money
 * is `bigint` in the domain and is always serialized as a decimal **string** (§4).
 * CORS is enabled for the dashboard; typed failures map to proper status codes.
 */
import type { Position } from "@clearline/core";
import type { ReplayResult, SettlementOutcome } from "@clearline/agent";
import type { HealthSnapshotDTO } from "@clearline/chain";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import type { Repository } from "./db/repo";

/** Everything the app needs, injected (so tests pass fakes). */
export interface AppDeps {
  readonly repo: Repository;
  /** Builds the RPC Health snapshot; must never throw (tolerate RPC errors). */
  readonly health: () => Promise<HealthSnapshotDTO>;
  /** Runs a deterministic replay; defaults to the real fixture when no id given. */
  readonly runReplay: (fixtureId?: number) => Promise<ReplayResult>;
}

/** Request body for `POST /api/demo-replay` — an optional fixture id. */
const DemoReplayBodySchema = z
  .object({ fixtureId: z.number().int().positive().optional() })
  .strict();

/** A position serialized for JSON (money as decimal strings). */
interface PositionJSON {
  readonly fixtureId: number;
  readonly predicate: Position["edge"]["predicate"];
  readonly stakeLamports: string;
  readonly priceBps: number;
  readonly claimedAtMs: number;
  readonly status: Position["status"];
}

/** A settlement outcome serialized for JSON (on-chain fields optional). */
interface SettlementJSON {
  readonly holds: boolean;
  readonly source: SettlementOutcome["source"];
  readonly signature: string | null;
  readonly explorerUrl: string | null;
  readonly rootPda: string | null;
  readonly programId: string | null;
  readonly verifiedOnChain: boolean;
}

/** A {@link ReplayResult} serialized for JSON — `pnlLamports` + stakes as strings. */
interface ReplayResultJSON {
  readonly fixtureId: number;
  readonly positions: PositionJSON[];
  readonly settlements: SettlementJSON[];
  readonly pnlLamports: string;
  readonly onchain: ReplayResult["onchain"] | null;
}

/** Serialize a core {@link Position} to its JSON DTO (bigint → string). */
function positionToJSON(position: Position): PositionJSON {
  return {
    fixtureId: position.edge.fixtureId,
    predicate: position.edge.predicate,
    stakeLamports: position.edge.stakeLamports.toString(),
    priceBps: position.edge.priceBps,
    claimedAtMs: position.edge.claimedAtMs,
    status: position.status,
  };
}

/** Serialize a {@link SettlementOutcome} to its JSON DTO. */
function settlementToJSON(outcome: SettlementOutcome): SettlementJSON {
  return {
    holds: outcome.holds,
    source: outcome.source,
    signature: outcome.signature ?? null,
    explorerUrl: outcome.explorerUrl ?? null,
    rootPda: outcome.rootPda ?? null,
    programId: outcome.programId ?? null,
    verifiedOnChain: outcome.verifiedOnChain ?? false,
  };
}

/** Serialize a whole {@link ReplayResult} (incl. the on-chain proof evidence). */
function replayResultToJSON(result: ReplayResult): ReplayResultJSON {
  return {
    fixtureId: result.fixtureId,
    positions: result.positions.map(positionToJSON),
    settlements: result.settlements.map(settlementToJSON),
    pnlLamports: result.pnlLamports.toString(),
    onchain: result.onchain ?? null,
  };
}

/**
 * Persist a replay result to the repo, idempotently. The replay uses a single
 * stable position id per fixture (`fixture:<id>`), so re-running a replay upserts
 * the same rows rather than duplicating them. Each position pairs with at most one
 * settlement (id `settle:<fixtureId>:<index>`). Persistence also appends an event
 * to the live log.
 */
async function persistReplay(repo: Repository, result: ReplayResult): Promise<void> {
  const now = Date.now();

  for (const position of result.positions) {
    const id = `fixture:${position.edge.fixtureId}`;
    await repo.savePosition({
      id,
      fixtureId: position.edge.fixtureId,
      predicate: position.edge.predicate,
      stakeLamports: position.edge.stakeLamports.toString(),
      priceBps: position.edge.priceBps,
      status: position.status,
      pnlLamports: result.pnlLamports.toString(),
      claimedAtMs: position.edge.claimedAtMs,
    });
  }

  for (let index = 0; index < result.settlements.length; index += 1) {
    const outcome = result.settlements[index];
    if (outcome === undefined) continue;
    await repo.saveSettlement({
      id: `settle:${result.fixtureId}:${index}`,
      positionId: `fixture:${result.fixtureId}`,
      holds: outcome.holds,
      source: outcome.source,
      signature: outcome.signature,
      explorerUrl: outcome.explorerUrl,
      rootPda: outcome.rootPda,
      programId: outcome.programId,
      createdAtMs: now,
    });
  }

  await repo.appendEvent({
    ts: now,
    kind: "replay.done",
    data: {
      fixtureId: result.fixtureId,
      positions: result.positions.length,
      settlements: result.settlements.length,
      pnlLamports: result.pnlLamports.toString(),
      explorerUrl: result.onchain?.subscribeExplorer ?? null,
    },
  });
}

/** The route table, surfaced at `GET /`. */
const ROUTES = [
  "GET /api/health",
  "GET /api/agent/status",
  "GET /api/positions",
  "GET /api/settlements",
  "GET /api/edges",
  "POST /api/demo-replay",
  "GET /api/events",
] as const;

/**
 * Build the Hono app. `deps` is injected so the same app is exercised by the
 * Worker entry (real D1 + chain pool) and by Vitest (in-memory fakes).
 */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.use("*", cors());

  app.onError((err, c) => {
    // Never leak internals/secrets: log the message, return a typed 500.
    console.error("api.error", { message: err.message });
    return c.json({ error: "internal", message: "internal server error" }, 500);
  });

  app.get("/", (c) => c.json({ name: "@clearline/api", routes: ROUTES }));

  app.get("/api/health", async (c) => {
    const rpc = await deps.health();
    return c.json({ ok: rpc.healthyCount > 0, rpc });
  });

  app.get("/api/agent/status", async (c) => {
    const status = await deps.repo.agentStatus();
    return c.json(status);
  });

  app.get("/api/positions", async (c) => {
    const positions = await deps.repo.listPositions();
    return c.json({ positions });
  });

  app.get("/api/settlements", async (c) => {
    const settlements = await deps.repo.listSettlements();
    return c.json({ settlements });
  });

  // An "edge" is the staked predicate of a position; surfaced as its own view for
  // the dashboard's edges table (§7 Phase 7).
  app.get("/api/edges", async (c) => {
    const positions = await deps.repo.listPositions();
    const edges = positions.map((p) => ({
      id: p.id,
      fixtureId: p.fixtureId,
      predicate: p.predicate,
      stakeLamports: p.stakeLamports,
      priceBps: p.priceBps,
      claimedAtMs: p.claimedAtMs,
      status: p.status,
    }));
    return c.json({ edges });
  });

  app.post("/api/demo-replay", async (c) => {
    // Validate the (optional) body at the boundary: `unknown` → Zod. A malformed
    // body is a typed 400.
    let raw: unknown = {};
    try {
      const text = await c.req.text();
      if (text.trim() !== "") {
        raw = JSON.parse(text) as unknown;
      }
    } catch {
      return c.json({ error: "bad-request", message: "request body must be valid JSON" }, 400);
    }

    const parsed = DemoReplayBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          error: "bad-request",
          message: "invalid demo-replay body",
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        400,
      );
    }

    const result = await deps.runReplay(parsed.data.fixtureId);
    await persistReplay(deps.repo, result);
    return c.json(replayResultToJSON(result));
  });

  // SSE: replay every stored event, then a final heartbeat, so the dashboard's
  // live panel can hydrate. (The Cron/Durable-Object live tail is a later phase —
  // ADR-0002; this phase serves the persisted log + a heartbeat.)
  app.get("/api/events", (c) => {
    return streamSSE(c, async (stream) => {
      const stored = await deps.repo.listEvents();
      for (const event of stored) {
        await stream.writeSSE({
          id: String(event.id),
          event: event.kind,
          data: JSON.stringify({ ts: event.ts, kind: event.kind, data: event.data }),
        });
      }
      await stream.writeSSE({
        event: "heartbeat",
        data: JSON.stringify({ ts: Date.now() }),
      });
    });
  });

  return app;
}
