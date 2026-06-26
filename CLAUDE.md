# ClearLine — Project Specification (CLAUDE.md)

> **STATUS: Implemented (spec reconciled against the build).**
> This spec was reconstructed (the original `CLAUDE.md` was absent from the repo) from the
> `solana-resilience-kit` README (the §11b library), the live TxLINE docs
> (`https://txline-docs.txodds.com/llms.txt` and linked pages), the installed toolchain, and
> a standard §0→9 hackathon build structure; the owner approved the reconstruction before the
> build (ADR-0001). The project is now built against it. Pinned versions are real (verified via
> `npm view`, June 2026). Every "ASSUMPTION" and "OPEN" marker below has been **reconciled
> against the implementation** — each is annotated inline (VERIFIED / RESOLVED / REFINED) with
> the deciding ADR. The standing remaining items are owner actions: record the demo video and
> deploy (`wrangler login` + a keyed `SOLANA_RPC_PRIMARY`).

---

## §1 — Vision

**ClearLine** is an autonomous settlement agent on **Solana devnet** that turns a
live sports-data oracle into trustless, verifiable on-chain settlement.

- **Input (live):** TxLINE (TxODDS Oracle) — high-fidelity, scout-verified sports
  scores/odds, anchored on Solana via hourly Merkle roots. ClearLine consumes the
  **World Cup & International Friendlies free tier** as a live Server-Sent-Events
  stream of score/odds updates.
