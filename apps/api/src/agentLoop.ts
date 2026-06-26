/**
 * Autonomous agent loop (§6, §7 Phase 5, ADR-0002 / ADR-0009).
 *
 * A Durable Object whose alarm drives the agent pipeline — ingest → decide → open →
 * settle — over the bundled real World-Cup fixture, on a cadence, with NO manual HTTP
 * trigger. A Cron Trigger keeps the loop alive (kicks a fresh run when idle and re-arms a
 * stalled alarm). Settlement is the LIVE trustless on-chain verdict (Task 1's
 * `OnChainSettlementProvider`, read-only `validate_stat` simulate through `@clearline/chain`).
 * Persistence is D1 via the same {@link Repository} the API reads, so the dashboard reflects
 * the loop's positions/settlements/events. Idempotent: one position per fixture, re-runs
 * upsert rather than duplicate.
 *
 * The phase machine lives in the pure-ish {@link stepLoop} so it is unit-testable with an
 * in-memory repo + a stub pool (no miniflare); the DO is a thin storage/alarm wrapper.
 */
import { createChainPool, loadChainConfig } from "@clearline/chain";
import type { ChainPool } from "@clearline/chain";
import {
  REAL_FIXTURE_ID,
  SettlementError,
  consoleLogger,
  loadRealDemoFixture,
  realTruePredicate,
  settleRealFixtureBestEffort,
} from "@clearline/agent";
import type { Logger } from "@clearline/agent";
import { makeEdge, settle as settleCore } from "@clearline/core";
import type { Position } from "@clearline/core";

import { D1Repository } from "./db/repo";
import type { Repository } from "./db/repo";

/** Deterministic stake/price for the loop's position (mirrors the demo replay). */
const STAKE_LAMPORTS = 1_000_000n;
const PRICE_BPS = 18_000;

/** Default cadence between alarm ticks (the free tier has a 60s delay; 5s suffices locally). */
export const DEFAULT_INTERVAL_MS = 5_000;
/** Floor for the alarm cadence — a too-small/negative interval would hammer the loop. */
export const MIN_INTERVAL_MS = 500;
/** Number of "ingest" cadence ticks before opening (simulates snapshot polling). */
export const INGEST_TICKS = 2;

/** Clamp a requested cadence to a sane floor (rejects negative/NaN/too-fast values). */
export function clampIntervalMs(requested: number): number {
  return Number.isFinite(requested) && requested >= MIN_INTERVAL_MS
    ? Math.floor(requested)
    : DEFAULT_INTERVAL_MS;
}

/** The loop's phase. */
export type LoopPhase = "ingest" | "open" | "settle" | "done";

/** Serializable loop state, persisted in DO storage between alarms. */
export interface LoopState {
  readonly phase: LoopPhase;
  readonly tick: number;
  readonly intervalMs: number;
  readonly fixtureId: number;
  /** Set when the position is opened, so settle reuses a stable claim time. */
  readonly claimedAtMs?: number;
}

/** A fresh loop state at the start of a run. */
export function initialLoopState(intervalMs: number = DEFAULT_INTERVAL_MS): LoopState {
  return { phase: "ingest", tick: 0, intervalMs, fixtureId: REAL_FIXTURE_ID };
}

/** Dependencies for {@link stepLoop} — injected for testability + determinism. */
export interface LoopDeps {
  readonly repo: Repository;
  readonly pool: ChainPool;
  readonly logger: Logger;
  /** Injected clock (epoch ms). */
  readonly now: () => number;
}

const positionId = (fixtureId: number): string => `fixture:${fixtureId}`;

/**
 * Advance the loop one phase, performing that phase's side effects (persist / settle) and
 * returning the next state. Pure with respect to its injected deps; total — every phase is
 * handled. Idempotent at the persistence layer (upsert by id).
 */
