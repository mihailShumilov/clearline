import { afterEach, describe, expect, it, vi } from "vitest";
import { consoleLogger, noopLogger } from "./index";

describe("noopLogger", () => {
  it("is callable and silent", () => {
    expect(() => {
      noopLogger.info("x");
      noopLogger.warn("y", { a: 1 });
      noopLogger.error("z");
    }).not.toThrow();
  });
});

describe("consoleLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits one JSON line per call with level + msg", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    consoleLogger.info("hello", { fixtureId: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0]?.[0] as string;
    expect(JSON.parse(arg)).toEqual({ level: "info", msg: "hello", fixtureId: 1 });
  });

  it("stringifies bigint fields (JSON has no bigint)", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleLogger.warn("pnl", { pnlLamports: 1_500n });
    const parsed = JSON.parse(spy.mock.calls[0]?.[0] as string);
    expect(parsed.pnlLamports).toBe("1500");
  });

  it("routes error level to console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleLogger.error("boom");
    expect(JSON.parse(spy.mock.calls[0]?.[0] as string)).toEqual({ level: "error", msg: "boom" });
  });
});
