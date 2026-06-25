import { describe, expect, it } from "vitest";

import { loadTxlineConfig } from "./config";
import { isTxlineError } from "./errors";
import { TxlineClient } from "./client";

/** A captured request plus a canned response, for asserting header/query shape. */
interface Captured {
  url: string;
  method: string;
  headers: Headers;
  body?: string;
}

/** Build a mock fetch that records the call and returns the given response. */
function mockFetch(responder: (req: Captured) => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const captured: Captured = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    };
    calls.push(captured);
    return responder(captured);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const coreScores = {
  fixtureId: 42,
  gameState: "in_play",
  startTime: 1,
  fixtureGroupId: 12,
  competitionId: 501,
  countryId: 1,
  sportId: 1,
  participant1IsHome: true,
  participant2Id: 200,
  participant1Id: 100,
  action: "update",
  id: 7,
  ts: 2,
  connectionId: 9,
  seq: 3,
};

describe("TxlineClient.startGuestSession", () => {
  it("posts to /auth/guest/start with no auth and stores the jwt", async () => {
    const { fetchImpl, calls } = mockFetch(() => jsonResponse({ token: "guest-jwt-123" }));
    const client = new TxlineClient({ config: loadTxlineConfig({}), fetchImpl });

    const out = await client.startGuestSession();

    expect(out.token).toBe("guest-jwt-123");
    expect(client.jwt).toBe("guest-jwt-123");
    expect(calls[0]?.url).toBe("https://txline.txodds.com/auth/guest/start");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers.has("Authorization")).toBe(false);
  });

  it("maps an HTTP 500 to a TxlineError of kind http", async () => {
    const { fetchImpl } = mockFetch(() => new Response("boom", { status: 500 }));
    const client = new TxlineClient({ config: loadTxlineConfig({}), fetchImpl });

    await expect(client.startGuestSession()).rejects.toSatisfy(
      (e: unknown) => isTxlineError(e) && e.kind === "http" && e.status === 500,
    );
  });

  it("maps a transport throw to a TxlineError of kind network", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const client = new TxlineClient({ config: loadTxlineConfig({}), fetchImpl });

    await expect(client.startGuestSession()).rejects.toSatisfy(
      (e: unknown) => isTxlineError(e) && e.kind === "network",
    );
  });

  it("rejects a malformed guest-start body with a validation error", async () => {
    const { fetchImpl } = mockFetch(() => jsonResponse({ notToken: 1 }));
    const client = new TxlineClient({ config: loadTxlineConfig({}), fetchImpl });

    await expect(client.startGuestSession()).rejects.toSatisfy(
      (e: unknown) => isTxlineError(e) && e.kind === "validation",
    );
  });
});

