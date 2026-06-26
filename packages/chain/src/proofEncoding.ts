/**
 * Proof-encoding normalization for the TxLINE three-stage Merkle proof (§10, ADR-0007).
 *
 * The mainnet OpenAPI marks 32-byte roots/hashes as `format: binary`, implying base64
 * strings; the DEVNET feed instead delivers them as JSON `number[]` byte arrays. This
 * module lifts the throwaway spike's `toBytes`/`toProof` helpers into typed production
 * code: a Zod-validated normalizer that accepts EITHER encoding and yields fixed
 * 32-byte `Uint8Array`s plus typed proof nodes — with no `any` (§4). The on-chain
 * encoder (`validateStat.ts`) consumes the normalized shape.
 */
import { z } from "zod";

import { chainOnchainError } from "./errors";

/** Number of bytes in a Merkle root / hash leaf. */
export const MERKLE_BYTES = 32;

/**
 * A 32-byte Merkle value on the wire: either a base64 string (mainnet OpenAPI
 * `format: binary`) or a JSON `number[]` of byte values (the devnet feed). Validated
 * here, normalized to bytes by {@link toBytes32}.
 */
export const MerkleBytesWireSchema = z.union([z.string(), z.array(z.number().int())]);
export type MerkleBytesWire = z.infer<typeof MerkleBytesWireSchema>;

/** One proof node on the wire (`hash` in either encoding). */
export const ProofNodeWireSchema = z.looseObject({
  hash: MerkleBytesWireSchema,
  isRightSibling: z.boolean(),
});
export type ProofNodeWire = z.infer<typeof ProofNodeWireSchema>;

/** `List_ProofNode` is `null | ProofNode[]`; normalize both to an array. */
export const ProofNodeListWireSchema = z
  .array(ProofNodeWireSchema)
  .nullish()
  .transform((v) => v ?? []);

/** A normalized proof node: fixed 32-byte hash + sibling flag. */
export interface NormalizedProofNode {
  readonly hash: Uint8Array;
  readonly isRightSibling: boolean;
}

/** A normalized {@link ScoreStat}-bearing term (mirrors on-chain `StatTerm`). */
export interface NormalizedStatTerm {
  readonly statToProve: { readonly key: number; readonly value: number; readonly period: number };
  readonly eventStatRoot: Uint8Array;
  readonly statProof: NormalizedProofNode[];
}

/**
 * A fully normalized stat-validation proof, ready for the on-chain encoder.
 * `targetTs` is the value the program keys the `daily_scores_roots` PDA by and
 * matches against the batch payload — it is `summary.updateStats.minTimestamp`,
 * NOT the top-level `ts` (ADR-0007).
 */
export interface NormalizedStatValidation {
  readonly ts: number;
  readonly targetTs: number;
  readonly fixtureId: number;
  readonly updateCount: number;
  readonly minTimestamp: number;
  readonly maxTimestamp: number;
  readonly eventsSubTreeRoot: Uint8Array;
  /** `fixture_proof` (the sub-tree proof). */
  readonly subTreeProof: NormalizedProofNode[];
  /** `main_tree_proof`. */
  readonly mainTreeProof: NormalizedProofNode[];
  /** `stat_a` — the (first) proven stat term. */
  readonly statA: NormalizedStatTerm;
  /** `stat_b` — present only for two-stat (margin) proofs. */
  readonly statB?: NormalizedStatTerm;
}

/** Zod shape for the raw stat-validation block (loose: tolerates extra keys). */
const StatToProveWireSchema = z.looseObject({
  key: z.number().int(),
  value: z.number().int(),
  period: z.number().int(),
});

