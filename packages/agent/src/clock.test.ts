import { describe, expect, it } from "vitest";
import { ClockError, ReplayClock } from "./index";

describe("ReplayClock", () => {
  it("starts at 0 by default", () => {
    expect(new ReplayClock().nowMs()).toBe(0);
  });

  it("set jumps to an exact instant (may move backwards)", () => {
    const c = new ReplayClock(100);
    c.set(50);
    expect(c.nowMs()).toBe(50);
  });

  it("advanceTo moves forward and is a no-op at the same instant", () => {
    const c = new ReplayClock(10);
    c.advanceTo(20);
    expect(c.nowMs()).toBe(20);
    c.advanceTo(20);
    expect(c.nowMs()).toBe(20);
  });

  it("advanceTo rejects a backwards move", () => {
    const c = new ReplayClock(100);
    expect(() => c.advanceTo(99)).toThrow(ClockError);
  });

  it("rejects a non-integer / negative time", () => {
    expect(() => new ReplayClock(1.5)).toThrow(ClockError);
    expect(() => new ReplayClock(-1)).toThrow(ClockError);
    const c = new ReplayClock(0);
    expect(() => c.set(1.2)).toThrow(ClockError);
  });
});
