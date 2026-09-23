import { eq, inArray } from "drizzle-orm";
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
} from "./worker";

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
    expect(tour).toEqual({ sourceId: "tttttttt", name: "Test Open" });
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

  it("a changed SAN yields one GameCorrected at previous plus one", async () => {
    currentPgn = PGN.replace(
      "2. Nf3 { [%eval 0.2] [%clk 0:02:55] }",
      "2. Bc4 { [%clk 0:02:54] }",
    ).replace("2... Nc6 { [%clk 0:02:57] } *", "2... Nc6 { [%clk 0:02:57] } 3. Bb5 { [%clk 0:02:50] } *");
    const before = await scopedCounts();
    const result = await ingestRound(database, http, "rrrrrrrr");
    expect(result).toMatchObject({ corrections: 1 });
    expect(await gameVersion("aaaaaaaa")).toBe(6);
    const [gameA] = await database
      .select({ id: games.id })
      .from(games)
      .where(eq(games.sourceId, "aaaaaaaa"));
    if (!gameA) throw new Error("game aaaaaaaa missing");
    const rows = await database
      .select()
      .from(moves)
      .where(eq(moves.gameId, gameA.id));
    const atThree = rows.filter((r) => r.ply === 3);
    expect(atThree).toHaveLength(2);
    expect(atThree.filter((r) => r.superseded)).toHaveLength(1);
    expect(atThree.find((r) => !r.superseded)?.san).toBe("Bc4");
    const after = await scopedCounts();
    expect(after.outbox - before.outbox).toBe(1);
    await sql.end();
  });

  it("fetches tournament metadata once across polls", async () => {
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
    expect(metaCalls).toBe(1);
    expect(cache.tournamentId).not.toBeNull();
    await ingestRound(database, counting, "rrrrrrrr", cache);
    expect(metaCalls).toBe(1);
    await sql.end();
  });
});
