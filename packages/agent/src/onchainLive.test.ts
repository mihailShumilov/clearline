/**
 * LIVE on-chain acceptance (Task 1 / §13): the production {@link OnChainSettlementProvider}
 * settles the recorded fixture against the LIVE devnet `daily_scores_roots` root via a
 * read-only `validate_stat` simulation through `@clearline/chain`. Opt-in (needs network):
 *
 *   ONCHAIN_LIVE=1 pnpm exec vitest run packages/agent/src/onchainLive.test.ts
 *
 * It is skipped in the default gate so CI/offline runs stay deterministic.
 */
import { describe, expect, it } from "vitest";
import { createChainPool, loadChainConfig } from "@clearline/chain";

import { loadRealDemoFixture, realTruePredicate, settleRealFixtureOnChain } from "./demo";

const live = process.env["ONCHAIN_LIVE"] ? it : it.skip;

describe("OnChainSettlementProvider — live devnet (opt-in: ONCHAIN_LIVE=1)", () => {
  live(
    "settles the recorded fixture against the live root — TRUE (value>0) and FALSE (value>1)",
    async () => {
      const pool = createChainPool(
        loadChainConfig({ SOLANA_RPC_PRIMARY: "https://api.devnet.solana.com" }),
      );
      const fixture = loadRealDemoFixture();

      const trueOutcome = await settleRealFixtureOnChain(pool, realTruePredicate(fixture));
      expect(trueOutcome.holds).toBe(true);
      expect(trueOutcome.source).toBe("onchain");
      expect(trueOutcome.verifiedOnChain).toBe(true);
      expect(trueOutcome.rootPda).toBe(fixture.onchain.dailyScoresRootsPda);
      expect(trueOutcome.programId).toBe(fixture.onchain.programId);

      const falseOutcome = await settleRealFixtureOnChain(pool, {
        ...realTruePredicate(fixture),
        threshold: 1,
      });
      expect(falseOutcome.holds).toBe(false);
      expect(falseOutcome.verifiedOnChain).toBe(true);
    },
    30_000,
  );
});
