/**
 * Integer comparison operators — the primitive predicate evaluation builds on (§8).
 * Mirrors the on-chain `TraderPredicate` comparison semantics so the agent's
 * off-chain decision and the on-chain `validateStat` verdict always agree.
 */
export type ComparisonOp = ">" | ">=" | "=" | "<=" | "<";

/**
 * Total, pure integer comparison. Exhaustive over {@link ComparisonOp}; never
 * uses floating point. Inputs are treated as integers by contract (§4).
 */
export function compareInt(op: ComparisonOp, left: number, right: number): boolean {
  switch (op) {
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "=":
      return left === right;
    case "<=":
      return left <= right;
    case "<":
      return left < right;
  }
}
