/**
 * On-chain TxLINE `validate_stat` — trustless settlement verification (§10, ADR-0007).
 *
 * Builds the `validate_stat` instruction (Borsh, from the devnet IDL layout — discriminator
 * + `ts, fixture_summary, fixture_proof, main_tree_proof, predicate, stat_a, stat_b?, op?`)
 * and runs it as a READ-ONLY simulation (`.view()`-equivalent) against the published
 * `daily_scores_roots` PDA. The program returns whether the predicate holds, verified
 * against the on-chain Merkle root, via Solana return-data — no fee, no signature, no
 * state change.
 *
 * ALL RPC goes through the injected {@link ChainPool} (`pool.rpc()`) — the project's
 * single resilient chokepoint (§11b). No bare `@solana/kit` RPC is created here; the kit
 * imports are pure builders/codecs (transaction message, PDA derivation, base64), not RPC.
 */
import {
  AccountRole,
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  prependTransactionMessageInstruction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  address,
} from "@solana/kit";
import type { Address, Blockhash, Instruction } from "@solana/kit";

import { chainOnchainError } from "./errors";
import type { ChainPool } from "./pool";
import type { NormalizedProofNode, NormalizedStatValidation } from "./proofEncoding";

/** TxLINE devnet program id (CLAUDE.md §10; devnet-patched IDL `address`). */
export const TXLINE_PROGRAM_ID_DEVNET = "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J";

/** `global:validate_stat` 8-byte Anchor discriminator (from the IDL). */
export const VALIDATE_STAT_DISCRIMINATOR = Uint8Array.from([107, 197, 232, 90, 191, 136, 105, 185]);

/** PDA seed for the published daily-scores Merkle roots account. */
export const DAILY_SCORES_ROOTS_SEED = "daily_scores_roots";

/** ms per UTC day — the `daily_scores_roots` PDA is keyed by `floor(ts / MS_PER_DAY)`. */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Compute-unit limit for the simulation. Terminal-seq proofs (shallow sub-tree) cost
 * ~150k CU; the 1.4M ceiling covers deeper proofs without exceeding the cap (ADR-0007).
 */
export const DEFAULT_COMPUTE_UNIT_LIMIT = 1_400_000;

/**
 * Default fee payer for the read-only simulation: the public devnet agent wallet
 * address. A simulation with `sigVerify: false` needs only a fee-payer *address* (no
 * signature, no balance change), so no secret key and no funding are required.
 */
export const DEFAULT_SIM_FEE_PAYER = "HCbeaJ54rRSEwey2QEd49tgFyrfFYAfpK3kzZ86NKd8P";

/** ComputeBudget program id. */
const COMPUTE_BUDGET_PROGRAM = address("ComputeBudget111111111111111111111111111111");

/** A throwaway placeholder blockhash; `replaceRecentBlockhash` swaps it during simulation. */
const PLACEHOLDER_BLOCKHASH = "11111111111111111111111111111111" as Blockhash;

/** The on-chain `Comparison` enum (variant order from the IDL). */
export type OnChainComparison = "GreaterThan" | "LessThan" | "EqualTo";
const COMPARISON_INDEX: Record<OnChainComparison, number> = {
  GreaterThan: 0,
  LessThan: 1,
  EqualTo: 2,
};

/** The on-chain `TraderPredicate` (integer threshold + comparison enum). */
export interface OnChainPredicate {
  readonly threshold: number;
  readonly comparison: OnChainComparison;
}

/* -------------------------------------------------------------------------- */
/* Borsh writer                                                               */
/* -------------------------------------------------------------------------- */

