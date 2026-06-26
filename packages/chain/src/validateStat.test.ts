import { describe, expect, it } from "vitest";
import type { RpcTransport } from "@solana/kit";
import { InMemoryMetrics } from "solana-resilience-kit";
import { MockCluster, MockEndpoint } from "solana-resilience-kit/testing";

import type { ChainConfig } from "./config";
import { ChainError } from "./errors";
import { createChainPool } from "./pool";
import type { NormalizedStatValidation } from "./proofEncoding";
import {
  DEFAULT_COMPUTE_UNIT_LIMIT,
  VALIDATE_STAT_DISCRIMINATOR,
  deriveDailyScoresRootsPda,
  encodeValidateStatData,
  epochDayFromTs,
  validateStatOnChain,
} from "./validateStat";
import { address } from "@solana/kit";

const ONE_ENDPOINT: ChainConfig = {
  cluster: "devnet",
  endpoints: [{ name: "primary", url: "https://api.devnet.solana.com" }],
};

const ZERO32 = new Uint8Array(32);

/** A minimal normalized proof (empty proofs) for structural + simulate tests. */
function tinyValidation(targetTs = 1_782_356_424_595): NormalizedStatValidation {
  return {
    ts: targetTs,
    targetTs,
    fixtureId: 17_588_395,
    updateCount: 2,
    minTimestamp: targetTs,
    maxTimestamp: targetTs + 1000,
    eventsSubTreeRoot: ZERO32,
    subTreeProof: [],
    mainTreeProof: [],
    statA: { statToProve: { key: 1, value: 1, period: 0 }, eventStatRoot: ZERO32, statProof: [] },
  };
}

/**
 * Wrap a MockEndpoint transport so `simulateTransaction` returns canned return-data,
 * delegating all other methods (getSlot/health probes) to the real mock. Exercises the
 * REAL resilient pool (§11b) while controlling the simulated verdict.
 */
function withSimulateReturnData(
  base: RpcTransport,
  returnDataBase64: string | null,
  err: unknown = null,
): RpcTransport {
  return (async (config) => {
    const payload = config.payload as { method: string; id: unknown };
    if (payload.method === "simulateTransaction") {
      return {
        jsonrpc: "2.0",
        id: payload.id,
        result: {
          context: { slot: 1n },
          value: {
            err,
            logs: [],
            accounts: null,
            unitsConsumed: 1000n,
            returnData:
              returnDataBase64 === null
                ? null
                : {
                    programId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
                    data: [returnDataBase64, "base64"],
                  },
          },
        },
      };
    }
    return base(config);
  }) as RpcTransport;
}

function poolWithVerdict(returnDataBase64: string | null, err: unknown = null) {
  const cluster = new MockCluster({ initialSlot: 1_000n, initialBlockHeight: 700n });
  const endpoint = new MockEndpoint(cluster, { name: "primary" });
  return createChainPool(ONE_ENDPOINT, {
    metrics: new InMemoryMetrics(),
    transportFor: () => withSimulateReturnData(endpoint.transport, returnDataBase64, err),
  });
}

describe("epochDayFromTs / deriveDailyScoresRootsPda", () => {
  it("derives epochDay 20629 for the recorded fixture's targetTs", () => {
    expect(epochDayFromTs(1_782_356_424_595)).toBe(20629);
  });

  it("derives the exact live daily_scores_roots PDA (epochDay 20629)", async () => {
    const pda = await deriveDailyScoresRootsPda(
      address("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"),
      20629,
    );
    // The real on-chain PDA recorded by the Phase-4 spike (ADR-0007 / PROGRESS.md).
    expect(String(pda)).toBe("CdUmkUdc4XBKeeq7Kq6JxQvnVMNuDA21mp98x4Rs3jHQ");
  });
});

describe("encodeValidateStatData", () => {
  it("prefixes the validate_stat discriminator", () => {
    const data = encodeValidateStatData(tinyValidation(), {
      comparison: "GreaterThan",
      threshold: 0,
    });
    expect([...data.slice(0, 8)]).toEqual([...VALIDATE_STAT_DISCRIMINATOR]);
  });

  it("encodes the predicate threshold (TRUE vs FALSE differ by one byte)", () => {
    const t = encodeValidateStatData(tinyValidation(), { comparison: "GreaterThan", threshold: 0 });
    const f = encodeValidateStatData(tinyValidation(), { comparison: "GreaterThan", threshold: 1 });
    expect(t).toHaveLength(f.length);
    const diffs = [...t].filter((b, i) => b !== f[i]).length;
    expect(diffs).toBe(1); // only the i32 threshold low byte changes
  });
});

describe("validateStatOnChain (simulate through the resilient pool)", () => {
  it("decodes AQ== as holds:true and surfaces the derived root PDA", async () => {
    const pool = poolWithVerdict("AQ==");
    const verdict = await validateStatOnChain(pool, tinyValidation(), {
      comparison: "GreaterThan",
      threshold: 0,
    });
    expect(verdict.holds).toBe(true);
    expect(verdict.rootPda).toBe("CdUmkUdc4XBKeeq7Kq6JxQvnVMNuDA21mp98x4Rs3jHQ");
    expect(verdict.epochDay).toBe(20629);
    expect(verdict.returnDataBase64).toBe("AQ==");
  });

  it("decodes AA== as holds:false", async () => {
    const pool = poolWithVerdict("AA==");
    const verdict = await validateStatOnChain(pool, tinyValidation(), {
      comparison: "GreaterThan",
      threshold: 1,
    });
    expect(verdict.holds).toBe(false);
  });

  it("throws a typed onchain error when the program returns an error", async () => {
    const pool = poolWithVerdict(null, { InstructionError: [1, "Custom"] });
    await expect(
      validateStatOnChain(pool, tinyValidation(), { comparison: "GreaterThan", threshold: 0 }),
    ).rejects.toBeInstanceOf(ChainError);
  });

  it("throws a typed onchain error when there is no return-data", async () => {
    const pool = poolWithVerdict(null);
    await expect(
      validateStatOnChain(pool, tinyValidation(), { comparison: "GreaterThan", threshold: 0 }),
    ).rejects.toMatchObject({ kind: "onchain", code: "no_return_data" });
  });

  it("honors the default compute-unit limit constant", () => {
    expect(DEFAULT_COMPUTE_UNIT_LIMIT).toBe(1_400_000);
  });
});
