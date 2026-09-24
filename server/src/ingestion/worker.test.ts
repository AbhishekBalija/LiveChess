import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { type Db } from "../db/client";
import * as schema from "../db/schema";
import { games, moves, outboxEvents, tournaments } from "../db/schema";
import {
  fetchRoundPgn,
  fetchTourInfo,
  ingestRound,
  RateLimitedError,
  roundMetaUrl,
  roundPgnUrl,
  type HttpPort,
  type HttpResponse,
  type TourCache,
  checkLichessToken,
  normalizeResult,
  roundFinished,
  runStreamWorker,
} from "./worker";
import { StreamRateLimitedError, type StreamPort } from "./stream";

function response(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): HttpResponse {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    text: async () => body,
    json: async () => JSON.parse(body) as unknown,
  };
}

function game(
  id: string,
  white: string,
  black: string,
  movetext: string,
): string {
  return `[Event "Test Open"]
[Site "https://lichess.org/broadcast/test-open/round-1/rrrrrrrr/${id}"]
[White "${white}"]
[Black "${black}"]
[GameURL "https://lichess.org/broadcast/test-open/round-1/rrrrrrrr/${id}"]
[BroadcastURL "https://lichess.org/broadcast/test-open/round-1/rrrrrrrr"]

${movetext}`;
}

const PGN = [
  game(
    "aaaaaaaa",
    "Alpha",
    "Beta",
    "1. e4 { [%clk 0:03:00] } 1... e5 { [%clk 0:02:58] } 2. Nf3 { [%eval 0.2] [%clk 0:02:55] } 2... Nc6 { [%clk 0:02:57] } *",
  ),
  game("bbbbbbbb", "Gamma", "Delta", "1. d4 { [%clk 0:03:01] } 1... d5 { [%clk 0:02:59] } *"),
].join("\n\n");

const META = JSON.stringify({
  tour: { id: "tttttttt", name: "Test Open" },
  round: { id: "rrrrrrrr", name: "Round 1" },
});

// Mutable canned Lichess: PGN text plus metadata per URL.
function fakeHttp(pgn: () => string): HttpPort {
  return {
    async get(url: string): Promise<HttpResponse> {
      if (url.endsWith(".pgn")) return response(200, pgn());
      if (url.includes("/api/broadcast/")) return response(200, META);
      throw new Error(`unexpected url ${url}`);
    },
  };
}

describe("worker http", () => {
  it("builds the round PGN and metadata urls", () => {
    expect(roundPgnUrl("rrrrrrrr")).toBe(
      "https://lichess.org/api/broadcast/round/rrrrrrrr.pgn",
    );
    expect(roundMetaUrl("test-open", "round-1", "rrrrrrrr")).toBe(
      "https://lichess.org/api/broadcast/test-open/round-1/rrrrrrrr",
    );
  });

  it("throws RateLimitedError with Retry-After seconds", async () => {
    const http: HttpPort = {
      get: async () => response(429, "", { "retry-after": "5" }),
    };
    const err = await fetchRoundPgn(http, "rrrrrrrr").then(
      () => null,
      (e: unknown) => e as RateLimitedError,
    );
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err?.retryAfterMs).toBe(5000);
  });

  it("defaults the backoff to 60s without Retry-After", async () => {
    const http: HttpPort = {
      get: async () => response(429, ""),
    };
    const err = await fetchRoundPgn(http, "rrrrrrrr").then(
      () => null,
      (e: unknown) => e as RateLimitedError,
    );
    expect(err?.retryAfterMs).toBe(60000);
  });

  it("sends per-request Accept headers", async () => {
    const seen: Array<{ url: string; accept: string | undefined }> = [];
    const http: HttpPort = {
      get: async (url: string, accept?: string) => {
        seen.push({ url, accept });
        if (url.endsWith(".pgn")) return response(200, PGN);
        return response(200, META);
      },
    };
    await fetchRoundPgn(http, "rrrrrrrr");
    await fetchTourInfo(http, "test-open", "round-1", "rrrrrrrr", "Test Open");
    expect(seen).toEqual([
      { url: roundPgnUrl("rrrrrrrr"), accept: "application/x-chess-pgn" },
      {
        url: roundMetaUrl("test-open", "round-1", "rrrrrrrr"),
        accept: "application/json",
      },
    ]);
  });

  it("throws on non-2xx and propagates network errors", async () => {
    const bad: HttpPort = {
      get: async () => response(500, "nope"),
    };
    await expect(fetchRoundPgn(bad, "rrrrrrrr")).rejects.toThrowError("500");
    const down: HttpPort = {
      get: async () => {
        throw new Error("conn refused");
      },
    };
    await expect(fetchRoundPgn(down, "rrrrrrrr")).rejects.toThrowError("conn refused");
  });

  it("reads tour id and name from metadata, falling back to PGN", async () => {
    const http = fakeHttp(() => PGN);
    const tour = await fetchTourInfo(http, "test-open", "round-1", "rrrrrrrr", "Test Open");
    expect(tour).toEqual({ sourceId: "tttttttt", name: "Test Open", tier: null, fideTc: null });
    const broken: HttpPort = {
      get: async () => response(404, "no"),
    };
    const fallback = await fetchTourInfo(broken, "test-open", "round-1", "rrrrrrrr", "Evt");
    expect(fallback).toEqual({ sourceId: "round-rrrrrrrr", name: "Evt" });
  });
});

