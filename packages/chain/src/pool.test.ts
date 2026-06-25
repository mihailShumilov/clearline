import { describe, expect, it } from "vitest";
import { InMemoryMetrics, LifecycleEmitter } from "solana-resilience-kit";
import { MockCluster, MockEndpoint } from "solana-resilience-kit/testing";

import type { ChainConfig } from "./config";
import { createChainPool } from "./pool";

/** A two-endpoint devnet config; transports are injected per test. */
const TWO_ENDPOINTS: ChainConfig = {
  cluster: "devnet",
  endpoints: [
    { name: "primary", url: "https://api.devnet.solana.com" },
    { name: "backup", url: "https://api.devnet.solana.com" },
  ],
};

describe("createChainPool — happy path", () => {
  it("serves getSlot through the pool over mock endpoints", async () => {
    const cluster = new MockCluster({ initialSlot: 5_000n, initialBlockHeight: 700n });
    const primary = new MockEndpoint(cluster, { name: "primary" });
    const backup = new MockEndpoint(cluster, { name: "backup" });

    const metrics = new InMemoryMetrics();
    const pool = createChainPool(TWO_ENDPOINTS, {
      metrics,
      transportFor: (e) => (e.name === "primary" ? primary.transport : backup.transport),
    });

    const slot = await pool.rpc().getSlot().send();
    expect(slot).toBe(5_000n);

    // Both endpoints report healthy and the pool exposes both names.
    expect(pool.endpointNames).toEqual(["primary", "backup"]);
    const snap = pool.health();
    expect(snap).toHaveLength(2);
    expect(snap.every((h) => h.healthy)).toBe(true);

    // Telemetry flowed through the injected sink.
    expect(metrics.requests.length).toBeGreaterThan(0);
    expect(metrics.successRate()).toBeGreaterThan(0);
  });
});

describe("createChainPool — failover", () => {
  it("serves from the backup when the primary 429s, and ejects the primary", async () => {
    const cluster = new MockCluster({ initialSlot: 9_000n, initialBlockHeight: 700n });
    // Primary always rate-limits; backup is clean.
    const primary = new MockEndpoint(cluster, { name: "primary" });
    primary.faults = { rate429Rate: 1 };
    const backup = new MockEndpoint(cluster, { name: "backup" });

    const metrics = new InMemoryMetrics();
    const events = new LifecycleEmitter();
    const failovers: Array<{ from: string; to: string }> = [];
    events.on("connection:failover", ({ from, to }) => failovers.push({ from, to }));

    // Strict configured order (freshnessAware off) so the request hits the
    // primary first, fails over to the backup on the 429, and records the
    // rate-limit metric on the serve path.
    const pool = createChainPool(TWO_ENDPOINTS, {
      metrics,
      events,
      freshnessAware: false,
      transportFor: (e) => (e.name === "primary" ? primary.transport : backup.transport),
    });

    // Drive enough requests to cross the default failureThreshold (3).
    for (let i = 0; i < 4; i++) {
      const slot = await pool.rpc().getSlot().send();
      expect(slot).toBe(9_000n); // served by the healthy backup
    }

    // The pool emitted failover primary -> backup on the serve path.
    expect(failovers.length).toBeGreaterThan(0);
    expect(failovers[0]).toEqual({ from: "primary", to: "backup" });

    // Metrics recorded the 429s against the primary.
    expect(metrics.rateLimited).toContain("primary");

    // health() shows the primary ejected (unhealthy) and the backup healthy.
    const snap = pool.health();
    const p = snap.find((h) => h.name === "primary");
    const b = snap.find((h) => h.name === "backup");
    expect(p?.healthy).toBe(false);
    expect(b?.healthy).toBe(true);
  });

  it("with freshness routing on (default), keeps serving from the backup and ejects a 429ing primary via health probing", async () => {
    const cluster = new MockCluster({ initialSlot: 7_000n, initialBlockHeight: 700n });
    const primary = new MockEndpoint(cluster, { name: "primary" });
    primary.faults = { rate429Rate: 1 };
    const backup = new MockEndpoint(cluster, { name: "backup" });

    const pool = createChainPool(TWO_ENDPOINTS, {
      metrics: new InMemoryMetrics(),
      // freshnessAware defaults to true
      transportFor: (e) => (e.name === "primary" ? primary.transport : backup.transport),
    });

    for (let i = 0; i < 4; i++) {
      const slot = await pool.rpc().getSlot().send();
      expect(slot).toBe(7_000n);
    }

    // The freshness probe detects the primary's 429s and ejects it from routing,
    // so the backup serves every request without a serve-path failover.
    const snap = pool.health();
    expect(snap.find((h) => h.name === "primary")?.healthy).toBe(false);
    expect(snap.find((h) => h.name === "backup")?.healthy).toBe(true);
  });

  it("serves from the backup when the primary drops every transport request", async () => {
    const cluster = new MockCluster({ initialSlot: 1_234n, initialBlockHeight: 700n });
    const primary = new MockEndpoint(cluster, { name: "primary" });
    primary.faults = { errorRate: 1 }; // every request to primary fails
    const backup = new MockEndpoint(cluster, { name: "backup" });

    const pool = createChainPool(TWO_ENDPOINTS, {
      metrics: new InMemoryMetrics(),
      transportFor: (e) => (e.name === "primary" ? primary.transport : backup.transport),
    });

    const slot = await pool.rpc().getSlot().send();
    expect(slot).toBe(1_234n);
  });
});

describe("createChainPool — freshness routing", () => {
  it("deprioritizes a lagging endpoint beyond maxSlotLag", async () => {
    const cluster = new MockCluster({ initialSlot: 50_000n, initialBlockHeight: 700n });
    // Primary lags far behind cluster truth; backup is fresh.
    const primary = new MockEndpoint(cluster, { name: "primary" });
    primary.faults = { slotLag: 1_000 };
    const backup = new MockEndpoint(cluster, { name: "backup" });

    const pool = createChainPool(TWO_ENDPOINTS, {
      metrics: new InMemoryMetrics(),
      // Tight lag tolerance so the 1000-slot lag is unambiguously stale.
      maxSlotLag: 100n,
      transportFor: (e) => (e.name === "primary" ? primary.transport : backup.transport),
    });

    // The served slot is the fresh backup's (cluster truth), not the lagging primary's.
    const slot = await pool.rpc().getSlot().send();
    expect(slot).toBe(50_000n);

    const snap = pool.health();
    const p = snap.find((h) => h.name === "primary");
    const b = snap.find((h) => h.name === "backup");
    // The lagging endpoint is deemed unhealthy (deprioritized); the fresh one stays healthy.
    expect(p?.healthy).toBe(false);
    expect(b?.healthy).toBe(true);
    // The lagging primary still answered, but its observed slot is behind truth.
    expect(p?.slot).toBe(49_000n);
    expect(b?.slot).toBe(50_000n);
  });
});

describe("createChainPool — live devnet (opt-in)", () => {
  const live = process.env["CHAIN_LIVE"] ? it : it.skip;
  live("reads getSlot from real devnet through the pool", async () => {
    const pool = createChainPool({
      cluster: "devnet",
      endpoints: [{ name: "primary", url: "https://api.devnet.solana.com" }],
    });
    const slot = await pool.rpc().getSlot().send();
    expect(typeof slot).toBe("bigint");
    expect(slot).toBeGreaterThan(0n);
  });
});
