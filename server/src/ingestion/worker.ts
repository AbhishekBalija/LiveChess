import { and, eq } from "drizzle-orm";
import { db, persistIngestResultTx, type Db, type DbTx } from "../db/client";
import { games, moves, tournaments } from "../db/schema";
import { applyMoveReceived, type GameState } from "./handler";
import {
  broadcastSlugs,
  gameSourceId,
  parseBroadcastGame,
  splitPgnGames,
} from "./lichess";

// Long-running Lichess broadcast ingestion. Polls the round PGN export,
// upserts tournament plus games, and runs every ply through the Move
// Handler with Version and existing moves loaded from Postgres, one
// transaction per game. Restarts are safe and re-polls are no-ops.

const USER_AGENT = "LiveChess/1.0 (slice-1 ingestion; poll, not stream)";

export const roundPgnUrl = (roundId: string): string =>
  `https://lichess.org/api/broadcast/round/${roundId}.pgn`;

export const roundMetaUrl = (
  tourSlug: string,
  roundSlug: string,
  roundId: string,
): string => `https://lichess.org/api/broadcast/${tourSlug}/${roundSlug}/${roundId}`;

// Minimal HTTP surface, injected so unit tests use a fake.
export interface HttpHeaders {
  get(name: string): string | null;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  headers: HttpHeaders;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface HttpPort {
  get(url: string): Promise<HttpResponse>;
}

export class RateLimitedError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super(`lichess rate limit, retry after ${retryAfterMs}ms`);
    this.retryAfterMs = retryAfterMs;
  }
}

function retryAfterMs(headers: HttpHeaders): number {
  const raw = headers.get("retry-after");
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(raw);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  return 60000;
}

export async function fetchRoundPgn(http: HttpPort, roundId: string): Promise<string> {
  const res = await http.get(roundPgnUrl(roundId));
  if (res.status === 429) throw new RateLimitedError(retryAfterMs(res.headers));
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`round PGN export failed with ${res.status}`);
  }
  return res.text();
}

interface TourInfo {
  sourceId: string;
  name: string;
}

// Broadcast tour id and name from the round metadata endpoint. Falls
// back to the PGN Event header when metadata is unreachable, so one
// failed side call never blocks the poll.
export async function fetchTourInfo(
  http: HttpPort,
  tourSlug: string,
  roundSlug: string,
  roundId: string,
  eventName: string,
): Promise<TourInfo> {
  try {
    const res = await http.get(roundMetaUrl(tourSlug, roundSlug, roundId));
    if (!res.ok) throw new Error(`metadata failed with ${res.status}`);
    const body = (await res.json()) as {
      tour?: { id?: unknown; name?: unknown };
    };    if (typeof body.tour?.id !== "string" || typeof body.tour?.name !== "string") {
      throw new Error("metadata missing tour id or name");
    }
    return { sourceId: body.tour.id, name: body.tour.name };
  } catch (err) {
    console.warn("tournament metadata unavailable, using PGN Event header", err);
    return { sourceId: `round-${roundId}`, name: eventName };
  }
}

export async function upsertTournament(
  database: Db | DbTx,
  sourceId: string,
  name: string,
): Promise<string> {
  const [row] = await database
    .insert(tournaments)
    .values({ source: "lichess", sourceId, name })
    .onConflictDoUpdate({
      target: [tournaments.source, tournaments.sourceId],
      set: { name },
    })
    .returning({ id: tournaments.id });
  if (!row) throw new Error("tournament upsert returned no row");
  return row.id;
}

export async function upsertGame(
  database: Db | DbTx,
  tournamentId: string,
  sourceId: string,
  white: string,
  black: string,
): Promise<string> {
  const [row] = await database
    .insert(games)
    .values({
      tournamentId,
      source: "lichess",
      sourceId,
      white,
      black,
      currentFen: "",
    })
    .onConflictDoUpdate({
      target: [games.source, games.sourceId],
      set: { white, black },
    })
    .returning({ id: games.id });
  if (!row) throw new Error("game upsert returned no row");
  return row.id;
}

export interface GameCounts {
  inserted: number;
  corrections: number;
  noops: number;
}

