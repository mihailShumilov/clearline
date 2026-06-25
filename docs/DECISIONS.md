# ClearLine — Decision Records (ADR)

Short, append-only architecture decisions.

## ADR-0001 — Reconstructed specification

**Context:** the original `CLAUDE.md` was absent from the repo.
**Decision:** reconstruct a best-effort spec from the solana-resilience-kit README, the
live TxLINE docs, and a standard §0→9 hackathon structure; owner approved it before any
build. Versions pinned from live `npm view` (June 2026).
**Status:** Accepted.

## ADR-0002 — Cloudflare-first runtime (Workers + D1)

**Context:** the agent needs a recurring ingest loop and persistence; owner chose
Cloudflare-first over a Node runtime.
**Decision:** API + agent run on Cloudflare Workers; persistence is D1 via
`drizzle-orm/d1`. The ingest loop is a Durable Object (alarm) + Cron Trigger polling
TxLINE snapshots (free tier has a 60s delay, no rate limits — polling suffices) rather
than a held SSE socket. Local dev uses `wrangler dev` (miniflare, no login). Dashboard →
Cloudflare Pages.
**Consequences:** deploy + `wrangler secret put` + remote D1 need `wrangler login` (a
manual owner step); local build/test/replay need no login.
**Status:** Accepted.

## ADR-0003 — Codama clients, not the Anchor TS client at runtime

**Context:** solana-resilience-kit is built on `@solana/kit` (web3.js v2);
`@coral-xyz/anchor`'s TS client uses web3.js v1 `Connection`.
**Decision:** generate `@solana/kit`-native clients via **Codama** from both the
ClearLine and TxLINE IDLs; send every transaction through solana-resilience-kit's
`TransactionSender`. Anchor (Rust) is used only to author/build the program.
**Consequences:** honors §11b ("no bare @solana/kit RPC"); avoids the v1/v2 split.
**Status:** Accepted.

## ADR-0004 — Internal packages consumed as bundled source

**Context:** internal `@clearline/*` packages are consumed by Workers (esbuild), Vite,
tsx, and Vitest — never run as raw Node ESM from `dist/`.
**Decision:** use `moduleResolution: "Bundler"` with extensionless TS imports; the
bundler/test-runner resolves source. `tsc` build still emits `dist/` for typecheck/decl.
**Status:** Accepted. Revisit if a package must be published or run as raw Node ESM.

## ADR-0005 — Deterministic historical replay for the demo

**Context:** live World Cup matches end before judging.
**Decision:** snapshot one real completed fixture's score sequence + stat-validation
proof; replay it through the same pipeline with a `ReplayClock` + seeded source (mirrors
the resilience-kit manual-clock harness). On-chain settlement uses the recorded proof
against the real devnet root, so the verdict is reproducible.
**Status:** Accepted.

## OPEN (to resolve in-phase)

- Stat-validation auth header convention (Bearer-only vs Bearer + `X-Api-Token`) — Phase 1.
- ClearLine `settle` mechanism: CPI into TxLINE `validateStat` vs. record an
  independently verified verdict — decided from the Phase-4 spike.
