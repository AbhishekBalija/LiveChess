import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { applyMoveReceived, emptyGame } from "../ingestion/handler";
import { persistIngestResult, type Db } from "../db/client";
import * as schema from "../db/schema";
import { games, tournaments } from "../db/schema";
import {
  drizzleStateDb,
  getGameState,
  parseSinceVersion,
  StateHttpError,
  type LiveMoveRow,
  type StateCachePort,
  type StateDbPort,
} from "./state";

const missCache: StateCachePort = { hgetall: async () => null };

// Well-formed id so UUID validation passes and the fakes are reached.
const GID = "123e4567-e89b-12d3-a456-426614174000";

describe("getGameState cache fast path", () => {
  const hitCache: StateCachePort = {
    hgetall: async () => ({ fen: "fen-2", version: "2", lastPly: "2", lastSan: "e5" }),
  };

  it("serves an up-to-date client from cache without touching Postgres", async () => {
    let dbCalls = 0;
    const db: StateDbPort = {
      listEvals: async () => [],
      findGame: async () => {
        dbCalls += 1;
        throw new Error("must not hit Postgres on cache fast path");
      },
      findLiveMove: async () => {
        dbCalls += 1;
        throw new Error("must not hit Postgres on cache fast path");
      },
      listLiveMovesSince: async () => {
        dbCalls += 1;
        throw new Error("must not hit Postgres on cache fast path");
      },
    };
    const res = await getGameState(db, hitCache, GID, 2);
    expect(res).toEqual({
      gameId: GID,
      version: 2,
      fen: "fen-2",
      lastMove: { ply: 2, san: "e5" },
      missedMoves: [],
      evals: [],
    });
    expect(dbCalls).toBe(0);
  });

  it("returns the cached newest-ply eval on the fast path", async () => {
    const cache: StateCachePort = {
      hgetall: async () => ({
        fen: "fen-2",
        version: "2",
        lastPly: "2",
        lastSan: "e5",
        evalPly: "2",
        evalVersion: "2",
        evalCp: "",
        evalMate: "-3",
        evalBest: "Qxf7#",
        evalSacrifice: "false",
      }),
    };
    const db = {} as StateDbPort;
    const res = await getGameState(db, cache, GID, 2);
    expect(res.evals).toEqual([{ ply: 2, version: 2, cp: null, mate: -3, best: "Qxf7#", sacrifice: false }]);
  });

  it("goes to Postgres when the client is behind the cache", async () => {
    const rows: LiveMoveRow[] = [
      { ply: 1, san: "e4", fen: "fen-1", clock: null, version: 1 },
      { ply: 2, san: "e5", fen: "fen-2", clock: null, version: 2 },
    ];
    const db: StateDbPort = {
      listEvals: async () => [],
      findGame: async () => ({
        id: GID,
        version: 2,
        currentFen: "fen-2",
        lastPly: 2,
        white: "Carlsen, Magnus",
        black: "Nepomniachtchi, Ian",
      }),
      findLiveMove: async () => ({ ply: 2, san: "e5" }),
      listLiveMovesSince: async (gameId, since) => {
        expect(gameId).toBe(GID);
        expect(since).toBe(0);
        return rows;
      },
    };
    const res = await getGameState(db, hitCache, GID, 0);
    expect(res.version).toBe(2);
    expect(res.missedMoves).toEqual(rows);
    expect(res.white).toBe("Carlsen, Magnus");
    expect(res.black).toBe("Nepomniachtchi, Ian");
  });

  it("goes to Postgres on cache miss", async () => {
    const db: StateDbPort = {
      listEvals: async () => [],
      findGame: async () => ({ id: GID, version: 1, currentFen: "fen-1", lastPly: 1 }),
      findLiveMove: async () => ({ ply: 1, san: "e4" }),
      listLiveMovesSince: async () => [{ ply: 1, san: "e4", fen: "fen-1", clock: null, version: 1 }],
    };
    const res = await getGameState(db, missCache, GID);
    expect(res.missedMoves).toHaveLength(1);
  });

  it("returns every stored eval on the Postgres path, not only missed moves", async () => {
    const evals = [
      { ply: 1, version: 1, cp: 30, mate: null, best: "e5", sacrifice: null },
      { ply: 2, version: 2, cp: 25, mate: null, best: null, sacrifice: true },
    ];
    const db: StateDbPort = {
      listEvals: async () => evals,
      findGame: async () => ({ id: GID, version: 2, currentFen: "fen-2", lastPly: 2 }),
      findLiveMove: async () => ({ ply: 2, san: "e5" }),
      listLiveMovesSince: async () => [],
    };
    const res = await getGameState(db, missCache, GID, 2);
    expect(res.evals).toEqual(evals);
  });

  it("returns null lastMove for a game with no moves yet", async () => {
    const db: StateDbPort = {
      listEvals: async () => [],
      findGame: async () => ({ id: GID, version: 0, currentFen: "", lastPly: 0 }),
      findLiveMove: async () => {
        throw new Error("no move lookup for lastPly 0");
      },
      listLiveMovesSince: async () => [],
    };
    const res = await getGameState(db, missCache, GID);
    expect(res.lastMove).toBeNull();
    expect(res.missedMoves).toEqual([]);
  });

  it("treats a malformed cache hash as a miss", async () => {
    const bad: StateCachePort = { hgetall: async () => ({ fen: "x" }) };
    const db: StateDbPort = {
      listEvals: async () => [],
      findGame: async () => ({ id: GID, version: 1, currentFen: "fen-1", lastPly: 1 }),
      findLiveMove: async () => ({ ply: 1, san: "e4" }),
      listLiveMovesSince: async () => [],
    };
    const res = await getGameState(db, bad, GID, 1);
    expect(res.version).toBe(1);
  });
});

