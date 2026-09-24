import { and, desc, eq, gt, inArray, ne, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { type Db } from "../db/client";
import { games, moves, tournaments } from "../db/schema";

// Games list for the home live strip. Postgres only: the list is polled
// every few seconds by the client, and live moves still arrive per game
// over the WebSocket, so no cache layer is needed here.

export type GameStatus = "live" | "finished" | "all";

export interface GameListItem {
  id: string;
  white: string;
  black: string;
  result: string;
  // `group` and `section` are set when Lichess splits the event into
  // several tours: "46th FIDE Chess Olympiad ..." and "Open | Matches 1-12".
  tournament: { id: string; name: string; group: string | null; section: string | null };
  lastPly: number;
  lastSan: string | null;
  // Remaining time from the PGN %clk of each side's latest move.
  whiteClock: string | null;
  blackClock: string | null;
  fen: string;
  version: number;
  updatedAt: string;
  // Eval of the current position from White's side (ADR 0006), null until
  // the eval worker has reached it.
  evalCp: number | null;
  evalMate: number | null;
  // Lichess round id, so a round page can pick out its games.
  roundId: string | null;
}

export interface GamesDbPort {
  listGames(status: GameStatus, limit: number): Promise<GameListItem[]>;
  // Specific games whatever their status (the featured game after it ends).
  listGamesByIds(ids: string[]): Promise<GameListItem[]>;
}

export class GamesHttpError extends Error {
  readonly status = 400;
}

const StatusSchema = z.enum(["live", "finished", "all"]);

// Missing means live, since that is what the home page asks for.
export function parseStatus(raw: string | null): GameStatus {
  if (raw === null) return "live";
  const parsed = StatusSchema.safeParse(raw);
  if (!parsed.success) throw new GamesHttpError("status must be live, finished or all");
  return parsed.data;
}

export const LIST_LIMIT = 200;

// A game counts as live only if it had activity recently. Without this,
// a round nobody ingests anymore stays "live" forever, since its PGN
// result never flips from "*". Three hours covers the longest think in
// classical chess.
export const LIVE_WINDOW = sql`now() - interval '3 hours'`;

export async function listGames(
  database: GamesDbPort,
  status: GameStatus,
): Promise<{ games: GameListItem[] }> {
  return { games: await database.listGames(status, LIST_LIMIT) };
}

// Each side's clock is on its own latest move: the move at last_ply is
// by the side that just moved (odd ply = White), the one before it by
// the other side.
export function clocksFor(
  lastPly: number,
  lastClock: string | null,
  prevClock: string | null,
): { whiteClock: string | null; blackClock: string | null } {
  if (lastPly === 0) return { whiteClock: null, blackClock: null };
  return lastPly % 2 === 1
    ? { whiteClock: lastClock, blackClock: prevClock }
    : { whiteClock: prevClock, blackClock: lastClock };
}

// One query: game plus its tournament plus the live moves at last_ply and
// the ply before (left joins, so a game with no moves yet still shows up).
export function drizzleGamesDb(database: Db): GamesDbPort {
  const prev = alias(moves, "prev");
  async function query(filter: SQL | undefined, limit: number): Promise<GameListItem[]> {
      const rows = await database
        .select({
          id: games.id,
          white: games.white,
          black: games.black,
          result: games.result,
          tournamentId: tournaments.id,
          tournamentName: tournaments.name,
          groupName: tournaments.groupName,
          groupTourName: tournaments.groupTourName,
          lastPly: games.lastPly,
          lastSan: moves.san,
          lastClock: moves.clock,
          prevClock: prev.clock,
          evalCp: moves.evalCp,
          evalMate: moves.evalMate,
          prevEvalCp: prev.evalCp,
          prevEvalMate: prev.evalMate,
          roundId: games.roundSourceId,
          fen: games.currentFen,
          version: games.version,
          updatedAt: games.updatedAt,
        })
        .from(games)
        .innerJoin(tournaments, eq(tournaments.id, games.tournamentId))
        .leftJoin(
          moves,
          and(
            eq(moves.gameId, games.id),
            eq(moves.ply, games.lastPly),
            eq(moves.superseded, false),
          ),
        )
        .leftJoin(
          prev,
          and(
            eq(prev.gameId, games.id),
            eq(prev.ply, sql`${games.lastPly} - 1`),
            eq(prev.superseded, false),
          ),
        )
        .where(filter)
        .orderBy(desc(games.updatedAt))
        .limit(limit);
      return rows.map((r) => ({
        id: r.id,
        white: r.white,
        black: r.black,
        result: r.result,
        tournament: { id: r.tournamentId, name: r.tournamentName, group: r.groupName, section: r.groupTourName },
        lastPly: r.lastPly,
        lastSan: r.lastSan,
        ...clocksFor(r.lastPly, r.lastClock, r.prevClock),
        fen: r.fen,
        version: r.version,
        updatedAt: r.updatedAt.toISOString(),
        // The newest move is unanalyzed for a second or so; the previous
        // ply's eval keeps home cards' bars from jumping to the middle.
        ...(r.evalCp === null && r.evalMate === null
          ? { evalCp: r.prevEvalCp, evalMate: r.prevEvalMate }
          : { evalCp: r.evalCp, evalMate: r.evalMate }),
        roundId: r.roundId,
      }));
  }
  return {
    listGames(status, limit) {
      const filter =
        status === "live"
          ? and(eq(games.result, "*"), gt(games.updatedAt, LIVE_WINDOW))
          : status === "finished"
            ? ne(games.result, "*")
            : undefined;
      return query(filter, limit);
    },
    listGamesByIds(ids) {
      return ids.length === 0 ? Promise.resolve([]) : query(inArray(games.id, ids), ids.length);
    },
  };
}