const URL = process.env["TEST_DATABASE_URL"];

describe.runIf(URL)("worker integration", () => {
  let database: Db;
  let sql: ReturnType<typeof postgres>;
  let currentPgn = PGN;

  const http = fakeHttp(() => currentPgn);

  // Counts scoped to this file's games, so parallel test files sharing
  // the database cannot skew them.
  async function scopedCounts() {
    const gs = await database
      .select({ id: games.id })
      .from(games)
      .where(inArray(games.sourceId, ["aaaaaaaa", "bbbbbbbb"]));
    const ids = new Set(gs.map((g) => g.id));
    const moveRows = await database.select().from(moves);
    const outboxRows = await database.select().from(outboxEvents);
    return {
      moves: moveRows.filter((r) => ids.has(r.gameId)).length,
      outbox: outboxRows.filter((r) =>
        ids.has((r.payload as { gameId?: string }).gameId ?? ""),
      ).length,
    };
  }

  async function gameRow(sourceId: string) {
    const [row] = await database.select().from(games).where(eq(games.sourceId, sourceId));
    if (!row) throw new Error(`game ${sourceId} missing`);
    return row;
  }

  async function maxOutboxId(): Promise<number> {
    const [row] = await database
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .orderBy(desc(outboxEvents.id))
      .limit(1);
    return row?.id ?? 0;
  }

  // One game's outbox event types written after `afterId`, oldest first.
  async function outboxTypesSince(gameId: string, afterId: number): Promise<string[]> {
    const rows = await database
      .select()
      .from(outboxEvents)
      .where(gt(outboxEvents.id, afterId))
      .orderBy(asc(outboxEvents.id));
    return rows
      .filter((r) => (r.payload as { gameId?: string }).gameId === gameId)
      .map((r) => r.eventType);
  }

  async function gameVersion(sourceId: string): Promise<number> {
    const [row] = await database
      .select({ version: games.version })
      .from(games)
      .where(eq(games.sourceId, sourceId));
    if (!row) throw new Error(`game ${sourceId} missing`);
    return row.version;
  }

  it("ingests two games with tournament and ply rows", async () => {
    sql = postgres(URL as string);
    database = drizzle(sql, { schema });
    // Hermetic start: drop this file's rows from any previous run.
    const stale = await database
      .select({ id: games.id })
      .from(games)
      .where(inArray(games.sourceId, ["aaaaaaaa", "bbbbbbbb"]));
    const staleIds = stale.map((g) => g.id);
    if (staleIds.length > 0) {
      const staleSet = new Set(staleIds);
      await database.delete(moves).where(inArray(moves.gameId, staleIds));
      const ob = await database
        .select({ id: outboxEvents.id, payload: outboxEvents.payload })
        .from(outboxEvents);
      const obIds = ob
        .filter((r) => staleSet.has((r.payload as { gameId?: string }).gameId ?? ""))
        .map((r) => r.id);
      if (obIds.length > 0) {
        await database.delete(outboxEvents).where(inArray(outboxEvents.id, obIds));
      }
      await database.delete(games).where(inArray(games.id, staleIds));
    }
    await database.delete(tournaments).where(eq(tournaments.sourceId, "tttttttt"));

    const before = await scopedCounts();
    const result = await ingestRound(database, http, "rrrrrrrr");
    expect(result).toMatchObject({ games: 2, inserted: 6, corrections: 0 });
    const [tour] = await database
      .select()
      .from(tournaments)
      .where(eq(tournaments.sourceId, "tttttttt"));
    expect(tour?.name).toBe("Test Open");
    const [gameA] = await database
      .select()
      .from(games)
      .where(eq(games.sourceId, "aaaaaaaa"));
    expect(gameA?.white).toBe("Alpha");
    expect(gameA?.black).toBe("Beta");
    expect(gameA?.version).toBe(4);
    const after = await scopedCounts();
    expect(after.moves - before.moves).toBe(6);
    expect(after.outbox - before.outbox).toBe(6);
  });

  it("re-polling the same PGN writes nothing", async () => {
    const before = await scopedCounts();
    const result = await ingestRound(database, http, "rrrrrrrr");
    expect(result).toMatchObject({ games: 2, inserted: 0, corrections: 0 });
    expect(result.noops).toBeGreaterThan(0);
    expect(await scopedCounts()).toEqual(before);
  });

  it("a restart continues Version from the DB with one new ply", async () => {
    currentPgn = PGN.replace("2... Nc6 { [%clk 0:02:57] } *", "2... Nc6 { [%clk 0:02:57] } 3. Bb5 { [%clk 0:02:50] } *");
    const before = await scopedCounts();
    const result = await ingestRound(database, http, "rrrrrrrr");
    expect(result).toMatchObject({ inserted: 1, corrections: 0 });
    expect(await gameVersion("aaaaaaaa")).toBe(5);
    const after = await scopedCounts();
    expect(after.moves - before.moves).toBe(1);
    expect(after.outbox - before.outbox).toBe(1);
  });

  it("a changed SAN with later plies truncates, corrects, then re-adds the new line", async () => {
    // Stored: e4 e5 Nf3 Nc6 Bb5 (v5). The PGN now has Bc4 at ply 3, so
    // plies 4 and 5 came from the old line and must be replaced (ADR 0004).
    currentPgn = PGN.replace(
      "2. Nf3 { [%eval 0.2] [%clk 0:02:55] }",
      "2. Bc4 { [%clk 0:02:54] }",
    ).replace("2... Nc6 { [%clk 0:02:57] } *", "2... Nc6 { [%clk 0:02:57] } 3. Bb5 { [%clk 0:02:50] } *");
    const before = await scopedCounts();
    const lastId = await maxOutboxId();
    const result = await ingestRound(database, http, "rrrrrrrr");
    expect(result).toMatchObject({ truncations: 1, corrections: 1, inserted: 2 });
    // v6 truncate to ply 3, v7 correct ply 3, v8 and v9 re-add plies 4 and 5.
    expect(await gameVersion("aaaaaaaa")).toBe(9);
    const gameA = await gameRow("aaaaaaaa");
    const rows = await database.select().from(moves).where(eq(moves.gameId, gameA.id));
    const live = rows.filter((r) => !r.superseded).sort((a, b) => a.ply - b.ply);
    expect(live.map((r) => r.san)).toEqual(["e4", "e5", "Bc4", "Nc6", "Bb5"]);
    expect(live.map((r) => r.version)).toEqual([1, 2, 7, 8, 9]);
    expect(gameA.lastPly).toBe(5);
    const after = await scopedCounts();
    expect(after.outbox - before.outbox).toBe(4);
    const types = await outboxTypesSince(gameA.id, lastId);
    expect(types).toEqual(["GameTruncated", "GameCorrected", "MoveReceived", "MoveReceived"]);
  });

  it("a shorter PGN truncates and rewinds the checkpoint", async () => {
    currentPgn = PGN.replace(
      "2. Nf3 { [%eval 0.2] [%clk 0:02:55] } 2... Nc6 { [%clk 0:02:57] } *",
      "*",
    );
    const result = await ingestRound(database, http, "rrrrrrrr");
    expect(result).toMatchObject({ truncations: 1, inserted: 0, corrections: 0 });
    const gameA = await gameRow("aaaaaaaa");
    expect(gameA.version).toBe(10);
    expect(gameA.lastPly).toBe(2);
    const [ply2] = await database
      .select({ fen: moves.fen })
      .from(moves)
      .where(and(eq(moves.gameId, gameA.id), eq(moves.ply, 2), eq(moves.superseded, false)));
    expect(gameA.currentFen).toBe(ply2?.fen);
    const live = await database
      .select({ ply: moves.ply })
      .from(moves)
      .where(and(eq(moves.gameId, gameA.id), eq(moves.superseded, false)));
    expect(live.map((r) => r.ply).sort()).toEqual([1, 2]);
    // Re-polling the same short PGN is a no-op.
    const again = await ingestRound(database, http, "rrrrrrrr");
    expect(again).toMatchObject({ truncations: 0, inserted: 0, corrections: 0 });
    await sql.end();
  });

  it("a Result change bumps Version and emits GameResult once", async () => {
    sql = postgres(URL as string);
    database = drizzle(sql, { schema });
    // Same two plies as the previous test (v10), now with a final score.
    currentPgn = PGN.replace(
      "2. Nf3 { [%eval 0.2] [%clk 0:02:55] } 2... Nc6 { [%clk 0:02:57] } *",
      "1-0",
    ).replace('[Black "Beta"]', '[Black "Beta"]\n[Result "1-0"]');
    const lastId = await maxOutboxId();
    await ingestRound(database, http, "rrrrrrrr");
    const gameA = await gameRow("aaaaaaaa");
    expect(gameA).toMatchObject({ result: "1-0", version: 11, lastPly: 2 });
    expect(await outboxTypesSince(gameA.id, lastId)).toEqual(["GameResult"]);
    // Re-polling the finished game changes nothing.
    await ingestRound(database, http, "rrrrrrrr");
    expect(await gameVersion("aaaaaaaa")).toBe(11);
    expect(await outboxTypesSince(gameA.id, lastId)).toEqual(["GameResult"]);
    await sql.end();
  });

  it("stores player facts, board and the event's tier (#52)", async () => {
    sql = postgres(URL as string);
    database = drizzle(sql, { schema });
    const id = "facts001";
    const pgn = game(id, "Keymer, Vincent", "Abdusattorov, Nodirbek", "1. e4 { [%clk 1:30:00] } *").replace(
      '[Black "Abdusattorov, Nodirbek"]',
      `[Black "Abdusattorov, Nodirbek"]
[Round "8.3"]
[WhiteElo "2764"]
[WhiteTitle "GM"]
[WhiteFideId "12940690"]
[WhiteTeam "Germany"]
[BlackElo "2762"]
[BlackTitle "GM"]
[BlackTeam "Uzbekistan"]`,
    );
    // Hermetic: forget this game from any earlier run so metadata is fetched.
    const old = await database.select({ id: games.id }).from(games).where(eq(games.sourceId, id));
    if (old[0]) {
      await database.delete(moves).where(eq(moves.gameId, old[0].id));
      await database.delete(games).where(eq(games.id, old[0].id));
    }
    const http: HttpPort = {
      async get(url: string): Promise<HttpResponse> {
        if (url.endsWith(".pgn")) return response(200, pgn);
        return response(
          200,
          JSON.stringify({ tour: { id: "tfacts01", name: "Facts Open", tier: 5, info: { fideTC: "standard" } }, round: {} }),
        );
      },
    };
    await ingestRound(database, http, "rrrrrrrr");
    const row = await gameRow(id);
    expect(row).toMatchObject({
      whiteRating: 2764,
      blackRating: 2762,
      whiteTitle: "GM",
      blackTitle: "GM",
      whiteFideId: 12940690,
      whiteTeam: "Germany",
      blackTeam: "Uzbekistan",
      board: 3,
    });
    const [tour] = await database.select().from(tournaments).where(eq(tournaments.id, row.tournamentId));
    expect(tour).toMatchObject({ tier: 5, fideTc: "standard" });
    await sql.end();
  });

  it("reuses a known game's tournament without fetching metadata", async () => {
    sql = postgres(URL as string);
    database = drizzle(sql, { schema });
    let metaCalls = 0;
    const counting: HttpPort = {
      get: async (url: string) => {
        if (url.endsWith(".pgn")) return response(200, currentPgn);
        metaCalls += 1;
        return response(200, META);
      },
    };
    const cache: TourCache = { tournamentId: null };
    await ingestRound(database, counting, "rrrrrrrr", cache);
    await ingestRound(database, counting, "rrrrrrrr", cache);
    expect(metaCalls).toBe(0);
    expect(cache.tournamentId).toBe((await gameRow("aaaaaaaa")).tournamentId);
  });

  it("a failing metadata request never creates a second tournament for known games", async () => {
    const before = await database.select({ id: tournaments.id }).from(tournaments);
    const failing: HttpPort = {
      get: async (url: string) => {
        if (url.endsWith(".pgn")) return response(200, currentPgn);
        throw new Error("ECONNRESET");
      },
    };
    await ingestRound(database, failing, "rrrrrrrr", { tournamentId: null });
    const after = await database.select({ id: tournaments.id }).from(tournaments);
    expect(after).toHaveLength(before.length);
    await sql.end();
  });
});

