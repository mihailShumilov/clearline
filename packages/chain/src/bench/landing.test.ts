import { describe, expect, it } from "vitest";

import { runLandingBench } from "./landing";

describe("runLandingBench — §11b before/after", () => {
  it("the resilient pool beats a naive single endpoint under injected faults", async () => {
    const result = await runLandingBench({ attempts: 50, primaryErrorRate: 1, seed: 7 });

    // The naive client is pinned to the always-failing primary: it lands nothing.
    expect(result.naiveSuccesses).toBe(0);
    expect(result.naiveRate).toBe(0);

    // The resilient pool fails over to the clean backup on every request.
    expect(result.resilientSuccesses).toBe(50);
    expect(result.resilientRate).toBe(1);

    // The recorded headline: resilience strictly improves landing rate.
    expect(result.resilientRate).toBeGreaterThan(result.naiveRate);
  });

  it("is deterministic across runs with the same seed", async () => {
    const a = await runLandingBench({ attempts: 30, primaryErrorRate: 0.5, seed: 42 });
    const b = await runLandingBench({ attempts: 30, primaryErrorRate: 0.5, seed: 42 });
    expect(a).toEqual(b);
  });
});
