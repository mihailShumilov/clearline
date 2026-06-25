/**
 * `TxlineClient` — the typed TxLINE (TxODDS Oracle) HTTP client (§9).
 *
 * - `fetchImpl` is injectable (defaults to global `fetch`) so the client runs in
 *   Cloudflare Workers and is fully mockable in tests.
 * - Auth: guest JWT (Bearer) + long-lived API token (`X-Api-Token`). The header
 *   builder enforces presence where required and raises a typed config error.
 * - All JSON responses are Zod-parsed; `activate` returns the text token verbatim.
 * - Secrets are never logged.
 */
import type { TxlineConfig } from "./config";
import { configError, httpError, networkError, validationError } from "./errors";
import { parseScoresStream } from "./sse";
import type {
  ActivationPayload,
  Fixture,
  Scores,
  ScoresStatValidation,
  TokenResponse,
} from "./schemas";
import {
  ActivationPayloadSchema,
  FixtureArraySchema,
  ScoresArraySchema,
  ScoresStatValidationSchema,
  TokenResponseSchema,
} from "./schemas";
import type { ScoresStreamEvent } from "./sse";
import type { z } from "zod";

/** Options accepted by the {@link TxlineClient} constructor. */
export interface TxlineClientOptions {
  /** Validated configuration (see `loadTxlineConfig`). */
  readonly config: TxlineConfig;
  /** Injectable fetch (defaults to the global `fetch`). */
  readonly fetchImpl?: typeof fetch;
}

/** Query options for {@link TxlineClient.getFixturesSnapshot}. */
export interface FixturesSnapshotOptions {
  /** Optional epoch day (UTC) at/within 30 days of which fixtures start. */
  readonly startEpochDay?: number;
  /** Optional competition filter. */
  readonly competitionId?: number;
}

/** Arguments for {@link TxlineClient.getStatValidation}. */
export interface StatValidationArgs {
  readonly fixtureId: number;
  readonly seq: number;
  readonly statKey: number;
  /** Optional second stat for two-stat (margin) predicates. */
  readonly statKey2?: number;
}

/** Options for {@link TxlineClient.streamScores}. */
export interface StreamScoresOptions {
  /** Optional single-fixture filter. */
  readonly fixtureId?: number;
  /** Optional `Last-Event-ID` to resume the stream. */
  readonly lastEventId?: string;
  /** Optional abort signal to stop the stream. */
  readonly signal?: AbortSignal;
}

type AuthRequirement = "none" | "jwt" | "both";

export class TxlineClient {
  readonly #config: TxlineConfig;
  readonly #fetch: typeof fetch;
  #jwt: string | undefined;
  #apiToken: string | undefined;

  constructor(options: TxlineClientOptions) {
    this.#config = options.config;
    const f = options.fetchImpl ?? globalThis.fetch;
    if (typeof f !== "function") {
      throw configError("no_fetch", "No fetch implementation available; pass fetchImpl");
    }
    // Bind to preserve `this` for the global fetch in browser/Worker runtimes.
    this.#fetch = f.bind(globalThis);
    this.#jwt = options.config.jwt;
    this.#apiToken = options.config.apiToken;
  }

  /** The JWT currently held by the client, if any. */
  get jwt(): string | undefined {
    return this.#jwt;
  }

  /** The API token currently held by the client, if any. */
  get apiToken(): string | undefined {
    return this.#apiToken;
  }

  /** Set/replace the session JWT (e.g. after re-acquiring on 401). */
  setJwt(jwt: string): void {
    this.#jwt = jwt;
  }

  /** Set/replace the long-lived API token (e.g. after activation). */
  setApiToken(token: string): void {
    this.#apiToken = token;
  }

  /* ----------------------------------------------------------------------- */
  /* Auth                                                                     */
  /* ----------------------------------------------------------------------- */

  /**
   * `POST /auth/guest/start` (no auth) → guest JWT. Stores the JWT on the client
   * and returns the parsed {@link TokenResponse}.
   */
  async startGuestSession(): Promise<TokenResponse> {
    const res = await this.#request("POST", "/auth/guest/start", { auth: "none" });
    const body = await this.#json(res, TokenResponseSchema);
    this.#jwt = body.token;
    return body;
  }