describe("getGameState validation", () => {
  it("throws 404 for an unknown game", async () => {
    const db: StateDbPort = {
      listEvals: async () => [],
      findGame: async () => null,
      findLiveMove: async () => null,
      listLiveMovesSince: async () => [],
    };
    const err = await getGameState(db, missCache, GID).then(
      () => null,
      (e: unknown) => e as StateHttpError,
    );
    expect(err).toBeInstanceOf(StateHttpError);
    expect(err?.status).toBe(404);
  });

  it("throws 404 for a non-UUID id without touching backends", async () => {
    let calls = 0;
    const db: StateDbPort = {
      listEvals: async () => [],
      findGame: async () => {
        calls += 1;
        return null;
      },
      findLiveMove: async () => {
        calls += 1;
        return null;
      },
      listLiveMovesSince: async () => {
        calls += 1;
        return [];
      },
    };
    const cache: StateCachePort = {
      hgetall: async () => {
        calls += 1;
        return null;
      },
    };
    const err = await getGameState(db, cache, "abc").then(
      () => null,
      (e: unknown) => e as StateHttpError,
    );
    expect(err).toBeInstanceOf(StateHttpError);
    expect(err?.status).toBe(404);
    expect(calls).toBe(0);
  });

  it("throws 400 for non-integer or negative sinceVersion", async () => {
    const db: StateDbPort = {
      listEvals: async () => [],
      findGame: async () => ({ id: GID, version: 1, currentFen: "f", lastPly: 1 }),
      findLiveMove: async () => ({ ply: 1, san: "e4" }),
      listLiveMovesSince: async () => [],
    };
    for (const bad of [1.5, -1, Number.NaN]) {
      const err = await getGameState(db, missCache, GID, bad).then(
        () => null,
        (e: unknown) => e as StateHttpError,
      );
      expect(err?.status).toBe(400);
    }
  });

  it("parses the since_version query value", () => {
    expect(parseSinceVersion(null)).toBe(0);
    expect(parseSinceVersion("3")).toBe(3);
    expect(parseSinceVersion("0")).toBe(0);
    expect(() => parseSinceVersion("")).toThrowError(StateHttpError);
    expect(() => parseSinceVersion("1.5")).toThrowError(StateHttpError);
    expect(() => parseSinceVersion("-1")).toThrowError(StateHttpError);
    expect(() => parseSinceVersion("abc")).toThrowError(StateHttpError);
    expect(() => parseSinceVersion("3 ")).toThrowError(StateHttpError);
  });

  it("passes live rows through in version order with the corrected SAN", async () => {
    const db: StateDbPort = {
      listEvals: async () => [],
      findGame: async () => ({ id: GID, version: 3, currentFen: "fen-2", lastPly: 2 }),
      findLiveMove: async () => ({ ply: 2, san: "e5" }),
      listLiveMovesSince: async () => [
        { ply: 2, san: "e5", fen: "fen-2", clock: null, version: 2 },
        { ply: 1, san: "d4", fen: "fen-1b", clock: null, version: 3 },
      ],
    };
    const res = await getGameState(db, missCache, GID, 0);
    expect(res.missedMoves.map((m) => m.version)).toEqual([2, 3]);
    expect(res.missedMoves.find((m) => m.ply === 1)?.san).toBe("d4");
  });
});

const URL = process.env["TEST_DATABASE_URL"];

describe.runIf(URL)("getGameState integration", () => {
  it("resyncs live moves in version order after a correction", async () => {
    const sql = postgres(URL as string);
    const database: Db = drizzle(sql, { schema });
    const [t] = await database
      .insert(tournaments)
      .values({
        source: "lichess",
        sourceId: `tour-resync-${Date.now()}`,
        name: "Resync Test",
      })
      .returning({ id: tournaments.id });
    const [g] = await database
      .insert(games)
      .values({
        tournamentId: t.id,
        source: "lichess",
        sourceId: `game-resync-${Date.now()}`,
        white: "A",
        black: "B",
        currentFen: "",
      })
      .returning({ id: games.id });
    const state = emptyGame();
    for (const input of [
      { ply: 1, san: "e4", fen: "fen-1" },
      { ply: 2, san: "e5", fen: "fen-2" },
    ] as const) {
      const r = applyMoveReceived(state, { ...input, clock: null, source: "lichess" });
      if (r.outcome === "duplicate-noop") throw new Error("unexpected noop");
      await persistIngestResult(database, g.id, r);
    }
    const fix = applyMoveReceived(state, {
      ply: 1,
      san: "d4",
      fen: "fen-1b",
      clock: null,
      source: "lichess",
    });
    if (fix.outcome !== "correction") throw new Error("expected correction");
    await persistIngestResult(database, g.id, fix);

    const db = drizzleStateDb(database);
    const full = await getGameState(db, missCache, g.id, 0);
    expect(full.version).toBe(3);
    expect(full.fen).toBe("fen-2");
    expect(full.lastMove).toEqual({ ply: 2, san: "e5" });
    expect(full.missedMoves.map((m) => m.version)).toEqual([2, 3]);
    expect(full.missedMoves.find((m) => m.ply === 1)?.san).toBe("d4");

    const caughtUp = await getGameState(db, missCache, g.id, 3);
    expect(caughtUp.missedMoves).toEqual([]);
    expect(caughtUp.version).toBe(3);
    await sql.end();
  });
});
