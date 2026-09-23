import { and, eq } from "drizzle-orm";
import { db, persistIngestResultTx, persistTruncateTx, type Db, type DbTx } from "../db/client";
import { games, moves, tournaments } from "../db/schema";
import { applyMoveReceived, applyTruncate, planTruncation, type GameState } from "./handler";
import {
  backoffMs,
  consumePgnStream,
  fetchStream,
  roundStreamUrl,
  StreamRateLimitedError,
  withIdleTimeout,
  type StreamPort,
} from "./stream";
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

const USER_AGENT = "LiveChess/1.0 (broadcast ingestion)";

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
  get(url: string, accept?: string): Promise<HttpResponse>;
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
  const res = await http.get(roundPgnUrl(roundId), "application/x-chess-pgn");
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
    const res = await http.get(
      roundMetaUrl(tourSlug, roundSlug, roundId),
      "application/json",
    );
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

const RESULTS = new Set(["1-0", "0-1", "1/2-1/2"]);

// Anything that is not a final score counts as in progress.
export function normalizeResult(raw: string | undefined): string {
  return raw && RESULTS.has(raw) ? raw : "*";
}

export async function upsertGame(
  database: Db | DbTx,
  tournamentId: string,
  sourceId: string,
  white: string,
  black: string,
  result = "*",
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
      result,
    })
    .onConflictDoUpdate({
      target: [games.source, games.sourceId],
      // Result flips from "*" to a score when the game ends.
      set: { white, black, result },
    })
    .returning({ id: games.id });
  if (!row) throw new Error("game upsert returned no row");
  return row.id;
}

