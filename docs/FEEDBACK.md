# TxLINE API — developer feedback

> Captured while integrating (Phase 1+). Both friction and wins, with specifics.

## Initial (from docs review, pre-integration)

- **Auth header ambiguity**: the World Cup page says all endpoints take
  `Authorization: Bearer ${apiToken}`, while the stat-validation page lists _both_
  `Authorization: Bearer <JWT>` and `X-Api-Token: <token>`. Needs a definitive answer;
  will verify against the live API and the OpenAPI spec in Phase 1.
- **Clear strength**: cryptographic verifiability is first-class — three-stage Merkle
  proofs (`statProof`/`subTreeProof`/`mainTreeProof`) reconstructing to an on-chain root
  is exactly what trustless settlement needs.
- **Free World Cup tier** with full historical access and no rate limits is ideal for a
  deterministic replay demo (SL1 has a 60s delay; SL12 real-time).

## Phase 1 — `packages/txline` integration

- **Auth ambiguity resolved (win):** the OpenAPI `securitySchemes` are unambiguous —
  `httpAuth` (bearer) + `apiKeyAuth` (`X-Api-Token`). Every data read lists `security:
[{ httpAuth: [], apiKeyAuth: [] }]`, i.e. **both** headers. `/auth/guest/start` has no
  security; `/api/token/activate` requires the JWT only. No more reconciliation needed.
- **`/auth/guest/start` works first-try (win):** unauthenticated POST returns
  `{ token }` (JWT ~279 chars) with no rate-limit friction. Self-provisioning the guest
  session is trivial.
- **Friction — `activate` returns `text/plain`, not JSON.** The `200` response of
  `/api/token/activate` is the bare token string (`txoracle_api_123abc456def`), unlike every
  other endpoint. A client that assumes JSON everywhere will break here; we special-case it
  (`res.text()`). A `{ "apiToken": "…" }` JSON envelope would be more consistent.
- **Friction — error bodies are `text/plain` across the board.** 400/401/403/500 all return a
  plain string, so there is no machine-readable error `code`/`field`. We surface the status +
  a truncated body in `TxlineError.detail`, but a structured error object (e.g. RFC 7807)
  would let callers branch on cause (expired JWT vs missing entitlement) without string-matching.
- **Friction — `format: binary` in a JSON API.** `hash` / `eventStatRoot` /
  `eventStatsSubTreeRoot` are declared `type: string, format: binary`. In JSON these can only be
  text; the encoding (base64 vs hex) is not stated in the spec. We model them as `string` and
  defer decoding to the on-chain layer, but the spec should document the exact encoding.
- **Friction — `List_ProofNode = oneOf[Nil, ProofNode[]]`.** A proof path serialises as either
  `null` or an array. Codegen tools produce an awkward `ProofNode[] | null`; we normalise `null`
  → `[]` in `ProofNodeListSchema`. A plain (possibly empty) array would be simpler.
- **Observation — `Scores` is a very large multi-sport union.** One object carries US-football,
  basketball, and soccer sub-objects, most optional. For the World Cup (soccer) tier we model the
  core + soccer fields and tolerate the rest via `z.looseObject`. Sport-specific response variants
  (or a `sportId`-discriminated union) would shrink the payload and tighten typing.
- **Cannot exercise data endpoints yet (blocker, expected):** the API token needs the on-chain
  `subscribe` tx + wallet-signed activation (Blocker (a)). Reads/SSE/stat-validation are
  implemented and unit-tested against mock `fetch` + the OpenAPI example shapes, but await a real
  token for a live run.
