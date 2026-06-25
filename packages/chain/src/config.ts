/**
 * Chain-layer configuration, validated with Zod (§4) and read from an injected
 * env record so the pool works under Cloudflare Workers (§6) — we never touch
 * `process.env` here.
 *
 * Devnet only (§5): `mainnet-beta` is rejected outright. The agent wallet is a
 * dedicated devnet keypair and must never reach mainnet, so we refuse to even
 * build a mainnet pool at the configuration boundary.
 */
import { z } from "zod";

import { chainConfigError } from "./errors";

/** The single devnet endpoint used when no `SOLANA_RPC_PRIMARY` is supplied. */
export const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";

/** The only cluster ClearLine is allowed to transact on (§5). */
export const ALLOWED_CLUSTER = "devnet" as const;

/** A single named RPC endpoint after validation. */
export const ChainEndpointSchema = z.strictObject({
  /** Stable, human-readable name (used in health/metrics attributes). */
  name: z.string().min(1),
  /** RPC origin URL. */
  url: z.url({ error: "RPC endpoint url must be a valid URL" }),
});

/** A single validated RPC endpoint. */
export type ChainEndpoint = z.infer<typeof ChainEndpointSchema>;

/**
 * Zod schema for the resolved chain config. Devnet is the default and the only
 * accepted value; `endpoints` must hold at least one entry and supports the
 * ≥2–3 endpoints the §11b failover story needs.
 */
export const ChainConfigSchema = z.strictObject({
  /** Always `"devnet"` — mainnet is rejected before this point (§5). */
  cluster: z.literal(ALLOWED_CLUSTER).default(ALLOWED_CLUSTER),
  /** Ordered endpoints; first is treated as the primary. */
  endpoints: z
    .array(ChainEndpointSchema)
    .min(1, { error: "at least one RPC endpoint is required" }),
});

/** Resolved, validated chain configuration. */
export type ChainConfig = z.infer<typeof ChainConfigSchema>;

/** Trim a value to `undefined` when it is missing or blank. */
function blankToUndef(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== "" ? value : undefined;
}

/**
 * Build a {@link ChainConfig} from an injected environment record.
 *
 * Endpoints, in priority order:
 *  - `primary`  ← `SOLANA_RPC_PRIMARY`  || {@link DEFAULT_DEVNET_RPC}
 *  - `backup-1` ← `SOLANA_RPC_BACKUP_1` (only when set)
 *  - `backup-2` ← `SOLANA_RPC_BACKUP_2` (only when set)
 *
 * `SOLANA_CLUSTER`, when present, must be `"devnet"`; any other value (notably
 * `mainnet-beta`) is rejected with a `kind: "config"` {@link ChainError} (§5).
 *
 * @param env - e.g. `process.env` (Node) or the Workers `env` binding object.
 */
export function loadChainConfig(env: Record<string, string | undefined>): ChainConfig {
  const requestedCluster = blankToUndef(env["SOLANA_CLUSTER"]);
  if (requestedCluster !== undefined && requestedCluster !== ALLOWED_CLUSTER) {
    // Devnet only (§5). Refuse mainnet/testnet at the boundary — no pool is built.
    throw chainConfigError(
      "cluster_not_allowed",
      `SOLANA_CLUSTER must be "${ALLOWED_CLUSTER}"; refusing "${requestedCluster}" (devnet only)`,
    );
  }

  const primaryUrl = blankToUndef(env["SOLANA_RPC_PRIMARY"]) ?? DEFAULT_DEVNET_RPC;
  const backup1 = blankToUndef(env["SOLANA_RPC_BACKUP_1"]);
  const backup2 = blankToUndef(env["SOLANA_RPC_BACKUP_2"]);

  const endpoints: Array<{ name: string; url: string }> = [{ name: "primary", url: primaryUrl }];
  if (backup1 !== undefined) endpoints.push({ name: "backup-1", url: backup1 });
  if (backup2 !== undefined) endpoints.push({ name: "backup-2", url: backup2 });

  const result = ChainConfigSchema.safeParse({ cluster: ALLOWED_CLUSTER, endpoints });
  if (!result.success) {
    // Surface field paths only — never any secret-bearing value.
    const fields = result.error.issues.map((i) => i.path.join(".") || "(root)").join(", ");
    throw chainConfigError("invalid_config", `Invalid chain config: ${fields}`);
  }
  return result.data;
}
