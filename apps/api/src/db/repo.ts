/**
 * The persistence boundary for the ClearLine API (§7 Phase 6).
 *
 * Handlers depend on the {@link Repository} interface — never on Drizzle/D1
 * directly — so they can be unit-tested with {@link InMemoryRepository} and no
 * miniflare. {@link D1Repository} is the production binding over `drizzle-orm/d1`.
 *
 * BIGINT AT THE BOUNDARY (§4): money is `bigint` in the domain but is serialized
 * as a decimal **string** in every DTO that leaves this module, so it survives JSON
 * and the SQLite text columns without floating-point. Callers convert back to
 * `bigint` only when they need arithmetic.
 */
import type { Position } from "@clearline/core";
import type { Predicate } from "@clearline/core";
import type { SettlementOutcome } from "@clearline/agent";
import { drizzle } from "drizzle-orm/d1";
import { asc, eq } from "drizzle-orm";

import { events, positions, settlements } from "./schema";

/** A persisted position, money rendered as decimal strings (bigint-safe). */
export interface PositionDTO {
  readonly id: string;
  readonly fixtureId: number;
  readonly predicate: Predicate;
  readonly stakeLamports: string;
  readonly priceBps: number;
  readonly status: Position["status"];
  readonly pnlLamports: string;
  readonly claimedAtMs: number;
}

/** A persisted settlement verdict + provenance (on-chain fields optional). */
export interface SettlementDTO {
  readonly id: string;
  readonly positionId: string;
  readonly holds: boolean;
  readonly source: SettlementOutcome["source"];
  readonly signature: string | null;
  readonly explorerUrl: string | null;
  readonly rootPda: string | null;
  readonly programId: string | null;
  /** Trustless provenance: "onchain-live" | "onchain-recorded" | null (local). */
  readonly path: string | null;
  /** Whether the verdict was verified against the on-chain root (null when unknown). */
  readonly verifiedOnChain: boolean | null;
  readonly createdAtMs: number;
}

/** An event for the SSE live panel. `id` is the monotonic store sequence. */
export interface EventDTO {
  readonly id: number;
  readonly ts: number;
  readonly kind: string;
  readonly data: unknown;
}

/** Input for {@link Repository.savePosition} — money as decimal strings. */
export interface SavePositionInput {
  readonly id: string;
  readonly fixtureId: number;
  readonly predicate: Predicate;
  readonly stakeLamports: string;
  readonly priceBps: number;
  readonly status: Position["status"];
  readonly pnlLamports: string;
  readonly claimedAtMs: number;
}

/** Input for {@link Repository.saveSettlement}. */
export interface SaveSettlementInput {
  readonly id: string;
  readonly positionId: string;
  readonly holds: boolean;
  readonly source: SettlementOutcome["source"];
  readonly signature?: string | undefined;
  readonly explorerUrl?: string | undefined;
  readonly rootPda?: string | undefined;
  readonly programId?: string | undefined;
  /** Trustless provenance: "onchain-live" | "onchain-recorded" (omit for local). */
  readonly path?: string | undefined;
  /** Whether the verdict was verified against the on-chain root. */
  readonly verifiedOnChain?: boolean | undefined;
  readonly createdAtMs: number;
}

/** Input for {@link Repository.appendEvent}. */
export interface AppendEventInput {
  readonly ts: number;
  readonly kind: string;
  readonly data: unknown;
}

/** Coarse agent lifecycle state for `GET /api/agent/status`. */
export type AgentState = "idle" | "running";

/** Summary of the most recent replay, surfaced by `agentStatus`. */
export interface LastReplaySummary {
  readonly fixtureId: number;
  readonly positions: number;
  readonly settlements: number;
  readonly pnlLamports: string;
  readonly verdictSource: string | null;
  readonly explorerUrl: string | null;
  readonly at: number;
}

/** Agent status DTO for the dashboard. */
export interface AgentStatusDTO {
  readonly state: AgentState;
  readonly lastReplay: LastReplaySummary | null;
}

/**
 * The persistence contract used by the route handlers. Every method is async so
 * the D1 implementation and the in-memory fake share one shape.
 */
export interface Repository {
  /** Upsert a position by id (idempotent for replay re-runs). */
  savePosition(input: SavePositionInput): Promise<void>;
  /** Upsert a settlement by id (idempotent for replay re-runs). */
  saveSettlement(input: SaveSettlementInput): Promise<void>;
  /** All positions, most-recently-claimed first. */
  listPositions(): Promise<PositionDTO[]>;
  /** All settlements, newest first. */
  listSettlements(): Promise<SettlementDTO[]>;
  /** Append an event to the live log; returns the assigned sequence id. */
  appendEvent(input: AppendEventInput): Promise<number>;
  /** All stored events in ascending sequence order (for SSE replay). */
  listEvents(): Promise<EventDTO[]>;
  /** Coarse agent status derived from the latest persisted replay. */
  agentStatus(): Promise<AgentStatusDTO>;
}

