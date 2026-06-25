/**
 * `runDemoReplay` — the canned, deterministic replay the future `/demo-replay`
 * command + API will call (§11, §7 Phase 8).
 *
 * Wires the bundled synthetic World-Cup fixture through the full agent pipeline with
 * a {@link LocalSettlementProvider}, a fresh deterministic clock + seeded RNG, and a
 * silent logger by default. Two calls produce a deep-equal {@link ReplayResult}.
 */
import { AgentRunner, type ReplayResult } from "./agent";
import { ReplayClock } from "./clock";
import { loadFixture, type RecordedFixture } from "./fixture";
import type { Logger } from "./logger";
import { noopLogger } from "./logger";
import { createRng } from "./rng";
import { LocalSettlementProvider } from "./settlement";
import { InMemoryPositionStore } from "./store";
import { makeOverGoalsStrategy } from "./strategy";
import wcSample from "./fixtures/wc-sample.json";

/** The deterministic RNG seed used by the demo replay. */
export const DEMO_SEED = 0xc1ead11e;

/** The fixture id of the bundled synthetic World-Cup sample. */
export const DEMO_FIXTURE_ID = 900001;

/** Load the bundled synthetic World-Cup fixture (Zod-validated). */
export function loadDemoFixture(): RecordedFixture {
  return loadFixture(wcSample);
}

/**
 * Run the bundled demo replay. `fixtureId` is accepted for forward-compatibility
 * with the `/demo-replay <fixtureId>` command surface; only {@link DEMO_FIXTURE_ID}
 * is bundled today, so any other id is rejected with a clear error.
 */
export async function runDemoReplay(
  fixtureId: number = DEMO_FIXTURE_ID,
  logger: Logger = noopLogger,
): Promise<ReplayResult> {
  const fixture = loadDemoFixture();
  if (fixtureId !== fixture.fixtureId) {
    throw new Error(
      `unknown demo fixture ${fixtureId}; only ${fixture.fixtureId} is bundled today`,
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
