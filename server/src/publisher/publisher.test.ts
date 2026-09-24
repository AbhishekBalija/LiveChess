import { execSync } from "node:child_process";
import { drizzle } from "drizzle-orm/postgres-js";
import { Redis } from "ioredis";
import postgres from "postgres";
import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { persistIngestResult, type Db } from "../db/client";
import * as schema from "../db/schema";
import { games, outboxEvents, tournaments } from "../db/schema";
import { applyMoveReceived, emptyGame } from "../ingestion/handler";
import { buildWrites, cacheKey, pollOnce, pruneOnce, STREAM, type RedisPort } from "./publisher";

describe("publisher mapping", () => {
  it("derives stream event and cache state from the same outbox row", () => {
    const writes = buildWrites({
      eventType: "MoveReceived",
      payload: {
        gameId: "g-1",
        ply: 3,
        san: "Bb5",
        fen: "fen-3",
        clock: "0:02:55.1",
        version: 3,
      },
    });
    expect(writes.stream).toMatchObject({
      type: "MoveReceived",
      gameId: "g-1",
      ply: "3",
      san: "Bb5",
      version: "3",
    });
    expect(writes.cacheKey).toBe("game:g-1");
    expect(writes.cache).toMatchObject({
      fen: "fen-3",
      version: "3",
      lastPly: "3",
      lastSan: "Bb5",
    });
  });

  it("maps corrections via newSan", () => {
    const writes = buildWrites({
      eventType: "GameCorrected",
      payload: { gameId: "g-1", ply: 5, oldSan: "e5", newSan: "c5", fen: "fen-5b", version: 6 },
    });
    expect(writes.stream.san).toBe("c5");
    expect(writes.cache.lastSan).toBe("c5");
  });

  it("keeps the cache on the checkpoint for an old-ply correction", () => {
    const writes = buildWrites({
      eventType: "GameCorrected",
      payload: {
        gameId: "g-1",
        ply: 1,
        oldSan: "e4",
        newSan: "d4",
        fen: "fen-1b",
        version: 3,
        checkpoint: { fen: "fen-2", lastPly: 2, lastSan: "e5", version: 3 },
      },
    });
    // Stream stays per-event; cache stays on the board position.
    expect(writes.stream).toMatchObject({ ply: "1", san: "d4", fen: "fen-1b", version: "3" });
    expect(writes.cache).toMatchObject({ fen: "fen-2", version: "3", lastPly: "2", lastSan: "e5" });
  });
});

describe("seam 2 contract", () => {
  it("only the publisher writes to Redis; the gateway only reads", () => {
    const out = execSync(
      "grep -rl 'ioredis\\|from \"redis\"' src --include='*.ts' | grep -v '.test.ts' || true",
      { encoding: "utf8" },
    );
    const files = out.split("\n").map((l) => l.trim()).filter(Boolean);
    // Writer (XADD + HSET) and reader (XREADGROUP + XACK) are the only
    // Redis touchpoints. Move Handler, adapter, and db layers stay clean.
    expect(files.sort()).toEqual(["src/gateway/index.ts", "src/publisher/index.ts"]);
    const gateway = execSync("grep -n 'xadd\\|hset' src/gateway/index.ts || true", {
      encoding: "utf8",
    }).trim();
    expect(gateway).toBe("");
  });
});

const URL = process.env["TEST_DATABASE_URL"];
const REDIS_URL = process.env["TEST_REDIS_URL"] ?? "redis://localhost:6379/1";

