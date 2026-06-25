/**
 * Typed fetch client for the ClearLine API (§7 Phase 7).
 *
 * Every response crosses the boundary as `unknown` and is parsed with Zod before
 * it reaches the UI — there is no `any` and no unchecked `as`. A failed fetch or a
 * schema mismatch surfaces as a typed {@link ApiError}; callers render a
 * disconnected state rather than crashing.
 *
 * Money (lamports) stays a decimal **string** end-to-end (§4); it is only formatted
 * for display. The SSE subscription uses the browser `EventSource`.
 */
import { z } from "zod";

/** Base URL for the API. Defaults to the local `wrangler dev` worker. */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

/* ------------------------------------------------------------------ schemas */

/** Integer comparison operator, mirrors core `ComparisonOp`. */
const ComparisonOpSchema = z.enum([">", ">=", "=", "<=", "<"]);

/** Predicate discriminated union, mirrors core `Predicate` (§8). */
const PredicateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("single"),
    statKey: z.number().int(),
    period: z.number().int().optional(),
    op: ComparisonOpSchema,
    threshold: z.number().int(),
  }),
  z.object({
    kind: z.literal("margin"),
    statKey1: z.number().int(),
    statKey2: z.number().int(),
    period: z.number().int().optional(),
    op: ComparisonOpSchema,
    threshold: z.number().int(),
  }),
]);
export type Predicate = z.infer<typeof PredicateSchema>;

/** One endpoint row of the RPC Health snapshot. */
const HealthEndpointSchema = z.object({
  name: z.string(),
  healthy: z.boolean(),
  slot: z.string().nullable(),
  latencyMs: z.number(),
  errorRate: z.number(),
  consecutiveFailures: z.number(),
  freshest: z.boolean(),
});
export type HealthEndpoint = z.infer<typeof HealthEndpointSchema>;

/** Full RPC Health snapshot DTO (§11b). */
const HealthSnapshotSchema = z.object({
  endpoints: z.array(HealthEndpointSchema),
  healthyCount: z.number(),
  totalCount: z.number(),
});
export type HealthSnapshot = z.infer<typeof HealthSnapshotSchema>;

/** `GET /api/health` envelope. */
const HealthResponseSchema = z.object({
  ok: z.boolean(),
  rpc: HealthSnapshotSchema,
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

const PositionStatusSchema = z.enum(["open", "won", "lost", "void"]);
export type PositionStatus = z.infer<typeof PositionStatusSchema>;

/** A persisted position / edge row. */
const PositionSchema = z.object({
  id: z.string(),
  fixtureId: z.number(),
  predicate: PredicateSchema,
  stakeLamports: z.string(),
  priceBps: z.number(),
  status: PositionStatusSchema,
  pnlLamports: z.string(),
  claimedAtMs: z.number(),
});
export type Position = z.infer<typeof PositionSchema>;

const PositionsResponseSchema = z.object({ positions: z.array(PositionSchema) });

/** An edge row (`GET /api/edges`) — the staked predicate, no P&L. */
const EdgeSchema = z.object({
  id: z.string(),
  fixtureId: z.number(),
  predicate: PredicateSchema,
  stakeLamports: z.string(),
  priceBps: z.number(),
  claimedAtMs: z.number(),
  status: PositionStatusSchema,
});
export type Edge = z.infer<typeof EdgeSchema>;

const EdgesResponseSchema = z.object({ edges: z.array(EdgeSchema) });

/** A persisted settlement verdict + on-chain provenance. */
const SettlementSchema = z.object({
  id: z.string(),
  positionId: z.string(),
  holds: z.boolean(),
  source: z.enum(["local", "onchain"]),
  signature: z.string().nullable(),
  explorerUrl: z.string().nullable(),
  rootPda: z.string().nullable(),
  programId: z.string().nullable(),
  createdAtMs: z.number(),
});
export type Settlement = z.infer<typeof SettlementSchema>;

const SettlementsResponseSchema = z.object({
  settlements: z.array(SettlementSchema),
});

/** Summary of the most recent replay (agent status). */
const LastReplaySchema = z.object({
  fixtureId: z.number(),
  positions: z.number(),
  settlements: z.number(),
  pnlLamports: z.string(),
  verdictSource: z.string().nullable(),
  explorerUrl: z.string().nullable(),
  at: z.number(),
});
export type LastReplay = z.infer<typeof LastReplaySchema>;

/** `GET /api/agent/status`. */
const AgentStatusSchema = z.object({
  state: z.enum(["idle", "running"]),
  lastReplay: LastReplaySchema.nullable(),
});
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/** A replay settlement (money as strings; on-chain fields optional). */
const ReplaySettlementSchema = z.object({
  holds: z.boolean(),
  source: z.enum(["local", "onchain"]),
  signature: z.string().nullable(),
  explorerUrl: z.string().nullable(),
  rootPda: z.string().nullable(),
  programId: z.string().nullable(),
  verifiedOnChain: z.boolean(),
});

const ReplayPositionSchema = z.object({
  fixtureId: z.number(),
  predicate: PredicateSchema,
  stakeLamports: z.string(),
  priceBps: z.number(),
  claimedAtMs: z.number(),
  status: PositionStatusSchema,
});

/** On-chain proof evidence surfaced by a real-fixture replay. */
const ReplayOnChainSchema = z.object({
  subscribeExplorer: z.string(),
  dailyScoresRootsPda: z.string(),
  programId: z.string(),
  verdictSource: z.string(),
});
export type ReplayOnChain = z.infer<typeof ReplayOnChainSchema>;

/** `POST /api/demo-replay` result. */
const ReplayResultSchema = z.object({
  fixtureId: z.number(),
  positions: z.array(ReplayPositionSchema),
  settlements: z.array(ReplaySettlementSchema),
  pnlLamports: z.string(),
  onchain: ReplayOnChainSchema.nullable(),
});
export type ReplayResult = z.infer<typeof ReplayResultSchema>;

/** A live event from the SSE stream. */
const LiveEventSchema = z.object({
  ts: z.number(),
  kind: z.string(),
  data: z.unknown(),
});
export type LiveEvent = z.infer<typeof LiveEventSchema>;

/* -------------------------------------------------------------------- errors */

/** A typed client error: a failed transport or a schema mismatch. */
export class ApiError extends Error {
  readonly kind: "network" | "http" | "parse";
  readonly status?: number;

  constructor(kind: "network" | "http" | "parse", message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    if (status !== undefined) this.status = status;
  }
}

/* ----------------------------------------------------------------- fetch core */

async function getJSON<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { accept: "application/json" },
    });
  } catch (cause) {
    throw new ApiError("network", `network error calling ${path}: ${String(cause)}`);
  }
  if (!res.ok) {
    throw new ApiError("http", `${path} responded ${res.status}`, res.status);
  }
  let body: unknown;
  try {
    body = (await res.json()) as unknown;
  } catch (cause) {
    throw new ApiError("parse", `${path} returned invalid JSON: ${String(cause)}`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError("parse", `${path} schema mismatch: ${parsed.error.message}`);
  }
  return parsed.data;
}