const StatValidationWireSchema = z.looseObject({
  ts: z.number().int(),
  statToProve: StatToProveWireSchema,
  eventStatRoot: MerkleBytesWireSchema,
  summary: z.looseObject({
    fixtureId: z.number().int(),
    updateStats: z.looseObject({
      updateCount: z.number().int(),
      minTimestamp: z.number().int(),
      maxTimestamp: z.number().int(),
    }),
    eventStatsSubTreeRoot: MerkleBytesWireSchema,
  }),
  statProof: ProofNodeListWireSchema,
  subTreeProof: ProofNodeListWireSchema,
  mainTreeProof: ProofNodeListWireSchema,
  statToProve2: StatToProveWireSchema.optional(),
  statProof2: ProofNodeListWireSchema.optional(),
});

/**
 * Normalize a single wire Merkle value to a fixed 32-byte `Uint8Array`. Accepts a
 * base64 string or a `number[]`; throws a typed {@link chainOnchainError} when the
 * decoded length is not {@link MERKLE_BYTES} or a byte is out of range.
 */
export function toBytes32(value: MerkleBytesWire): Uint8Array {
  let bytes: Uint8Array;
  if (typeof value === "string") {
    // base64 → bytes (Buffer is available under Node + Workers `nodejs_compat`).
    bytes = Uint8Array.from(Buffer.from(value, "base64"));
  } else {
    for (const b of value) {
      if (!Number.isInteger(b) || b < 0 || b > 255) {
        throw chainOnchainError("bad_merkle_byte", "Merkle byte out of range [0,255]", { byte: b });
      }
    }
    bytes = Uint8Array.from(value);
  }
  if (bytes.length !== MERKLE_BYTES) {
    throw chainOnchainError(
      "bad_merkle_length",
      `expected ${MERKLE_BYTES}-byte Merkle value, got ${bytes.length}`,
    );
  }
  return bytes;
}

/** Normalize a wire proof-node list to {@link NormalizedProofNode}s. */
export function toProofNodes(nodes: readonly ProofNodeWire[]): NormalizedProofNode[] {
  return nodes.map((n) => ({ hash: toBytes32(n.hash), isRightSibling: n.isRightSibling }));
}

function toStatTerm(
  stat: { key: number; value: number; period: number },
  eventStatRoot: MerkleBytesWire,
  statProof: readonly ProofNodeWire[],
): NormalizedStatTerm {
  return {
    statToProve: { key: stat.key, value: stat.value, period: stat.period },
    eventStatRoot: toBytes32(eventStatRoot),
    statProof: toProofNodes(statProof),
  };
}

/**
 * Validate + normalize a raw stat-validation block (from the live TxLINE client or a
 * bundled recorded fixture, in either byte encoding) into a {@link NormalizedStatValidation}.
 * Throws a typed {@link chainOnchainError} (`bad_proof`) when the shape is invalid.
 */
export function normalizeStatValidation(raw: unknown): NormalizedStatValidation {
  const parsed = StatValidationWireSchema.safeParse(raw);
  if (!parsed.success) {
    throw chainOnchainError("bad_proof", "stat-validation proof failed validation", {
      issues: parsed.error.issues.map((i) => i.path.join(".") || "(root)"),
    });
  }
  const v = parsed.data;
  const statB =
    v.statToProve2 !== undefined
      ? toStatTerm(v.statToProve2, v.eventStatRoot, v.statProof2 ?? [])
      : undefined;
  return {
    ts: v.ts,
    targetTs: v.summary.updateStats.minTimestamp,
    fixtureId: v.summary.fixtureId,
    updateCount: v.summary.updateStats.updateCount,
    minTimestamp: v.summary.updateStats.minTimestamp,
    maxTimestamp: v.summary.updateStats.maxTimestamp,
    eventsSubTreeRoot: toBytes32(v.summary.eventStatsSubTreeRoot),
    subTreeProof: toProofNodes(v.subTreeProof),
    mainTreeProof: toProofNodes(v.mainTreeProof),
    statA: toStatTerm(v.statToProve, v.eventStatRoot, v.statProof),
    ...(statB !== undefined ? { statB } : {}),
  };
}
