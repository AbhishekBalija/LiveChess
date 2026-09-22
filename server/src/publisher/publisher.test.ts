import { execSync } from "node:child_process";
import { drizzle } from "drizzle-orm/postgres-js";
import { Redis } from "ioredis";
import postgres from "postgres";
import { beforeAll, describe, expect, it } from "vitest";
import { persistIngestResult, type Db } from "../db/client";
import * as schema from "../db/schema";
import { games, outboxEvents, tournaments } from "../db/schema";
import { applyMoveReceived, emptyGame } from "../ingestion/handler";
import { buildWrites, cacheKey, pollOnce, STREAM, type RedisPort } from "./publisher";

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
});

describe("seam 2 contract", () => {
  it("only the publisher touches Redis", () => {
    const out = execSync(
      "grep -rl 'ioredis\\|from \"redis\"' src --include='*.ts' | grep -v '.test.ts' || true",
      { encoding: "utf8" },
    );
    const files = out.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(files).toEqual(["src/publisher/index.ts"]);
  });
});

const URL = process.env["TEST_DATABASE_URL"];
const REDIS_URL = process.env["TEST_REDIS_URL"] ?? "redis://localhost:6379";

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
    const entries = await redis.xread("COUNT", 100, "STREAMS", STREAM, "0");
    const mine = (entries?.[0]?.[1] ?? []).filter(([, f]) => {
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
});
