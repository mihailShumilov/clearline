import { describe, expect, it } from "vitest";

import { isTxlineError } from "./errors";
import { parseScoresStream, parseSseStream, type SseEvent } from "./sse";

/** Build an async iterable from a fixed list of chunks. */
async function* chunksOf(
  ...chunks: Array<string | Uint8Array>
): AsyncGenerator<string | Uint8Array> {
  for (const c of chunks) yield c;
}

async function collect(it: AsyncIterable<SseEvent>): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
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

describe("parseSseStream", () => {
  it("parses a single data event", async () => {
    const out = await collect(parseSseStream(chunksOf("data: hello\n\n")));
    expect(out).toEqual([{ data: "hello" }]);
  });

  it("parses id + event + data", async () => {
    const out = await collect(
      parseSseStream(chunksOf('id: 123:0\nevent: heartbeat\ndata: {"Ts":1}\n\n')),
    );
    expect(out).toEqual([{ id: "123:0", event: "heartbeat", data: '{"Ts":1}' }]);
  });

  it("joins multiline data with newlines", async () => {
    const out = await collect(parseSseStream(chunksOf("data: line1\ndata: line2\n\n")));
    expect(out).toEqual([{ data: "line1\nline2" }]);
  });

  it("emits multiple events in one stream", async () => {
    const out = await collect(parseSseStream(chunksOf("data: a\n\ndata: b\n\ndata: c\n\n")));
    expect(out.map((e) => e.data)).toEqual(["a", "b", "c"]);
  });

  it("handles a chunk split mid-event and mid-line", async () => {
    const out = await collect(
      parseSseStream(chunksOf("id: 1\nda", "ta: par", "tial\n\ndata: second\n", "\n")),
    );
    // Per the SSE spec the last-event-id buffer persists across events, so the
    // second event (which has no explicit id) inherits id "1".
    expect(out).toEqual([
      { id: "1", data: "partial" },
      { id: "1", data: "second" },
    ]);
  });

  it("decodes Uint8Array chunks", async () => {
    const bytes = new TextEncoder().encode("data: bytes-ok\n\n");
    const out = await collect(parseSseStream(chunksOf(bytes)));
    expect(out).toEqual([{ data: "bytes-ok" }]);
  });

  it("handles CRLF and CR line terminators", async () => {
    const out = await collect(parseSseStream(chunksOf("data: crlf\r\n\r\n")));
    expect(out).toEqual([{ data: "crlf" }]);
  });

  it("ignores comment / ping lines", async () => {
    const out = await collect(parseSseStream(chunksOf(": keep-alive\ndata: real\n\n")));
    expect(out).toEqual([{ data: "real" }]);
  });

  it("flushes a final event with no trailing blank line", async () => {
    const out = await collect(parseSseStream(chunksOf("data: tail")));
    expect(out).toEqual([{ data: "tail" }]);
  });

  it("does not dispatch empty blocks", async () => {
    const out = await collect(parseSseStream(chunksOf("\n\n\n")));
    expect(out).toEqual([]);
  });
});

describe("parseScoresStream", () => {
  it("yields a validated Scores event and skips heartbeats", async () => {
    const heartbeat = 'event: heartbeat\ndata: {"Ts":123}\n\n';
    const data = `id: 200:0\ndata: ${JSON.stringify(coreScores)}\n\n`;
    const out: Array<{ id?: string; fixtureId: number }> = [];
    for await (const ev of parseScoresStream(chunksOf(heartbeat, data))) {
      out.push({ ...(ev.id !== undefined ? { id: ev.id } : {}), fixtureId: ev.data.fixtureId });
    }
    expect(out).toEqual([{ id: "200:0", fixtureId: 42 }]);
  });

  it("throws a validation TxlineError on malformed JSON", async () => {
    const it = parseScoresStream(chunksOf("data: {not json}\n\n"));
    await expect(async () => {
      for await (const _ of it) void _;
    }).rejects.toSatisfy((e: unknown) => isTxlineError(e) && e.kind === "validation");
  });

  it("throws a validation TxlineError when Scores fields are missing", async () => {
    const it = parseScoresStream(chunksOf('data: {"fixtureId":1}\n\n'));
    await expect(async () => {
      for await (const _ of it) void _;
    }).rejects.toSatisfy((e: unknown) => isTxlineError(e) && e.kind === "validation");
  });
});
