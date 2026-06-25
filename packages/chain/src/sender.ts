/**
 * createChainSender — wraps the kit's {@link TransactionSender} with a devnet
 * {@link ClusterGuardConfig} so a transaction can never be broadcast to the
 * wrong network (§5: devnet only). The sender shares the pool's metrics and
 * lifecycle event streams, so `tx.landings` / `tx.rebroadcasts` and the
 * `transaction:*` events flow through the same chokepoint as RPC telemetry.
 */
import { TransactionSender } from "solana-resilience-kit";
import type { Cluster, SendConfig, SendResult } from "solana-resilience-kit";

import type { ChainPool } from "./pool";

/** Options for {@link createChainSender}. */
export interface ChainSenderOptions {
  /**
   * Cluster the sender is allowed to transact on. Defaults to `"devnet"`; the
   * guard runs in `"throw"` mode so a definitive mismatch blocks the send before
   * any broadcast leaves the client.
   */
  expectedCluster?: Cluster;
  /**
   * Injected sleep for deterministic tests (advances the mock clock per
   * rebroadcast). Defaults to the kit's real timer.
   */
  sleep?: (ms: number) => Promise<void>;
}

/** A typed handle exposing the resilient `sendAndConfirm`. */
export interface ChainSender {
  /** Send + confirm a signed wire transaction with correct block-height semantics. */
  sendAndConfirm(config: SendConfig): Promise<SendResult>;
}

/** Default (and only allowed) cluster for ClearLine sends (§5). */
const DEFAULT_EXPECTED_CLUSTER: Cluster = "devnet";

/**
 * Build a {@link ChainSender} over a {@link ChainPool}. The underlying
 * {@link TransactionSender} uses the pool's failover RPC, shares its metrics and
 * events, and enforces a `clusterGuard` against the expected cluster.
 *
 * @param pool - the project's single {@link ChainPool} chokepoint.
 * @param options - cluster guard target and an optional injected `sleep`.
 */
export function createChainSender(pool: ChainPool, options: ChainSenderOptions = {}): ChainSender {
  const expected = options.expectedCluster ?? DEFAULT_EXPECTED_CLUSTER;

  const sender = new TransactionSender(pool.rpc(), {
    metrics: pool.metrics,
    events: pool.events,
    clusterGuard: { expected, mode: "throw" },
    ...(options.sleep !== undefined ? { sleep: options.sleep } : {}),
  });

  return {
    sendAndConfirm: (config: SendConfig) => sender.sendAndConfirm(config),
  };
}
