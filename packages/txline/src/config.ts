/**
 * TxLINE client configuration, validated with Zod (§4) and read from an injected
 * env record so the client works under Cloudflare Workers (§6) — we never touch
 * `process.env` here.
 */
import { z } from "zod";

import { configError } from "./errors";

/** Default production TxLINE base URL (§9). */
export const DEFAULT_API_BASE = "https://txline.txodds.com";

/**
 * Zod schema for the resolved client config. Secrets are optional so a config can
 * be built for the unauthenticated guest-start call alone.
 */
export const TxlineConfigSchema = z.strictObject({
  /** API origin, no trailing slash. */
  apiBase: z
    .url({ error: "TXLINE_API_BASE must be a valid URL" })
    .default(DEFAULT_API_BASE)
    .transform((u) => u.replace(/\/+$/, "")),
  /** Guest/session JWT (Bearer). Optional until a session is started. */
  jwt: z.string().min(1).optional(),
  /** Long-lived API token (X-Api-Token). Optional until activation. */
  apiToken: z.string().min(1).optional(),
});

/** Resolved, validated TxLINE configuration. */
export type TxlineConfig = z.infer<typeof TxlineConfigSchema>;

/**
 * Build a {@link TxlineConfig} from an injected environment record.
 *
 * Reads `TXLINE_API_BASE`, `TXLINE_JWT`, `TXLINE_API_TOKEN`. Empty strings are
 * treated as absent. Throws a `kind: "config"` {@link TxlineError} on invalid input.
 *
 * @param env - e.g. `process.env` (Node) or the Workers `env` binding object.
 */
export function loadTxlineConfig(env: Record<string, string | undefined>): TxlineConfig {
  const blankToUndef = (v: string | undefined): string | undefined =>
    v !== undefined && v.trim() !== "" ? v : undefined;

  const candidate = {
    apiBase: blankToUndef(env["TXLINE_API_BASE"]),
    jwt: blankToUndef(env["TXLINE_JWT"]),
    apiToken: blankToUndef(env["TXLINE_API_TOKEN"]),
  };

  const result = TxlineConfigSchema.safeParse(candidate);
  if (!result.success) {
    // Surface field paths only — never the secret values themselves.
    const fields = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw configError("invalid_config", `Invalid TxLINE config: ${fields}`);
  }
  return result.data;
}
