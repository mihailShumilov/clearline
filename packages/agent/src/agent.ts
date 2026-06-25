/**
 * `AgentRunner` — the deterministic decision/settlement loop (§7 Phase 5, §11).
 *
 * `runReplay` feeds a recorded fixture's `Scores` updates into the same pipeline a
 * live run would use:
 *   advance clock → strategy.decide → open position → … → settle on completion.
 * It is PURE with respect to its inputs (clock/rng/logger/store/settlement are all
 * injected) and IDEMPOTENT: two runs over the same fixture + providers produce a
 * deep-equal {@link ReplayResult}. No wall clock, no ambient randomness.
 */
import type { Position } from "@clearline/core";
import { makeEdge, settle as settleCore } from "@clearline/core";
import type { Scores } from "@clearline/txline";
import type { ReplayClock } from "./clock";
import { finalStats, type RecordedFixture } from "./fixture";
import type { Logger } from "./logger";
import { noopLogger } from "./logger";
import type { Rng } from "./rng";
import type { SettlementOutcome, SettlementProvider } from "./settlement";
import type { PositionStore } from "./store";
import type { Strategy } from "./strategy";

/** Everything `runReplay` needs, injected for determinism. */
export interface RunReplayArgs {
  readonly fixture: RecordedFixture;
  readonly strategy: Strategy;
  readonly settlement: SettlementProvider;
  readonly store: PositionStore;
  readonly clock: ReplayClock;
  /** Optional structured logger; defaults to {@link noopLogger} (silent). */
  readonly logger?: Logger;
  /** Optional deterministic RNG; reserved for future tie-breaks. */
  readonly rng?: Rng;
}

/**
 * Surfaced on-chain proof for a replay settled against a REAL recorded verdict
 * (ADR-0005, ADR-0007). Present only on the real-fixture path so the future
 * API/dashboard can render the proof; absent for the synthetic local replay.
 */
export interface ReplayOnChainProof {
  /** Solana Explorer URL for the `validate_stat` subscribe transaction. */
  readonly subscribeExplorer: string;
  /** The published `daily_scores_roots` PDA the verdict was verified against. */
  readonly dailyScoresRootsPda: string;
  /** The TxLINE program id the verdict was verified against. */
  readonly programId: string;
  /** Marks the verdict as reconciled against a recorded on-chain result. */
  readonly verdictSource: "onchain-recorded";
}

/** Deterministic outcome of a replay. `pnlLamports` is the summed net P&L. */
export interface ReplayResult {
  readonly fixtureId: number;
  readonly positions: Position[];
  readonly settlements: SettlementOutcome[];
  readonly pnlLamports: bigint;
  /** On-chain proof, present only when settled against a real recorded verdict. */
  readonly onchain?: ReplayOnChainProof;
}

/** Stable position id for a fixture — single position per fixture in the replay. */
function positionId(fixtureId: number): string {
  return `fixture:${fixtureId}`;
}

export const AgentRunner = {
  /**
   * Replay a recorded fixture end-to-end and return a deterministic result.
   *
   * Steps:
   *  1. Set the clock to the first update's `ts`, then advance to each update's `ts`
   *     in order (rejecting a backwards `ts` via the clock).
   *  2. After each update, if no position is open yet, ask the strategy to decide;
   *     on the first non-null `Edge`, re-validate it with `makeEdge` and open a
   *     `Position` in the store.
   *  3. At end-of-fixture, derive `finalStats`, ask the settlement provider for the
   *     verdict, settle the core `Position`, and persist the won/lost status.
   *
   * Idempotent: re-running with a fresh store/clock yields a deep-equal result.
   */
  async runReplay(args: RunReplayArgs): Promise<ReplayResult> {
    const { fixture, strategy, settlement, store, clock } = args;
    const logger = args.logger ?? noopLogger;
    const fixtureId = fixture.fixtureId;

    logger.info("replay.start", { fixtureId, updates: fixture.updates.length });

    // 1–2. Drive the clock + strategy over the ordered update sequence.
    const observed: Scores[] = [];
    let opened: { id: string; position: Position } | undefined;
    const id = positionId(fixtureId);

    const first = fixture.updates[0];
    if (first !== undefined) {
      clock.set(first.ts);
    }

    for (const update of fixture.updates) {
      clock.advanceTo(update.ts);
      observed.push(update);

      if (opened === undefined) {
        const edge = strategy.decide(observed, clock);
        if (edge !== null) {
          // Re-validate via core's constructor for a clean, typed position edge.
          const built = makeEdge({
            fixtureId: edge.fixtureId,
            predicate: edge.predicate,
            stakeLamports: edge.stakeLamports,
            priceBps: edge.priceBps,
            claimedAtMs: edge.claimedAtMs,
          });
          if (built.ok) {
            const position: Position = { edge: built.edge, status: "open" };
            const stored = await store.open(id, position);
            opened = { id: stored.id, position: stored.position };
            logger.info("position.open", {
              fixtureId,
              claimedAtMs: built.edge.claimedAtMs,
              stakeLamports: built.edge.stakeLamports,
              priceBps: built.edge.priceBps,
            });
          } else {
            logger.warn("edge.rejected", { fixtureId, code: built.error.code });
          }
        }
      }
    }

    // 3. Settle at end-of-fixture.
    const positions: Position[] = [];
    const settlements: SettlementOutcome[] = [];
    let pnlLamports = 0n;

    if (opened !== undefined) {
      const stats = finalStats(fixture);
      const outcome = await settlement.settle({
        fixtureId,
        predicate: opened.position.edge.predicate,
        statsAtSettle: stats,
      });
      settlements.push(outcome);

      const settled = settleCore(opened.position, outcome.holds);
      if (settled.ok) {
        const finalPosition: Position = {
          edge: opened.position.edge,
          status: settled.outcome.status,
        };
        await store.update(opened.id, { position: finalPosition });
        positions.push(finalPosition);
        pnlLamports += settled.outcome.pnlLamports;
        logger.info("position.settle", {
          fixtureId,
          holds: outcome.holds,
          source: outcome.source,
          status: settled.outcome.status,
          pnlLamports: settled.outcome.pnlLamports,
        });
      } else {
        // Defensive: the position is freshly opened, so it cannot already be settled.
        positions.push(opened.position);
        logger.warn("settle.skipped", { fixtureId, code: settled.error.code });
      }
    } else {
      logger.info("replay.no-position", { fixtureId });
    }

    logger.info("replay.done", { fixtureId, pnlLamports });
    return { fixtureId, positions, settlements, pnlLamports };
  },
};
