import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { persistIngestResult, type Db } from "../db/client";
import * as schema from "../db/schema";
import { games, moves, outboxEvents, tournaments } from "../db/schema";
import { applyMoveReceived, emptyGame } from "../ingestion/handler";
import type { HttpPort, HttpResponse } from "../ingestion/worker";
import { parseBestMove, parseScore, whitePov, type EnginePort } from "./engine";
import { Chess } from "chess.js";
import { isSacrifice, sacrificedMaterial } from "./sacrifice";
import { categoryToEval, pieceCount, TABLEBASE_WIN_CP } from "./tablebase";
import { Evaluator, nextJob, saveEval, uciToSan } from "./worker";

const WHITE_TO_MOVE = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1";
const BLACK_TO_MOVE = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
// King and pawn endgame, 4 pieces.
const ENDGAME = "4k3/6KP/8/8/8/8/7p/8 w - - 0 1";

describe("UCI score parsing", () => {
  it("reads cp and mate scores from info lines", () => {
    expect(parseScore("info depth 14 seldepth 20 multipv 1 score cp 35 nodes 1000 pv e2e4")).toEqual({ cp: 35, mate: null });
    expect(parseScore("info depth 20 score mate -3 nodes 5000 pv h7h8q")).toEqual({ cp: null, mate: -3 });
  });

  it("skips bound scores and non-info lines", () => {
    expect(parseScore("info depth 12 score cp 40 lowerbound nodes 900")).toBeNull();
    expect(parseScore("info string NNUE evaluation enabled")).toBeNull();
    expect(parseScore("bestmove e2e4 ponder e7e5")).toBeNull();
  });

  it("turns side-to-move scores into White's point of view", () => {
    expect(whitePov({ cp: 50, mate: null }, WHITE_TO_MOVE)).toEqual({ cp: 50, mate: null });
    expect(whitePov({ cp: 50, mate: null }, BLACK_TO_MOVE)).toEqual({ cp: -50, mate: null });
    expect(whitePov({ cp: null, mate: 2 }, BLACK_TO_MOVE)).toEqual({ cp: null, mate: -2 });
    // Mate 0 means the side to move is checkmated; there is no sign to flip.
    expect(whitePov({ cp: null, mate: 0 }, BLACK_TO_MOVE)).toEqual({ cp: null, mate: 0 });
  });

  it("reads the best move, and none when there is no legal move", () => {
    expect(parseBestMove("bestmove e2e4 ponder e7e5")).toBe("e2e4");
    expect(parseBestMove("bestmove e7e8q")).toBe("e7e8q");
    expect(parseBestMove("bestmove (none)")).toBeNull();
  });
});

describe("UCI to SAN", () => {
  it.each([
    ["plain move", WHITE_TO_MOVE, "g1f3", "Nf3"],
    ["black move", BLACK_TO_MOVE, "e7e5", "e5"],
    ["castling", "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1g1", "O-O"],
    ["promotion", "8/4P1k1/8/8/8/8/8/4K3 w - - 0 1", "e7e8q", "e8=Q"],
    ["mate", "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", "a1a8", "Ra8#"],
    ["illegal move", WHITE_TO_MOVE, "e1e5", null],
    ["garbage", WHITE_TO_MOVE, "zz", null],
  ])("%s", (_name, fen, uci, san) => {
    expect(uciToSan(fen, uci)).toBe(san);
  });
});

describe("sacrifice check", () => {
  // Material the mover gives up net when playing `san` from `fen`.
  function lostBy(fen: string, san: string): number | null {
    const board = new Chess(fen);
    board.move(san);
    return sacrificedMaterial(fen, board.fen());
  }

  it.each([
    // Bishop for a pawn: Kxh7 wins the bishop back for nothing.
    ["Greek gift", "r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 8", "Bxh7+", 200],
    // Qd8 takes the knight on g5 for free.
    ["hanging piece", "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3", "Ng5", 300],
    ["even trade", "rnbqkbnr/ppp2ppp/8/3pp3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3", "exd5", 0],
    // Taking back the knight that just took a pawn gains material.
    ["recapture", "rnbqkb1r/pppp1ppp/8/4p3/4n3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 3", "Nxe4", -300],
    // The new queen is taken, but that only costs the pawn.
    ["promotion", "r6k/4P3/8/8/8/8/8/4K3 w - - 0 1", "e8=Q+", 100],
  ])("%s", (_name, fen, san, lost) => {
    expect(lostBy(fen, san)).toBe(lost);
  });

  it("counts more than a pawn as a sacrifice, and needs usable FENs", () => {
    const fen = "r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 8";
    const board = new Chess(fen);
    board.move("Bxh7+");
    expect(isSacrifice(fen, board.fen())).toBe(true);
    expect(isSacrifice(WHITE_TO_MOVE, BLACK_TO_MOVE)).toBe(false);
    expect(isSacrifice("not a fen", BLACK_TO_MOVE)).toBeNull();
  });
});

