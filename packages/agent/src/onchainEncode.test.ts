import { describe, expect, it } from "vitest";
import { encodeValidateStatData, normalizeStatValidation } from "@clearline/chain";

import wcReal from "./fixtures/wc-real-17588395.json";

/**
 * Golden vectors: the `validate_stat` instruction data the Anchor coder produces for the
 * recorded fixture's three-stage proof (the bytes the live-proven Phase-4 spike sent,
 * ADR-0007). The production kit encoder MUST reproduce these byte-for-byte — a fully
 * deterministic, offline correctness proof that the hand-rolled Borsh layout matches the
 * on-chain program's expectation (the same proof verified live: value>0→TRUE, value>1→FALSE).
 */
const GOLDEN_TRUE =
  "6bc5e85abf8869b993b7b8fc9e010000ab600c01000000000200000093b7b8fc9e01000062a2bbfc9e010000fb47c330c47d575712e63f7886893d1e60aa329068bc6d6ed1d979f498013a9b01000000709c808ba0f7309500cbea68308e3b7aa490e99b8fedaae3664591d5204a96bb000200000039c35a274097d66854944d5ee2b716904e6569cd89d04c3ae8993c74f95d5065001b837cd17ed98d9979da251f3854ca20c863f79a39263a1d9f50e6a22cb5600b010000000000010000000100000000000000709c808ba0f7309500cbea68308e3b7aa490e99b8fedaae3664591d5204a96bb06000000b76875c50ef704dbbf7f02c982445971d1bbd61aebe2e4b28ddc58a1d66317d5010712228b7d6195f28005199632a1c32d30b463be20ee2f6aed828937e8e0de1d01c9ce61c5150e6d270164e85af37ecee876d3b1eeef6d889312224705f74e94fe01fe2f28e25166b866bd6d0d05d46662145204a58b08678aadeda6863efc56d92f0191a6207532c14e76fd918ad2b91ed14ea3f5e8776bbe69f5b2b13fcadc8b28050115a4e3db4ea7888fa1daa97e49c31ffe90a8b374a641439c72a60f09d8b60ff4010000";
const GOLDEN_FALSE =
  "6bc5e85abf8869b993b7b8fc9e010000ab600c01000000000200000093b7b8fc9e01000062a2bbfc9e010000fb47c330c47d575712e63f7886893d1e60aa329068bc6d6ed1d979f498013a9b01000000709c808ba0f7309500cbea68308e3b7aa490e99b8fedaae3664591d5204a96bb000200000039c35a274097d66854944d5ee2b716904e6569cd89d04c3ae8993c74f95d5065001b837cd17ed98d9979da251f3854ca20c863f79a39263a1d9f50e6a22cb5600b010100000000010000000100000000000000709c808ba0f7309500cbea68308e3b7aa490e99b8fedaae3664591d5204a96bb06000000b76875c50ef704dbbf7f02c982445971d1bbd61aebe2e4b28ddc58a1d66317d5010712228b7d6195f28005199632a1c32d30b463be20ee2f6aed828937e8e0de1d01c9ce61c5150e6d270164e85af37ecee876d3b1eeef6d889312224705f74e94fe01fe2f28e25166b866bd6d0d05d46662145204a58b08678aadeda6863efc56d92f0191a6207532c14e76fd918ad2b91ed14ea3f5e8776bbe69f5b2b13fcadc8b28050115a4e3db4ea7888fa1daa97e49c31ffe90a8b374a641439c72a60f09d8b60ff4010000";

describe("validate_stat encoder matches the Anchor golden vector", () => {
  const validation = normalizeStatValidation(
    (wcReal as { statValidation: unknown }).statValidation,
  );

  it("encodes the TRUE predicate (value > 0) byte-for-byte", () => {
    const data = encodeValidateStatData(validation, { comparison: "GreaterThan", threshold: 0 });
    expect(Buffer.from(data).toString("hex")).toBe(GOLDEN_TRUE);
  });

  it("encodes the FALSE predicate (value > 1) byte-for-byte", () => {
    const data = encodeValidateStatData(validation, { comparison: "GreaterThan", threshold: 1 });
    expect(Buffer.from(data).toString("hex")).toBe(GOLDEN_FALSE);
  });
});
