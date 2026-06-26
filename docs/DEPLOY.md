# ClearLine — Deploy

> **Live now:**
> Dashboard → https://clearline-dashboard.pages.dev/ · API → https://clearline-api.mschumilow.workers.dev
> (Cloudflare account `michael@vadimages.com`; devnet only.)
> The **autonomous loop** runs on a Cron Trigger + the `AgentLoop` Durable Object and settles
> on the **live `validate_stat` verdict** (`SOLANA_RPC_PRIMARY` Helius secret is set, so the
> Worker reaches devnet): `GET /api/agent/status` → `verdictSource: "onchain-live"`.

## Prerequisites

- A Cloudflare account + `wrangler login` (the only manual gate). Free tier covers
  Workers + D1 + Pages.
- **Secrets:** `SOLANA_RPC_PRIMARY` (a keyed **Helius devnet** URL) is set via
  `wrangler secret put` — the deployed loop uses it to settle on the **live** `validate_stat`
  verdict. Without it the Worker falls back to public devnet (which 403-blocks the workerd
  egress IP) and settles on the _recorded-and-reconciled_ on-chain verdict — still verifiable.
  (`TXLINE_*` only for _live_ in-play ingest, deferred per ADR-0009.)

## API (Hono Worker + D1)

```bash
wrangler login                                   # once (interactive)
pnpm --filter @clearline/api exec wrangler d1 create clearline
#   → copy database_id into apps/api/wrangler.toml  (already set to d6db3547-…)
pnpm --filter @clearline/api exec wrangler d1 migrations apply clearline --remote
pnpm --filter @clearline/api exec wrangler deploy
#   → https://clearline-api.<account>.workers.dev
```

## Dashboard (Vite SPA → Pages)

The API base is **inlined at build time**, so build with the deployed Worker URL:

```bash
VITE_API_BASE=https://clearline-api.mschumilow.workers.dev \
  pnpm --filter @clearline/dashboard build
pnpm --filter @clearline/dashboard exec wrangler pages project create clearline-dashboard --production-branch main
pnpm --filter @clearline/dashboard exec wrangler pages deploy dist --project-name clearline-dashboard --branch main
#   → https://clearline-dashboard.pages.dev/
```

CORS is open (`*`), so the Pages SPA can call the Worker cross-origin.

## RPC config — Helius primary + public devnet backup

`/api/health` probes the RPC pool through solana-resilience-kit. Public devnet
(`api.devnet.solana.com`) rate-limits Cloudflare egress, so it's the **backup**; the
**primary** is a keyed **Helius devnet** URL (Worker-friendly, no egress limit).

- `SOLANA_RPC_BACKUP_1 = https://api.devnet.solana.com` — committed in `wrangler.toml [vars]`.
- `SOLANA_RPC_PRIMARY` — the Helius URL is a **SECRET**; set it (value never committed/logged):
  ```bash
  pnpm --filter @clearline/api exec wrangler secret put SOLANA_RPC_PRIMARY
  # paste:  https://devnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY
  ```
  It applies to the live Worker immediately (no redeploy needed). Then the health panel
  shows Helius healthy/fresh (real slot + latency) with the public backup as failover.

For **local** dev, put both in `apps/api/.dev.vars` (gitignored):
`SOLANA_RPC_PRIMARY=https://devnet.helius-rpc.com/?api-key=…` and
`SOLANA_RPC_BACKUP_1=https://api.devnet.solana.com`.

> The demo headline (`POST /api/demo-replay` → real recorded on-chain verdict) works
> regardless of RPC health — health only powers the live RPC panel.

## Redeploy

Re-run `wrangler deploy` (API) / rebuild+`wrangler pages deploy` (dashboard). D1 data persists.