describe("tablebase mapping", () => {
  it("counts pieces on the board only", () => {
    expect(pieceCount(ENDGAME)).toBe(4);
    expect(pieceCount(WHITE_TO_MOVE)).toBe(32);
  });

  it("maps categories to White-side evals and rejects inexact ones", () => {
    expect(categoryToEval("win", ENDGAME)).toEqual({ cp: TABLEBASE_WIN_CP, mate: null });
    expect(categoryToEval("win", ENDGAME.replace(" w ", " b "))).toEqual({ cp: -TABLEBASE_WIN_CP, mate: null });
    expect(categoryToEval("cursed-win", ENDGAME)).toEqual({ cp: 0, mate: null });
    expect(categoryToEval("maybe-win", ENDGAME)).toBeNull();
    expect(categoryToEval("unknown", ENDGAME)).toBeNull();
  });
});

function reply(status: number, body: unknown): HttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(),
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

describe("Evaluator source choice", () => {
  function setup(tablebase: () => HttpResponse) {
    const calls = { engine: 0, http: 0 };
    const searchmoves: string[][] = [];
    const engine: EnginePort = {
      // The full search finds Nf3 at +12; a search without it finds -40.
      evaluate: async (_fen, _nodes, only = []) => {
        calls.engine += 1;
        searchmoves.push(only);
        return only.length > 0 ? { eval: { cp: -40, mate: null }, bestMove: "d2d4" } : { eval: { cp: 12, mate: null }, bestMove: "g1f3" };
      },
    };
    const http: HttpPort = {
      get: async () => {
        calls.http += 1;
        return tablebase();
      },
    };
    let now = 0;
    const evaluator = new Evaluator(engine, http, 1000, () => now);
    return { evaluator, calls, searchmoves, advance: (ms: number) => (now += ms) };
  }

  it("uses the tablebase for 7 pieces or fewer and Stockfish otherwise", async () => {
    // Tablebase moves are scored for the opponent: "loss" is the mover's win.
    const { evaluator, calls } = setup(() =>
      reply(200, {
        category: "win",
        moves: [
          { uci: "h7h8q", san: "h8=Q+", category: "loss" },
          { uci: "g7g8", san: "Kg8", category: "draw" },
        ],
      }),
    );
    await expect(evaluator.evaluate(ENDGAME)).resolves.toEqual({
      eval: { cp: TABLEBASE_WIN_CP, mate: null },
      source: "tablebase",
      best: "h8=Q+",
      second: { cp: 0, mate: null },
    });
    // Stockfish's UCI best move comes back as SAN.
    await expect(evaluator.evaluate(WHITE_TO_MOVE, "d4")).resolves.toMatchObject({ source: "stockfish", best: "Nf3" });
    expect(calls).toEqual({ engine: 1, http: 1 });
  });

  it("searches the other moves only when the next move is the best one or not played yet", async () => {
    const { evaluator, calls, searchmoves } = setup(() => reply(200, {}));
    // Next move not played yet: search the others right away.
    await expect(evaluator.evaluate(WHITE_TO_MOVE)).resolves.toMatchObject({
      best: "Nf3",
      second: { cp: -40, mate: null },
    });
    // Every legal move except the best one, in UCI.
    expect(searchmoves[1]).toHaveLength(new Chess(WHITE_TO_MOVE).moves().length - 1);
    expect(searchmoves[1]).not.toContain("g1f3");
    expect(searchmoves[1]).toContain("e4e5");
    // The best move was played: searched too.
    await expect(evaluator.evaluate(WHITE_TO_MOVE, "Nf3")).resolves.toMatchObject({ second: { cp: -40, mate: null } });
    // Another move was played: no Great label possible, no second search.
    await expect(evaluator.evaluate(WHITE_TO_MOVE, "d4")).resolves.toMatchObject({ second: null });
    expect(calls.engine).toBe(5);
  });

  it("pauses tablebase lookups for a minute after a 429", async () => {
    const { evaluator, calls, advance } = setup(() => reply(429, {}));
    await expect(evaluator.evaluate(ENDGAME)).resolves.toMatchObject({ source: "stockfish" });
    await evaluator.evaluate(ENDGAME);
    expect(calls.http).toBe(1);
    advance(60_000);
    await evaluator.evaluate(ENDGAME);
    expect(calls.http).toBe(2);
  });

  it("never sends a malformed FEN to Stockfish", async () => {
    const { evaluator, calls } = setup(() => reply(200, {}));
    await expect(evaluator.evaluate("not a fen")).resolves.toMatchObject({ source: "invalid" });
    expect(calls).toEqual({ engine: 0, http: 0 });
  });
});

const URL = process.env["TEST_DATABASE_URL"];

