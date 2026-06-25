import { describe, expect, it } from "vitest";

import { DEFAULT_API_BASE, loadTxlineConfig } from "./config";
import { isTxlineError } from "./errors";

describe("loadTxlineConfig", () => {
  it("defaults apiBase and leaves secrets undefined on an empty env", () => {
    const cfg = loadTxlineConfig({});
    expect(cfg.apiBase).toBe(DEFAULT_API_BASE);
    expect(cfg.jwt).toBeUndefined();
    expect(cfg.apiToken).toBeUndefined();
  });

  it("reads jwt and apiToken from the injected record", () => {
    const cfg = loadTxlineConfig({
      TXLINE_JWT: "jwt-value",
      TXLINE_API_TOKEN: "txoracle_api_abc",
    });
    expect(cfg.jwt).toBe("jwt-value");
    expect(cfg.apiToken).toBe("txoracle_api_abc");
  });

  it("treats blank/whitespace env values as absent", () => {
    const cfg = loadTxlineConfig({ TXLINE_JWT: "", TXLINE_API_TOKEN: "   " });
    expect(cfg.jwt).toBeUndefined();
    expect(cfg.apiToken).toBeUndefined();
  });

  it("strips a trailing slash from apiBase", () => {
    const cfg = loadTxlineConfig({ TXLINE_API_BASE: "https://example.com/" });
    expect(cfg.apiBase).toBe("https://example.com");
  });

  it("throws a config TxlineError on an invalid apiBase URL", () => {
    try {
      loadTxlineConfig({ TXLINE_API_BASE: "not-a-url" });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(isTxlineError(e)).toBe(true);
      if (isTxlineError(e)) {
        expect(e.kind).toBe("config");
        // The thrown message must never leak secret values.
        expect(e.message).not.toContain("not-a-url");
      }
    }
  });

  it("does not read process.env (Workers-safe) — only the passed record", () => {
    const cfg = loadTxlineConfig({ TXLINE_API_BASE: "https://txline-dev.txodds.com" });
    expect(cfg.apiBase).toBe("https://txline-dev.txodds.com");
  });
});
