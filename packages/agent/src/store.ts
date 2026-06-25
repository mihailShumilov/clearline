/**
 * Position persistence abstraction (§6: agent persistence).
 *
 * The interface is kept deliberately small and storage-agnostic so a D1-backed
 * implementation (`drizzle-orm/d1`, Phase 6) can drop in behind it. The replay/demo
 * uses {@link InMemoryPositionStore}, which is synchronous under the hood but
 * exposes the same async surface as a future durable store.
 */
import type { Position } from "@clearline/core";

/** A {@link Position} as held by the store: the core position plus a stable id. */
export interface StoredPosition {
  readonly id: string;
  readonly position: Position;
}

/** Fields a store record may be patched with. */
export interface PositionPatch {
  readonly position: Position;
}

/** Pluggable position persistence. */
export interface PositionStore {
  /** Persist a new position under `id`; rejects a duplicate id. */
  open(id: string, position: Position): Promise<StoredPosition>;
  /** Replace the position held under `id`; rejects an unknown id. */
  update(id: string, patch: PositionPatch): Promise<StoredPosition>;
  /** All stored positions, in insertion order. */
  list(): Promise<StoredPosition[]>;
  /** The position under `id`, or `undefined` if absent. */
  get(id: string): Promise<StoredPosition | undefined>;
}

/** Typed store failure (no bare `throw "string"`, §4). */
export class StoreError extends Error {
  readonly code: "duplicate-id" | "unknown-id";
  readonly id: string;
  constructor(code: "duplicate-id" | "unknown-id", id: string) {
    super(`${code}: ${id}`);
    this.name = "StoreError";
    this.code = code;
    this.id = id;
    Object.setPrototypeOf(this, StoreError.prototype);
  }
}

/**
 * In-memory {@link PositionStore} for replays/tests. Preserves insertion order and
 * is fully deterministic. Not durable — a process restart drops everything.
 */
export class InMemoryPositionStore implements PositionStore {
  // Map preserves insertion order, which `list()` relies on for determinism.
  readonly #byId = new Map<string, Position>();

  open(id: string, position: Position): Promise<StoredPosition> {
    if (this.#byId.has(id)) {
      return Promise.reject(new StoreError("duplicate-id", id));
    }
    this.#byId.set(id, position);
    return Promise.resolve({ id, position });
  }

  update(id: string, patch: PositionPatch): Promise<StoredPosition> {
    if (!this.#byId.has(id)) {
      return Promise.reject(new StoreError("unknown-id", id));
    }
    this.#byId.set(id, patch.position);
    return Promise.resolve({ id, position: patch.position });
  }

  list(): Promise<StoredPosition[]> {
    const out: StoredPosition[] = [];
    for (const [id, position] of this.#byId) {
      out.push({ id, position });
    }
    return Promise.resolve(out);
  }

  get(id: string): Promise<StoredPosition | undefined> {
    const position = this.#byId.get(id);
    return Promise.resolve(position === undefined ? undefined : { id, position });
  }
}