/** Parse a stored `predicateJson` back to a typed {@link Predicate}. */
function parsePredicate(json: string): Predicate {
  // The value was serialized by us from a core `Predicate`; trust the round-trip.
  return JSON.parse(json) as Predicate;
}

/** Parse a stored event `dataJson` back to `unknown` (never `any`). */
function parseEventData(json: string): unknown {
  return JSON.parse(json) as unknown;
}

/**
 * Production repository over a D1 binding via `drizzle-orm/d1`. SQLite has no
 * upsert sugar in Drizzle's typed builder for every column, so writes use
 * `onConflictDoUpdate` keyed on the primary id to stay idempotent.
 */
export class D1Repository implements Repository {
  readonly #db: ReturnType<typeof drizzle>;

  constructor(d1: D1Database) {
    this.#db = drizzle(d1);
  }

  async savePosition(input: SavePositionInput): Promise<void> {
    const row = {
      id: input.id,
      fixtureId: input.fixtureId,
      predicateJson: JSON.stringify(input.predicate),
      stakeLamports: input.stakeLamports,
      priceBps: input.priceBps,
      status: input.status,
      pnlLamports: input.pnlLamports,
      claimedAtMs: input.claimedAtMs,
    };
    await this.#db
      .insert(positions)
      .values(row)
      .onConflictDoUpdate({
        target: positions.id,
        set: {
          fixtureId: row.fixtureId,
          predicateJson: row.predicateJson,
          stakeLamports: row.stakeLamports,
          priceBps: row.priceBps,
          status: row.status,
          pnlLamports: row.pnlLamports,
          claimedAtMs: row.claimedAtMs,
        },
      });
  }

  async saveSettlement(input: SaveSettlementInput): Promise<void> {
    const row = {
      id: input.id,
      positionId: input.positionId,
      holds: input.holds ? 1 : 0,
      source: input.source,
      signature: input.signature ?? null,
      explorerUrl: input.explorerUrl ?? null,
      rootPda: input.rootPda ?? null,
      programId: input.programId ?? null,
      path: input.path ?? null,
      verifiedOnChain: input.verifiedOnChain === undefined ? null : input.verifiedOnChain ? 1 : 0,
      createdAtMs: input.createdAtMs,
    };
    await this.#db
      .insert(settlements)
      .values(row)
      .onConflictDoUpdate({
        target: settlements.id,
        set: {
          positionId: row.positionId,
          holds: row.holds,
          source: row.source,
          signature: row.signature,
          explorerUrl: row.explorerUrl,
          rootPda: row.rootPda,
          programId: row.programId,
          path: row.path,
          verifiedOnChain: row.verifiedOnChain,
          createdAtMs: row.createdAtMs,
        },
      });
  }

  async listPositions(): Promise<PositionDTO[]> {
    const rows = await this.#db.select().from(positions);
    return rows
      .map((r) => ({
        id: r.id,
        fixtureId: r.fixtureId,
        predicate: parsePredicate(r.predicateJson),
        stakeLamports: r.stakeLamports,
        priceBps: r.priceBps,
        status: r.status as Position["status"],
        pnlLamports: r.pnlLamports,
        claimedAtMs: r.claimedAtMs,
      }))
      .sort((a, b) => b.claimedAtMs - a.claimedAtMs);
  }

  async listSettlements(): Promise<SettlementDTO[]> {
    const rows = await this.#db.select().from(settlements);
    return rows
      .map((r) => ({
        id: r.id,
        positionId: r.positionId,
        holds: r.holds !== 0,
        source: r.source as SettlementOutcome["source"],
        signature: r.signature,
        explorerUrl: r.explorerUrl,
        rootPda: r.rootPda,
        programId: r.programId,
        path: r.path,
        verifiedOnChain: r.verifiedOnChain === null ? null : r.verifiedOnChain !== 0,
        createdAtMs: r.createdAtMs,
      }))
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
  }

  async appendEvent(input: AppendEventInput): Promise<number> {
    const inserted = await this.#db
      .insert(events)
      .values({ ts: input.ts, kind: input.kind, dataJson: JSON.stringify(input.data) })
      .returning({ id: events.id });
    return inserted[0]?.id ?? 0;
  }

