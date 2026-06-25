/**
 * Settlement providers — turn a predicate + settle-time stats into a verdict (§8).
 *
 * Two implementations share one interface so the agent takes the provider by
 * injection:
 *  - {@link LocalSettlementProvider} — offline, deterministic; evaluates the
 *    predicate with core's `evaluatePredicate`. Used by the demo/replay (§11).
 *  - {@link OnChainSettlementProvider} — the trustless path (Phase 4, §10): fetch
 *    the three-stage Merkle proof and verify it against the published on-chain root
 *    via TxLINE `validate_stat`. It is intentionally NOT wired yet (the agent wallet
 *    must be funded first) and throws a typed error rather than faking a result.
 */
import type { Predicate, Stat } from "@clearline/core";
import { evaluatePredicate } from "@clearline/core";

/** The verdict for one settlement, plus its provenance. */
export interface SettlementOutcome {
  /** Whether the predicate held against the settle-time stats. */
  readonly holds: boolean;
  /** Where the verdict came from. */
  readonly source: "local" | "onchain";
  /** Solana transaction signature, when settled on-chain. */
  readonly signature?: string;
  /** Solana Explorer URL for {@link SettlementOutcome.signature}, when on-chain. */
  readonly explorerUrl?: string;
}

/** Arguments for a single settlement request. */
export interface SettleArgs {
  readonly fixtureId: number;
  readonly predicate: Predicate;
  readonly statsAtSettle: ReadonlyArray<Stat>;
}

/** A pluggable settlement backend. */
export interface SettlementProvider {
  settle(args: SettleArgs): Promise<SettlementOutcome>;
}

/** Typed settlement failure (no bare `throw "string"`, §4). */
export class SettlementError extends Error {
  readonly code: "missing-stat" | "not-wired";
  readonly detail: unknown;
  constructor(code: "missing-stat" | "not-wired", message: string, detail?: unknown) {
    super(message);
    this.name = "SettlementError";
    this.code = code;
    this.detail = detail;
    Object.setPrototypeOf(this, SettlementError.prototype);
  }
}

/**
 * Offline settlement: computes `holds` purely via core's `evaluatePredicate` over
 * the supplied settle-time stats. Deterministic and side-effect-free, so it is the
 * settlement path for the deterministic replay (§11). A missing referenced stat is a
 * typed {@link SettlementError} (`missing-stat`) — never a faked verdict.
 */
export class LocalSettlementProvider implements SettlementProvider {
  async settle(args: SettleArgs): Promise<SettlementOutcome> {
    const result = evaluatePredicate(args.predicate, args.statsAtSettle);
    if (!result.ok) {
      throw new SettlementError(
        "missing-stat",
        `cannot settle fixture ${args.fixtureId}: stat ${result.error.statKey} missing`,
        result.error,
      );
    }
    return { holds: result.holds, source: "local" };
  }
}

/**
 * Trustless on-chain settlement (Phase 4, §10) — NOT YET WIRED.
 *
 * TODO(phase4-funded): wire the real flow once the agent devnet wallet is funded and
 * the TxLINE API token is activated (CLAUDE.md Blockers (a)/(b)):
 *   1. Resolve the deciding update `seq` and statKey(s) for `predicate` from the
 *      observed sequence (statKey for a single predicate; statKey1 + statKey2 for a
 *      margin predicate).
 *   2. Fetch the three-stage Merkle proof:
 *        `TxlineClient.getStatValidation({ fixtureId, seq, statKey, statKey2? })`
 *      → `ScoresStatValidation { statToProve, eventStatRoot, summary, statProof,
 *         subTreeProof, mainTreeProof, statToProve2?, statProof2? }`.
 *   3. Build and send the TxLINE `validate_stat(targetTs, fixtureSummary,
 *      fixtureProof, mainTreeProof, predicate, stat1, stat2?, operator?)` call as a
 *      read-only `.view()` against the `daily_scores_roots` PDA, routed through
 *      `@clearline/chain` (`createChainPool` / `createChainSender`) — never bare
 *      `@solana/kit` (§11b). The program returns whether the predicate holds,
 *      verified against the published on-chain root.
 *   4. Return `{ holds, source: "onchain", signature, explorerUrl }` where
 *      `explorerUrl = https://explorer.solana.com/tx/<signature>?cluster=devnet`.
 *
 * The offline replay path MUST NOT require a live pool, so nothing on-chain is
 * constructed in the constructor; `settle` throws a typed "not yet wired" error.
 */
export class OnChainSettlementProvider implements SettlementProvider {
  async settle(_args: SettleArgs): Promise<SettlementOutcome> {
    throw new SettlementError(
      "not-wired",
      "on-chain settlement is not wired yet (TODO(phase4-funded)): fund the agent " +
        "devnet wallet, activate the TxLINE token, then verify via validate_stat",
    );
  }
}
