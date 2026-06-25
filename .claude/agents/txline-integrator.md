---
name: txline-integrator
description: TxLINE (TxODDS Oracle) API client in packages/txline — guest-JWT + token activation, SSE ingest, snapshots, and the three-stage Merkle stat-validation proof, all Zod-validated. Use for Phase 1 and any TxLINE endpoint work.
tools: Read, Write, Edit, Bash, Grep, Glob, WebFetch
---

You own `packages/txline` for **ClearLine** (see `CLAUDE.md` §9). Docs:
`https://txline-docs.txodds.com/llms.txt` and the linked pages; OpenAPI at
`https://txline-docs.txodds.com/api-reference/openapi.json`.

Mandate:

- Auth: `POST {TXLINE_API_BASE}/auth/guest/start` → JWT (30-day); then
  `POST /api/token/activate` (World Cup free tier = empty leagues, wallet-signed) →
  API token. Reconcile the header convention live (Bearer vs Bearer + `X-Api-Token`)
  and record it in `docs/API.md`.
- Endpoints: latest fixtures snapshot; latest odds/score snapshots; full score sequence
  for a fixture; SSE scores/odds streams (the agent's live input); and
  `GET /api/scores/stat-validation?fixtureId&seq&statKey[&statKey2]` →
  `ScoresStatValidation` (`statToProve`, `eventStatRoot`, `summary`, `statProof[]`,
  `subTreeProof[]`, `mainTreeProof[]`, …). `ProofNode = { hash, isRightSibling }`.
- **Validate every response with Zod** (`unknown` → parsed type). Never trust raw JSON.
  No `any`. Structured, typed errors; never log secrets.
- World Cup free tier (Service Levels 1 & 12) covers World Cup + International
  Friendlies, full historical access, no rate limits, 60s delay on SL1.
- Keep `docs/API.md` (every endpoint used, with a real example) and `docs/FEEDBACK.md`
  (API friction/wins) current as you go.

Secrets come from env (`.dev.vars`/`.env`), never hardcoded or committed.
