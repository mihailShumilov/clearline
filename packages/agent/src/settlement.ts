/**
 * Settlement providers — turn a predicate + settle-time stats into a verdict (§8).
 *
 * Implementations share one interface so the agent takes the provider by injection:
 *  - {@link LocalSettlementProvider} — offline, deterministic; evaluates the predicate
 *    with core's `evaluatePredicate`. Used by the synthetic demo/replay (§11).
 *  - {@link RecordedSettlementProvider} — the REAL recorded path (ADR-0005, ADR-0007):
 *    computes the verdict locally with core's `evaluatePredicate` (mirroring on-chain
 *    `validate_stat`), surfaces the recorded on-chain evidence (PDA, program id, subscribe
 *    tx + Explorer link), and asserts the local verdict MATCHES the recorded on-chain
 *    verdict. `verifiedOnChain` is `true` ONLY when a recorded verdict was actually
 *    cross-checked — never fakes a verdict that was not recorded.
 *  - {@link OnChainSettlementProvider} — the LIVE trustless path (Phase 4, §10): fetches
 *    the three-stage Merkle proof and verifies a single-stat predicate against the
 *    published on-chain root by simulating TxLINE `validate_stat` (read-only `.view()`)
 *    through `@clearline/chain` (`createChainPool`) — NO bare `@solana/kit` RPC (§11b).
 *    The verdict it returns IS the real on-chain return-data bool; it reconciles that
 *    against the off-chain decision and throws on divergence rather than faking a result.
 */
import type { ChainPool, NormalizedStatValidation, OnChainPredicate } from "@clearline/chain";
import { normalizeStatValidation, validateStatOnChain } from "@clearline/chain";
import type { Predicate, SinglePredicate, Stat } from "@clearline/core";
import { evaluatePredicate } from "@clearline/core";
import type { TxlineClient } from "@clearline/txline";
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
  /**
   * `true` when the verdict was verified against the on-chain Merkle root — either a
   * LIVE `validate_stat` simulation ({@link OnChainSettlementProvider}) or a recorded
   * on-chain cross-check ({@link RecordedSettlementProvider}). Never `true` without a
   * real reconciliation.
   */
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
export type SettlementErrorCode =
  | "missing-stat"
  | "not-wired"
  | "verdict-mismatch"
  | "unsupported-predicate";

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
 * Offline settlement: computes `holds` purely via core's `evaluatePredicate` over the
 * supplied settle-time stats. Deterministic and side-effect-free, so it is the
 * settlement path for the synthetic deterministic replay (§11). A missing referenced
 * stat is a typed {@link SettlementError} (`missing-stat`) — never a faked verdict.
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
 * recorded boolean result so the integrity guard can compare it to the locally computed
 * verdict; returns `undefined` when the predicate is unrelated to a recorded verdict.
 */
