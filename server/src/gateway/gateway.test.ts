import { describe, expect, it, vi } from "vitest";
import { consumeOnce, entryToEvent, GROUP } from "./consumer";
import { Router } from "./router";
import { STREAM } from "../publisher/publisher";

describe("gateway router", () => {
  it("fans out only to subscribers of that game", () => {
    const router = new Router();
    const a = {};
    const b = {};
    router.subscribe(a, "g-1");
    router.subscribe(b, "g-2");
    const send = vi.fn();
    const delivered = router.fanout(
      { type: "MoveReceived", gameId: "g-1", ply: "1", san: "e4", fen: "f", clock: "", version: "1", result: "" },
      send,
    );
    expect(delivered).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1]).toContain("g-1");
  });

  it("stores subscriptions but never events: nothing to replay", () => {
    const router = new Router();
    const a = {};
    router.subscribe(a, "g-1");
    router.fanout(
      { type: "MoveReceived", gameId: "g-1", ply: "1", san: "e4", fen: "f", clock: "", version: "1", result: "" },
      () => {},
    );
    // A late subscriber gets nothing from memory; it must resync.
    const late = {};
    router.subscribe(late, "g-1");
    const send = vi.fn();
    expect(router.fanout(
      { type: "MoveReceived", gameId: "g-9", ply: "9", san: "x", fen: "f", clock: "", version: "9", result: "" },
      send,
    )).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(router.connectionCount()).toBe(2);
  });

  it("drops subscriptions on disconnect", () => {
    const router = new Router();
    const a = {};
    router.subscribe(a, "g-1");
    router.unsubscribeAll(a);
    const send = vi.fn();
    router.fanout(
      { type: "MoveReceived", gameId: "g-1", ply: "1", san: "e4", fen: "f", clock: "", version: "1", result: "" },
      send,
    );
    expect(send).not.toHaveBeenCalled();
  });
});

describe("gateway consumer", () => {
  it("reads the group stream, fans out, and acks each entry", async () => {
    const seen: Array<[string, string, string]> = [];
    const acked: string[] = [];
    const router = new Router();
    const conn = {};
    router.subscribe(conn, "g-1");
    const send = vi.fn();
    const n = await consumeOnce(
      {
        readGroup: async (group, _consumer, stream) => {
          seen.push([group, stream, GROUP]);
          expect(stream).toBe(STREAM);
          return [
            { id: "1-0", fields: { type: "MoveReceived", gameId: "g-1", ply: "1", san: "e4", fen: "f", clock: "", version: "1", result: "" } },
            { id: "2-0", fields: { type: "MoveReceived", gameId: "g-2", ply: "1", san: "d4", fen: "f", clock: "", version: "1", result: "" } },
          ];
        },
        ack: async (_s, _g, id) => {
          acked.push(id);
        },
      },
      router,
      "test-consumer",
      send,
    );
    expect(n).toBe(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(acked).toEqual(["1-0", "2-0"]);
    expect(seen[0]?.[0]).toBe(GROUP);
  });

  it("maps stream fields to events with safe defaults", () => {
    expect(entryToEvent({})).toMatchObject({ gameId: "", version: "" });
  });
});