export interface GameCounts {
  inserted: number;
  corrections: number;
  truncations: number;
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
  const counts: GameCounts = { inserted: 0, corrections: 0, truncations: 0, noops: 0 };
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
    // Takeback first (ADR 0004): drop plies from the old line, then the
    // normal per-ply path fixes the changed ply and re-adds the new line.
    const toPly = planTruncation(state, plies);
    if (toPly !== null) {
      await persistTruncateTx(tx, gameId, applyTruncate(state, toPly));
      counts.truncations += 1;
    }
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

// Resolved tournament id, held for one worker run and reused across
// polls. The first resolution wins, real or fallback, so a later
// metadata failure can never create a second tournament row.
export interface TourCache {
  tournamentId: string | null;
}

// A game we already know keeps its tournament. Reusing it skips the
// metadata request on every restart, and a flaky metadata request can no
// longer fall back to a second tournament row for the same event.
async function existingTournamentId(database: Db, sourceId: string): Promise<string | null> {
  const [row] = await database
    .select({ tournamentId: games.tournamentId })
    .from(games)
    .where(and(eq(games.source, "lichess"), eq(games.sourceId, sourceId)));
  return row?.tournamentId ?? null;
}

// One game's full PGN: resolve the tournament once, upsert the game, run
// every ply through the Move Handler. Shared by polling and streaming.
// Returns null for a game we cannot use (unparseable, no source id).
export async function ingestPgnGame(
  database: Db,
  http: HttpPort,
  roundId: string,
  pgn: string,
  tourCache: TourCache,
): Promise<(GameCounts & { sourceId: string; result: string }) | null> {
  let game: ReturnType<typeof parseBroadcastGame>;
  try {
    game = parseBroadcastGame(pgn);
  } catch (err) {
    console.warn("skipping unparseable game", err);
    return null;
  }
  const sourceId = gameSourceId(game.headers);
  if (!sourceId) {
    console.warn("skipping game without a GameURL or Site id");
    return null;
  }
  if (tourCache.tournamentId === null) {
    tourCache.tournamentId = await existingTournamentId(database, sourceId);
  }
  if (tourCache.tournamentId === null) {
    const slugs = broadcastSlugs(game.headers);
    const eventName = game.headers["Event"] ?? roundId;
    const tour = slugs
      ? await fetchTourInfo(http, slugs.tourSlug, slugs.roundSlug, roundId, eventName)
      : { sourceId: `round-${roundId}`, name: eventName };
    tourCache.tournamentId = await upsertTournament(database, tour.sourceId, tour.name);
  }
  const result = normalizeResult(game.headers["Result"]);
  const gameId = await upsertGame(
    database,
    tourCache.tournamentId,
    sourceId,
    game.headers["White"] ?? "?",
    game.headers["Black"] ?? "?",
    result,
  );
  const counts = await ingestGame(database, gameId, game.plies);
  return { ...counts, sourceId, result };
}

export async function ingestRound(
  database: Db,
  http: HttpPort,
  roundId: string,
  tourCache: TourCache = { tournamentId: null },
): Promise<PollCounts> {
  const pgn = await fetchRoundPgn(http, roundId);
  const counts: PollCounts = { games: 0, inserted: 0, corrections: 0, truncations: 0, noops: 0 };
  for (const part of splitPgnGames(pgn)) {
    const game = await ingestPgnGame(database, http, roundId, part, tourCache);
    if (!game) continue;
    counts.games += 1;
    counts.inserted += game.inserted;
    counts.corrections += game.corrections;
    counts.truncations += game.truncations;
    counts.noops += game.noops;
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
  const tourCache: TourCache = { tournamentId: null };
  for (;;) {
    try {
      const counts = await ingestRound(database, http, roundId, tourCache);
      console.log(
        `ingest ${roundId}: ${counts.games} games, +${counts.inserted} moves, ~${counts.corrections} corrections, -${counts.truncations} takebacks`,
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

// A round is over once every game we have seen has a final result.
export function roundFinished(results: Map<string, string>): boolean {
  return results.size > 0 && [...results.values()].every((r) => r !== "*");
}

export interface StreamWorkerOptions {
  idleMs?: number;
  finishCheckMs?: number;
  rateLimitMs?: number;
}

// Default ingestion: hold the round stream open, reconnect with backoff,
// stop when the round is over. Resolves when the round has finished.
export async function runStreamWorker(
  database: Db,
  http: HttpPort,
  stream: StreamPort,
  roundId: string,
  { idleMs = 90_000, finishCheckMs = 60_000, rateLimitMs = 60_000 }: StreamWorkerOptions = {},
): Promise<void> {
  const tourCache: TourCache = { tournamentId: null };
  const results = new Map<string, string>();
  let attempt = 0;
  for (;;) {
    const controller = new AbortController();
    // Checked on a timer, not per game: the dump on connect sends games
    // one by one, and a few finished ones first would look like the end.
    const finishCheck = setInterval(() => {
      if (roundFinished(results)) controller.abort();
    }, finishCheckMs);
    try {
      const chunks = await stream.open(roundStreamUrl(roundId), controller.signal);
      attempt = 0;
      console.log(`stream ${roundId}: connected`);
      await consumePgnStream(withIdleTimeout(chunks, idleMs, () => controller.abort()), async (pgn) => {
        const game = await ingestPgnGame(database, http, roundId, pgn, tourCache);
        if (!game) return;
        results.set(game.sourceId, game.result);
        if (game.inserted || game.corrections || game.truncations) {
          console.log(
            `stream ${roundId}: ${game.sourceId} +${game.inserted} moves, ~${game.corrections} corrections, -${game.truncations} takebacks`,
          );
        }
      });
      if (!controller.signal.aborted) console.warn(`stream ${roundId}: closed by server, reconnecting`);
    } catch (err) {
      if (err instanceof StreamRateLimitedError) {
        console.warn(`stream ${roundId}: 429, waiting ${rateLimitMs}ms`);
        clearInterval(finishCheck);
        await sleep(rateLimitMs);
        continue;
      }
      if (!controller.signal.aborted) console.error(`stream ${roundId}: failed, reconnecting`, err);
    } finally {
      clearInterval(finishCheck);
    }
    if (roundFinished(results)) {
      console.log(`stream ${roundId}: round finished, stopping`);
      return;
    }
    if (controller.signal.aborted) console.warn(`stream ${roundId}: idle for ${idleMs}ms, reconnecting`);
    await sleep(backoffMs(attempt));
    attempt += 1;
  }
}

const nodeHttp: HttpPort = {
  async get(url: string, accept = "application/json"): Promise<HttpResponse> {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: accept },
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
  const args = process.argv.slice(2);
  const poll = args.includes("--poll");
  const roundId = args.find((a) => !a.startsWith("--"));
  if (!roundId) {
    console.error("usage: bun run ingest <broadcastRoundId> [--poll]");
    process.exit(1);
  }
  if (poll) {
    // Fallback: the old 3s polling of the round export.
    const intervalMs = Number(process.env["INGEST_INTERVAL_MS"] ?? 3000);
    await runWorker(db(), nodeHttp, roundId, intervalMs);
  } else {
    const token = process.env["LICHESS_TOKEN"] || undefined;
    await runStreamWorker(db(), nodeHttp, fetchStream(USER_AGENT, token), roundId);
    process.exit(0);
  }
}
