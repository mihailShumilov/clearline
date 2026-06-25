import { describe, expect, it } from "vitest";
import type { Position, Predicate } from "@clearline/core";
import { InMemoryPositionStore, StoreError } from "./index";

const predicate: Predicate = { kind: "single", statKey: 100, op: ">=", threshold: 2 };

function position(status: Position["status"] = "open"): Position {
  return {
    edge: { fixtureId: 1, predicate, stakeLamports: 1_000n, priceBps: 18_000, claimedAtMs: 0 },
    status,
  };
}

describe("InMemoryPositionStore", () => {
  it("opens, gets, and lists in insertion order", async () => {
    const store = new InMemoryPositionStore();
    await store.open("a", position());
    await store.open("b", position());
    const got = await store.get("a");
    expect(got?.id).toBe("a");
    const list = await store.list();
    expect(list.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("rejects a duplicate id", async () => {
    const store = new InMemoryPositionStore();
    await store.open("a", position());
    await expect(store.open("a", position())).rejects.toBeInstanceOf(StoreError);
  });

  it("updates an existing position", async () => {
    const store = new InMemoryPositionStore();
    await store.open("a", position("open"));
    const updated = await store.update("a", { position: position("won") });
    expect(updated.position.status).toBe("won");
    expect((await store.get("a"))?.position.status).toBe("won");
  });

  it("rejects updating an unknown id", async () => {
    const store = new InMemoryPositionStore();
    await expect(store.update("nope", { position: position() })).rejects.toMatchObject({
      code: "unknown-id",
    });
  });

  it("get returns undefined for an absent id", async () => {
    const store = new InMemoryPositionStore();
    expect(await store.get("missing")).toBeUndefined();
  });
});
