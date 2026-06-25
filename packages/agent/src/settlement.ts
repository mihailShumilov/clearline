/**
 * Settlement providers — turn a predicate + settle-time stats into a verdict (§8).
 *
 * Two implementations share one interface so the agent takes the provider by
 * injection:
 *  - {@link LocalSettlementProvider} — offline, deterministic; evaluates the
 *    predicate with core's `evaluatePredicate`. Used by the demo/replay (§11).
 *  - {@link RecordedSettlementProvider} — the REAL recorded path (ADR-0005,
 *    ADR-0007): computes the verdict locally with core's `evaluatePredicate`
 *    (mirroring on-chain `validate_stat`), surfaces the recorded on-chain evidence
 *    (PDA, program id, subscribe tx + Explorer link), and asserts the local verdict
 *    MATCHES the recorded on-chain verdict — never silently diverges, never fakes a
 *    verdict that was not recorded.
 *  - {@link OnChainSettlementProvider} — the trustless path (Phase 4, §10): fetch
 *    the three-stage Merkle proof and verify it against the published on-chain root
 *    via TxLINE `validate_stat`. It is intentionally NOT wired yet (the agent wallet
 *    must be funded first) and throws a typed error rather than faking a result.
 */
import type { Predicate, Stat } from "@clearline/core";
import { evaluatePredicate } from "@clearline/core";
import type { RealFixture } from "./realFixture";

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
  /** The published `daily_scores_roots` PDA the verdict was verified against. */
  readonly rootPda?: string;
  /** The TxLINE program id the verdict was verified against. */
  readonly programId?: string;
  /** `true` when the verdict was reconciled against a recorded on-chain result. */
  readonly verifiedOnChain?: boolean;
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

/** The set of typed settlement failure codes (§4). */
export type SettlementErrorCode = "missing-stat" | "not-wired" | "verdict-mismatch";

/** Typed settlement failure (no bare `throw "string"`, §4). */
export class SettlementError extends Error {
  readonly code: SettlementErrorCode;
  readonly detail: unknown;
  constructor(code: SettlementErrorCode, message: string, detail?: unknown) {
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
 * Maps a {@link Predicate} to the recorded verdict it should reconcile against, when
 * the predicate matches one of the two recorded `value > N` shapes. Returns the
 * recorded boolean result so the integrity guard can compare it to the locally
 * computed verdict; returns `undefined` when the predicate is unrelated to a recorded
 * verdict (e.g. a different op/threshold), in which case no reconciliation applies.
 */
function recordedResultFor(
  predicate: Predicate,
  fixture: RealFixture,
): { readonly which: "truePredicate" | "falsePredicate"; readonly result: boolean } | undefined {
  // The recorded verdicts are single `value > N` rules over the chosen stat.
  if (predicate.kind !== "single" || predicate.op !== ">") {
    return undefined;
  }
  if (predicate.statKey !== fixture.chosen.statKey) {
    return undefined;
  }
  const { verdicts } = fixture.onchain;
  if (predicate.threshold === 0) {
    return { which: "truePredicate", result: verdicts.truePredicate.result };
  }
  if (predicate.threshold === 1) {
    return { which: "falsePredicate", result: verdicts.falsePredicate.result };
  }
  return undefined;
}

/**
 * REAL recorded settlement (ADR-0005, ADR-0007). Constructed from a {@link RealFixture}
 * captured off a live devnet `validate_stat` run.
 *
 * `settle` computes the verdict LOCALLY via core's `evaluatePredicate` over the
 * supplied settle-time stats (which carry the chosen stat) — mirroring exactly what
 * on-chain `validate_stat` did — then returns the recorded on-chain evidence: the
 * subscribe tx signature + Explorer link, the published `daily_scores_roots` PDA, and
 * the program id, with `source: "onchain"` and `verifiedOnChain: true`.
 *
 * INTEGRITY GUARD: when the predicate matches a recorded verdict shape
 * (`value > 0` / `value > 1` over the chosen stat), the locally computed `holds` MUST
 * equal the recorded `onchain.verdicts.*.result`; a mismatch throws a typed
 * {@link SettlementError} (`verdict-mismatch`) rather than silently diverging. This
 * proves the off-chain decision agrees with the real on-chain verdict; it never
 * fabricates a verdict that was not recorded.
 */
export class RecordedSettlementProvider implements SettlementProvider {
  readonly #fixture: RealFixture;

  constructor(fixture: RealFixture) {
    this.#fixture = fixture;
  }

  async settle(args: SettleArgs): Promise<SettlementOutcome> {
    const fixture = this.#fixture;
    const result = evaluatePredicate(args.predicate, args.statsAtSettle);
    if (!result.ok) {
      throw new SettlementError(
        "missing-stat",
        `cannot settle fixture ${args.fixtureId}: stat ${result.error.statKey} missing`,
        result.error,
      );
    }

    // Reconcile the local verdict against the recorded on-chain verdict.
    const recorded = recordedResultFor(args.predicate, fixture);
    if (recorded !== undefined && recorded.result !== result.holds) {
      throw new SettlementError(
        "verdict-mismatch",
        `fixture ${args.fixtureId}: local verdict ${String(result.holds)} for ` +
          `${recorded.which} contradicts recorded on-chain verdict ${String(recorded.result)}`,
        {
          which: recorded.which,
          local: result.holds,
          recorded: recorded.result,
          left: result.left,
          right: result.right,
        },
      );
    }

    const { onchain } = fixture;
    return {
      holds: result.holds,
      source: "onchain",
      signature: onchain.subscribeTxSig,
      explorerUrl: onchain.subscribeExplorer,
      rootPda: onchain.dailyScoresRootsPda,
      programId: onchain.programId,
      verifiedOnChain: true,
    };
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
