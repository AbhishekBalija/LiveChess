import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Chess, validateFen } from "chess.js";
import type { Db } from "../db/client";
import { games, moves, outboxEvents } from "../db/schema";
import type { HttpPort } from "../ingestion/worker";
import type { EnginePort, Eval } from "./engine";
import { TablebaseRateLimited, tablebaseEval } from "./tablebase";

// Eval worker core (ADR 0006). It keeps no state of its own: the to-do
// list is "live moves with no eval yet" in Postgres, so a restart simply
// carries on where it stopped.

export interface EvalJob {
  moveId: string;
  gameId: string;
  ply: number;
  fen: string;
  // The move row's Version, so clients can tell which move this eval is for.
  version: number;
  // The game's newest ply when the job was picked.
  latest: boolean;
}

// Order of work:
// 1. games someone has open (`watched`), newest ply first, so stepping back
//    through a game you are looking at fills in within a minute or two
// 2. the newest ply of every other game, so live bars stay current
// 3. everything else (backfill), most recently active game first
// ponytail: sorts the whole backlog on each pick; fine while the backlog
// is thousands of rows, keep a "latest" pass separate if it grows past that.
export async function nextJob(database: Db, watched: string[] = []): Promise<EvalJob | null> {
  const latest = sql<boolean>`${moves.ply} = ${games.lastPly}`;
  const order = [desc(latest), desc(games.updatedAt), desc(moves.ply)];
  if (watched.length > 0) order.unshift(desc(inArray(moves.gameId, watched)));
  const [row] = await database
    .select({
      moveId: moves.id,
      gameId: moves.gameId,
      ply: moves.ply,
      fen: moves.fen,
      version: moves.version,
      latest,
    })
    .from(moves)
    .innerJoin(games, eq(games.id, moves.gameId))
    .where(and(eq(moves.superseded, false), isNull(moves.evalSource)))
    .orderBy(...order)
    .limit(1);
  return row ?? null;
}

export type EvalSource = "stockfish" | "tablebase" | "invalid";

export interface EvalResult {
  eval: Eval;
  source: EvalSource;
  // Best reply from this position, as SAN (Move classification: Best).
  best: string | null;
}

// Stockfish's UCI move ("e7e8q") as SAN ("e8=Q+"), from the position it
// was searched in. Null when it is not a legal move there.
export function uciToSan(fen: string, uci: string): string | null {
  try {
    const move = new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return move.san;
  } catch {
    return null;
  }
}

// Picks the source for one position: the tablebase for 7 pieces or fewer
// (unless it is paused after a 429 or has no exact answer), else Stockfish.
export class Evaluator {
  private tablebasePausedUntil = 0;

  constructor(
    private readonly engine: EnginePort,
    private readonly http: HttpPort,
    private readonly nodes: number,
    private readonly now: () => number = Date.now,
  ) {}

  async evaluate(fen: string): Promise<EvalResult> {
    // Stockfish can crash on a malformed FEN, so never hand it one.
    if (!validateFen(fen).ok) return { eval: { cp: null, mate: null }, source: "invalid", best: null };
    if (this.now() >= this.tablebasePausedUntil) {
      try {
        const exact = await tablebaseEval(this.http, fen);
        if (exact) return { eval: exact.eval, source: "tablebase", best: exact.bestSan };
      } catch (err) {
        if (err instanceof TablebaseRateLimited) this.tablebasePausedUntil = this.now() + 60_000;
        else console.warn("tablebase lookup failed, using stockfish", err);
      }
    }
    const search = await this.engine.evaluate(fen, this.nodes);
    const best = search.bestMove === null ? null : uciToSan(fen, search.bestMove);
    return { eval: search.eval, source: "stockfish", best };
  }
}

// Stores the eval on its move row and publishes it, in one transaction.
// If the row was superseded (Correction or Truncation) while we searched,
// the update matches nothing and the result is dropped. Eval never bumps
// the game's Version (ADR 0006).
export async function saveEval(database: Db, job: EvalJob, result: EvalResult): Promise<boolean> {
  return database.transaction(async (tx) => {
    const updated = await tx
      .update(moves)
      .set({ evalCp: result.eval.cp, evalMate: result.eval.mate, evalSource: result.source, bestReply: result.best })
      .where(and(eq(moves.id, job.moveId), eq(moves.superseded, false)))
      .returning({ id: moves.id });
    if (updated.length === 0 || result.source === "invalid") return false;
    await tx.insert(outboxEvents).values({
      eventType: "EvalUpdated",
      payload: {
        gameId: job.gameId,
        ply: job.ply,
        version: job.version,
        evalCp: result.eval.cp,
        evalMate: result.eval.mate,
        bestReply: result.best,
        latest: job.latest,
      },
    });
    return true;
  });
}

// One step of the loop: evaluate and store the next job. False when there
// was nothing to do, so the caller can wait before asking again.
export async function evalOnce(database: Db, evaluator: Evaluator, watched: string[] = []): Promise<boolean> {
  const job = await nextJob(database, watched);
  if (!job) return false;
  await saveEval(database, job, await evaluator.evaluate(job.fen));
  return true;
}