  async listEvents(): Promise<EventDTO[]> {
    const rows = await this.#db.select().from(events).orderBy(asc(events.id));
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      kind: r.kind,
      data: parseEventData(r.dataJson),
    }));
  }

  async agentStatus(): Promise<AgentStatusDTO> {
    const settlementRows = await this.#db.select().from(settlements);
    if (settlementRows.length === 0) {
      return { state: "idle", lastReplay: null };
    }
    const latest = settlementRows.reduce((acc, r) => (r.createdAtMs > acc.createdAtMs ? r : acc));
    const positionRows = await this.#db
      .select()
      .from(positions)
      .where(eq(positions.id, latest.positionId));
    const pos = positionRows[0];
    const pnlLamports = pos?.pnlLamports ?? "0";
    const fixtureId = pos?.fixtureId ?? 0;

    return {
      state: "idle",
      lastReplay: {
        fixtureId,
        positions: positionRows.length,
        settlements: settlementRows.length,
        pnlLamports,
        // Honest provenance: the stored path ("onchain-live"/"onchain-recorded") when
        // known, else the generic source — never mislabel a live verdict as recorded.
        verdictSource: latest.path ?? latest.source,
        explorerUrl: latest.explorerUrl,
        at: latest.createdAtMs,
      },
    };
  }
}

/** A persisted in-memory shape mirroring the SQLite row (money as strings). */
type MemPosition = SavePositionInput;
interface MemSettlement {
  readonly id: string;
  readonly positionId: string;
  readonly holds: boolean;
  readonly source: SettlementOutcome["source"];
  readonly signature: string | null;
  readonly explorerUrl: string | null;
  readonly rootPda: string | null;
  readonly programId: string | null;
  readonly path: string | null;
  readonly verifiedOnChain: boolean | null;
  readonly createdAtMs: number;
}

/**
 * In-memory repository for tests and local handler runs. Same semantics as
 * {@link D1Repository}: idempotent upserts by id, money as decimal strings, events
 * assigned a monotonic sequence.
 */
export class InMemoryRepository implements Repository {
  readonly #positions = new Map<string, MemPosition>();
  readonly #settlements = new Map<string, MemSettlement>();
  readonly #events: EventDTO[] = [];
  #eventSeq = 0;

  async savePosition(input: SavePositionInput): Promise<void> {
    this.#positions.set(input.id, { ...input });
  }

  async saveSettlement(input: SaveSettlementInput): Promise<void> {
    this.#settlements.set(input.id, {
      id: input.id,
      positionId: input.positionId,
      holds: input.holds,
      source: input.source,
      signature: input.signature ?? null,
      explorerUrl: input.explorerUrl ?? null,
      rootPda: input.rootPda ?? null,
      programId: input.programId ?? null,
      path: input.path ?? null,
      verifiedOnChain: input.verifiedOnChain ?? null,
      createdAtMs: input.createdAtMs,
    });
  }

  async listPositions(): Promise<PositionDTO[]> {
    return [...this.#positions.values()]
      .map((p) => ({
        id: p.id,
        fixtureId: p.fixtureId,
        predicate: p.predicate,
        stakeLamports: p.stakeLamports,
        priceBps: p.priceBps,
        status: p.status,
        pnlLamports: p.pnlLamports,
        claimedAtMs: p.claimedAtMs,
      }))
      .sort((a, b) => b.claimedAtMs - a.claimedAtMs);
  }

  async listSettlements(): Promise<SettlementDTO[]> {
    return [...this.#settlements.values()]
      .map((s) => ({ ...s }))
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
  }

  async appendEvent(input: AppendEventInput): Promise<number> {
    const id = ++this.#eventSeq;
    this.#events.push({ id, ts: input.ts, kind: input.kind, data: input.data });
    return id;
  }

  async listEvents(): Promise<EventDTO[]> {
    return [...this.#events].sort((a, b) => a.id - b.id);
  }

  async agentStatus(): Promise<AgentStatusDTO> {
    const settlementList = [...this.#settlements.values()];
    if (settlementList.length === 0) {
      return { state: "idle", lastReplay: null };
    }
    const latest = settlementList.reduce((acc, s) => (s.createdAtMs > acc.createdAtMs ? s : acc));
    const pos = this.#positions.get(latest.positionId);
    return {
      state: "idle",
      lastReplay: {
        fixtureId: pos?.fixtureId ?? 0,
        positions: this.#positions.size,
        settlements: settlementList.length,
        pnlLamports: pos?.pnlLamports ?? "0",
        verdictSource: latest.path ?? latest.source,
        explorerUrl: latest.explorerUrl,
        at: latest.createdAtMs,
      },
    };
  }
}
