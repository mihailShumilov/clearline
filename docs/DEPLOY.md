# ClearLine — Deploy

> **Live now:**
> Dashboard → https://clearline-dashboard.pages.dev/ · API → https://clearline-api.mschumilow.workers.dev
> (Cloudflare account `michael@vadimages.com`; devnet only.)

## Prerequisites

- A Cloudflare account + `wrangler login` (the only manual gate). Free tier covers
  Workers + D1 + Pages.
- **No secrets required for the demo:** the Worker defaults to public devnet RPC and serves
  the _recorded_ on-chain verdict from D1. (Optional: `wrangler secret put SOLANA_RPC_PRIMARY`
  for a private RPC; `TXLINE_*` only for _live_ ingest.)

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

## Known caveat — live RPC Health from Workers

`/api/health` probes a devnet RPC through solana-resilience-kit. Public devnet endpoints
(`api.devnet.solana.com`) frequently rate-limit Cloudflare egress, so the **deployed**
health panel may show the endpoint as degraded / `slot: null`. This does **not** affect the
headline (`POST /api/demo-replay` serves the real recorded on-chain verdict from D1 and works
live). For a pristine RPC-Health panel in the demo video, either:

- run the stack **locally** (`wrangler dev` + `vite dev`) from a normal IP (best panel), or
- set a keyed devnet RPC: `wrangler secret put SOLANA_RPC_PRIMARY` (e.g. a Helius/QuickNode devnet URL).

## Redeploy

Re-run `wrangler deploy` (API) / rebuild+`wrangler pages deploy` (dashboard). D1 data persists.
