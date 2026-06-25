/**
 * Typed error model for the TxLINE client (§4 quality: no bare `throw "string"`).
 *
 * Every failure surfaces as a {@link TxlineError} carrying a discriminated
 * `kind`. Secrets (JWTs, API tokens) are NEVER placed in `message` or `detail`.
 */

/** The category of a {@link TxlineError}. */
export type TxlineErrorKind = "http" | "validation" | "network" | "config";

/** Structured fields carried by every {@link TxlineError}. */
export interface TxlineErrorInfo {
  /** Discriminant: what kind of failure occurred. */
  readonly kind: TxlineErrorKind;
  /** HTTP status code, when `kind === "http"`. */
  readonly status?: number;
  /** A short machine-readable code (e.g. `"missing_jwt"`, `"bad_response"`). */
  readonly code?: string;
  /** Human-readable summary. Must never contain secrets. */
  readonly message: string;
  /** Optional extra context (parse issues, response body excerpt). No secrets. */
  readonly detail?: unknown;
}

/**
 * The single error type thrown by the TxLINE client. Use the `kind` discriminant
 * (and helpers below) to branch on failure category.
 */
export class TxlineError extends Error implements TxlineErrorInfo {
  readonly kind: TxlineErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly detail?: unknown;

  constructor(info: TxlineErrorInfo, options?: { cause?: unknown }) {
    super(info.message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TxlineError";
    this.kind = info.kind;
    if (info.status !== undefined) this.status = info.status;
    if (info.code !== undefined) this.code = info.code;
    if (info.detail !== undefined) this.detail = info.detail;
    // Preserve prototype chain for `instanceof` across transpile targets.
    Object.setPrototypeOf(this, TxlineError.prototype);
  }

  /** A non-secret plain object suitable for structured (JSON) logging. */
  toJSON(): TxlineErrorInfo {
    return {
      kind: this.kind,
      ...(this.status !== undefined ? { status: this.status } : {}),
      ...(this.code !== undefined ? { code: this.code } : {}),
      message: this.message,
      ...(this.detail !== undefined ? { detail: this.detail } : {}),
    };
  }
}

/** Construct a `kind: "http"` error from a non-2xx response. */
export function httpError(status: number, message: string, detail?: unknown): TxlineError {
  return new TxlineError({ kind: "http", status, code: `http_${status}`, message, detail });
}

/** Construct a `kind: "validation"` error from a failed Zod parse. */
export function validationError(message: string, detail?: unknown): TxlineError {
  return new TxlineError({ kind: "validation", code: "bad_response", message, detail });
}

/** Construct a `kind: "network"` error from a transport-level failure. */
export function networkError(message: string, cause?: unknown): TxlineError {
  return new TxlineError({ kind: "network", code: "network", message }, { cause });
}

/** Construct a `kind: "config"` error (missing auth, bad config). */
export function configError(code: string, message: string): TxlineError {
  return new TxlineError({ kind: "config", code, message });
}

/** Type guard for {@link TxlineError}. */
export function isTxlineError(value: unknown): value is TxlineError {
  return value instanceof TxlineError;
}
