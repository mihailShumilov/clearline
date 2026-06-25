/**
 * Drizzle **SQLite** schema for the ClearLine API's D1 database (§7 Phase 6).
 *
 * D1 is SQLite, so the schema uses `sqliteTable` and the `sqlite-core` column
 * builders; the same definitions drive `drizzle-kit generate` (dialect "sqlite")
 * to produce the committed migration SQL.
 *
 * MONEY IS INTEGER (§4): lamports are `bigint` in the domain. SQLite has no native
 * bigint column, so amounts are stored as **text** (a decimal string) and converted
 * back to `bigint` at the repository boundary — never as a float.
 */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * A settled/open position the replay produced. `pnlLamports` and `stakeLamports`
 * are decimal strings (bigint-safe). `predicateJson` is the JSON-serialized core
 * `Predicate`. `status` is the core `PositionStatus` ("open" | "won" | "lost" |
 * "void").
 */
export const positions = sqliteTable("positions", {
  id: text("id").primaryKey(),
  fixtureId: integer("fixture_id").notNull(),
  predicateJson: text("predicate_json").notNull(),
  stakeLamports: text("stake_lamports").notNull(),
  priceBps: integer("price_bps").notNull(),
  status: text("status").notNull(),
  pnlLamports: text("pnl_lamports").notNull(),
  claimedAtMs: integer("claimed_at_ms").notNull(),
});

/**
 * A settlement verdict and its provenance. `holds` is stored as an integer flag
 * (0/1) since SQLite has no native boolean. `source` is "local" | "onchain". The
 * on-chain evidence columns (`signature`, `explorerUrl`, `rootPda`, `programId`)
 * are nullable — present only for the real recorded on-chain path.
 */
export const settlements = sqliteTable("settlements", {
  id: text("id").primaryKey(),
  positionId: text("position_id").notNull(),
  holds: integer("holds").notNull(),
  source: text("source").notNull(),
  signature: text("signature"),
  explorerUrl: text("explorer_url"),
  rootPda: text("root_pda"),
  programId: text("program_id"),
  createdAtMs: integer("created_at_ms").notNull(),
});

/**
 * The append-only event log replayed over SSE to the dashboard's live panel.
 * `dataJson` carries the JSON-serialized event payload; `ts` is epoch ms.
 */
export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ts: integer("ts").notNull(),
  kind: text("kind").notNull(),
  dataJson: text("data_json").notNull(),
});

export type PositionRow = typeof positions.$inferSelect;
export type SettlementRow = typeof settlements.$inferSelect;
export type EventRow = typeof events.$inferSelect;
