/**
 * Recorded-fixture model + Zod loader for the deterministic replay engine (§11).
 *
 * PLACEHOLDER DATA: `src/fixtures/wc-sample.json` is a SYNTHETIC but realistic
 * recorded World-Cup soccer fixture (kickoff → goals → full time). It is shaped to
 * validate against the live TxLINE `ScoresSchema` so the replay pipeline can be
 * built and tested offline, before a TxLINE API token is available (token
 * activation needs the agent wallet funded — CLAUDE.md Blockers (a)/(b)).
 * Once the token is available, replace this file with a real recorded fixture
 * (`TxlineClient.getScoresHistorical(fixtureId)`) — the loader and types stay the
 * same.
 *
 * STAT-KEY CONVENTION (mirrors TxLINE `stats` map keys):
 *  - statKey 1 → Participant1 score
 *  - statKey 2 → Participant2 score
 * Both are recorded at the {@link SETTLE_PERIOD} (full-time) period for settlement.
 */
import { z } from "zod";
import type { Stat } from "@clearline/core";
import type { Scores } from "@clearline/txline";
import { ScoresSchema } from "@clearline/txline";

/** statKey for Participant1's score in the recorded `stats` map. */
export const STAT_KEY_P1_SCORE = 1;
/** statKey for Participant2's score in the recorded `stats` map. */
export const STAT_KEY_P2_SCORE = 2;
/**
 * Derived statKey for total goals (P1 + P2). Not part of the TxLINE wire `stats`
 * map; {@link finalStats} synthesises it so a `single` total-goals predicate can be
 * evaluated by core's `evaluatePredicate` without needing an "add" binary op.
 */
export const STAT_KEY_TOTAL_GOALS = 100;
/** Period the settle-time stats are attributed to (full-time / total). */
export const SETTLE_PERIOD = 0;

/** A recorded fixture: an ordered sequence of `Scores` updates plus metadata. */
export interface RecordedFixture {
  readonly fixtureId: number;
  readonly label: string;
  readonly updates: ReadonlyArray<Scores>;
}

/**
 * Zod schema for the on-disk recorded-fixture shape. Each `updates[]` element is
 * validated with the live {@link ScoresSchema}, so a fixture that drifts from the
 * TxLINE contract is rejected at load time (§4: Zod at every boundary).
 */
export const RecordedFixtureSchema = z.strictObject({
  fixtureId: z.int(),
  label: z.string().min(1),
  updates: z.array(ScoresSchema).min(1),
});

/** Typed loader failure (no bare `throw "string"`, §4). */
export class FixtureError extends Error {
  readonly code: "invalid-fixture";
  readonly detail: unknown;
  constructor(message: string, detail: unknown) {
    super(message);
    this.name = "FixtureError";
    this.code = "invalid-fixture";
    this.detail = detail;
    Object.setPrototypeOf(this, FixtureError.prototype);
  }
}

/**
 * Parse + validate an unknown JSON value into a {@link RecordedFixture}. Throws a
 * typed {@link FixtureError} (carrying the flattened Zod issues) when the value does
 * not match the contract — including a malformed `updates[]` element.
 */
export function loadFixture(json: unknown): RecordedFixture {
  const parsed = RecordedFixtureSchema.safeParse(json);
  if (!parsed.success) {
    throw new FixtureError("recorded fixture failed validation", parsed.error.flatten());
  }
  return parsed.data;
}

/**
 * Derive the settle-time {@link Stat}s from a fixture's final update.
 *
 * Prefers the explicit `stats` map (statKey → integer value); when a participant's
 * key is absent it falls back to the `scoreSoccer.*.Total.score` field. Returns the
 * Participant1, Participant2, and (synthesised) total-goals scores at
 * {@link SETTLE_PERIOD}, which is exactly the input `evaluatePredicate` needs for
 * single total-goals / margin predicates. Pure — no I/O, no clock.
 */
export function finalStats(fixture: RecordedFixture): Stat[] {
  const last = fixture.updates[fixture.updates.length - 1];
  if (last === undefined) {
    // RecordedFixtureSchema guarantees ≥1 update, so this is defensive only.
    return [];
  }

  const p1 = scoreFor(last, STAT_KEY_P1_SCORE, "Participant1");
  const p2 = scoreFor(last, STAT_KEY_P2_SCORE, "Participant2");

  return [
    { key: STAT_KEY_P1_SCORE, value: p1, period: SETTLE_PERIOD },
    { key: STAT_KEY_P2_SCORE, value: p2, period: SETTLE_PERIOD },
    { key: STAT_KEY_TOTAL_GOALS, value: p1 + p2, period: SETTLE_PERIOD },
  ];
}

/** Read one participant's final score, preferring `stats[key]`, else `scoreSoccer`. */
function scoreFor(
  update: Scores,
  statKey: number,
  participant: "Participant1" | "Participant2",
): number {
  const stats = update.stats;
  if (stats !== undefined) {
    const fromMap = stats[String(statKey)];
    if (fromMap !== undefined) {
      return fromMap;
    }
  }
  return soccerTotalScore(update, participant);
}

/** Extract `scoreSoccer.<participant>.Total.score` as an integer, defaulting to 0. */
function soccerTotalScore(update: Scores, participant: "Participant1" | "Participant2"): number {
  const soccer = update.scoreSoccer;
  if (soccer === undefined) {
    return 0;
  }
  const side = soccer[participant];
  if (side === null || side === undefined || typeof side !== "object") {
    return 0;
  }
  const total = (side as Record<string, unknown>)["Total"];
  if (total === null || total === undefined || typeof total !== "object") {
    return 0;
  }
  const score = (total as Record<string, unknown>)["score"];
  return typeof score === "number" && Number.isInteger(score) ? score : 0;
}