- **Decision (deterministic):** From the live feed the agent forms an **edge** — a
  precise, integer-valued **predicate** over match statistics (e.g. "Participant1
  full-time score ≥ Participant2 + 2", "total goals > 2"). All decision math is
  pure and unit-tested.
- **Settlement (trustless):** When a fixture completes, the agent fetches a
  **three-stage Merkle proof** for the deciding statistic and submits it to the
  TxLINE on-chain program's **`validateStat`** instruction, which verifies the
  statistic against the **published daily-scores Merkle root** and returns whether
  the predicate holds. No trusted reporter sits in the settlement path — the data
  is cryptographically anchored.
- **Proof-of-Edge dashboard:** Renders the agent's open/closed positions, the edge
  it claimed, each settlement with its Solana Explorer link and Merkle-proof
  verdict, running P&L, and a live **RPC Health** panel sourced from
  solana-resilience-kit telemetry.
- **Reproducible demo:** Because live World Cup matches end before judging, a
  deterministic **historical replay** (`/demo-replay <fixtureId>`) drives the whole
  pipeline — ingest → edge → position → on-chain settlement — to an identical
  result every run, for a recorded video.

**Hackathon:** _The TxODDS Hackathon Challenge 2026_ (World Cup). Network: **devnet only.**

---

## §2 — Tech stack & pinned versions

Pinned to the latest published majors as of **June 2026** (verified via `npm view`).
**Do not move majors.** Verify any unfamiliar API via Context7 MCP before use.

### Toolchain (present on this machine)

| Tool          | Version                   |
| ------------- | ------------------------- |
| Node          | 24.13.0 (engines: `>=20`) |
| pnpm          | 9.15.4 (package manager)  |
| anchor-cli    | 1.0.2                     |
| solana-cli    | 3.1.14 (Agave)            |
| rustc / cargo | 1.93.0                    |

### npm dependencies (pinned)

| Package                      | Version   | Used in                                           |
| ---------------------------- | --------- | ------------------------------------------------- |
| `@solana/kit`                | `6.10.0`  | chain (peer of the kit)                           |
| `solana-resilience-kit`      | `1.2.0`   | chain (ALL RPC)                                   |
| `@opentelemetry/api`         | `1.9.1`   | chain (metrics)                                   |
| `@opentelemetry/sdk-metrics` | `2.8.0`   | api/agent (meter provider)                        |
| `codama`                     | `1.8.0`   | chain (IDL → kit client)                          |
| `@codama/nodes-from-anchor`  | `1.5.1`   | chain (Anchor IDL ingest)                         |
| `hono`                       | `4.12.27` | apps/api                                          |
| `@hono/node-server`          | `2.0.6`   | apps/api (Node runtime)                           |
| `drizzle-orm`                | `0.45.2`  | api/agent persistence (`drizzle-orm/d1`)          |
| `drizzle-kit`                | `0.31.10` | D1 migrations (`dialect: "sqlite"`)               |
| `better-sqlite3`             | `12.11.1` | optional: local replay-fixture store / core tests |
| `wrangler`                   | `4.104.0` | Workers + D1 dev/deploy (PRIMARY runtime)         |
| `react`                      | `19.2.7`  | apps/dashboard                                    |
| `vite`                       | `8.1.0`   | apps/dashboard                                    |
| `zod`                        | `4.4.3`   | all boundaries                                    |
| `vitest`                     | `4.1.9`   | tests + coverage                                  |
| `typescript`                 | `6.0.3`   | all                                               |
| `eslint`                     | `10.5.0`  | flat config                                       |
| `prettier`                   | `3.8.4`   | formatting                                        |
| `tsx`                        | `4.22.4`  | scripts/spikes                                    |

Rust: `anchor-lang` / `anchor-spl` pinned to match the installed `anchor-cli` (1.0.2);
confirm exact crate version via `avm`/`anchor --version` in Phase 4.

**ASSUMPTION → REFINED (ADR-0003, ADR-0008):** Anchor TS client is _not_ used at runtime —
**confirmed**. Every RPC goes through `@clearline/chain` (`pool.rpc()`), avoiding the
web3.js-v1/v2 split (§11b). Refinement: the one runtime on-chain call is the **read-only**
TxLINE `validate_stat` (`.view()`/simulate), and it is encoded by a small **hand-rolled
`@solana/kit` Borsh encoder** (`packages/chain/src/validateStat.ts`, byte-identical to the
Anchor coder via a golden vector) rather than a generated **Codama** client — a single read
instruction did not warrant a code-gen renderer (ADR-0008). Codama remains the path if the
`clearline_settlement` write client or many TxLINE instructions are added later.

---

## §3 — `.claude/` workspace setup (do first, Phase 0)

### §3.1 `settings.json` permissions

- **allow:** `pnpm *`, `node *`, `tsx *`, `cargo *`, `rustc *`, `anchor *`,
  `avm *`, `solana *` (devnet config), `git *`, `gh *`, `npm view *`,
  `curl -sSL --max-time * https://txline*`, `wrangler whoami`, `wrangler pages *`.
- **deny (blocking):** reading/writing `**/.env`, `**/*.key`, `**/id.json`,
  `**/*keypair*.json`, `**/wallet*.json`; `git push --force*`; `solana ... mainnet*`;
  `solana airdrop` outside devnet; any `rm -rf` outside the repo; printing secrets
  (`cat .env*`).
- `defaultMode`: prompt for writes outside the repo and for network-mutating cmds.

### §3.2 Subagents (six)

Create under `.claude/agents/`:

1. **solana-anchor-dev** — Anchor (Rust) `clearline_settlement` program, devnet
   deploy, IDL, Codama client generation, on-chain spikes, Explorer verification.
2. **quant-logic** — pure deterministic math in `packages/core`: edge model,
   predicate evaluation, integer money/odds, settlement P&L, property tests.
3. **txline-integrator** — TxLINE client in `packages/txline`: guest-JWT + token
   activation, SSE ingest, snapshots, `/api/scores/stat-validation`, Zod schemas,
   `docs/API.md` + `docs/FEEDBACK.md`.
4. **resilience-engineer** — `packages/chain` over solana-resilience-kit: ≥2–3 RPC
   failover, OTel metrics, cluster guard, fault-harness tests, `docs/RESILIENCE_KIT_REPORT.md`,
   issues/PRs upstream.
5. **frontend-dashboard** — `apps/dashboard` (Vite + React): Proof-of-Edge views,
   RPC Health panel, live event stream, Explorer links.
6. **reviewer** — PR review against §4 quality gates + security; runs before every
   squash-merge; never rubber-stamps.

### §3.3 Slash commands (`.claude/commands/`)

- `/phase-start <n>` — create `feat/<phase>-<slug>`, scaffold, restate acceptance.
- `/check` — `pnpm check` (lint + typecheck + test + build) to green.
- `/devnet-spike` — run the Phase-4 `validateStat` spike against a completed fixture.
- `/demo-replay <fixtureId>` — deterministic historical replay (see §11).
- `/resilience-report` — append before/after metrics + findings to RESILIENCE_KIT_REPORT.md.
- `/ship <phase>` — `/check` → acceptance → Conventional Commit → open PR → `reviewer`.

---

## §4 — Quality gates (blocking on every commit)

- **TypeScript strict**; **no `any`** — use `unknown` + **Zod** at every external
  boundary (TxLINE responses, env, RPC payloads, request bodies).
- **Deterministic logic lives in `packages/core` as pure functions** with **≥90%
  Vitest coverage** (lines/functions/statements ≥90, branches ≥85).
- **Money, odds, scores are integers** (lamports, basis points, micro-units). No
  floating-point in settlement or P&L.
- **Structured logging** (JSON, leveled, no secrets) and **typed errors**
  (discriminated unions / tagged error classes), no bare `throw "string"`.
- **ESLint 10 flat config + Prettier** green on every commit. `pnpm check` is the
  gate; CI (or a local pre-PR run) must pass before any merge.

---

## §5 — Security

- **Never commit secrets.** `TXLINE_JWT`, `TXLINE_API_TOKEN`, `SOLANA_AGENT_SECRET`
  live in **`.dev.vars`** (gitignored) for local `wrangler dev`, and are set via
  **`wrangler secret put`** for deployed Workers. (`.env` is also gitignored for any
  Node-side scripts/spikes.)
- **Devnet only.** The agent wallet is a **dedicated** devnet keypair, generated
  locally, funded by devnet airdrop, never reused on mainnet.
- Respect the `.claude/settings.json` deny rules. `.env.example` documents the keys
  with placeholder values only.

---

## §6 — Monorepo layout

```
clearline/
  package.json            # pnpm workspace root; "check": lint && typecheck && test && build
  pnpm-workspace.yaml
  tsconfig.base.json      # strict
  eslint.config.mjs       # ESLint 10 flat
  .prettierrc  .gitignore  .env.example
  vitest.config.ts        # coverage gates scoped to packages/core
  packages/
    core/      # pure: edge, predicates, settlement math, integer money — ≥90% cov
    chain/     # solana-resilience-kit pool/sender, OTel, cluster guard, Codama clients
    txline/    # TxLINE client: auth, SSE ingest, snapshots, stat-validation, Zod
    agent/     # autonomous loop: ingest → decide(core) → open → settle(chain); Drizzle
    contracts/ # Anchor program `clearline_settlement` (positions + settle) + IDL
  apps/
    api/       # Hono (@hono/node-server) REST + SSE for the dashboard & agent control
    dashboard/ # Vite + React Proof-of-Edge dashboard
  docs/
    PROGRESS.md DECISIONS.md ARCHITECTURE.md API.md SUBMISSION.md
    FEEDBACK.md RESILIENCE_KIT_REPORT.md
  README.md
```

**Deployment (DECISION — Cloudflare-first):** API + agent run on **Cloudflare
Workers**; persistence is **D1** via `drizzle-orm/d1`. Hono targets Workers natively.
The long-lived ingest loop is **not** a held SSE socket — it is a **Durable Object**
(state + alarm-driven loop) and/or a **Cron Trigger** that pulls TxLINE score
snapshots on an interval (the free tier has a 60s delay and no rate limits, so polling
is sufficient). The dashboard is a static Vite build on **Cloudflare Pages**.
Local dev uses `wrangler dev` (miniflare, **no login required**) with a local D1 and
`.dev.vars` for secrets; **deploy** (`wrangler deploy` / Pages) and `wrangler secret
put` require `wrangler login` — a **manual** step (see Blockers).

---

## §7 — Phases (execute strictly 0 → 9)

Each phase: branch `feat/<phase>-<slug>` → implement → `pnpm check` green →
acceptance test → Conventional Commit → PR → `reviewer` subagent → squash-merge.
**Do not advance until the current acceptance passes.**

- **Phase 0 — Bootstrap.** `git init`; pnpm workspace; strict TS; ESLint10 flat +
  Prettier; Vitest; `.claude/` (§3); empty package skeletons; `.env.example`.
  _Acceptance:_ `pnpm check` green on the empty monorepo; six subagents + slash
  commands present; `solana config` set to devnet; agent keypair generated (gitignored).

- **Phase 1 — TxLINE read integration.** `packages/txline`: guest JWT
  (`POST /auth/guest/start`), token activation (`POST /api/token/activate`,
  empty-leagues World Cup free tier), typed (Zod) snapshot reads for a World Cup
  fixture (fixtures, score snapshots, full score sequence). Document every endpoint
  used in `docs/API.md`; note friction in `docs/FEEDBACK.md`.
  _Acceptance:_ a live call returns a real World Cup fixture + Zod-validated score
  snapshot; recorded in API.md. (If activation needs a paid/manual step → Blocker.)

- **Phase 2 — Resilience chain layer.** `packages/chain`: `ResilientRpcPool` over
  **≥2–3 devnet RPC endpoints**, `HealthMonitor`, `CreditRateLimiter`, devnet
  `clusterGuard`, `OtelMetrics`. All RPC in the project goes through this module.
  _Acceptance:_ `pool.health()` lists ≥2 endpoints; a `getSlot` succeeds with a
  forced-failover test using `solana-resilience-kit/testing` (drops/429/lag) — green.

- **Phase 3 — Core quant logic.** `packages/core`: `Edge`, `Predicate`
  (single-stat + two-stat margin with operator), `evaluatePredicate`, integer
  `Money`/odds, `settlePosition` P&L. Pure functions, property tests.
  _Acceptance:_ core coverage ≥90% (branches ≥85); predicate/settlement
  property tests pass; zero `any`.

- **Phase 4 — On-chain settlement (RISK NODE — spike first).** Step (a): a minimal
  **devnet spike** (`/devnet-spike`) that, for a **completed** World Cup fixture,
  fetches the three-stage Merkle proof and submits the TxLINE **`validateStat`**
  call, producing a **real transaction/verdict** proving a predicate against the
  published `daily_scores_roots` PDA. Step (b): the ClearLine Anchor program
  `clearline_settlement` (Position account: predicate, stake, status; `open` +
  `settle`), Codama-generated kit client, sent via resilience-kit. The settlement
  design (CPI into TxLINE `validateStat` vs. record the verified verdict on our own
  `settle` ix) is **decided in DECISIONS.md from the spike result**.
  _Acceptance:_ a real devnet signature that proves a predicate on a completed
  match via Merkle proof against the on-chain root; Explorer link in PROGRESS.md.
  _On any on-chain failure: diagnose via logs + Solana Explorer; never bypass the
  data check._

- **Phase 5 — Autonomous agent.** `packages/agent`: the decision/settlement loop
  (ingest tick → `decide` via core → `open` position → on fixture completion
  `settle` via chain), driven by a **Durable Object** alarm + a **Cron Trigger** that
  polls TxLINE snapshots. **D1** persistence (`drizzle-orm/d1`); structured logs;
  typed errors; idempotent settlement.
  _Acceptance:_ agent loop runs end-to-end on a replayed fixture (under `wrangler
dev`/miniflare), opens and settles ≥1 position with a verifiable on-chain
  settlement and structured logs.

- **Phase 6 — API (Hono on Workers).** REST + SSE: positions, edges, settlements
  (with sigs), RPC health, agent status; control endpoints (start/stop replay).
  Zod-validated I/O; reads D1; runs under `wrangler dev` locally.
  _Acceptance:_ endpoints return typed data; SSE pushes live position/health updates;
  `wrangler dev` serves the API against local D1.

- **Phase 7 — Proof-of-Edge dashboard.** Vite + React: positions/edges table,
  settlement cards with Explorer links + Merkle verdict, P&L, live event stream,
  and the **RPC Health** panel (endpoint freshness/latency/failover/landings from
  resilience-kit telemetry).
  _Acceptance:_ dashboard renders live agent state + RPC health from real API data.

- **Phase 8 — Deterministic demo replay.** `/demo-replay <fixtureId>`: replays a
  real World Cup match's recorded score sequence through the full pipeline to an
  identical settled position every run (seeded; fixed clock à la the resilience-kit
  harness). See §11.
  _Acceptance:_ two runs of `/demo-replay <fixtureId>` produce byte-identical
  edge + settlement verdict; suitable for a recorded video.

- **Phase 9 — Hardening + submission.** Complete all `docs/`; RESILIENCE*KIT_REPORT
  with before/after metrics and **≥1 issue/PR upstream**; SUBMISSION checklist (§13);
  recorded demo script; README quickstart.
  \_Acceptance:* §13 checklist fully ticked; `pnpm check` green; demo script runs clean.

---

## §8 — Core data model (packages/core, integer-only)

- `Stat { key:int, value:int, period:int }` — mirrors TxLINE `ScoreStat`.
- `Predicate` — discriminated union:
  - `{ kind:"single", statKey, op:">"|">="|"="|"<="|"<", threshold:int }`
  - `{ kind:"margin", statKey1, statKey2, binaryOp:"subtract", op, threshold:int }`
    (mirrors `validateStat(predicate, stat1, stat2?, operator?)`).
- `Edge { fixtureId, predicate, claimedAt, stakeLamports:bigint, priceBps:int }`.
- `Position { edge, status:"open"|"won"|"lost"|"void", settlement? }`.
- `evaluatePredicate(predicate, stats): boolean` — pure; mirrors on-chain logic so
  off-chain decision and on-chain verdict must agree.
- `settle(position, verdict): { status, pnlLamports:bigint }` — integer P&L.

---

## §9 — TxLINE API surface (see docs/API.md for the live, verified record)

- **Auth:** `POST https://txline.txodds.com/auth/guest/start` → JWT (30-day);
  `POST https://txline.txodds.com/api/token/activate` (wallet signature; empty
  leagues = World Cup free tier) → API token. Header convention — **RESOLVED (Phase 1,
  ADR-0006, docs/API.md):** authenticated reads send **both** `Authorization: Bearer <jwt>`
  **and** `X-Api-Token: <apiToken>` (verified live; enforced by `TxlineClient`). The devnet
  host is `https://txline-dev.txodds.com` (the §9 prod URLs above are the mainnet form).
- **Live input:** scores SSE stream + odds SSE stream (the agent's live feed).
- **Snapshots/history:** latest fixtures snapshot; latest odds/score snapshots for a
  fixture; full score sequence for a fixture (start time 6h–2 weeks in the past).
- **Settlement proof:** `GET /api/scores/stat-validation?fixtureId&seq&statKey[&statKey2]`
  → `ScoresStatValidation { ts, statToProve, eventStatRoot, summary, statProof[],
subTreeProof[], mainTreeProof[], statToProve2?, statProof2? }`; `ProofNode { hash,
isRightSibling }`.

## §10 — On-chain (TxLINE devnet, verify against IDL & Types (Devnet) doc)

- **Program ID (devnet):** `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`
- **TxL mint (devnet):** `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG`
- **`validateStat(targetTs, fixtureSummary, fixtureProof, mainTreeProof, predicate,
stat1, stat2?, operator?)`** → `bool`; account `dailyScoresMerkleRoots` =
  PDA(`["daily_scores_roots", epochDay:u16]`). Operator example `{ subtract:{} }`.
- ClearLine generates a Codama kit-client from the TxLINE devnet IDL (read) and from
  its own `clearline_settlement` IDL (write).

---

## §11 — Deterministic historical replay (`/demo-replay`)

Live matches end before judging, so the demo runs offline-deterministic:

- Pre-fetch and **snapshot to a fixture file** the full score sequence + the
  stat-validation proof for one real, completed World Cup fixture.
- A `ReplayClock` + seeded source feed the recorded updates into the _same_ agent
  pipeline at controlled cadence (mirrors the resilience-kit manual-clock harness).
- The on-chain settlement step uses the recorded proof against the real devnet root,
  yielding the same verdict — so the run is reproducible for a recorded video.
- `/demo-replay <fixtureId>` is idempotent and produces identical edge + verdict.

## §11b — solana-resilience-kit mandate (production polygon)

This project is a real-world proving ground for **solana-resilience-kit**
(local: `../superteam-solana-rps-sdk`; upstream:
`github.com/mihailShumilov/solana-resilience-kit`).

- **ALL RPC goes through `packages/chain`** — no bare `@solana/kit` RPC anywhere.
- Configure **≥2–3 devnet RPC endpoints** for real failover; enable **OpenTelemetry**
  metrics (`rpc.request.latency_ms`, `rpc.request.failures`, `rpc.rate_limited`,
  `tx.rebroadcasts`, `tx.landings`, `rpc.endpoint.slot`) and surface an **RPC Health**
  panel on the dashboard.
- Cover the integration with **`solana-resilience-kit/testing`** (MockCluster /
  MockEndpoint / faults: drops, expiry, 429, slot lag).
- Keep **`docs/RESILIENCE_KIT_REPORT.md`**: every bug/friction → an issue and, where
  possible, a PR upstream. If a needed scenario is missing, extend the library in its
  repo, publish a patch, bump the dependency. Include **before/after metrics** in the
  report and the demo.

---

## §12 — Documentation (keep current as you go)

`PROGRESS.md` (done / next + tx links), `DECISIONS.md` (ADRs), `ARCHITECTURE.md`
(+ diagram), `API.md` (TxLINE endpoints used), `SUBMISSION.md` (§13 checklist),
`FEEDBACK.md` (TxLINE API experience), `RESILIENCE_KIT_REPORT.md` (§11b). `README.md`
with a copy-paste quickstart.

---

## §13 — Submission checklist & demo scenario

### Checklist

- [ ] Working **autonomous agent** running on Solana **devnet**.
- [ ] **Live TxLINE ingest** (World Cup SSE) as the agent's real input.
- [ ] **Trustless settlement** via on-chain `validateStat` + Merkle proof — with a
      **real devnet transaction/verdict** linked on Solana Explorer.
- [ ] **Proof-of-Edge dashboard** showing positions, edges, settlements (with proof
      links), P&L, and a live **RPC Health** panel.
- [ ] **solana-resilience-kit** is the sole RPC path; ≥2–3 endpoints; OTel metrics;
      fault-harness coverage; **before/after metrics** + **≥1 upstream issue/PR**.
- [ ] **Deterministic `/demo-replay`** of a real World Cup match.
- [ ] Quality gates green (`pnpm check`); `packages/core` ≥90% coverage.
- [ ] Public repo + README quickstart + complete `docs/`.
- [ ] **Recorded demo video** following the scenario below.

### Demo scenario (video script)

1. **Hook (15s):** "ClearLine — an autonomous agent that settles sports edges
   trustlessly on Solana, using TxLINE's on-chain-anchored World Cup data."
2. **Live ingest (30s):** Show the agent attached to the TxLINE scores SSE stream;
   structured logs scrolling; the dashboard's live event panel updating.
3. **Edge (20s):** Agent forms a predicate-based edge on a fixture (show the edge
   card: predicate, stake, price).
4. **RPC Health (20s):** Kill/slow one RPC endpoint live; the **RPC Health** panel
   shows failover and recovery; landings keep succeeding — the resilience-kit story.
5. **Settlement (40s):** Fixture completes → agent fetches the three-stage Merkle
   proof → submits `validateStat` → verdict + **Explorer link**; position flips to
   won/lost; P&L updates. Emphasize: no trusted reporter — the proof verifies against
   the on-chain root.
6. **Reproducibility (20s):** Run `/demo-replay <fixtureId>` to reproduce the exact
   settlement deterministically.
7. **Close (15s):** Recap trustlessness + the resilience-kit before/after metrics.

---

## Blockers / open questions (reconciled against the build)

- **(a) TxLINE secrets / activation — RESOLVED (ADR-0007):** the World-Cup free tier (empty
  leagues) activates with **no payment/KYC**. On-chain `pricing_matrix` `rowId=1` has
  `price_per_week_token = 0`; the agent self-provisions via `subscribe(1, 4)` (the devnet
  program requires `weeks % 4 == 0`) — only devnet SOL for the Token-2022 ATA rent + fees.
- **(b) Agent wallet — RESOLVED:** dedicated **devnet** keypair generated + funded (5 SOL):
  `HCbeaJ54rRSEwey2QEd49tgFyrfFYAfpK3kzZ86NKd8P`; gitignored. (The read-only `validate_stat`
  `.view()` needs only its public address — no secret, no funding — for simulation.)
- **(c) Cloudflare deploy — STANDING (owner):** local dev (`wrangler dev`/miniflare + local
  D1) needs **no login**; the full build, demo-replay, and autonomous loop run locally.
  **Deploy** (`wrangler deploy`, Pages, `wrangler secret put SOLANA_RPC_PRIMARY`, remote D1)
  requires `wrangler login` — an owner step. NOTE: under `wrangler dev` local the public
  devnet RPC IP-blocks the workerd egress (403), so the loop settles via the recorded-and-
  reconciled verdict locally and via the live `validate_stat` once a keyed RPC is set (ADR-0009).
- **(d) GitHub — RESOLVED:** `gh` is authenticated; phase PRs are opened against `main`
  (reviewer-gated) as a normal step.
- **OPEN → RESOLVED (Phase 1, §9/ADR-0006):** stat-validation auth = `Bearer <jwt>` **+**
  `X-Api-Token <apiToken>` (both headers), verified live.
- **OPEN → RESOLVED (ADR-0007):** ClearLine settlement records an **independently-verified
  verdict** (the agent runs the `validate_stat` `.view()` against the public root), **not** a
  CPI into TxLINE `validate_stat`.
