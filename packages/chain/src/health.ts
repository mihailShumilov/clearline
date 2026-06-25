/**
 * toHealthSnapshot — a pure mapping from the kit's {@link EndpointHealth}[] to a
 * typed, JSON-serializable DTO for the dashboard's RPC Health panel.
 *
 * The kit reports `slot` as `bigint | null`, which is not JSON-serializable; we
 * render it as a decimal string (or `null`) so the snapshot can cross the API
 * boundary unchanged. The freshest healthy endpoint (highest observed slot) is
 * flagged so the panel can mark which node routing currently prefers.
 *
 * Pure + total: no I/O, no throwing, no mutation of the input.
 */
import type { EndpointHealth } from "solana-resilience-kit";

/** One endpoint row for the dashboard RPC Health panel. */
export interface HealthEndpointDTO {
  /** Endpoint name (matches the configured name). */
  name: string;
  /** Whether the health monitor currently considers this endpoint usable. */
  healthy: boolean;
  /** Latest observed slot as a decimal string (bigint-safe), or `null` if unseen. */
  slot: string | null;
  /** Exponentially-weighted mean latency in ms. */
  latencyMs: number;
  /** Rolling error rate in `[0,1]`. */
  errorRate: number;
  /** Consecutive failures observed for this endpoint. */
  consecutiveFailures: number;
  /** True for the single healthy endpoint with the highest observed slot. */
  freshest: boolean;
}

/** The full RPC Health snapshot DTO. */
export interface HealthSnapshotDTO {
  /** Per-endpoint health rows, in the order the kit reported them. */
  endpoints: HealthEndpointDTO[];
  /** Count of endpoints currently healthy. */
  healthyCount: number;
  /** Total endpoints in the pool. */
  totalCount: number;
}

/**
 * Map kit health to the dashboard DTO. Pure and total.
 *
 * @param health - the array returned by `pool.health()`.
 */
export function toHealthSnapshot(health: readonly EndpointHealth[]): HealthSnapshotDTO {
  // Identify the freshest healthy endpoint by highest observed slot. Ties resolve
  // to the first such endpoint encountered (stable with the kit's ranking order).
  let freshestName: string | null = null;
  let freshestSlot: bigint | null = null;
  for (const h of health) {
    if (!h.healthy || h.slot === null) continue;
    if (freshestSlot === null || h.slot > freshestSlot) {
      freshestSlot = h.slot;
      freshestName = h.name;
    }
  }

  const endpoints: HealthEndpointDTO[] = health.map((h) => ({
    name: h.name,
    healthy: h.healthy,
    slot: h.slot === null ? null : h.slot.toString(),
    latencyMs: h.latencyMs,
    errorRate: h.errorRate,
    consecutiveFailures: h.consecutiveFailures,
    freshest: h.name === freshestName,
  }));

  return {
    endpoints,
    healthyCount: endpoints.filter((e) => e.healthy).length,
    totalCount: endpoints.length,
  };
}
