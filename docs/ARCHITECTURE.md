# ClearLine — Architecture

ClearLine is an autonomous settlement agent on **Solana devnet** that ingests live
TxLINE World Cup data, forms a deterministic edge, and settles it trustlessly against
TxLINE's on-chain Merkle roots.

```mermaid
flowchart TB
  subgraph TX[TxLINE / TxODDS Oracle]
    SSE[scores/odds SSE + snapshots]
    SV[/api/scores/stat-validation\n3-stage Merkle proof/]
    ROOT[(on-chain daily_scores_roots\nMerkle root PDA)]
  end

  subgraph CF[Cloudflare Workers]
    CRON[Cron Trigger] --> DO
    DO[Durable Object\nagent loop] -->|decide| CORE
    DO --> D1[(D1 / Drizzle)]
    API[Hono API\nREST + SSE]
    DO --> API
  end

  CORE[["@clearline/core\npure: edge, predicate, settle (int)"]]
  CHAIN[["@clearline/chain\nsolana-resilience-kit (ONLY RPC)"]]

  SSE -->|ingest tick| DO
  DO -->|open / settle| CHAIN
  SV -->|proof| DO
  CHAIN -->|validateStat / settle tx| PROG[clearline_settlement + TxLINE program]
  PROG -. verifies against .-> ROOT
  CHAIN -->|≥2-3 endpoints, failover| RPC[(devnet RPCs)]
  CHAIN --> OTEL[OpenTelemetry metrics]

  API --> DASH[Proof-of-Edge dashboard\nVite + React]
  OTEL --> DASH
```

## Layers

- **`packages/core`** — pure, integer-only decision/settlement math (`Predicate`,
  `evaluatePredicate`, `Edge`, `Position`, `settle`). ≥90% covered. No I/O.
- **`packages/txline`** — typed TxLINE client (auth, SSE ingest, snapshots,
  stat-validation), Zod-validated.
- **`packages/chain`** — the project's only RPC path: solana-resilience-kit pool
  (≥2–3 devnet endpoints, health, rate-limit, cluster guard), `TransactionSender`,
  OpenTelemetry. Codama-generated kit clients for the ClearLine + TxLINE programs.
- **`packages/agent`** — orchestration: ingest → decide → open → settle; idempotent.
- **`packages/contracts`** — the `clearline_settlement` Anchor program.
- **`apps/api`** — Hono on Workers: REST + SSE + agent control; D1 persistence; the
  Durable Object + Cron host the agent loop.
- **`apps/dashboard`** — the Proof-of-Edge UI incl. the RPC Health panel.

## Trustlessness

Settlement does not depend on a trusted reporter. The deciding statistic is proven via a
three-stage Merkle proof (`statProof → subTreeProof → mainTreeProof`) that reconstructs
to the **on-chain published `daily_scores_roots` Merkle root**; `validateStat` returns
whether the agent's predicate holds. The off-chain `evaluatePredicate` (core) mirrors the
on-chain check so decision and settlement agree.
