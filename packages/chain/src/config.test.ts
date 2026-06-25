import { describe, expect, it } from "vitest";

import { DEFAULT_DEVNET_RPC, loadChainConfig } from "./config";
import { isChainError } from "./errors";

describe("loadChainConfig", () => {
  it("defaults to a single devnet primary on an empty env", () => {
    const cfg = loadChainConfig({});
    expect(cfg.cluster).toBe("devnet");
    expect(cfg.endpoints).toEqual([{ name: "primary", url: DEFAULT_DEVNET_RPC }]);
  });

  it("uses SOLANA_RPC_PRIMARY when provided", () => {
    const cfg = loadChainConfig({ SOLANA_RPC_PRIMARY: "https://devnet.example.com" });
    expect(cfg.endpoints[0]).toEqual({ name: "primary", url: "https://devnet.example.com" });
  });

  it("includes backups when set, in priority order (supports 2-3 endpoints)", () => {
    const cfg = loadChainConfig({
      SOLANA_RPC_PRIMARY: "https://p.example.com",
      SOLANA_RPC_BACKUP_1: "https://b1.example.com",
      SOLANA_RPC_BACKUP_2: "https://b2.example.com",
    });
    expect(cfg.endpoints.map((e) => e.name)).toEqual(["primary", "backup-1", "backup-2"]);
    expect(cfg.endpoints).toHaveLength(3);
  });

  it("treats blank/whitespace env values as absent", () => {
    const cfg = loadChainConfig({
      SOLANA_RPC_PRIMARY: "   ",
      SOLANA_RPC_BACKUP_1: "",
    });
    expect(cfg.endpoints).toEqual([{ name: "primary", url: DEFAULT_DEVNET_RPC }]);
  });

  it("accepts an explicit devnet cluster", () => {
    const cfg = loadChainConfig({ SOLANA_CLUSTER: "devnet" });
    expect(cfg.cluster).toBe("devnet");
  });

  it("rejects mainnet-beta (devnet only, §5)", () => {
    expect.assertions(3);
    try {
      loadChainConfig({ SOLANA_CLUSTER: "mainnet-beta" });
    } catch (err) {
      expect(isChainError(err)).toBe(true);
      if (isChainError(err)) {
        expect(err.kind).toBe("config");
        expect(err.code).toBe("cluster_not_allowed");
      }
    }
  });

  it("rejects a non-URL primary endpoint", () => {
    expect(() => loadChainConfig({ SOLANA_RPC_PRIMARY: "not-a-url" })).toThrow();
  });

  it("never leaks env values into the error message", () => {
    try {
      loadChainConfig({ SOLANA_RPC_PRIMARY: "not-a-url-secret" });
    } catch (err) {
      if (isChainError(err)) {
        expect(err.message).not.toContain("not-a-url-secret");
      }
    }
  });
});
