/**
 * The Cloudflare Worker entry for `@clearline/api` (§7 Phase 6, ADR-0002).
 *
 * Wires the production dependencies into {@link createApp}:
 *  - `D1Repository(env.DB)` over the `DB` binding,
 *  - a `health` closure that builds a resilient chain pool from the injected env
 *    and maps `pool.health()` to the dashboard DTO — TOLERATING RPC errors by
 *    returning an empty/unhealthy snapshot rather than throwing,
 *  - `runReplay = runDemoReplay` (on-demand; the Cron/Durable-Object loop is a
 *    later enhancement per ADR-0002).
 *
 * Secrets never reach logs: the chain config reads only RPC URLs from `env`, and
 * the health closure swallows errors without echoing the env.
 */
import { runDemoReplay, REAL_FIXTURE_ID } from "@clearline/agent";
import type { ReplayResult } from "@clearline/agent";
import { createChainPool, loadChainConfig, toHealthSnapshot } from "@clearline/chain";
import type { HealthSnapshotDTO } from "@clearline/chain";

import { AgentLoop, loopStub } from "./agentLoop";
import { D1Repository } from "./db/repo";
import { createApp } from "./routes";

export { AgentLoop };

/**
 * The Worker environment bindings. `DB` is the D1 database; the optional
 * `SOLANA_RPC_*` / `SOLANA_CLUSTER` vars configure the resilient RPC pool (devnet
 * only — see `loadChainConfig`).
 */
export interface Env {
  readonly DB: D1Database;
  /** The autonomous-loop Durable Object namespace (§7 Phase 5, ADR-0002). */
  readonly AGENT_LOOP: DurableObjectNamespace;
  readonly SOLANA_RPC_PRIMARY?: string;
  readonly SOLANA_RPC_BACKUP_1?: string;
  readonly SOLANA_RPC_BACKUP_2?: string;
  readonly SOLANA_CLUSTER?: string;
}

/** An empty/unhealthy snapshot returned when RPC health cannot be obtained. */
const UNHEALTHY_SNAPSHOT: HealthSnapshotDTO = {
  endpoints: [],
  healthyCount: 0,
  totalCount: 0,
};

/**
 * Build a `health()` closure over the env. It constructs a chain pool and reads a
 * one-shot `pool.health()` snapshot. Any failure (bad config, RPC unreachable) is
 * tolerated: it returns {@link UNHEALTHY_SNAPSHOT} and never throws, so the
 * dashboard's health panel degrades gracefully instead of 500-ing.
 */
function makeHealth(env: Env): () => Promise<HealthSnapshotDTO> {
  return async () => {
    try {
      const config = loadChainConfig({
        SOLANA_RPC_PRIMARY: env.SOLANA_RPC_PRIMARY,
        SOLANA_RPC_BACKUP_1: env.SOLANA_RPC_BACKUP_1,
        SOLANA_RPC_BACKUP_2: env.SOLANA_RPC_BACKUP_2,
        SOLANA_CLUSTER: env.SOLANA_CLUSTER,
      });
      const pool = createChainPool(config);
      // Probe once so the HealthMonitor records live slot/latency before we
      // snapshot it (freshness-aware routing probes endpoints on a request).
      try {
        await pool.rpc().getSlot().send();
      } catch {
        // A probe failure still yields a meaningful (unhealthy) snapshot below.
      }
      return toHealthSnapshot(pool.health());
    } catch (err) {
      // Do NOT echo the env or any secret; log a terse marker only.
      console.warn("health.unavailable", { reason: err instanceof Error ? err.name : "unknown" });
      return UNHEALTHY_SNAPSHOT;
    }
  };
}

/** On-demand replay runner. Defaults to the REAL recorded fixture (ADR-0005). */
function runReplay(fixtureId?: number): Promise<ReplayResult> {
  return runDemoReplay(fixtureId ?? REAL_FIXTURE_ID);
}

export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    // The autonomous-loop control surface is served by the Durable Object directly,
    // so the injected Hono app (routes.ts) stays DO-free and unit-testable with fakes.
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/agent/loop")) {
      return loopStub(env.AGENT_LOOP).fetch(request);
    }
    const app = createApp({
      repo: new D1Repository(env.DB),
      health: makeHealth(env),
      runReplay,
    });
    return app.fetch(request);
  },

  /**
   * Cron Trigger (§6, ADR-0002): keep the autonomous loop alive. Each tick kicks the
   * loop DO — starting a fresh run when idle/done and re-arming a stalled alarm — so the
   * agent runs ingest→decide→open→settle on a schedule with no manual HTTP trigger.
   */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const stub = loopStub(env.AGENT_LOOP);
    await stub.fetch("https://agent-loop/api/agent/loop/cron");
  },
};