describe.runIf(URL)("publisher integration", () => {
  let database: Db;
  let redis: Redis;
  let gameId: string;

  const port: RedisPort = {
    xadd: async (stream, fields) =>
      redis.xadd(stream, "*", ...Object.entries(fields).flat()),
    hset: async (key, fields) => redis.hset(key, fields),
  };

  beforeAll(async () => {
    const sql = postgres(URL as string);
    database = drizzle(sql, { schema });
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3 });
    const [t] = await database
      .insert(tournaments)
      .values({ source: "lichess", sourceId: `tour-pub-${Date.now()}`, name: "Pub Test" })
      .returning({ id: tournaments.id });
    const [g] = await database
      .insert(games)
      .values({
        tournamentId: t.id,
        source: "lichess",
        sourceId: `game-pub-${Date.now()}`,
        white: "A",
        black: "B",
        currentFen: "",
      })
      .returning({ id: games.id });
    gameId = g.id;
  });

  it("polls in happened-order and performs both Redis writes per row", async () => {
    const state = emptyGame();
    for (const [ply, san] of [[1, "e4"], [2, "e5"]] as const) {
      const r = applyMoveReceived(state, {
        ply,
        san,
        fen: `fen-${ply}`,
        clock: null,
        source: "lichess",
      });
      if (r.outcome === "duplicate-noop") throw new Error("unexpected noop");
      await persistIngestResult(database, gameId, r);
    }
    const claimed = await pollOnce(database, port);
    expect(claimed).toBeGreaterThanOrEqual(2);
    // Newest entries, oldest first: the test stream keeps entries from
    // earlier runs, so reading from the start would miss this run's.
    const entries = (await redis.xrevrange(STREAM, "+", "-", "COUNT", 100)).reverse();
    const mine = entries.filter(([, f]) => {
      const obj = Object.fromEntries(
        Array.from({ length: f.length / 2 }, (_, i) => [f[i * 2], f[i * 2 + 1]]),
      );
      return obj["gameId"] === gameId;
    });
    expect(mine.map(([, f]) => f[f.indexOf("ply") + 1])).toEqual(["1", "2"]);
    const cache = await redis.hgetall(cacheKey(gameId));
    expect(cache).toMatchObject({ lastPly: "2", lastSan: "e5", version: "2" });
    // Second poll is a no-op: rows are marked published.
    await expect(pollOnce(database, port)).resolves.toBe(0);
  });

  it("prunes published rows beyond the newest `keep`, never unpublished ones", async () => {
    // Fresh game: the test above already wrote plies 1 and 2 for gameId.
    const [g] = await database
      .insert(games)
      .values({
        tournamentId: (await database.select({ id: games.tournamentId }).from(games).where(eq(games.id, gameId)))[0].id,
        source: "lichess",
        sourceId: `game-prune-${Date.now()}`,
        white: "C",
        black: "D",
        currentFen: "",
      })
      .returning({ id: games.id });
    const pruneGameId = g.id;
    const state = emptyGame();
    for (const [ply, san] of [[1, "d4"], [2, "d5"]] as const) {
      const r = applyMoveReceived(state, { ply, san, fen: `fen-${ply}`, clock: null, source: "lichess" });
      if (r.outcome === "duplicate-noop") throw new Error("unexpected noop");
      await persistIngestResult(database, pruneGameId, r);
    }
    await pollOnce(database, port);
    // One more row that stays unpublished.
    const r = applyMoveReceived(state, { ply: 3, san: "c4", fen: "fen-3", clock: null, source: "lichess" });
    if (r.outcome === "duplicate-noop") throw new Error("unexpected noop");
    await persistIngestResult(database, pruneGameId, r);

    await expect(pruneOnce(database, 2)).resolves.toBeGreaterThan(0);
    const left = await database
      .select({ id: outboxEvents.id, published: outboxEvents.published })
      .from(outboxEvents)
      .orderBy(asc(outboxEvents.id));
    // keep=2 leaves the newest two ids: published d5 and unpublished c4.
    expect(left.map((row) => row.published)).toEqual([true, false]);
    await pollOnce(database, port);
  });
});

describe("buildWrites for a takeback", () => {
  it("streams the truncation point and rewinds the cache to the checkpoint", () => {
    const writes = buildWrites({
      eventType: "GameTruncated",
      payload: {
        gameId: "g1",
        ply: 2,
        fen: "fen-2",
        version: 6,
        checkpoint: { fen: "fen-2", lastPly: 2, lastSan: "e5", version: 6 },
      },
    });
    expect(writes.stream).toEqual({
      type: "GameTruncated",
      gameId: "g1",
      ply: "2",
      san: "",
      fen: "fen-2",
      clock: "",
      version: "6",
    });
    expect(writes.cache).toEqual({ fen: "fen-2", version: "6", lastPly: "2", lastSan: "e5" });
  });
});