  /**
   * `POST /api/token/activate` (Bearer JWT). Returns the API token as plain text,
   * stores it on the client, and returns the raw token string.
   */
  async activate(payload: ActivationPayload): Promise<string> {
    const parsed = ActivationPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw validationError("Invalid ActivationPayload", parsed.error.issues);
    }
    const res = await this.#request("POST", "/api/token/activate", {
      auth: "jwt",
      body: parsed.data,
    });
    const token = (await res.text()).trim();
    if (token.length === 0) {
      throw validationError("Activation returned an empty API token");
    }
    this.#apiToken = token;
    return token;
  }

  /* ----------------------------------------------------------------------- */
  /* Reads                                                                    */
  /* ----------------------------------------------------------------------- */

  /** `GET /api/fixtures/snapshot` → `Fixture[]`. */
  async getFixturesSnapshot(opts: FixturesSnapshotOptions = {}): Promise<Fixture[]> {
    const query: Record<string, string | number | undefined> = {
      startEpochDay: opts.startEpochDay,
      competitionId: opts.competitionId,
    };
    const res = await this.#request("GET", "/api/fixtures/snapshot", { auth: "both", query });
    return this.#json(res, FixtureArraySchema);
  }

  /** `GET /api/scores/snapshot/{fixtureId}` → `Scores[]`. */
  async getScoresSnapshot(fixtureId: number): Promise<Scores[]> {
    const res = await this.#request(
      "GET",
      `/api/scores/snapshot/${encodeURIComponent(fixtureId)}`,
      {
        auth: "both",
      },
    );
    return this.#json(res, ScoresArraySchema);
  }

  /** `GET /api/scores/historical/{fixtureId}` → full `Scores[]` sequence. */
  async getScoresHistorical(fixtureId: number): Promise<Scores[]> {
    const res = await this.#request(
      "GET",
      `/api/scores/historical/${encodeURIComponent(fixtureId)}`,
      { auth: "both" },
    );
    return this.#json(res, ScoresArraySchema);
  }

  /** `GET /api/scores/stat-validation` → the three-stage Merkle proof. */
  async getStatValidation(args: StatValidationArgs): Promise<ScoresStatValidation> {
    const query: Record<string, string | number | undefined> = {
      fixtureId: args.fixtureId,
      seq: args.seq,
      statKey: args.statKey,
      statKey2: args.statKey2,
    };
    const res = await this.#request("GET", "/api/scores/stat-validation", {
      auth: "both",
      query,
    });
    return this.#json(res, ScoresStatValidationSchema);
  }

  /**
   * `GET /api/scores/stream` (SSE) → async iterator of validated score events.
   * Heartbeats are filtered out by {@link parseScoresStream}.
   */
  async *streamScores(
    opts: StreamScoresOptions = {},
  ): AsyncGenerator<ScoresStreamEvent, void, void> {
    const headers = this.#headers("both");
    headers.set("Accept", "text/event-stream");
    if (opts.lastEventId !== undefined) headers.set("Last-Event-ID", opts.lastEventId);

    const url = this.#url("/api/scores/stream", { fixtureId: opts.fixtureId });

    let res: Response;
    try {
      res = await this.#fetch(url, {
        method: "GET",
        headers,
        ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      });
    } catch (cause) {
      throw networkError("Network error opening scores stream", cause);
    }
    if (!res.ok) {
      throw httpError(res.status, `Scores stream failed: HTTP ${res.status}`);
    }
    const body = res.body;
    if (body === null) {
      throw networkError("Scores stream response had no body");
    }
    yield* parseScoresStream(readableToAsyncIterable(body));
  }

  /* ----------------------------------------------------------------------- */
  /* Internals                                                                */
  /* ----------------------------------------------------------------------- */

  /** Build a headers object, enforcing auth presence for the given requirement. */
  #headers(auth: AuthRequirement): Headers {
    const headers = new Headers();
    if (auth === "jwt" || auth === "both") {
      if (this.#jwt === undefined) {
        throw configError("missing_jwt", "Missing JWT; call startGuestSession() first");
      }
      headers.set("Authorization", `Bearer ${this.#jwt}`);
    }
    if (auth === "both") {
      if (this.#apiToken === undefined) {
        throw configError("missing_api_token", "Missing API token; call activate() first");
      }
      headers.set("X-Api-Token", this.#apiToken);
    }
    return headers;
  }

  #url(path: string, query?: Record<string, string | number | undefined>): string {
    const url = new URL(this.#config.apiBase + path);
    if (query !== undefined) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  async #request(
    method: "GET" | "POST",
    path: string,
    opts: {
      auth: AuthRequirement;
      query?: Record<string, string | number | undefined>;
      body?: unknown;
    },
  ): Promise<Response> {
    const headers = this.#headers(opts.auth);
    let init: RequestInit = { method, headers };
    if (opts.body !== undefined) {
      headers.set("Content-Type", "application/json");
      init = { ...init, body: JSON.stringify(opts.body) };
    }
    const url = this.#url(path, opts.query);

    let res: Response;
    try {
      res = await this.#fetch(url, init);
    } catch (cause) {
      throw networkError(`Network error: ${method} ${path}`, cause);
    }
    if (!res.ok) {
      // Surface the (non-secret) error body text for diagnostics.
      let detail: string | undefined;
      try {
        detail = (await res.text()).slice(0, 500);
      } catch {
        detail = undefined;
      }
      throw httpError(res.status, `${method} ${path} failed: HTTP ${res.status}`, detail);
    }
    return res;
  }

  /** Read a JSON body and validate it with the given Zod schema. */
  async #json<S extends z.ZodType>(res: Response, schema: S): Promise<z.infer<S>> {
    let raw: unknown;
    try {
      raw = await res.json();
    } catch (cause) {
      throw validationError("Response was not valid JSON", { cause: String(cause) });
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw validationError("Response failed schema validation", parsed.error.issues);
    }
    return parsed.data;
  }
}

/** Adapt a `ReadableStream<Uint8Array>` into an async iterable of chunks. */
async function* readableToAsyncIterable(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array, void, void> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value !== undefined) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
