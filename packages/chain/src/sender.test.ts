import { describe, expect, it } from "vitest";
import { InMemoryMetrics } from "solana-resilience-kit";
import { MockCluster, MockEndpoint } from "solana-resilience-kit/testing";

import type { ChainConfig } from "./config";
import { createChainPool } from "./pool";
import { createChainSender } from "./sender";

/** Genesis hash the kit maps to "devnet". */
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
/** Genesis hash the kit maps to "mainnet-beta". */
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

const ONE_ENDPOINT: ChainConfig = {
  cluster: "devnet",
  endpoints: [{ name: "primary", url: "https://api.devnet.solana.com" }],
};

/** A short raw signature string (mock treats <=100 chars as a raw signature). */
const SIG = "TestSig111111111111111111111111111111111111";

describe("createChainSender — devnet cluster guard", () => {
  it("confirms a send on a devnet-genesis cluster", async () => {
    const cluster = new MockCluster({
      initialSlot: 1_000n,
      initialBlockHeight: 700n,
      genesisHash: DEVNET_GENESIS,
    });
    const primary = new MockEndpoint(cluster, { name: "primary" });

    // The tx lands one block after acceptance.
    cluster.scheduleLanding(SIG, 1);

    const metrics = new InMemoryMetrics();
    const pool = createChainPool(ONE_ENDPOINT, {
      metrics,
      transportFor: () => primary.transport,
    });

    // Injected sleep advances the mock clock so the scheduled landing is observed
    // deterministically — no wall-clock time passes.
    const sender = createChainSender(pool, {
      expectedCluster: "devnet",
      sleep: async () => {
        cluster.advanceSlots(2);
      },
    });

    const result = await sender.sendAndConfirm({
      wireTransaction: SIG, // low-level: the mock derives the signature from this
      signature: SIG,
      lastValidBlockHeight: 10_000n,
    });

    expect(result.outcome).toBe("confirmed");
    expect(result.signature).toBe(SIG);
    // The landing was recorded into the shared metrics sink.
    expect(metrics.landings.some((l) => l.signature === SIG && l.outcome === "confirmed")).toBe(
      true,
    );
  });

  it("blocks a send to a mainnet-genesis cluster (devnet guard, throw mode)", async () => {
    const cluster = new MockCluster({
      initialSlot: 1_000n,
      initialBlockHeight: 700n,
      genesisHash: MAINNET_GENESIS,
    });
    const primary = new MockEndpoint(cluster, { name: "primary" });

    const pool = createChainPool(ONE_ENDPOINT, {
      metrics: new InMemoryMetrics(),
      transportFor: () => primary.transport,
    });
    const sender = createChainSender(pool, {
      expectedCluster: "devnet",
      sleep: async () => {
        cluster.advanceSlots(1);
      },
    });

    await expect(
      sender.sendAndConfirm({
        wireTransaction: SIG,
        signature: SIG,
        lastValidBlockHeight: 10_000n,
      }),
    ).rejects.toThrow();

    // Nothing was broadcast: the mock saw no sendTransaction.
    expect(primary.stats.sends).toBe(0);
  });
});
