/**
 * `runDemoReplay` — the canned, deterministic replay the future `/demo-replay`
 * command + API will call (§11, §7 Phase 8).
 *
 * Wires the bundled synthetic World-Cup fixture through the full agent pipeline with
 * a {@link LocalSettlementProvider}, a fresh deterministic clock + seeded RNG, and a
 * silent logger by default. Two calls produce a deep-equal {@link ReplayResult}.
 */
import type { Position, Predicate, Stat } from "@clearline/core";
import { makeEdge, settle as settleCore } from "@clearline/core";
import { AgentRunner, type ReplayResult } from "./agent";
import { ReplayClock } from "./clock";
import { loadFixture, type RecordedFixture } from "./fixture";
import type { Logger } from "./logger";
import { noopLogger } from "./logger";
import { createRng } from "./rng";
import { loadRealFixture, type RealFixture } from "./realFixture";
import { LocalSettlementProvider, RecordedSettlementProvider } from "./settlement";
import { InMemoryPositionStore } from "./store";
import { makeOverGoalsStrategy } from "./strategy";
import wcSample from "./fixtures/wc-sample.json";
import wcReal from "./fixtures/wc-real-17588395.json";

/** The deterministic RNG seed used by the demo replay. */
export const DEMO_SEED = 0xc1ead11e;

/** The fixture id of the bundled synthetic World-Cup sample. */
export const DEMO_FIXTURE_ID = 900001;

/** The fixture id of the bundled REAL recorded devnet capture (ADR-0005, ADR-0007). */
export const REAL_FIXTURE_ID = 17588395;

/**
 * The deterministic stake/price for the real-fixture replay. Stake 1_000_000 lamports
 * at 1.8x (18_000 bps) → integer profit 800_000 lamports on a winning verdict, matching
 * the synthetic demo's P&L model.
 */
const REAL_STAKE_LAMPORTS = 1_000_000n;
const REAL_PRICE_BPS = 18_000;
/** A fixed, non-wall-clock claim timestamp so the result is reproducible. */
const REAL_CLAIMED_AT_MS = 0;

/** Load the bundled synthetic World-Cup fixture (Zod-validated). */
export function loadDemoFixture(): RecordedFixture {
  return loadFixture(wcSample);
}

/** Load the bundled REAL recorded devnet fixture (Zod-validated). */
export function loadRealDemoFixture(): RealFixture {
  return loadRealFixture(wcReal);
}

/**
 * Run the bundled demo replay. Routes to {@link runRealDemoReplay} for
 * {@link REAL_FIXTURE_ID}; otherwise drives the bundled SYNTHETIC fixture. `fixtureId`
 * is accepted for the `/demo-replay <fixtureId>` command surface; an unknown id is
 * rejected with a clear error.
 */
export async function runDemoReplay(
  fixtureId: number = DEMO_FIXTURE_ID,
  logger: Logger = noopLogger,
): Promise<ReplayResult> {
  if (fixtureId === REAL_FIXTURE_ID) {
    return runRealDemoReplay(logger);
  }

  const fixture = loadDemoFixture();
  if (fixtureId !== fixture.fixtureId) {
    throw new Error(
      `unknown demo fixture ${fixtureId}; only ${fixture.fixtureId} and ` +
        `${REAL_FIXTURE_ID} are bundled today`,
    );
  }

  return AgentRunner.runReplay({
    fixture,
    strategy: makeOverGoalsStrategy(),
    settlement: new LocalSettlementProvider(),
    store: new InMemoryPositionStore(),
    clock: new ReplayClock(),
    rng: createRng(DEMO_SEED),
    logger,
  });
}

/**
 * Replay the REAL recorded devnet fixture and settle on the REAL on-chain verdict
 * (ADR-0005, ADR-0007).
 *
 * Deterministic and pure: builds the recorded TRUE predicate ("Participant 1 scores
 * at least 1 goal" — `chosen.statKey > 0`), opens a fixed-stake position, derives the
 * settle-time stat from `chosen`/`statToProve`, and settles through a
 * {@link RecordedSettlementProvider}. The provider reconciles the locally computed
 * verdict against the recorded on-chain result, so the returned `holds: true` IS the
 * real on-chain verdict. The result carries the Explorer link, root PDA, program id,
 * and integer P&L. Two runs produce a deep-equal {@link ReplayResult}.
 */
export async function runRealDemoReplay(logger: Logger = noopLogger): Promise<ReplayResult> {
  const fixture = loadRealDemoFixture();
  const fixtureId = fixture.fixtureId;
  const { statToProve } = fixture.statValidation;

  logger.info("replay.real.start", {
    fixtureId,
    statKey: fixture.chosen.statKey,
    seq: fixture.chosen.seq,
  });

  // The recorded TRUE predicate: chosen stat value > 0 ("at least 1 goal").
  const predicate: Predicate = {
    kind: "single",
    statKey: fixture.chosen.statKey,
    period: statToProve.period,
    op: ">",
    threshold: 0,
  };

  const built = makeEdge({
    fixtureId,
    predicate,
    stakeLamports: REAL_STAKE_LAMPORTS,
    priceBps: REAL_PRICE_BPS,
    claimedAtMs: REAL_CLAIMED_AT_MS,
  });
  if (!built.ok) {
    // Defensive: the inputs above are constant and valid.
    throw new Error(`failed to build real edge: ${built.error.code}`);
  }

  const store = new InMemoryPositionStore();
  const id = `fixture:${fixtureId}`;
  const opened: Position = { edge: built.edge, status: "open" };
  await store.open(id, opened);

  // Settle-time stat from the chosen stat + statToProve period (what was proven).
  const statsAtSettle: Stat[] = [
    { key: fixture.chosen.statKey, value: fixture.chosen.statValue, period: statToProve.period },
  ];

  const settlement = new RecordedSettlementProvider(fixture);
  const outcome = await settlement.settle({ fixtureId, predicate, statsAtSettle });

  const settled = settleCore(opened, outcome.holds);
  if (!settled.ok) {
    // Defensive: a freshly opened position cannot already be settled.
    throw new Error(`failed to settle real position: ${settled.error.code}`);
  }
  const finalPosition: Position = { edge: built.edge, status: settled.outcome.status };
  await store.update(id, { position: finalPosition });

  logger.info("replay.real.done", {
    fixtureId,
    holds: outcome.holds,
    source: outcome.source,
    status: settled.outcome.status,
    pnlLamports: settled.outcome.pnlLamports,
  });

  return {
    fixtureId,
    positions: [finalPosition],
    settlements: [outcome],
    pnlLamports: settled.outcome.pnlLamports,
    onchain: {
      subscribeExplorer: fixture.onchain.subscribeExplorer,
      dailyScoresRootsPda: fixture.onchain.dailyScoresRootsPda,
      programId: fixture.onchain.programId,
      verdictSource: "onchain-recorded",
    },
  };
}
