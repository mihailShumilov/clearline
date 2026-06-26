/**
 * Typed error model for the chain layer (§4 quality: no bare `throw "string"`).
 *
 * Every failure surfaces as a {@link ChainError} carrying a discriminated
 * `kind`. RPC URLs, keys, and any secret material are NEVER placed in `message`
 * or `detail`.
 */

/** The category of a {@link ChainError}. */
export type ChainErrorKind = "config" | "cluster" | "onchain";

/** Structured fields carried by every {@link ChainError}. */
export interface ChainErrorInfo {
  /** Discriminant: what kind of failure occurred. */
  readonly kind: ChainErrorKind;
  /** A short machine-readable code (e.g. `"invalid_config"`). */
  readonly code?: string;
  /** Human-readable summary. Must never contain secrets. */
  readonly message: string;
  /** Optional extra context. No secrets. */
  readonly detail?: unknown;
}

/**
 * The single error type thrown by the chain configuration layer. Use the `kind`
 * discriminant (and helpers below) to branch on failure category.
 */
export class ChainError extends Error implements ChainErrorInfo {
  readonly kind: ChainErrorKind;
  readonly code?: string;
  readonly detail?: unknown;

  constructor(info: ChainErrorInfo, options?: { cause?: unknown }) {
    super(info.message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ChainError";
    this.kind = info.kind;
    if (info.code !== undefined) this.code = info.code;
    if (info.detail !== undefined) this.detail = info.detail;
    // Preserve prototype chain for `instanceof` across transpile targets.
    Object.setPrototypeOf(this, ChainError.prototype);
  }

  /** A non-secret plain object suitable for structured (JSON) logging. */
  toJSON(): ChainErrorInfo {
    return {
      kind: this.kind,
      ...(this.code !== undefined ? { code: this.code } : {}),
      message: this.message,
      ...(this.detail !== undefined ? { detail: this.detail } : {}),
    };
  }
}

/** Construct a `kind: "config"` error (invalid/disallowed configuration). */
export function chainConfigError(code: string, message: string): ChainError {
  return new ChainError({ kind: "config", code, message });
}

/** Construct a `kind: "cluster"` error (cluster guard / mismatch). */
export function chainClusterError(code: string, message: string): ChainError {
  return new ChainError({ kind: "cluster", code, message });
}

/**
 * Construct a `kind: "onchain"` error (a `validate_stat` simulation or proof
 * encoding failure). `detail` is non-secret context (e.g. simulation logs or the
 * comparison/threshold) for diagnostics; never put RPC URLs or keys in it.
 */
export function chainOnchainError(code: string, message: string, detail?: unknown): ChainError {
  return new ChainError({ kind: "onchain", code, message, detail });
}

/** Type guard for {@link ChainError}. */
export function isChainError(value: unknown): value is ChainError {
  return value instanceof ChainError;
}