function recordedResultFor(
  predicate: Predicate,
  fixture: RealFixture,
): { readonly which: "truePredicate" | "falsePredicate"; readonly result: boolean } | undefined {
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
 * `settle` computes the verdict LOCALLY via core's `evaluatePredicate` over the supplied
 * settle-time stats — mirroring exactly what on-chain `validate_stat` did — then returns
 * the recorded on-chain evidence. INTEGRITY GUARD: when the predicate matches a recorded
 * verdict shape (`value > 0` / `value > 1` over the chosen stat), the locally computed
 * `holds` MUST equal the recorded `onchain.verdicts.*.result`; a mismatch throws a typed
 * `verdict-mismatch`. `verifiedOnChain` is `true` ONLY when such a cross-check applied
 * (a predicate with no recorded counterpart surfaces the evidence but `verifiedOnChain:
 * false`, since this verdict was not itself reconciled against a recorded on-chain run).
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
      // Honest provenance: only `true` when this verdict was actually cross-checked
      // against a recorded on-chain result (ADR-0007 / PROGRESS follow-up).
      verifiedOnChain: recorded !== undefined,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Live on-chain settlement (§10)                                              */
/* -------------------------------------------------------------------------- */

/** A resolved, normalized three-stage proof + the stat key(s) it proves. */
export interface ResolvedProof {
  readonly validation: NormalizedStatValidation;
  readonly statKey: number;
  readonly statKey2?: number;
}

/** Resolves the three-stage Merkle proof for a settlement request. */
export interface ProofSource {
  resolve(args: SettleArgs): Promise<ResolvedProof>;
}

/**
 * A {@link ProofSource} backed by a pre-captured (bundled) stat-validation block — the
 * recorded fixture's proof. Normalizes either byte encoding (`number[]`/base64). Used to
 * settle a recorded fixture against the LIVE on-chain root deterministically.
 */
export class RecordedProofSource implements ProofSource {
  readonly #validation: NormalizedStatValidation;

  constructor(rawStatValidation: unknown) {
    this.#validation = normalizeStatValidation(rawStatValidation);
  }

  async resolve(_args: SettleArgs): Promise<ResolvedProof> {
    const validation = this.#validation;
    const proof: ResolvedProof = {
      validation,
      statKey: validation.statA.statToProve.key,
      ...(validation.statB !== undefined ? { statKey2: validation.statB.statToProve.key } : {}),
    };
    return proof;
  }
}

/** How to resolve the deciding `seq` (and stat keys) for a live proof fetch. */
export interface SeqResolution {
  readonly seq: number;
  readonly statKey: number;
  readonly statKey2?: number;
}

/**
 * A {@link ProofSource} that fetches the proof LIVE from TxLINE. The caller supplies a
 * `resolveSeq` that picks the deciding update `seq` + stat key(s) from the observed
 * sequence (the agent's loop knows the terminal update). The fetched proof is normalized
 * (`number[]`/base64) for the on-chain encoder.
 */
export class LiveProofSource implements ProofSource {
  readonly #txline: TxlineClient;
  readonly #resolveSeq: (args: SettleArgs) => SeqResolution | Promise<SeqResolution>;

  constructor(
    txline: TxlineClient,
    resolveSeq: (args: SettleArgs) => SeqResolution | Promise<SeqResolution>,
  ) {
    this.#txline = txline;
    this.#resolveSeq = resolveSeq;
  }

  async resolve(args: SettleArgs): Promise<ResolvedProof> {
    const { seq, statKey, statKey2 } = await this.#resolveSeq(args);
    const raw = await this.#txline.getStatValidation({
      fixtureId: args.fixtureId,
      seq,
      statKey,
      ...(statKey2 !== undefined ? { statKey2 } : {}),
    });
    const validation = normalizeStatValidation(raw);
    return { validation, statKey, ...(statKey2 !== undefined ? { statKey2 } : {}) };
  }
}

/** Options for {@link OnChainSettlementProvider}. */
export interface OnChainSettlementOptions {
  /** The resilient RPC pool — the project's only RPC path (§11b). */
  readonly pool: ChainPool;
  /** Resolves the three-stage Merkle proof for a settlement. */
  readonly proofSource: ProofSource;
  /** TxLINE program id; defaults to the devnet program. */
  readonly programId?: string;
  /** Fee-payer address for the read-only simulation; defaults to the agent wallet. */
  readonly feePayer?: string;
  /** Compute-unit limit for the simulation. */
  readonly computeUnitLimit?: number;
  /**
   * Optional on-chain provenance to surface alongside the verdict (e.g. the subscribe
   * tx signature + Explorer link that activated the data subscription). The verdict
   * itself is a read-only simulation and produces no signature.
   */
  readonly evidence?: { readonly signature?: string; readonly explorerUrl?: string };
}

/** Map a core single-stat predicate to the on-chain `{threshold, comparison}`. */
function singleToOnChain(predicate: SinglePredicate): OnChainPredicate {
  switch (predicate.op) {
    case ">":
      return { comparison: "GreaterThan", threshold: predicate.threshold };
    case ">=":
      // value >= t  ⟺  value > t-1 (integer stats, §4).
      return { comparison: "GreaterThan", threshold: predicate.threshold - 1 };
    case "<":
      return { comparison: "LessThan", threshold: predicate.threshold };
    case "<=":
      // value <= t  ⟺  value < t+1.
      return { comparison: "LessThan", threshold: predicate.threshold + 1 };
    case "=":
      return { comparison: "EqualTo", threshold: predicate.threshold };
  }
}

