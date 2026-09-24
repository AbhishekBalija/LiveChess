import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyMoveReceived, applyResultChange, applyTruncate, emptyGame, planTruncation, START_FEN } from "./handler";
import {
  broadcastSlugs,
  fensForSans,
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

describe("takebacks (ADR 0004)", () => {
  function stateWith(sans: string[]) {
    const state = emptyGame();
    sans.forEach((san, i) => {
      applyMoveReceived(state, { ply: i + 1, san, fen: `fen-${i + 1}`, clock: null, source: "lichess" });
    });
    return state;
  }
  const incoming = (sans: string[]) => sans.map((san, i) => ({ ply: i + 1, san }));

  it("needs nothing when the PGN only grows", () => {
    expect(planTruncation(stateWith(["e4", "e5"]), incoming(["e4", "e5", "Nf3"]))).toBeNull();
  });

  it("needs nothing for a correction on the last ply", () => {
    expect(planTruncation(stateWith(["e4", "e5"]), incoming(["e4", "c5"]))).toBeNull();
  });

  it("truncates to the changed ply when later plies exist", () => {
    const state = stateWith(["e4", "e5", "Nf3", "Nc6"]);
    expect(planTruncation(state, incoming(["e4", "c5"]))).toBe(2);
    expect(planTruncation(state, incoming(["e4", "c5", "Nf3", "d6"]))).toBe(2);
  });

  it("truncates to the PGN length when the PGN just gets shorter", () => {
    expect(planTruncation(stateWith(["e4", "e5", "Nf3"]), incoming(["e4"]))).toBe(1);
    expect(planTruncation(stateWith(["e4", "e5"]), [])).toBe(0);
  });

  it("drops later plies, rewinds the position and bumps Version once", () => {
    const state = stateWith(["e4", "e5", "Nf3", "Nc6"]);
    const t = applyTruncate(state, 2);
    expect(t).toMatchObject({ outcome: "truncated", toPly: 2, fen: "fen-2", lastSan: "e5", version: 5 });
    expect(t.outbox).toEqual({ eventType: "GameTruncated", payload: { ply: 2, fen: "fen-2", version: 5 } });
    expect([...state.moves.keys()]).toEqual([1, 2]);
    expect(state.version).toBe(5);
  });

  it("rewinds to the start position when every ply goes", () => {
    const t = applyTruncate(stateWith(["e4"]), 0);
    expect(t).toMatchObject({ toPly: 0, fen: START_FEN, lastSan: "" });
  });

  it("a correction after a truncation continues the Version sequence", () => {
    const state = stateWith(["e4", "e5", "Nf3"]);
    applyTruncate(state, 2);
    const fix = applyMoveReceived(state, { ply: 2, san: "c5", fen: "fen-2b", clock: null, source: "lichess" });
    expect(fix).toMatchObject({ outcome: "correction", version: 5 });
  });
});

describe("illegal moves in a relayed PGN", () => {
  it("keeps the legal plies before the first illegal one", () => {
    // 3. Qxf7 is illegal (the queen is still on d1 after 1. e4 e5 2. Nf3 Nc6).
    const pgn = `[Event "T"]
[GameURL "https://lichess.org/broadcast/t/r/rrrrrrrr/iiiiiiii"]

1. e4 e5 2. Nf3 Nc6 3. Qxf7 Kxf7 *`;
    const game = parseBroadcastGame(pgn);
    expect(game.plies.map((p) => p.san)).toEqual(["e4", "e5", "Nf3", "Nc6"]);
    expect(game.plies[3]?.fen).toContain("r1bqkbnr/pppp1ppp/2n5");
  });

  it("stops fensForSans at the first illegal move", () => {
    expect(fensForSans(["e4", "e5", "Ke3", "Nc6"])).toHaveLength(2);
  });
});

describe("result changes", () => {
  it("bumps Version once and keeps the board where it is", () => {
    const state = emptyGame();
    applyMoveReceived(state, { ply: 1, san: "e4", fen: "fen-1", clock: null, source: "lichess" });
    const out = applyResultChange(state, "*", "1-0");
    expect(out).toMatchObject({ version: 2, result: "1-0", lastPly: 1, fen: "fen-1", lastSan: "e4" });
    expect(out?.outbox).toEqual({
      eventType: "GameResult",
      payload: { ply: 1, fen: "fen-1", version: 2, result: "1-0" },
    });
    expect(state.version).toBe(2);
  });

  it("does nothing when the Result is unchanged", () => {
    const state = emptyGame();
    expect(applyResultChange(state, "1-0", "1-0")).toBeNull();
    expect(state.version).toBe(0);
  });
});