describe.runIf(URL)("eval worker integration", () => {
  it("takes the newest ply first, then backfills, and drops superseded rows", async () => {
    const sql = postgres(URL as string);
    const database: Db = drizzle(sql, { schema });
    // Other test files leave unevaluated moves behind; mark them done so
    // this game is the only work left.
    await database.update(moves).set({ evalSource: "invalid" });
    const [t] = await database
      .insert(tournaments)
      .values({ source: "lichess", sourceId: `tour-eval-${Date.now()}`, name: "Eval Test" })
      .returning({ id: tournaments.id });
    const [g] = await database
      .insert(games)
      .values({ tournamentId: t.id, source: "lichess", sourceId: `game-eval-${Date.now()}`, white: "A", black: "B", currentFen: "" })
      .returning({ id: games.id });
    const state = emptyGame();
    for (const [ply, san, fen] of [
      [1, "e4", BLACK_TO_MOVE],
      [2, "e5", "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"],
    ] as const) {
      const r = applyMoveReceived(state, { ply, san, fen, clock: null, source: "lichess" });
      if (r.outcome === "duplicate-noop") throw new Error("unexpected noop");
      await persistIngestResult(database, g.id, r);
    }

    const newest = await nextJob(database);
    // The job carries the FEN before the move, for the sacrifice check.
    expect(newest).toMatchObject({ gameId: g.id, ply: 2, version: 2, latest: true, prevFen: BLACK_TO_MOVE, nextSan: null });
    if (!newest) throw new Error("no job");
    await expect(
      saveEval(database, newest, { eval: { cp: 20, mate: null }, source: "stockfish", best: "Nf3", second: { cp: -60, mate: null } }, false),
    ).resolves.toBe(true);
    const [event] = await database.select().from(outboxEvents).orderBy(desc(outboxEvents.id)).limit(1);
    expect(event).toMatchObject({
      eventType: "EvalUpdated",
      payload: { gameId: g.id, ply: 2, version: 2, evalCp: 20, evalMate: null, bestReply: "Nf3", secondCp: -60, secondMate: null, sacrifice: false, latest: true },
    });
    const [stored] = await database
      .select({ best: moves.bestReply, secondCp: moves.secondCp, sacrifice: moves.sacrifice })
      .from(moves)
      .where(eq(moves.id, newest.moveId));
    expect(stored).toEqual({ best: "Nf3", secondCp: -60, sacrifice: false });

    const backfill = await nextJob(database);
    // Ply 1's next move (e5) is known, so the job says what it was.
    expect(backfill).toMatchObject({ gameId: g.id, ply: 1, latest: false, prevFen: null, nextSan: "e5" });
    if (!backfill) throw new Error("no job");
    // A Correction supersedes the row while the search runs.
    await database.update(moves).set({ superseded: true }).where(eq(moves.id, backfill.moveId));
    await expect(saveEval(database, backfill, { eval: { cp: 30, mate: null }, source: "stockfish", best: null, second: null })).resolves.toBe(false);
    const [row] = await database
      .select({ evalSource: moves.evalSource })
      .from(moves)
      .where(and(eq(moves.id, backfill.moveId)));
    expect(row?.evalSource).toBeNull();
    await expect(nextJob(database)).resolves.toBeNull();
    await sql.end();
  });

  it("analyzes games someone has open before any other game", async () => {
    const sql = postgres(URL as string);
    const database: Db = drizzle(sql, { schema });
    await database.update(moves).set({ evalSource: "invalid" });
    const [t] = await database
      .insert(tournaments)
      .values({ source: "lichess", sourceId: `tour-watch-${Date.now()}`, name: "Watch Test" })
      .returning({ id: tournaments.id });
    const newGame = async (tag: string): Promise<string> => {
      const [g] = await database
        .insert(games)
        .values({ tournamentId: t.id, source: "lichess", sourceId: `game-${tag}-${Date.now()}`, white: "A", black: "B", currentFen: "" })
        .returning({ id: games.id });
      const state = emptyGame();
      for (const [ply, san, fen] of [
        [1, "e4", BLACK_TO_MOVE],
        [2, "e5", "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"],
      ] as const) {
        const r = applyMoveReceived(state, { ply, san, fen, clock: null, source: "lichess" });
        if (r.outcome === "duplicate-noop") throw new Error("unexpected noop");
        await persistIngestResult(database, g.id, r);
      }
      return g.id;
    };
    const watchedGame = await newGame("watched");
    const otherGame = await newGame("other"); // more recently active

    await expect(nextJob(database)).resolves.toMatchObject({ gameId: otherGame, ply: 2 });
    const first = await nextJob(database, [watchedGame]);
    expect(first).toMatchObject({ gameId: watchedGame, ply: 2 });
    if (!first) throw new Error("no job");
    await saveEval(database, first, { eval: { cp: 10, mate: null }, source: "stockfish", best: null, second: null });
    // The watched game's older ply still beats the other game's newest one.
    await expect(nextJob(database, [watchedGame])).resolves.toMatchObject({ gameId: watchedGame, ply: 1 });
    await sql.end();
  });
});
