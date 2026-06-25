/**
 * Minimal structured logging for the agent (§4: structured JSON logs, no secrets).
 *
 * The agent takes a {@link Logger} by injection so the deterministic replay path
 * can supply {@link noopLogger} (silent, side-effect-free) while a live run wires
 * {@link consoleLogger} (JSON lines). The interface is intentionally tiny — three
 * leveled methods, each taking a message and an optional flat field bag.
 *
 * SECURITY: callers must never pass secrets (JWTs, API tokens, keypairs) in
 * `fields`; this module does no redaction, it only serialises what it is given.
 */

/** A flat bag of structured fields attached to a log line. */
export type LogFields = Record<string, unknown>;

/** The structured logger interface the agent depends on. */
export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

/** A logger that discards everything — the default for deterministic replays. */
export const noopLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};

/** Log levels emitted by {@link consoleLogger}. */
type Level = "info" | "warn" | "error";

/**
 * JSON-safe replacer: serialises `bigint` as a decimal string (JSON has no bigint)
 * so money fields survive structured logging without throwing.
 */
function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function emit(level: Level, msg: string, fields?: LogFields): void {
  const line = fields === undefined ? { level, msg } : { level, msg, ...fields };
  const serialised = JSON.stringify(line, jsonReplacer);
  if (level === "error") {
    console.error(serialised);
  } else if (level === "warn") {
    console.warn(serialised);
  } else {
    console.info(serialised);
  }
}

/**
 * A console-backed logger that writes one JSON object per line. `bigint` fields are
 * stringified; nothing is redacted, so callers must keep secrets out of `fields`.
 */
export const consoleLogger: Logger = {
  info(msg, fields) {
    emit("info", msg, fields);
  },
  warn(msg, fields) {
    emit("warn", msg, fields);
  },
  error(msg, fields) {
    emit("error", msg, fields);
  },
};