// One transaction per game: lock the row, rebuild handler state from the
// DB version plus live moves, then apply every ply the PGN contains.
// Re-polling the same PGN is all duplicate-noops by construction.
export async function ingestGame(
  database: Db,
  gameId: string,
  plies: Array<{ ply: number; san: string; fen: string; clock: string | null }>,
): Promise<GameCounts> {
  const counts: GameCounts = { inserted: 0, corrections: 0, noops: 0 };
  await database.transaction(async (tx) => {
    const [game] = await tx
      .select()
      .from(games)
      .where(eq(games.id, gameId))
      .for("update");
    if (!game) throw new Error(`game ${gameId} missing inside ingest transaction`);
    const live = await tx
      .select()
      .from(moves)
      .where(and(eq(moves.gameId, gameId), eq(moves.superseded, false)));
    const state: GameState = {
      version: game.version,
      moves: new Map(
        live.map((r) => [
          r.ply,
          {
            ply: r.ply,
            san: r.san,
            fen: r.fen,
            clock: r.clock,
            superseded: false,
            source: r.source,
          },
        ]),
      ),
    };
    for (const ply of plies) {
      const outcome = applyMoveReceived(state, {
        ply: ply.ply,
        san: ply.san,
        fen: ply.fen,
        clock: ply.clock,
        source: "lichess",
      });
      if (outcome.outcome === "duplicate-noop") {
        counts.noops += 1;
        continue;
      }
      if (outcome.outcome === "correction") counts.corrections += 1;
      else counts.inserted += 1;
      await persistIngestResultTx(tx, gameId, outcome);
    }
  });
  return counts;
}

export interface PollCounts extends GameCounts {
  games: number;
}

export async function ingestRound(
  database: Db,
  http: HttpPort,
  roundId: string,
): Promise<PollCounts> {
  const pgn = await fetchRoundPgn(http, roundId);
  const parts = splitPgnGames(pgn);
  const counts: PollCounts = { games: 0, inserted: 0, corrections: 0, noops: 0 };
  let tournamentId: string | null = null;
  for (const part of parts) {
    let game: ReturnType<typeof parseBroadcastGame>;
    try {
      game = parseBroadcastGame(part);
    } catch (err) {
      console.warn("skipping unparseable game", err);
      continue;
    }
    const sourceId = gameSourceId(game.headers);
    if (!sourceId) {
      console.warn("skipping game without a GameURL or Site id");
      continue;
    }
    if (tournamentId === null) {
      const slugs = broadcastSlugs(game.headers);
      const eventName = game.headers["Event"] ?? roundId;
      const tour = slugs
        ? await fetchTourInfo(http, slugs.tourSlug, slugs.roundSlug, roundId, eventName)
        : { sourceId: `round-${roundId}`, name: eventName };
      tournamentId = await upsertTournament(database, tour.sourceId, tour.name);
    }
    const gameId = await upsertGame(
      database,
      tournamentId,
      sourceId,
      game.headers["White"] ?? "?",
      game.headers["Black"] ?? "?",
    );
    const gameCounts = await ingestGame(database, gameId, game.plies);
    counts.games += 1;
    counts.inserted += gameCounts.inserted;
    counts.corrections += gameCounts.corrections;
    counts.noops += gameCounts.noops;
  }
  return counts;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function runWorker(
  database: Db,
  http: HttpPort,
  roundId: string,
  intervalMs: number,
): Promise<never> {
  for (;;) {
    try {
      const counts = await ingestRound(database, http, roundId);
      console.log(
        `ingest ${roundId}: ${counts.games} games, +${counts.inserted} moves, ~${counts.corrections} corrections`,
      );
    } catch (err) {
      if (err instanceof RateLimitedError) {
        console.warn(`lichess 429, backing off ${err.retryAfterMs}ms`);
        await sleep(err.retryAfterMs);
        continue;
      }
      console.error("ingest poll failed, continuing", err);
    }
    await sleep(intervalMs);
  }
}

const nodeHttp: HttpPort = {
  async get(url: string): Promise<HttpResponse> {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/x-chess-pgn" },
    });
    return {
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      text: () => res.text(),
      json: () => res.json() as Promise<unknown>,
    };
  },
};

if (import.meta.main) {
  const roundId = process.argv[2];
  if (!roundId) {
    console.error("usage: bun run ingest <broadcastRoundId>");
    process.exit(1);
  }
  const intervalMs = Number(process.env["INGEST_INTERVAL_MS"] ?? 3000);
  await runWorker(db(), nodeHttp, roundId, intervalMs);
}
