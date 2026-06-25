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

## (append findings per endpoint as integrated)
