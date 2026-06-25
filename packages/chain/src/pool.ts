/**
 * createChainPool — the project's single RPC chokepoint (§11b).
 *
 * Builds a {@link ResilientRpcPool} over the configured devnet endpoints, wiring
 * a {@link HealthMonitor} (freshness-aware routing), an optional
 * {@link CreditRateLimiter}, a {@link Metrics} sink (default
 * {@link InMemoryMetrics}, or an injected `OtelMetrics`), and a
 * {@link LifecycleEmitter}. Everything else in the repo obtains its kit RPC from
 * the handle returned here — no bare `@solana/kit` RPC anywhere else.
 */
import { createDefaultRpcTransport, devnet } from "@solana/kit";
import type { Rpc, RpcTransport, SolanaRpcApi } from "@solana/kit";
import {
  HealthMonitor,
  InMemoryMetrics,
  LifecycleEmitter,
  ResilientRpcPool,
} from "solana-resilience-kit";
import type { CreditRateLimiter, EndpointHealth, Metrics } from "solana-resilience-kit";

import type { ChainConfig } from "./config";

/**
 * Default slot-lag tolerance for the {@link HealthMonitor}. Matches the kit's own
 * default (`150n`) — a devnet node more than ~150 slots (~60–90s) behind the
 * freshest peer is treated as stale and deprioritized.
 */
export const DEFAULT_MAX_SLOT_LAG = 150n;

/**
 * Optional rate-limiter knobs. Omit `deps.rateLimiter` entirely to disable
 * client-side credit metering (the public devnet endpoint has no documented
 * credit budget); supply one for shared/keyed providers that 429.
 */
export interface ChainPoolDeps {
  /**
   * Metrics sink. Defaults to {@link InMemoryMetrics} (for tests/local). Inject
   * an `OtelMetrics` instance for OpenTelemetry export.
   */
  metrics?: Metrics;
  /** Shared lifecycle event emitter. A fresh {@link LifecycleEmitter} by default. */
  events?: LifecycleEmitter;
  /** Optional weighted-credit rate limiter to pre-empt 429s. */
  rateLimiter?: CreditRateLimiter;
  /** Slot-lag threshold for the health monitor. Defaults to {@link DEFAULT_MAX_SLOT_LAG}. */
  maxSlotLag?: bigint;
  /**
   * Probe slots and route to the freshest healthy node first. Defaults to `true`
   * (the §11b freshness-routing story). Set `false` to use strict configured
   * order — useful for exercising the serve-path failover deterministically.
   */
  freshnessAware?: boolean;
  /**
   * Build the kit transport for an endpoint. Injected in tests to supply a
   * `MockEndpoint.transport`; defaults to {@link createDefaultRpcTransport} over
   * a `devnet()`-branded URL.
   */
  transportFor?: (endpoint: { name: string; url: string }) => RpcTransport;
}

/**
 * The typed pool handle handed to the rest of the repo. Intentionally narrow:
 * callers get a kit RPC, a health snapshot, and references to the shared metrics
 * and event streams — nothing more.
 */
export interface ChainPool {
  /** A ready-to-use kit RPC backed by the resilient failover transport. */
  rpc(): Rpc<SolanaRpcApi>;
  /** Current per-endpoint health snapshot (for the dashboard's RPC Health panel). */
  health(): EndpointHealth[];
  /** The shared metrics sink (so the sender can report into the same instruments). */
  metrics: Metrics;
  /** The shared lifecycle event stream (failover / health / transaction events). */
  events: LifecycleEmitter;
  /** Endpoint names in configured (priority) order. */
  endpointNames: string[];
  /** The underlying kit-compatible failover transport (for confirmation fan-out). */
  transport: RpcTransport;
}

/** Default transport factory: a kit HTTP transport over a devnet-branded URL. */
function defaultTransportFor(endpoint: { name: string; url: string }): RpcTransport {
  return createDefaultRpcTransport({ url: devnet(endpoint.url) });
}

/**
 * Build the single resilient RPC pool for the whole project.
 *
 * @param config - validated {@link ChainConfig} (devnet only).
 * @param deps   - optional injected metrics/events/rate-limiter and transport factory.
 */
export function createChainPool(config: ChainConfig, deps: ChainPoolDeps = {}): ChainPool {
  const endpointNames = config.endpoints.map((e) => e.name);
  const metrics: Metrics = deps.metrics ?? new InMemoryMetrics();
  const events = deps.events ?? new LifecycleEmitter();
  const transportFor = deps.transportFor ?? defaultTransportFor;
  const maxSlotLag = deps.maxSlotLag ?? DEFAULT_MAX_SLOT_LAG;

  const healthMonitor = new HealthMonitor({ endpointNames, maxSlotLag });

  const pool = new ResilientRpcPool({
    endpoints: config.endpoints.map((e) => ({
      name: e.name,
      transport: transportFor({ name: e.name, url: e.url }),
    })),
    freshnessAware: deps.freshnessAware ?? true,
    healthMonitor,
    metrics,
    events,
    ...(deps.rateLimiter !== undefined ? { rateLimiter: deps.rateLimiter } : {}),
  });

  return {
    rpc: () => pool.rpc(),
    health: () => pool.health(),
    metrics,
    events,
    endpointNames,
    transport: pool.transport,
  };
}
