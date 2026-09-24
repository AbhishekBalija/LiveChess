import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { persistIngestResult, type Db } from "../db/client";
import * as schema from "../db/schema";
import { games, moves, outboxEvents, tournaments } from "../db/schema";
import { applyMoveReceived, emptyGame } from "../ingestion/handler";
import type { HttpPort, HttpResponse } from "../ingestion/worker";
import { parseScore, whitePov, type EnginePort } from "./engine";
import { categoryToEval, pieceCount, TABLEBASE_WIN_CP } from "./tablebase";
import { Evaluator, nextJob, saveEval } from "./worker";

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
    const engine: EnginePort = {
      evaluate: async () => {
        calls.engine += 1;
        return { cp: 12, mate: null };
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
    return { evaluator, calls, advance: (ms: number) => (now += ms) };
  }

  it("uses the tablebase for 7 pieces or fewer and Stockfish otherwise", async () => {
    const { evaluator, calls } = setup(() => reply(200, { category: "win" }));
    await expect(evaluator.evaluate(ENDGAME)).resolves.toEqual({
      eval: { cp: TABLEBASE_WIN_CP, mate: null },
      source: "tablebase",
    });
    await expect(evaluator.evaluate(WHITE_TO_MOVE)).resolves.toMatchObject({ source: "stockfish" });
    expect(calls).toEqual({ engine: 1, http: 1 });
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
    expect(newest).toMatchObject({ gameId: g.id, ply: 2, version: 2, latest: true });
    if (!newest) throw new Error("no job");
    await expect(saveEval(database, newest, { eval: { cp: 20, mate: null }, source: "stockfish" })).resolves.toBe(true);
    const [event] = await database.select().from(outboxEvents).orderBy(desc(outboxEvents.id)).limit(1);
    expect(event).toMatchObject({
      eventType: "EvalUpdated",
      payload: { gameId: g.id, ply: 2, version: 2, evalCp: 20, evalMate: null, latest: true },
    });

    const backfill = await nextJob(database);
    expect(backfill).toMatchObject({ gameId: g.id, ply: 1, latest: false });
    if (!backfill) throw new Error("no job");
    // A Correction supersedes the row while the search runs.
    await database.update(moves).set({ superseded: true }).where(eq(moves.id, backfill.moveId));
    await expect(saveEval(database, backfill, { eval: { cp: 30, mate: null }, source: "stockfish" })).resolves.toBe(false);
    const [row] = await database
      .select({ evalSource: moves.evalSource })
      .from(moves)
      .where(and(eq(moves.id, backfill.moveId)));
    expect(row?.evalSource).toBeNull();
    await expect(nextJob(database)).resolves.toBeNull();
    await sql.end();
  });
});
