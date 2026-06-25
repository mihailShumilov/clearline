# TxLINE API — endpoints used by ClearLine

Base: `https://txline.txodds.com` · Docs: `https://txline-docs.txodds.com` ·
OpenAPI: `https://txline-docs.txodds.com/api-reference/openapi.json`

> Phase 1 will append **real, verified** request/response examples. Below is the
> doc-derived plan (to be confirmed live).

## Auth (World Cup free tier)

1. `POST /auth/guest/start` → guest **JWT** (Bearer, 30-day lifetime).
2. `POST /api/token/activate` → long-lived **API token**. World Cup free tier =
   empty leagues array; wallet-signature based.
3. Header convention — **OPEN**: docs show both `Authorization: Bearer <token>` and,
   for stat-validation, an additional `X-Api-Token: <token>`. Reconcile in Phase 1.

## Read (ingest + history)

- Latest fixtures snapshot (optionally from/within 30 days of an epoch day).
- Latest odds/score snapshots for a fixture (`asOf` for historical).
- Full score-update sequence for a fixture (start time 6h–2 weeks in the past).
- SSE streams: scores updates; odds updates (the agent's **live input**).

## Settlement proof

`GET /api/scores/stat-validation?fixtureId={int}&seq={int}&statKey={int}[&statKey2={int}]`
→ `ScoresStatValidation`:

```
{
  ts: int64,
  statToProve: { key:int, value:int, period:int },
  eventStatRoot: bytes,
  summary: { fixtureId:int, updateStats:{updateCount,minTimestamp,maxTimestamp},
             eventStatsSubTreeRoot: bytes },
  statProof:    ProofNode[],   // stat → event root
  subTreeProof: ProofNode[],   // event → fixture summary
  mainTreeProof: ProofNode[],  // fixture → batch root (ties to on-chain root)
  statToProve2?: ScoreStat, statProof2?: ProofNode[]
}
ProofNode = { hash: bytes, isRightSibling: boolean }
```

Statistic keys: e.g. `1` = Participant1_Score, `2` = Participant2_Score (confirm per feed).

## On-chain (devnet)

- TxLINE program: `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`
- `validateStat(targetTs, fixtureSummary, fixtureProof, mainTreeProof, predicate, stat1,
stat2?, operator?)` → `bool`; account `dailyScoresMerkleRoots` =
  PDA(`["daily_scores_roots", epochDay:u16]`). Operator example `{ subtract: {} }`.
- TxL mint (devnet): `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG`.

## Verified (Phase 1)

The `@clearline/txline` client (`packages/txline`) implements and Zod-validates the
endpoints below. Auth model confirmed against the OpenAPI spec (`securitySchemes`):
`httpAuth` = HTTP bearer (`Authorization: Bearer <JWT>`) and `apiKeyAuth` =
`X-Api-Token: <apiToken>`.

| Endpoint                             | Method    | Auth                   | Status                                                                 | Client method                    |
| ------------------------------------ | --------- | ---------------------- | ---------------------------------------------------------------------- | -------------------------------- |
| `/auth/guest/start`                  | POST      | none                   | **Live-verified** — returns `{ token: <JWT ~279 chars> }`              | `startGuestSession()`            |
| `/api/token/activate`                | POST      | Bearer JWT             | Spec-verified (pending the on-chain `subscribe` tx + wallet signature) | `activate(payload)`              |
| `/api/fixtures/snapshot`             | GET       | Bearer + `X-Api-Token` | Spec-verified (pending API token)                                      | `getFixturesSnapshot(opts?)`     |
| `/api/scores/snapshot/{fixtureId}`   | GET       | Bearer + `X-Api-Token` | Spec-verified (pending API token)                                      | `getScoresSnapshot(fixtureId)`   |
| `/api/scores/historical/{fixtureId}` | GET       | Bearer + `X-Api-Token` | Spec-verified (pending API token)                                      | `getScoresHistorical(fixtureId)` |
| `/api/scores/stream`                 | GET (SSE) | Bearer + `X-Api-Token` | Spec-verified (pending API token)                                      | `streamScores(opts?)`            |
| `/api/scores/stat-validation`        | GET       | Bearer + `X-Api-Token` | Spec-verified (pending API token)                                      | `getStatValidation(args)`        |

### Auth-header convention — RESOLVED

The earlier ambiguity is resolved: **all** data reads require **both** headers
(`Authorization: Bearer <JWT>` **and** `X-Api-Token: <apiToken>`). `/auth/guest/start`
takes no auth; `/api/token/activate` takes the guest JWT only (no API token yet).

### `/auth/guest/start` (live)

```
POST https://txline.txodds.com/auth/guest/start
→ 200 application/json
{ "token": "eyJ…" }   // JWT, ~279 chars, 30-day lifetime
```

Verified live by the opt-in test (`TXLINE_LIVE=1 pnpm exec vitest run packages/txline -t live`).
The returned token validates against `TokenResponseSchema` and is stored on the client.

### `/api/token/activate` (text/plain token)

```
POST https://txline.txodds.com/api/token/activate
Authorization: Bearer <guest JWT>
Content-Type: application/json
{ "txSig": "<base58 sig>", "walletSignature": "<base64>", "leagues": [] }
→ 200 text/plain
txoracle_api_123abc456def
```

Body validated by `ActivationPayloadSchema`. Response is **plain text** (not JSON), so the
client returns the trimmed token string. World Cup free tier = empty `leagues` array.

### Data reads & types

All score endpoints return `Scores[]`; fixtures return `Fixture[]`. Schemas model the core +
soccer-relevant fields strictly and tolerate the multi-sport tail via Zod v4 `z.looseObject`.
`/api/scores/stat-validation` returns `ScoresStatValidation` — the three-stage Merkle proof
(`statProof` / `subTreeProof` / `mainTreeProof`). Proof lists are spec'd as
`oneOf[Nil, ProofNode[]]`; the client normalises a JSON `null` to `[]`. `format: binary`
fields (`hash`, `eventStatRoot`, sub-tree roots) arrive as (base64) strings and are kept as
`string` — byte decoding is the on-chain layer's concern.
