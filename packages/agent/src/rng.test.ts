import { describe, expect, it } from "vitest";
import { createRng } from "./index";

describe("createRng (mulberry32)", () => {
  it("is deterministic for a given seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });

  it("differs across seeds", () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it("next() stays in [0, 1)", () => {
    const r = createRng(7);
    for (let i = 0; i < 100; i += 1) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("nextUint32() yields a 32-bit unsigned integer", () => {
    const r = createRng(123);
    const v = r.nextUint32();
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(0xffffffff);
  });

  it("coerces a non-finite seed deterministically", () => {
    expect(createRng(Number.NaN).next()).toBe(createRng(0).next());
  });
});
