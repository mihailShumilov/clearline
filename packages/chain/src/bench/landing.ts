/**
 * §11b before/after harness — measures the landing/success rate of a *naive*
 * single-endpoint client versus the *resilient* {@link createChainPool} under
 * injected faults, against the deterministic `solana-resilience-kit/testing`
 * cluster. Pure of any real network; a test invokes it and writes the numbers
 * into `docs/RESILIENCE_KIT_REPORT.md`.
 *
 * "Landing" here means: a `getSlot` read returns a value without throwing. A
 * naive client pinned to a single faulty endpoint inherits that endpoint's drop
 * rate; the resilient pool fails over to a healthy backup, so its success rate
 * is materially higher under the same injected faults.
 */
import { createSolanaRpcFromTransport } from "@solana/kit";
import type { Rpc, SolanaRpcApi } from "@solana/kit";
import { MockCluster, MockEndpoint } from "solana-resilience-kit/testing";

import { createChainPool } from "../pool";

/** Outcome of one before/after comparison run. */
export interface LandingBenchResult {
  /** Number of logical requests issued to each client. */
  attempts: number;
  /** Successful `getSlot` reads through the naive single-endpoint client. */
  naiveSuccesses: number;
  /** Successful `getSlot` reads through the resilient pool. */
  resilientSuccesses: number;
  /** Naive success rate in `[0,1]`. */
  naiveRate: number;
  /** Resilient success rate in `[0,1]`. */
  resilientRate: number;
}

/** Knobs for {@link runLandingBench}. */
export interface LandingBenchConfig {
  /** Logical requests per client (default 50). */
  attempts?: number;
  /** Probability the primary endpoint fails a request, in `[0,1]` (default 1). */
  primaryErrorRate?: number;
  /** Deterministic RNG seed for the fault draws (default 1). */
  seed?: number;
}

/** Count successful `getSlot` reads over `attempts` requests; never throws out. */
async function countSlotSuccesses(rpc: Rpc<SolanaRpcApi>, attempts: number): Promise<number> {
  let ok = 0;
  for (let i = 0; i < attempts; i++) {
    try {
      await rpc.getSlot().send();
      ok++;
    } catch {
      // A failed request counts as a non-landing; keep going.
    }
  }
  return ok;
}

/**
 * Run the before/after comparison. Both clients share one {@link MockCluster}
 * (one ledger truth). The naive client is pinned to the faulty primary; the
 * resilient client is the {@link createChainPool} handle over primary + a clean
 * backup, so it routes around the faults.
 */
export async function runLandingBench(
  config: LandingBenchConfig = {},
): Promise<LandingBenchResult> {
  const attempts = config.attempts ?? 50;
  const primaryErrorRate = config.primaryErrorRate ?? 1;
  const seed = config.seed ?? 1;

  const cluster = new MockCluster({ initialSlot: 1_000n, initialBlockHeight: 700n });

  // A faulty primary and a healthy backup, sharing the same ledger truth.
  const primary = new MockEndpoint(cluster, { name: "primary", rngSeed: seed });
  primary.faults = { errorRate: primaryErrorRate };
  const backup = new MockEndpoint(cluster, { name: "backup", rngSeed: seed + 1 });

  // Naive client: a single endpoint, no failover (the status quo most dApps ship).
  const naiveRpc = createSolanaRpcFromTransport(primary.transport);
  const naiveSuccesses = await countSlotSuccesses(naiveRpc, attempts);

  // Resilient client: the project's chain pool over the same primary + backup.
  // Inject the mock transports so no network is touched.
  const pool = createChainPool(
    {
      cluster: "devnet",
      endpoints: [
        { name: "primary", url: "https://api.devnet.solana.com" },
        { name: "backup", url: "https://api.devnet.solana.com" },
      ],
    },
    {
      transportFor: (e) => (e.name === "primary" ? primary.transport : backup.transport),
    },
  );
  const resilientSuccesses = await countSlotSuccesses(pool.rpc(), attempts);

  return {
    attempts,
    naiveSuccesses,
    resilientSuccesses,
    naiveRate: naiveSuccesses / attempts,
    resilientRate: resilientSuccesses / attempts,
  };
}