/** Minimal little-endian Borsh writer — transparent and golden-vector tested. */
class ByteWriter {
  #chunks: number[] = [];
  u8(n: number): void {
    this.#chunks.push(n & 0xff);
  }
  bool(b: boolean): void {
    this.u8(b ? 1 : 0);
  }
  u32(n: number): void {
    this.u8(n);
    this.u8(n >>> 8);
    this.u8(n >>> 16);
    this.u8(n >>> 24);
  }
  /** Signed 32-bit little-endian (two's complement via `>>> 0` of the raw bits). */
  i32(n: number): void {
    this.u32(n | 0);
  }
  /** Signed/unsigned 64-bit little-endian via BigInt (covers ms timestamps). */
  i64(n: number): void {
    let v = BigInt(n) & 0xffffffffffffffffn;
    for (let i = 0; i < 8; i += 1) {
      this.u8(Number(v & 0xffn));
      v >>= 8n;
    }
  }
  bytes(b: Uint8Array): void {
    for (const x of b) this.#chunks.push(x & 0xff);
  }
  proofVec(nodes: readonly NormalizedProofNode[]): void {
    this.u32(nodes.length);
    for (const n of nodes) {
      this.bytes(n.hash);
      this.bool(n.isRightSibling);
    }
  }
  toBytes(): Uint8Array {
    return Uint8Array.from(this.#chunks);
  }
}

/* -------------------------------------------------------------------------- */
/* Instruction encoding                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Encode the `validate_stat` instruction data for a SINGLE-stat predicate (the
 * trustless settlement path proven live on devnet, ADR-0007). `stat_b` and `op` are
 * encoded as Borsh `None`. Byte-for-byte verified against the Anchor coder.
 */
export function encodeValidateStatData(
  validation: NormalizedStatValidation,
  predicate: OnChainPredicate,
): Uint8Array {
  const w = new ByteWriter();
  w.bytes(VALIDATE_STAT_DISCRIMINATOR);
  // ts: i64
  w.i64(validation.targetTs);
  // fixture_summary: ScoresBatchSummary
  w.i64(validation.fixtureId);
  w.i32(validation.updateCount);
  w.i64(validation.minTimestamp);
  w.i64(validation.maxTimestamp);
  w.bytes(validation.eventsSubTreeRoot);
  // fixture_proof: Vec<ProofNode>
  w.proofVec(validation.subTreeProof);
  // main_tree_proof: Vec<ProofNode>
  w.proofVec(validation.mainTreeProof);
  // predicate: TraderPredicate { threshold: i32, comparison: enum<u8> }
  w.i32(predicate.threshold);
  w.u8(COMPARISON_INDEX[predicate.comparison]);
  // stat_a: StatTerm
  w.u32(validation.statA.statToProve.key);
  w.i32(validation.statA.statToProve.value);
  w.i32(validation.statA.statToProve.period);
  w.bytes(validation.statA.eventStatRoot);
  w.proofVec(validation.statA.statProof);
  // stat_b: Option<StatTerm> = None
  w.u8(0);
  // op: Option<BinaryExpression> = None
  w.u8(0);
  return w.toBytes();
}

/** `floor(ts / MS_PER_DAY)` — the epoch day the `daily_scores_roots` PDA is keyed by. */
export function epochDayFromTs(ts: number): number {
  return Math.floor(ts / MS_PER_DAY);
}

/** Derive the `daily_scores_roots` PDA for an epoch day (`["daily_scores_roots", u16 LE]`). */
export async function deriveDailyScoresRootsPda(
  programAddress: Address,
  epochDay: number,
): Promise<Address> {
  const seed = Uint8Array.from([epochDay & 0xff, (epochDay >>> 8) & 0xff]);
  const [pda] = await getProgramDerivedAddress({
    programAddress,
    seeds: [new TextEncoder().encode(DAILY_SCORES_ROOTS_SEED), seed],
  });
  return pda;
}

/** `ComputeBudget::SetComputeUnitLimit(units)` instruction. */
function setComputeUnitLimitIx(units: number): Instruction {
  const data = new Uint8Array(5);
  data[0] = 0x02; // SetComputeUnitLimit
  data[1] = units & 0xff;
  data[2] = (units >>> 8) & 0xff;
  data[3] = (units >>> 16) & 0xff;
  data[4] = (units >>> 24) & 0xff;
  return { programAddress: COMPUTE_BUDGET_PROGRAM, accounts: [], data };
}

/* -------------------------------------------------------------------------- */
/* Simulation (read-only `.view()`)                                            */
/* -------------------------------------------------------------------------- */

/** The verdict + provenance returned by a `validate_stat` simulation. */
export interface ValidateStatVerdict {
  /** Whether the predicate holds, per the on-chain return-data bool. */
  readonly holds: boolean;
  /** The `daily_scores_roots` PDA the verdict was verified against (base58). */
  readonly rootPda: string;
  /** The TxLINE program id the verdict was verified against (base58). */
  readonly programId: string;
  /** The epoch day the root PDA is keyed by. */
  readonly epochDay: number;
  /** The `ts` used to key the PDA + match the batch (`summary.updateStats.minTimestamp`). */
  readonly targetTs: number;
  /** Raw base64 return-data the program emitted (`AQ==` = true, `AA==` = false). */
  readonly returnDataBase64: string;
}

/** Options for {@link validateStatOnChain}. */
export interface ValidateStatOptions {
  /** TxLINE program id; defaults to {@link TXLINE_PROGRAM_ID_DEVNET}. */
  readonly programId?: string;
  /** Fee-payer address for the simulation; defaults to {@link DEFAULT_SIM_FEE_PAYER}. */
  readonly feePayer?: string;
  /** Compute-unit limit; defaults to {@link DEFAULT_COMPUTE_UNIT_LIMIT}. */
  readonly computeUnitLimit?: number;
}

/**
 * Verify a single-stat predicate against the published on-chain Merkle root by
 * simulating `validate_stat` through the resilient {@link ChainPool} (§11b). Returns the
 * authoritative on-chain verdict; throws a typed {@link chainOnchainError} on a program
 * error or missing return-data — never fabricates a verdict.
 */
export async function validateStatOnChain(
  pool: ChainPool,
  validation: NormalizedStatValidation,
  predicate: OnChainPredicate,
  options: ValidateStatOptions = {},
): Promise<ValidateStatVerdict> {
  const programId = options.programId ?? TXLINE_PROGRAM_ID_DEVNET;
  const programAddress = address(programId);
  const feePayer = address(options.feePayer ?? DEFAULT_SIM_FEE_PAYER);
  const cuLimit = options.computeUnitLimit ?? DEFAULT_COMPUTE_UNIT_LIMIT;

  const epochDay = epochDayFromTs(validation.targetTs);
  const rootPda = await deriveDailyScoresRootsPda(programAddress, epochDay);
  const data = encodeValidateStatData(validation, predicate);

  const ix: Instruction = {
    programAddress,
    accounts: [{ address: rootPda, role: AccountRole.READONLY }],
    data,
  };

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: PLACEHOLDER_BLOCKHASH, lastValidBlockHeight: 0n },
        m,
      ),
    (m) => prependTransactionMessageInstruction(setComputeUnitLimitIx(cuLimit), m),
    (m) => appendTransactionMessageInstruction(ix, m),
  );
  const wire = getBase64EncodedWireTransaction(compileTransaction(message));

  const result = await pool
    .rpc()
    .simulateTransaction(wire, {
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: true,
    })
    .send();

  if (result.value.err !== null) {
    throw chainOnchainError("simulation_failed", "validate_stat simulation returned an error", {
      err: result.value.err,
      logs: (result.value.logs ?? []).slice(-6),
    });
  }
  const returnData = result.value.returnData;
  if (returnData === null || returnData === undefined) {
    throw chainOnchainError("no_return_data", "validate_stat produced no return-data bool");
  }
  const base64 = returnData.data[0];
  const decoded = getBase64Encoder().encode(base64);
  const holds = decoded.length > 0 && decoded[0] === 1;

  return {
    holds,
    rootPda: String(rootPda),
    programId,
    epochDay,
    targetTs: validation.targetTs,
    returnDataBase64: base64,
  };
}
