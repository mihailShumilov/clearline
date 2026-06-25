# apps/api — Hono on Cloudflare Workers

> Scaffolded in **Phase 6**. Placeholder until then (no `package.json`, so pnpm
> ignores it).

REST + SSE surface for the Proof-of-Edge dashboard and agent control:
positions, edges, settlements (with signatures), RPC health, agent status, and
replay start/stop. Persistence is **D1** via `drizzle-orm/d1`. The autonomous
agent loop runs as a **Durable Object** (alarm-driven) plus a **Cron Trigger**
that polls TxLINE snapshots (Phase 5). Runs locally under `wrangler dev`
(miniflare, no login); deploy needs `wrangler login`.
