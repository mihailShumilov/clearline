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

import { D1Repository } from "./db/repo";
import { createApp } from "./routes";

/**
 * The Worker environment bindings. `DB` is the D1 database; the optional
 * `SOLANA_RPC_*` / `SOLANA_CLUSTER` vars configure the resilient RPC pool (devnet
 * only — see `loadChainConfig`).
 */
export interface Env {
  readonly DB: D1Database;
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
    const app = createApp({
      repo: new D1Repository(env.DB),
      health: makeHealth(env),
      runReplay,
    });
    return app.fetch(request);
  },
};
