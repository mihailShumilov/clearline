# `@clearline/api` — Hono on Cloudflare Workers

Phase 6 REST + SSE surface for the **Proof-of-Edge dashboard** and the
agent/replay data. Hono runs natively on **Cloudflare Workers**; persistence is
**D1** (SQLite) via `drizzle-orm/d1`. The DB sits behind a `Repository` interface,
so handlers are unit-tested with an in-memory fake — no miniflare needed.

## Architecture

- `src/db/schema.ts` — Drizzle **SQLite** schema (`positions`, `settlements`,
  `events`). Money (`bigint` lamports) is stored as **text** decimal strings (§4).
- `src/db/repo.ts` — the `Repository` interface, `D1Repository` (production, over
  `drizzle-orm/d1`), and `InMemoryRepository` (tests/local). Bigints are serialized
  as strings at the boundary.
- `src/routes.ts` — `createApp(deps)` returning a Hono app. `deps` is injected
  (`repo`, `health`, `runReplay`) so the same app is driven by the Worker entry and
  by Vitest.
- `src/index.ts` — the Worker entry: wires `D1Repository(env.DB)`, a `health`
  closure (resilient chain pool → `toHealthSnapshot`, tolerating RPC errors), and
  `runReplay = runDemoReplay`.

## Routes

| Method + path           | Returns                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `GET /`                 | JSON index of routes                                          |
| `GET /api/health`       | `{ ok, rpc: HealthSnapshotDTO }` (RPC Health panel)           |
| `GET /api/agent/status` | agent status (idle/running + last replay summary)             |
| `GET /api/positions`    | persisted positions                                           |
| `GET /api/settlements`  | persisted settlements (with on-chain evidence)                |
| `GET /api/edges`        | the staked predicate of each position                         |
| `POST /api/demo-replay` | runs + persists a replay; returns the verdict + Explorer link |
| `GET /api/events`       | **SSE** stream of stored events + a heartbeat                 |

`POST /api/demo-replay` takes an optional `{ "fixtureId": number }` body (default
`REAL_FIXTURE_ID` = 17588395), validated with Zod (a bad body → 400). It is
idempotent — re-running upserts the same `fixture:<id>` rows.

## Local setup

```sh
# 1. Generate the D1 migration SQL from the Drizzle schema (already committed).
pnpm --filter @clearline/api db:generate

# 2. Apply migrations to the LOCAL D1 (miniflare; no wrangler login needed).
pnpm --filter @clearline/api exec wrangler d1 migrations apply clearline --local

# 3. Run the Worker locally against the local D1.
pnpm --filter @clearline/api dev          # wrangler dev (default port 8787)

# 4. Smoke it.
curl -s localhost:8787/api/health
curl -s -XPOST localhost:8787/api/demo-replay
curl -sN localhost:8787/api/events
```

`.dev.vars` (gitignored) supplies `SOLANA_RPC_*` for the health pool locally;
deploy + `wrangler secret put` + remote D1 (`wrangler d1 create clearline`, then
replace the placeholder `database_id` in `wrangler.toml`) require `wrangler login`
— a manual owner step (ADR-0002).

## Test

```sh
pnpm --filter @clearline/api typecheck
pnpm --filter @clearline/api test
```