export async function stepLoop(state: LoopState, deps: LoopDeps): Promise<LoopState> {
  const { repo, pool, logger, now } = deps;
  const fixture = loadRealDemoFixture();
  const predicate = realTruePredicate(fixture);

  switch (state.phase) {
    case "ingest": {
      const tick = state.tick + 1;
      logger.info("agent.tick", { phase: "ingest", tick, fixtureId: state.fixtureId });
      await repo.appendEvent({
        ts: now(),
        kind: "agent.ingest",
        data: { fixtureId: state.fixtureId, tick },
      });
      if (tick >= INGEST_TICKS) {
        return { ...state, phase: "open", tick };
      }
      return { ...state, tick };
    }

    case "open": {
      const claimedAtMs = now();
      const built = makeEdge({
        fixtureId: state.fixtureId,
        predicate,
        stakeLamports: STAKE_LAMPORTS,
        priceBps: PRICE_BPS,
        claimedAtMs,
      });
      if (!built.ok) {
        // Defensive: constant, valid inputs. Surface + stop rather than loop forever.
        logger.warn("agent.open.rejected", { fixtureId: state.fixtureId, code: built.error.code });
        return { ...state, phase: "done" };
      }
      await repo.savePosition({
        id: positionId(state.fixtureId),
        fixtureId: state.fixtureId,
        predicate,
        stakeLamports: STAKE_LAMPORTS.toString(),
        priceBps: PRICE_BPS,
        status: "open",
        pnlLamports: "0",
        claimedAtMs,
      });
      await repo.appendEvent({
        ts: now(),
        kind: "position.open",
        data: { fixtureId: state.fixtureId, predicate, stakeLamports: STAKE_LAMPORTS.toString() },
      });
      logger.info("position.open", { fixtureId: state.fixtureId, claimedAtMs });
      return { ...state, phase: "settle", claimedAtMs };
    }

    case "settle": {
      const claimedAtMs = state.claimedAtMs ?? now();
      // The trustless verdict: LIVE validate_stat simulate when the RPC is reachable, else
      // the recorded-and-reconciled on-chain verdict (verdict-mismatch always propagates).
      const { outcome, path } = await settleRealFixtureBestEffort(pool, predicate, logger);
      const opened: Position = {
        edge: {
          fixtureId: state.fixtureId,
          predicate,
          stakeLamports: STAKE_LAMPORTS,
          priceBps: PRICE_BPS,
          claimedAtMs,
        },
        status: "open",
      };
      const settled = settleCore(opened, outcome.holds);
      if (!settled.ok) {
        logger.warn("agent.settle.skipped", {
          fixtureId: state.fixtureId,
          code: settled.error.code,
        });
        return { ...state, phase: "done" };
      }
      await repo.savePosition({
        id: positionId(state.fixtureId),
        fixtureId: state.fixtureId,
        predicate,
        stakeLamports: STAKE_LAMPORTS.toString(),
        priceBps: PRICE_BPS,
        status: settled.outcome.status,
        pnlLamports: settled.outcome.pnlLamports.toString(),
        claimedAtMs,
      });
      await repo.saveSettlement({
        id: `settle:${state.fixtureId}:0`,
        positionId: positionId(state.fixtureId),
        holds: outcome.holds,
        source: outcome.source,
        signature: outcome.signature,
        explorerUrl: outcome.explorerUrl,
        rootPda: outcome.rootPda,
        programId: outcome.programId,
        path,
        verifiedOnChain: outcome.verifiedOnChain,
        createdAtMs: now(),
      });
      await repo.appendEvent({
        ts: now(),
        kind: "position.settle",
        data: {
          fixtureId: state.fixtureId,
          holds: outcome.holds,
          status: settled.outcome.status,
          pnlLamports: settled.outcome.pnlLamports.toString(),
          rootPda: outcome.rootPda,
          explorerUrl: outcome.explorerUrl,
          verifiedOnChain: outcome.verifiedOnChain ?? false,
          path,
        },
      });
      logger.info("position.settle", {
        fixtureId: state.fixtureId,
        holds: outcome.holds,
        status: settled.outcome.status,
        pnlLamports: settled.outcome.pnlLamports.toString(),
        verifiedOnChain: outcome.verifiedOnChain ?? false,
        path,
      });
      return { ...state, phase: "done" };
    }

    case "done": {
      logger.info("agent.idle", { fixtureId: state.fixtureId });
      return state;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Durable Object wrapper                                                      */
/* -------------------------------------------------------------------------- */

/** The slice of the Worker env the loop needs. */
export interface AgentLoopEnv {
  readonly DB: D1Database;
  readonly SOLANA_RPC_PRIMARY?: string;
  readonly SOLANA_RPC_BACKUP_1?: string;
  readonly SOLANA_RPC_BACKUP_2?: string;
  readonly SOLANA_CLUSTER?: string;
}

/** Structured JSON logger (bigint-safe, no secrets; §4). */
const jsonLogger: Logger = consoleLogger;

const STATE_KEY = "loop:state";

/**
 * The autonomous loop Durable Object. `fetch` exposes control (`/start`, `/cron`,
 * `/status`); `alarm` advances one phase and re-arms until `done`.
 */
export class AgentLoop {
  readonly #storage: DurableObjectState["storage"];
  readonly #env: AgentLoopEnv;

  constructor(state: DurableObjectState, env: AgentLoopEnv) {
    this.#storage = state.storage;
    this.#env = env;
  }

  #pool(): ChainPool {
    return createChainPool(
      loadChainConfig({
        SOLANA_RPC_PRIMARY: this.#env.SOLANA_RPC_PRIMARY,
        SOLANA_RPC_BACKUP_1: this.#env.SOLANA_RPC_BACKUP_1,
        SOLANA_RPC_BACKUP_2: this.#env.SOLANA_RPC_BACKUP_2,
        SOLANA_CLUSTER: this.#env.SOLANA_CLUSTER,
      }),
    );
  }

  async #begin(intervalMs: number): Promise<LoopState> {
    const state = initialLoopState(intervalMs);
    await this.#storage.put(STATE_KEY, state);
    await this.#storage.setAlarm(Date.now() + 1);
    jsonLogger.info("agent.start", { intervalMs, fixtureId: state.fixtureId });
    return state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/.*\/api\/agent\/loop/, "") || "/";

    if (path === "/start") {
      const intervalMs = clampIntervalMs(Number(url.searchParams.get("intervalMs")));
      const state = await this.#begin(intervalMs);
      return Response.json({ started: true, state });
    }

    if (path === "/cron") {
      // Keep the loop alive: start a fresh run when idle/done, else ensure an alarm exists.
      const state = (await this.#storage.get<LoopState>(STATE_KEY)) ?? null;
      if (state === null || state.phase === "done") {
        const fresh = await this.#begin(DEFAULT_INTERVAL_MS);
        return Response.json({ cron: "started", state: fresh });
      }
      if ((await this.#storage.getAlarm()) === null) {
        await this.#storage.setAlarm(Date.now() + 1);
        return Response.json({ cron: "rearmed", state });
      }
      return Response.json({ cron: "running", state });
    }

    if (path === "/status" || path === "/") {
      const state = (await this.#storage.get<LoopState>(STATE_KEY)) ?? null;
      return Response.json({ state });
    }

    return new Response("not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    const state = (await this.#storage.get<LoopState>(STATE_KEY)) ?? null;
    if (state === null || state.phase === "done") {
      return;
    }
    const deps: LoopDeps = {
      repo: new D1Repository(this.#env.DB),
      pool: this.#pool(),
      logger: jsonLogger,
      now: () => Date.now(),
    };
    let next: LoopState;
    try {
      next = await stepLoop(state, deps);
    } catch (err) {
      // A deterministic integrity failure (verdict-mismatch) will NOT fix on retry —
      // surface its typed code and terminate rather than hammering the loop forever.
      if (err instanceof SettlementError && err.code === "verdict-mismatch") {
        jsonLogger.error("agent.alarm.terminal", { phase: state.phase, code: err.code });
        await this.#storage.put(STATE_KEY, { ...state, phase: "done" });
        return;
      }
      // Otherwise treat as transient (e.g. an RPC blip): log + retry this phase.
      jsonLogger.error("agent.alarm.error", {
        phase: state.phase,
        code: err instanceof SettlementError ? err.code : undefined,
        name: err instanceof Error ? err.name : "unknown",
      });
      await this.#storage.setAlarm(Date.now() + state.intervalMs);
      return;
    }
    await this.#storage.put(STATE_KEY, next);
    if (next.phase !== "done") {
      await this.#storage.setAlarm(Date.now() + next.intervalMs);
    }
  }
}

/** Get the singleton loop DO stub. */
export function loopStub(namespace: DurableObjectNamespace): DurableObjectStub {
  return namespace.get(namespace.idFromName("singleton"));
}