/* --------------------------------------------------------------------- client */

export const api = {
  health: (): Promise<HealthResponse> => getJSON("/api/health", HealthResponseSchema),
  agentStatus: (): Promise<AgentStatus> => getJSON("/api/agent/status", AgentStatusSchema),
  positions: (): Promise<Position[]> =>
    getJSON("/api/positions", PositionsResponseSchema).then((r) => r.positions),
  edges: (): Promise<Edge[]> => getJSON("/api/edges", EdgesResponseSchema).then((r) => r.edges),
  settlements: (): Promise<Settlement[]> =>
    getJSON("/api/settlements", SettlementsResponseSchema).then((r) => r.settlements),
  async runReplay(fixtureId?: number): Promise<ReplayResult> {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/demo-replay`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(fixtureId === undefined ? {} : { fixtureId }),
      });
    } catch (cause) {
      throw new ApiError("network", `network error running replay: ${String(cause)}`);
    }
    if (!res.ok) {
      throw new ApiError("http", `demo-replay responded ${res.status}`, res.status);
    }
    let body: unknown;
    try {
      body = (await res.json()) as unknown;
    } catch (cause) {
      throw new ApiError("parse", `demo-replay returned invalid JSON: ${String(cause)}`);
    }
    const parsed = ReplayResultSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError("parse", `demo-replay schema mismatch: ${parsed.error.message}`);
    }
    return parsed.data;
  },
};

/**
 * Subscribe to the `/api/events` SSE stream. Returns an unsubscribe function.
 *
 * Each `message` is validated; malformed frames are dropped (reported to
 * `onError`) rather than throwing. Transport errors flip the caller's connection
 * state via `onError`; `EventSource` reconnects on its own.
 */
export function subscribeEvents(handlers: {
  onEvent: (event: LiveEvent) => void;
  onOpen?: () => void;
  onError?: (error: ApiError) => void;
}): () => void {
  const source = new EventSource(`${API_BASE}/api/events`);

  const handleMessage = (ev: MessageEvent<string>): void => {
    let raw: unknown;
    try {
      raw = JSON.parse(ev.data) as unknown;
    } catch {
      handlers.onError?.(new ApiError("parse", "SSE frame was not valid JSON"));
      return;
    }
    const parsed = LiveEventSchema.safeParse(raw);
    if (parsed.success) {
      handlers.onEvent(parsed.data);
    }
  };

  // The API emits named events (`replay.done`, `heartbeat`, …) as well as the
  // default `message` type, so listen broadly.
  source.onmessage = handleMessage;
  source.addEventListener("replay.done", handleMessage as EventListener);
  source.addEventListener("heartbeat", handleMessage as EventListener);
  source.onopen = (): void => handlers.onOpen?.();
  source.onerror = (): void => handlers.onError?.(new ApiError("network", "SSE connection lost"));

  return (): void => source.close();
}
