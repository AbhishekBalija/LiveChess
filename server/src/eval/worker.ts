import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { validateFen } from "chess.js";
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

// Latest first, then backfill: a game's newest ply beats any older ply,
// and among those the most recently active game goes first.
// ponytail: sorts the whole backlog on each pick; fine while the backlog
// is thousands of rows, keep a "latest" pass separate if it grows past that.
export async function nextJob(database: Db): Promise<EvalJob | null> {
  const latest = sql<boolean>`${moves.ply} = ${games.lastPly}`;
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
    .orderBy(desc(latest), desc(games.updatedAt), desc(moves.ply))
    .limit(1);
  return row ?? null;
}

export type EvalSource = "stockfish" | "tablebase" | "invalid";

export interface EvalResult {
  eval: Eval;
  source: EvalSource;
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
    if (!validateFen(fen).ok) return { eval: { cp: null, mate: null }, source: "invalid" };
    if (this.now() >= this.tablebasePausedUntil) {
      try {
        const exact = await tablebaseEval(this.http, fen);
        if (exact) return { eval: exact, source: "tablebase" };
      } catch (err) {
        if (err instanceof TablebaseRateLimited) this.tablebasePausedUntil = this.now() + 60_000;
        else console.warn("tablebase lookup failed, using stockfish", err);
      }
    }
    return { eval: await this.engine.evaluate(fen, this.nodes), source: "stockfish" };
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
      .set({ evalCp: result.eval.cp, evalMate: result.eval.mate, evalSource: result.source })
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
        latest: job.latest,
      },
    });
    return true;
  });
}

// One step of the loop: evaluate and store the next job. False when there
// was nothing to do, so the caller can wait before asking again.
export async function evalOnce(database: Db, evaluator: Evaluator): Promise<boolean> {
  const job = await nextJob(database);
  if (!job) return false;
  await saveEval(database, job, await evaluator.evaluate(job.fen));
  return true;
}