describe("normalizeResult", () => {
  it("keeps final scores and treats everything else as in progress", () => {
    expect(normalizeResult("1-0")).toBe("1-0");
    expect(normalizeResult("0-1")).toBe("0-1");
    expect(normalizeResult("1/2-1/2")).toBe("1/2-1/2");
    expect(normalizeResult("*")).toBe("*");
    expect(normalizeResult(undefined)).toBe("*");
    expect(normalizeResult("?")).toBe("*");
  });
});

describe.runIf(URL)("stream worker integration", () => {
  it("rides out a 429, ingests the dump plus an update, and stops when the round ends", async () => {
    const sql = postgres(URL as string);
    const database: Db = drizzle(sql, { schema });
    const ids = ["cccccccc", "dddddddd"];
    const stale = await database.select({ id: games.id }).from(games).where(inArray(games.sourceId, ids));
    for (const { id } of stale) {
      await database.delete(moves).where(eq(moves.gameId, id));
    }
    await database.delete(games).where(inArray(games.sourceId, ids));

    const live = game("cccccccc", "Echo", "Foxtrot", "1. e4 e5 *");
    const update = game("cccccccc", "Echo", "Foxtrot", "1. e4 e5 2. Nf3 1-0").replace("[Black", '[Result "1-0"]\n[Black');
    const done = game("dddddddd", "Golf", "Hotel", "1. d4 d5 1/2-1/2").replace("[Black", '[Result "1/2-1/2"]\n[Black');

    let opens = 0;
    const stream: StreamPort = {
      async open() {
        opens += 1;
        if (opens === 1) throw new StreamRateLimitedError();
        // Initial dump of both games, then one live update; then the
        // server closes, and every game now has a final result.
        async function* body(): AsyncIterable<string> {
          yield `${live}\n\n\n${done.slice(0, 30)}`;
          yield `${done.slice(30)}\n\n\n `;
          yield `${update}\n\n\n`;
        }
        return body();
      },
    };

    await runStreamWorker(database, fakeHttp(() => ""), stream, "rrrrrrrr", {
      rateLimitMs: 5,
      finishCheckMs: 5,
    });

    expect(opens).toBe(2);
    const rows = await database
      .select({ sourceId: games.sourceId, lastPly: games.lastPly, result: games.result })
      .from(games)
      .where(inArray(games.sourceId, ids));
    const bySource = Object.fromEntries(rows.map((r) => [r.sourceId, r]));
    expect(bySource["cccccccc"]).toMatchObject({ lastPly: 3, result: "1-0" });
    expect(bySource["dddddddd"]).toMatchObject({ lastPly: 2, result: "1/2-1/2" });
    await sql.end();
  });
});

describe("roundFinished", () => {
  it("is true only when every seen game has a final result", () => {
    expect(roundFinished(new Map())).toBe(false);
    expect(roundFinished(new Map([["a", "1-0"], ["b", "*"]]))).toBe(false);
    expect(roundFinished(new Map([["a", "1-0"], ["b", "0-1"]]))).toBe(true);
  });
});

describe("checkLichessToken", () => {
  const withStatus = (status: number, body: unknown = {}): HttpPort => ({
    get: async (url) => {
      expect(url).toBe("https://lichess.org/api/account");
      return response(status, JSON.stringify(body));
    },
  });

  it("returns the account name for a working token", async () => {
    expect(await checkLichessToken(withStatus(200, { username: "abhishek" }), "lip_x")).toBe("abhishek");
  });

  it("fails loudly on a rejected token", async () => {
    await expect(checkLichessToken(withStatus(401), "lip_bad")).rejects.toThrow(/rejected/);
  });

  it("skips the check without a token", async () => {
    expect(await checkLichessToken(withStatus(500), undefined)).toBeNull();
  });
});
