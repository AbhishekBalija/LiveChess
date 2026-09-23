import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyMoveReceived, emptyGame } from "./handler";
import {
  broadcastSlugs,
  gameSourceId,
  parseBroadcastGame,
  parseMovetext,
  splitPgnGames,
} from "./lichess";

const SAMPLE = `[White "Carlsen, Magnus"]
[Black "Nepomniachtchi, Ian"]

1. e4 {[%clk 0:03:00]} 1... e5 {[%clk 0:02:58.7]} 2. Nf3 {[%clk 0:02:59.9]} 2... Nc6 {[%clk 0:02:56.6]} *`;

describe("lichess broadcast parsing", () => {
  it("assigns distinct plies to White and Black at the same move number", () => {
    const plies = parseMovetext(
      "1. e4 {[%clk 0:03:00]} 1... e5 {[%clk 0:02:58.7]}",
    );
    expect(plies.map((p) => p.ply)).toEqual([1, 2]);
    expect(plies.map((p) => p.moveNumber)).toEqual([1, 1]);
    expect(plies.map((p) => p.side)).toEqual(["white", "black"]);
    expect(plies.map((p) => p.san)).toEqual(["e4", "e5"]);
  });

  it("captures %clk per half-move, null when absent", () => {
    const plies = parseMovetext("1. e4 {[%clk 0:03:00]} 1... e5 2. Nf3");
    expect(plies[0].clock).toBe("0:03:00");
    expect(plies[1].clock).toBeNull();
    expect(plies[2].clock).toBeNull();
  });

  it("ignores eval noise and NAG suffixes without phantom plies", () => {
    const plies = parseMovetext(
      "1. e4 { [%eval 0.1] [%clk 1:30:47] } 1... Nf6 { [%eval 0.18] } 2. e5?! { Inaccuracy. d4 was best. } { [%clk 1:25:01] } *",
    );
    expect(plies.map((p) => p.san)).toEqual(["e4", "Nf6", "e5"]);
    expect(plies.map((p) => p.ply)).toEqual([1, 2, 3]);
    expect(plies[0].clock).toBe("1:30:47");
    expect(plies[1].clock).toBeNull();
    expect(plies[2].clock).toBe("1:25:01");
  });

  it("splits a round export into games and reads their headers", () => {
    const pgn = `[Event "Test Open"]
[Site "https://lichess.org/broadcast/test-open/round-1/rrrrrrrr/aaaaaaaa"]
[White "A"]
[Black "B"]
[GameURL "https://lichess.org/broadcast/test-open/round-1/rrrrrrrr/aaaaaaaa"]
[BroadcastURL "https://lichess.org/broadcast/test-open/round-1/rrrrrrrr"]

1. e4 e5 *

[Event "Test Open"]
[Site "https://lichess.org/broadcast/test-open/round-1/rrrrrrrr/bbbbbbbb"]
[White "C"]
[Black "D"]
[GameURL "https://lichess.org/broadcast/test-open/round-1/rrrrrrrr/bbbbbbbb"]
[BroadcastURL "https://lichess.org/broadcast/test-open/round-1/rrrrrrrr"]

1. d4 d5 *`;
    const parts = splitPgnGames(pgn);
    expect(parts).toHaveLength(2);
    const first = parseBroadcastGame(parts[0] ?? "");
    expect(gameSourceId(first.headers)).toBe("aaaaaaaa");
    expect(first.headers["White"]).toBe("A");
    expect(first.plies.map((p) => p.san)).toEqual(["e4", "e5"]);
    expect(broadcastSlugs(first.headers)).toEqual({
      tourSlug: "test-open",
      roundSlug: "round-1",
    });
    expect(gameSourceId({})).toBeNull();
    expect(broadcastSlugs({})).toBeNull();
  });

  it("parses headers and computes a FEN per ply", () => {
    const game = parseBroadcastGame(SAMPLE);
    expect(game.headers["White"]).toBe("Carlsen, Magnus");
    expect(game.plies).toHaveLength(4);
    const fens = new Set(game.plies.map((p) => p.fen));
    expect(fens.size).toBe(4);
    expect(game.plies[0].clock).toBe("0:03:00");
  });
});

describe("move handler core", () => {
  it("inserts a new ply with version bump and MoveReceived outbox", () => {
    const state = emptyGame();
    const r = applyMoveReceived(state, {
      ply: 1,
      san: "e4",
      fen: "fen-1",
      clock: "0:03:00",
      source: "lichess",
    });
    expect(r.outcome).toBe("inserted");
    if (r.outcome !== "inserted") throw new Error("narrowing");
    expect(r.version).toBe(1);
    expect(r.outbox.eventType).toBe("MoveReceived");
  });

  it("treats same key plus same SAN as duplicate no-op", () => {
    const state = emptyGame();
    applyMoveReceived(state, {
      ply: 1,
      san: "e4",
      fen: "fen-1",
      clock: null,
      source: "lichess",
    });
    const r = applyMoveReceived(state, {
      ply: 1,
      san: "e4",
      fen: "fen-1",
      clock: null,
      source: "lichess",
    });
    expect(r).toEqual({ outcome: "duplicate-noop" });
    expect(state.version).toBe(1);
  });

  it("treats same key plus different SAN as correction with history", () => {
    const state = emptyGame();
    applyMoveReceived(state, {
      ply: 2,
      san: "e5",
      fen: "fen-2",
      clock: null,
      source: "lichess",
    });
    const r = applyMoveReceived(state, {
      ply: 2,
      san: "c5",
      fen: "fen-2b",
      clock: null,
      source: "lichess",
    });
    expect(r.outcome).toBe("correction");
    if (r.outcome !== "correction") throw new Error("narrowing");
    expect(r.version).toBe(2);
    expect(r.outbox.eventType).toBe("GameCorrected");
    expect(r.outbox.payload["oldSan"]).toBe("e5");
    expect(state.moves.get(2)?.san).toBe("c5");
  });

  it("never imports a Redis client by construction", () => {
    const src = readFileSync(new URL("./handler.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from\s+["'][^"']*redis[^"']*["']/i);
    expect(src).not.toMatch(/require\s*\([^)]*redis[^)]*\)/i);
  });
});
