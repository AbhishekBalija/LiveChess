import { and, asc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { type Db } from "../db/client";
import { games, moves, tournaments } from "../db/schema";
import { cacheKey } from "../publisher/publisher";

// Read-only resync. The publisher owns all Redis writes (ADR 0003);
// this module only hash-reads the cache and reads Postgres.
// No client import here by design: the caller injects the ports,
// so unit tests use fakes and only integration touches real backends.

export interface GameCheckpoint {
  id: string;
  version: number;
  currentFen: string;
  lastPly: number;
  white?: string;
  black?: string;
  tournament?: string;
  result?: string;
  updatedAt?: string;
}

export interface LiveMoveRow {
  ply: number;
  san: string;
  fen: string;
  // Mover's remaining time after this move (PGN %clk), when the source has it.
  clock: string | null;
  version: number;
}

// Stored eval of one live move (ADR 0006), from White's side. `version` is
// the move row's Version, so the client only attaches it to that move.
export interface EvalRow {
  ply: number;
  version: number;
  cp: number | null;
  mate: number | null;
  // Best reply from this position (SAN), for the next Move's Best label.
  best: string | null;
}

// Narrow Postgres surface getGameState needs. Drizzle adapter below
// implements it; unit tests fake it.
export interface StateDbPort {
  findGame(gameId: string): Promise<GameCheckpoint | null>;
  findLiveMove(gameId: string, ply: number): Promise<{ ply: number; san: string } | null>;
  listLiveMovesSince(gameId: string, sinceVersion: number): Promise<LiveMoveRow[]>;
  listEvals(gameId: string): Promise<EvalRow[]>;
}

// Narrow cache surface: read-only hash fetch, null on miss.
export interface StateCachePort {
  hgetall(key: string): Promise<Record<string, string> | null>;
}

export interface LastMove {
  ply: number;
  san: string;
}

export interface GameStateResponse {
  gameId: string;
  version: number;
  fen: string;
  lastMove: LastMove | null;
  missedMoves: LiveMoveRow[];
  // Evals do not bump Version, so "since version" cannot find the ones a
  // client missed. The Postgres path returns every stored eval of the
  // game; the cache fast path returns only the newest ply's.
  // ponytail: older-ply evals missed during a disconnect stay missing
  // until a full reload; fine for the live bar, revisit for an eval graph.
  evals: EvalRow[];
  // Postgres path only; the cache fast path omits them. The first load
  // (since_version=0) always misses the fast path, so clients get names.
  white?: string;
  black?: string;
  tournament?: string;
  result?: string;
  updatedAt?: string;
}

export class StateHttpError extends Error {
  readonly status: 400 | 404;
  constructor(status: 400 | 404, message: string) {
    super(message);
    this.status = status;
  }
}

const SinceVersionSchema = z.number().int().min(0);
const GameIdSchema = z.string().uuid();

// Raw ?since_version= query value. Missing means full live history (0).
// Only plain digit strings are accepted; empty string, decimals,
// signs, and anything else is a 400, never a silent default.
export function parseSinceVersion(raw: string | null): number {
  if (raw === null) return 0;
  if (!/^\d+$/.test(raw)) throw new StateHttpError(400, "since_version must be an integer >= 0");
  const parsed = SinceVersionSchema.safeParse(Number(raw));
  if (!parsed.success) throw new StateHttpError(400, "since_version must be an integer >= 0");
  return parsed.data;
}

// Drizzle-backed ports. Thin query mapping only; all cache-vs-Postgres
// decisions live in getGameState so fakes can cover them.
export function drizzleStateDb(database: Db): StateDbPort {
  return {
    async findGame(gameId) {
      const [row] = await database
        .select({
          id: games.id,
          version: games.version,
          currentFen: games.currentFen,
          lastPly: games.lastPly,
          white: games.white,
          black: games.black,
          tournament: tournaments.name,
          result: games.result,
          updatedAt: games.updatedAt,
        })
        .from(games)
        .innerJoin(tournaments, eq(tournaments.id, games.tournamentId))
        .where(eq(games.id, gameId));
      return row ? { ...row, updatedAt: row.updatedAt.toISOString() } : null;
    },
    async findLiveMove(gameId, ply) {
      const [row] = await database
        .select({ ply: moves.ply, san: moves.san })
        .from(moves)
        .where(
          and(eq(moves.gameId, gameId), eq(moves.ply, ply), eq(moves.superseded, false)),
        );
      return row ?? null;
    },
    async listLiveMovesSince(gameId, sinceVersion) {
      return database
        .select({ ply: moves.ply, san: moves.san, fen: moves.fen, clock: moves.clock, version: moves.version })
        .from(moves)
        .where(
          and(
            eq(moves.gameId, gameId),
            eq(moves.superseded, false),
            gt(moves.version, sinceVersion),
          ),
        )
        .orderBy(asc(moves.version));
    },
    async listEvals(gameId) {
      return database
        .select({ ply: moves.ply, version: moves.version, cp: moves.evalCp, mate: moves.evalMate, best: moves.bestReply })
        .from(moves)
        .where(
          and(
            eq(moves.gameId, gameId),
            eq(moves.superseded, false),
            isNotNull(moves.evalSource),
            // "invalid" rows have no eval to show.
            sql`${moves.evalSource} <> 'invalid'`,
          ),
        )
        .orderBy(asc(moves.ply));
    },
  };
}

// The newest ply's eval, from the fields the publisher caches.
function parseCachedEval(hash: Record<string, string>): EvalRow[] {
  const ply = Number(hash["evalPly"]);
  const version = Number(hash["evalVersion"]);
  if (!hash["evalPly"] || !Number.isInteger(ply) || !Number.isInteger(version)) return [];
  const num = (raw: string | undefined): number | null => (raw ? Number(raw) : null);
  return [{ ply, version, cp: num(hash["evalCp"]), mate: num(hash["evalMate"]), best: hash["evalBest"] || null }];
}

function parseCacheSnapshot(
  gameId: string,
  hash: Record<string, string>,
): GameStateResponse | null {
  const version = Number(hash["version"]);
  const lastPly = Number(hash["lastPly"]);
  const fen = hash["fen"];
  const lastSan = hash["lastSan"];
  if (
    fen === undefined ||
    lastSan === undefined ||
    !Number.isInteger(version) ||
    version < 0 ||
    !Number.isInteger(lastPly) ||
    lastPly < 0
  ) {
    return null;
  }
  return {
    gameId,
    version,
    fen,
    lastMove: lastPly === 0 ? null : { ply: lastPly, san: lastSan },
    missedMoves: [],
    evals: parseCachedEval(hash),
  };
}

// Resync entry point. Version is the single ordering authority:
// missed moves are live rows with version > sinceVersion, ORDER BY
// version ASC. Cache is a fast path only when the client is already
// at or ahead of the cached version; every other case reads the
// snapshot plus moves from Postgres. Never writes to Redis.
export async function getGameState(
  database: StateDbPort,
  cache: StateCachePort,
  gameId: string,
  sinceVersion = 0,
): Promise<GameStateResponse> {
  // Non-UUID ids cannot exist in Postgres; 404 before touching backends.
  if (!GameIdSchema.safeParse(gameId).success) throw new StateHttpError(404, "game not found");
  const since = SinceVersionSchema.safeParse(sinceVersion);
  if (!since.success) throw new StateHttpError(400, "sinceVersion must be an integer >= 0");
  const sinceV = since.data;

  const cached = await cache.hgetall(cacheKey(gameId));
  if (cached) {
    const snapshot = parseCacheSnapshot(gameId, cached);
    if (snapshot && sinceV >= snapshot.version) return snapshot;
  }

  const game = await database.findGame(gameId);
  if (!game) throw new StateHttpError(404, "game not found");
  const lastMove =
    game.lastPly === 0 ? null : await database.findLiveMove(gameId, game.lastPly);
  const missedMoves = await database.listLiveMovesSince(gameId, sinceV);
  const evals = await database.listEvals(gameId);
  return {
    gameId: game.id,
    version: game.version,
    fen: game.currentFen,
    lastMove,
    missedMoves,
    evals,
    white: game.white,
    black: game.black,
    tournament: game.tournament,
    // When the last change was stored; clients tick the side to move's
    // clock from here.
    result: game.result,
    updatedAt: game.updatedAt,
  };
}
