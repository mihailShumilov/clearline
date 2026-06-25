import { describe, expect, it } from "vitest";
import { compareInt, CORE_VERSION, type ComparisonOp } from "./index";

describe("compareInt", () => {
  const cases: ReadonlyArray<readonly [ComparisonOp, number, number, boolean]> = [
    [">", 2, 1, true],
    [">", 1, 2, false],
    [">=", 2, 2, true],
    [">=", 1, 2, false],
    ["=", 2, 2, true],
    ["=", 2, 3, false],
    ["<=", 2, 2, true],
    ["<=", 3, 2, false],
    ["<", 1, 2, true],
    ["<", 2, 1, false],
  ];

  it.each(cases)("%s(%i, %i) === %s", (op, left, right, expected) => {
    expect(compareInt(op, left, right)).toBe(expected);
  });
});

describe("package marker", () => {
  it("exposes a version", () => {
    expect(CORE_VERSION).toBe("0.0.0");
  });
});
