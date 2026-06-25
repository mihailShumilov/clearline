import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config for the D1 (SQLite) schema. `db:generate` emits versioned
 * migration SQL into `migrations/`, which `wrangler d1 migrations apply` runs.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./migrations",
});