/**
 * LIVE trustless on-chain settlement (Phase 4, §10).
 *
 * For a single-stat predicate, `settle`:
 *   1. resolves + normalizes the three-stage Merkle proof via the injected {@link ProofSource},
 *   2. maps the predicate to the on-chain `TraderPredicate`,
 *   3. simulates `validate_stat` (read-only `.view()`) against the `daily_scores_roots`
 *      PDA through `@clearline/chain` (`pool.rpc()` only — §11b), decoding the return-data
 *      bool as the authoritative verdict,
 *   4. RECONCILES that verdict against the off-chain decision (`evaluatePredicate` over the
 *      proven stat) and against the agent's observed value — throwing `verdict-mismatch`
 *      on any divergence rather than trusting one side.
 *
 * Returns `{ holds, source: "onchain", verifiedOnChain: true, rootPda, programId }`. A
 * margin (two-stat) predicate throws a typed `unsupported-predicate` (the live on-chain
 * path is single-stat — the form proven on devnet, ADR-0007).
 */
export class OnChainSettlementProvider implements SettlementProvider {
  readonly #opts: OnChainSettlementOptions;

  constructor(opts: OnChainSettlementOptions) {
    this.#opts = opts;
  }

  async settle(args: SettleArgs): Promise<SettlementOutcome> {
    const { predicate, fixtureId } = args;
    if (predicate.kind !== "single") {
      throw new SettlementError(
        "unsupported-predicate",
        `fixture ${fixtureId}: on-chain settlement supports single-stat predicates only ` +
          `(margin predicates are evaluated off-chain; ADR-0007)`,
        { kind: predicate.kind },
      );
    }

    const { validation, statKey } = await this.#opts.proofSource.resolve(args);

    // The proof must be for the stat the predicate references.
    if (statKey !== predicate.statKey || validation.statA.statToProve.key !== predicate.statKey) {
      throw new SettlementError(
        "verdict-mismatch",
        `fixture ${fixtureId}: proof stat ${validation.statA.statToProve.key} ` +
          `does not match predicate stat ${predicate.statKey}`,
        { proofStatKey: validation.statA.statToProve.key, predicateStatKey: predicate.statKey },
      );
    }

    // The off-chain decision over the PROVEN stat (mirrors on-chain semantics).
    const provenStat: Stat = {
      key: validation.statA.statToProve.key,
      value: validation.statA.statToProve.value,
      period: validation.statA.statToProve.period,
    };
    const local = evaluatePredicate(predicate, [provenStat]);
    if (!local.ok) {
      throw new SettlementError(
        "missing-stat",
        `cannot settle fixture ${fixtureId}: proven stat ${local.error.statKey} missing`,
        local.error,
      );
    }

    // The agent's observed value (if it carried this stat) must equal the proven value —
    // settling on a stale/divergent observation is surfaced, never silently accepted.
    const observed = args.statsAtSettle.find((s) => s.key === predicate.statKey);
    if (observed !== undefined && observed.value !== provenStat.value) {
      throw new SettlementError(
        "verdict-mismatch",
        `fixture ${fixtureId}: observed value ${observed.value} for stat ${predicate.statKey} ` +
          `diverges from on-chain proven value ${provenStat.value}`,
        { observed: observed.value, proven: provenStat.value },
      );
    }

    // The authoritative on-chain verdict (read-only simulate via @clearline/chain).
    const onchain = await validateStatOnChain(
      this.#opts.pool,
      validation,
      singleToOnChain(predicate),
      {
        ...(this.#opts.programId !== undefined ? { programId: this.#opts.programId } : {}),
        ...(this.#opts.feePayer !== undefined ? { feePayer: this.#opts.feePayer } : {}),
        ...(this.#opts.computeUnitLimit !== undefined
          ? { computeUnitLimit: this.#opts.computeUnitLimit }
          : {}),
      },
    );

    // Off-chain decision and on-chain verdict MUST agree (the trustlessness invariant).
    if (onchain.holds !== local.holds) {
      throw new SettlementError(
        "verdict-mismatch",
        `fixture ${fixtureId}: on-chain verdict ${String(onchain.holds)} contradicts ` +
          `off-chain decision ${String(local.holds)}`,
        { onchain: onchain.holds, local: local.holds, left: local.left, right: local.right },
      );
    }

    return {
      holds: onchain.holds,
      source: "onchain",
      verifiedOnChain: true,
      rootPda: onchain.rootPda,
      programId: onchain.programId,
      ...(this.#opts.evidence?.signature !== undefined
        ? { signature: this.#opts.evidence.signature }
        : {}),
      ...(this.#opts.evidence?.explorerUrl !== undefined
        ? { explorerUrl: this.#opts.evidence.explorerUrl }
        : {}),
    };
  }
}