describe("TxlineClient.activate", () => {
  it("sends Bearer JWT, posts the payload, returns the text token", async () => {
    const { fetchImpl, calls } = mockFetch(
      () => new Response("txoracle_api_123abc456def", { status: 200 }),
    );
    const client = new TxlineClient({
      config: loadTxlineConfig({ TXLINE_JWT: "jwt-1" }),
      fetchImpl,
    });

    const token = await client.activate({ txSig: "sig", walletSignature: "ws", leagues: [] });

    expect(token).toBe("txoracle_api_123abc456def");
    expect(client.apiToken).toBe("txoracle_api_123abc456def");
    expect(calls[0]?.url).toBe("https://txline.txodds.com/api/token/activate");
    expect(calls[0]?.headers.get("Authorization")).toBe("Bearer jwt-1");
    expect(calls[0]?.headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({ txSig: "sig" });
  });

  it("requires a JWT (missing-auth → config TxlineError)", async () => {
    const { fetchImpl } = mockFetch(() => new Response("x"));
    const client = new TxlineClient({ config: loadTxlineConfig({}), fetchImpl });

    await expect(client.activate({ txSig: "s", walletSignature: "w" })).rejects.toSatisfy(
      (e: unknown) => isTxlineError(e) && e.kind === "config" && e.code === "missing_jwt",
    );
  });

  it("rejects an empty token response", async () => {
    const { fetchImpl } = mockFetch(() => new Response("   ", { status: 200 }));
    const client = new TxlineClient({
      config: loadTxlineConfig({ TXLINE_JWT: "jwt-1" }),
      fetchImpl,
    });
    await expect(client.activate({ txSig: "s", walletSignature: "w" })).rejects.toSatisfy(
      (e: unknown) => isTxlineError(e) && e.kind === "validation",
    );
  });
});

describe("TxlineClient data reads", () => {
  const authedConfig = loadTxlineConfig({ TXLINE_JWT: "jwt-1", TXLINE_API_TOKEN: "api-1" });

  it("getFixturesSnapshot sends both auth headers and the query params", async () => {
    const { fetchImpl, calls } = mockFetch(() => jsonResponse([]));
    const client = new TxlineClient({ config: authedConfig, fetchImpl });

    await client.getFixturesSnapshot({ startEpochDay: 20000, competitionId: 501 });

    const call = calls[0];
    expect(call?.headers.get("Authorization")).toBe("Bearer jwt-1");
    expect(call?.headers.get("X-Api-Token")).toBe("api-1");
    const url = new URL(call?.url ?? "");
    expect(url.pathname).toBe("/api/fixtures/snapshot");
    expect(url.searchParams.get("startEpochDay")).toBe("20000");
    expect(url.searchParams.get("competitionId")).toBe("501");
  });

  it("getFixturesSnapshot omits absent query params", async () => {
    const { fetchImpl, calls } = mockFetch(() => jsonResponse([]));
    const client = new TxlineClient({ config: authedConfig, fetchImpl });

    await client.getFixturesSnapshot();
    const url = new URL(calls[0]?.url ?? "");
    expect(url.search).toBe("");
  });

  it("getScoresSnapshot parses an array of Scores", async () => {
    const { fetchImpl, calls } = mockFetch(() => jsonResponse([coreScores]));
    const client = new TxlineClient({ config: authedConfig, fetchImpl });

    const out = await client.getScoresSnapshot(42);
    expect(out).toHaveLength(1);
    expect(out[0]?.fixtureId).toBe(42);
    expect(new URL(calls[0]?.url ?? "").pathname).toBe("/api/scores/snapshot/42");
  });

  it("getScoresHistorical targets the historical path", async () => {
    const { fetchImpl, calls } = mockFetch(() => jsonResponse([coreScores]));
    const client = new TxlineClient({ config: authedConfig, fetchImpl });

    await client.getScoresHistorical(99);
    expect(new URL(calls[0]?.url ?? "").pathname).toBe("/api/scores/historical/99");
  });

  it("getStatValidation builds the query and parses the proof (statKey2 optional)", async () => {
    const proof = {
      ts: 1,
      statToProve: { key: 1, value: 2, period: 0 },
      eventStatRoot: "cm9vdA==",
      summary: {
        fixtureId: 42,
        updateStats: { updateCount: 1, minTimestamp: 1, maxTimestamp: 2 },
        eventStatsSubTreeRoot: "c3Vi",
      },
      statProof: [{ hash: "aA==", isRightSibling: true }],
      subTreeProof: null,
      mainTreeProof: [],
    };
    const { fetchImpl, calls } = mockFetch(() => jsonResponse(proof));
    const client = new TxlineClient({ config: authedConfig, fetchImpl });

    const out = await client.getStatValidation({ fixtureId: 42, seq: 3, statKey: 1 });
    expect(out.subTreeProof).toEqual([]);
    const url = new URL(calls[0]?.url ?? "");
    expect(url.pathname).toBe("/api/scores/stat-validation");
    expect(url.searchParams.get("fixtureId")).toBe("42");
    expect(url.searchParams.get("seq")).toBe("3");
    expect(url.searchParams.get("statKey")).toBe("1");
    expect(url.searchParams.has("statKey2")).toBe(false);
  });

  it("getStatValidation includes statKey2 when provided", async () => {
    const { fetchImpl, calls } = mockFetch(() =>
      jsonResponse({
        ts: 1,
        statToProve: { key: 1, value: 2, period: 0 },
        eventStatRoot: "x",
        summary: {
          fixtureId: 42,
          updateStats: { updateCount: 1, minTimestamp: 1, maxTimestamp: 2 },
          eventStatsSubTreeRoot: "y",
        },
        statProof: [],
        subTreeProof: [],
        mainTreeProof: [],
      }),
    );
    const client = new TxlineClient({ config: authedConfig, fetchImpl });

    await client.getStatValidation({ fixtureId: 42, seq: 3, statKey: 1, statKey2: 2 });
    expect(new URL(calls[0]?.url ?? "").searchParams.get("statKey2")).toBe("2");
  });

  it("requires the API token for data reads (missing-auth → config error)", async () => {
    const { fetchImpl } = mockFetch(() => jsonResponse([]));
    const client = new TxlineClient({
      config: loadTxlineConfig({ TXLINE_JWT: "only-jwt" }),
      fetchImpl,
    });

    await expect(client.getScoresSnapshot(1)).rejects.toSatisfy(
      (e: unknown) => isTxlineError(e) && e.kind === "config" && e.code === "missing_api_token",
    );
  });

  it("maps a 403 to an http TxlineError", async () => {
    const { fetchImpl } = mockFetch(() => new Response("denied", { status: 403 }));
    const client = new TxlineClient({ config: authedConfig, fetchImpl });

    await expect(client.getFixturesSnapshot()).rejects.toSatisfy(
      (e: unknown) => isTxlineError(e) && e.kind === "http" && e.status === 403,
    );
  });
});

describe("TxlineClient.streamScores", () => {
  const authedConfig = loadTxlineConfig({ TXLINE_JWT: "jwt-1", TXLINE_API_TOKEN: "api-1" });

  function sseResponse(text: string): Response {
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  it("sets SSE headers, the fixtureId query, and yields validated events", async () => {
    const sse =
      `event: heartbeat\ndata: {"Ts":1}\n\n` + `id: 9:0\ndata: ${JSON.stringify(coreScores)}\n\n`;
    const { fetchImpl, calls } = mockFetch(() => sseResponse(sse));
    const client = new TxlineClient({ config: authedConfig, fetchImpl });

    const seen: Array<{ id?: string; fixtureId: number }> = [];
    for await (const ev of client.streamScores({ fixtureId: 42, lastEventId: "5:0" })) {
      seen.push({ ...(ev.id !== undefined ? { id: ev.id } : {}), fixtureId: ev.data.fixtureId });
    }

    expect(seen).toEqual([{ id: "9:0", fixtureId: 42 }]);
    const call = calls[0];
    expect(call?.headers.get("Accept")).toBe("text/event-stream");
    expect(call?.headers.get("Last-Event-ID")).toBe("5:0");
    expect(call?.headers.get("X-Api-Token")).toBe("api-1");
    expect(new URL(call?.url ?? "").searchParams.get("fixtureId")).toBe("42");
  });

  it("maps a non-ok stream response to an http TxlineError", async () => {
    const { fetchImpl } = mockFetch(() => new Response("nope", { status: 401 }));
    const client = new TxlineClient({ config: authedConfig, fetchImpl });

    const iter = client.streamScores();
    await expect(async () => {
      for await (const _ of iter) void _;
    }).rejects.toSatisfy((e: unknown) => isTxlineError(e) && e.kind === "http" && e.status === 401);
  });
});

// One opt-in live test (default skipped). Set TXLINE_LIVE=1 to exercise it.
describe("live", () => {
  if (!process.env["TXLINE_LIVE"]) {
    it.skip("startGuestSession returns a real { token } (set TXLINE_LIVE=1)", () => {
      /* skipped by default */
    });
  } else {
    it("startGuestSession returns a real { token }", async () => {
      const client = new TxlineClient({ config: loadTxlineConfig(process.env) });
      const out = await client.startGuestSession();
      expect(typeof out.token).toBe("string");
      expect(out.token.length).toBeGreaterThan(100);
    });
  }
});
