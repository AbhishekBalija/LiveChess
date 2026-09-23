import { and, desc, eq, gt, ne, sql } from "drizzle-orm";
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
  tournament: { id: string; name: string };
  lastPly: number;
  lastSan: string | null;
  fen: string;
  version: number;
  updatedAt: string;
}

export interface GamesDbPort {
  listGames(status: GameStatus, limit: number): Promise<GameListItem[]>;
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

// One query: game plus its tournament plus the live move at last_ply
// (left join, so a game with no moves yet still shows up).
export function drizzleGamesDb(database: Db): GamesDbPort {
  return {
    async listGames(status, limit) {
      const filter =
        status === "live"
          ? and(eq(games.result, "*"), gt(games.updatedAt, LIVE_WINDOW))
          : status === "finished"
            ? ne(games.result, "*")
            : undefined;
      const rows = await database
        .select({
          id: games.id,
          white: games.white,
          black: games.black,
          result: games.result,
          tournamentId: tournaments.id,
          tournamentName: tournaments.name,
          lastPly: games.lastPly,
          lastSan: moves.san,
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
        .where(filter)
        .orderBy(desc(games.updatedAt))
        .limit(limit);
      return rows.map((r) => ({
        id: r.id,
        white: r.white,
        black: r.black,
        result: r.result,
        tournament: { id: r.tournamentId, name: r.tournamentName },
        lastPly: r.lastPly,
        lastSan: r.lastSan,
        fen: r.fen,
        version: r.version,
        updatedAt: r.updatedAt.toISOString(),
      }));
    },
  };
}
