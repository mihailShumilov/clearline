# `@clearline/dashboard` — Proof-of-Edge (Vite + React 19)

The **Proof-of-Edge** dashboard (§7 Phase 7): a dark "settlement terminal" that
renders the agent's edges/positions, each settlement with its **Solana Explorer
link + on-chain verdict (TRUE/FALSE)**, running P&L, a live SSE event ticker, and
the headline **RPC Health** panel sourced from solana-resilience-kit telemetry
(§11b). Built as a static Vite SPA deployable to Cloudflare Pages.

Every API response is validated with **Zod** at the boundary (`unknown` → parsed);
a transport failure flips a disconnected state rather than crashing the UI.

## Consuming the Phase 6 API

The client reads its base URL from `VITE_API_BASE` (defaults to
`http://localhost:8787`, the local `wrangler dev` worker). Endpoints used:
`GET /api/health`, `/api/agent/status`, `/api/positions`, `/api/settlements`,
`/api/edges`; `POST /api/demo-replay`; and the `GET /api/events` SSE stream.

## Run locally

Bring the API up first (Phase 6, under `wrangler dev` on port 8787):

```sh
# In one shell — the API against local D1 (no wrangler login needed).
pnpm --filter @clearline/api dev

# In another — the dashboard dev server (http://localhost:5173).
pnpm --filter @clearline/dashboard dev
```

Point the dashboard at a non-default API with an env var:

```sh
VITE_API_BASE=http://127.0.0.1:8787 pnpm --filter @clearline/dashboard dev
```

## Build

```sh
pnpm --filter @clearline/dashboard build   # vite build → apps/dashboard/dist/
```

The build emits a static SPA into `dist/`, including `public/_redirects`
(`/* /index.html 200`) so Cloudflare Pages serves client-side routes.

## Deploy to Cloudflare Pages

Deploying requires a one-time `wrangler login` (a manual owner step):

```sh
wrangler login
wrangler pages deploy apps/dashboard/dist --project-name clearline-dashboard
```

Set the production API base as a Pages build/environment variable
(`VITE_API_BASE`) so the deployed SPA targets the deployed Worker.

## Verify

```sh
pnpm --filter @clearline/dashboard typecheck
pnpm --filter @clearline/dashboard build
```
