import { describe, expect, it } from "vitest";
import type { EndpointHealth } from "solana-resilience-kit";

import { toHealthSnapshot } from "./health";

/** Build an EndpointHealth with sensible defaults for the fields under test. */
function health(partial: Partial<EndpointHealth> & { name: string }): EndpointHealth {
  return {
    name: partial.name,
    healthy: partial.healthy ?? true,
    slot: partial.slot ?? null,
    latencyMs: partial.latencyMs ?? 0,
    errorRate: partial.errorRate ?? 0,
    consecutiveFailures: partial.consecutiveFailures ?? 0,
    lastError: partial.lastError ?? null,
  };
}

describe("toHealthSnapshot", () => {
  it("maps fields and serializes bigint slot to a decimal string", () => {
    const snap = toHealthSnapshot([
      health({ name: "primary", healthy: true, slot: 123_456_789n, latencyMs: 42, errorRate: 0.1 }),
    ]);
    expect(snap.endpoints[0]).toEqual({
      name: "primary",
      healthy: true,
      slot: "123456789",
      latencyMs: 42,
      errorRate: 0.1,
      consecutiveFailures: 0,
      freshest: true,
    });
  });

  it("renders a null slot as null", () => {
    const snap = toHealthSnapshot([health({ name: "p", slot: null })]);
    expect(snap.endpoints[0]?.slot).toBeNull();
  });

  it("flags the healthy endpoint with the highest slot as freshest", () => {
    const snap = toHealthSnapshot([
      health({ name: "a", healthy: true, slot: 100n }),
      health({ name: "b", healthy: true, slot: 200n }),
      health({ name: "c", healthy: true, slot: 150n }),
    ]);
    const freshest = snap.endpoints.filter((e) => e.freshest).map((e) => e.name);
    expect(freshest).toEqual(["b"]);
  });

  it("never flags an unhealthy endpoint as freshest even with the highest slot", () => {
    const snap = toHealthSnapshot([
      health({ name: "lagging-but-down", healthy: false, slot: 999n }),
      health({ name: "fresh", healthy: true, slot: 500n }),
    ]);
    expect(snap.endpoints.find((e) => e.freshest)?.name).toBe("fresh");
  });

  it("flags nothing as freshest when no endpoint has a slot", () => {
    const snap = toHealthSnapshot([
      health({ name: "a", slot: null }),
      health({ name: "b", slot: null }),
    ]);
    expect(snap.endpoints.some((e) => e.freshest)).toBe(false);
  });

  it("counts healthy vs total and produces a JSON-serializable DTO", () => {
    const snap = toHealthSnapshot([
      health({ name: "a", healthy: true, slot: 10n }),
      health({ name: "b", healthy: false, slot: 5n }),
    ]);
    expect(snap.healthyCount).toBe(1);
    expect(snap.totalCount).toBe(2);
    // Round-trips through JSON without throwing on a bigint.
    expect(() => JSON.stringify(snap)).not.toThrow();
  });

  it("is pure: does not mutate the input array or its elements", () => {
    const input: EndpointHealth[] = [health({ name: "a", slot: 1n })];
    const snapshotBefore = JSON.stringify(input, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    toHealthSnapshot(input);
    const snapshotAfter = JSON.stringify(input, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    expect(snapshotAfter).toBe(snapshotBefore);
  });
});
