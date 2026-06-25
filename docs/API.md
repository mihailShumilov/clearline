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
