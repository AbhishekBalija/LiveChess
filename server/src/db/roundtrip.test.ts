import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { beforeAll, describe, expect, it } from "vitest";
import { applyMoveReceived, emptyGame } from "../ingestion/handler";
import * as schema from "./schema";
import { persistIngestResult, type Db } from "./client";
import { games, moves, outboxEvents, tournaments } from "./schema";

// Real Postgres round-trip. Proves the two invariants mocks cannot:
// the unique constraint on (game_id, ply, source) actually fires,
// and move plus outbox rows commit atomically in one transaction.
// Runs only with TEST_DATABASE_URL set, e.g.
// TEST_DATABASE_URL=postgresql://abhishekan@localhost:5433/livechess_test
const URL = process.env["TEST_DATABASE_URL"];

describe.runIf(URL)("postgres round-trip", () => {
  let db: Db;
  let sql: ReturnType<typeof postgres>;
  let gameId: string;

  beforeAll(async () => {
    sql = postgres(URL as string);
    db = drizzle(sql, { schema });
    await db.delete(moves);
    await db.delete(outboxEvents);
    await db.delete(games);
    await db.delete(tournaments);
    const [t] = await db
      .insert(tournaments)
      .values({ source: "lichess", sourceId: "tour-1", name: "Test Open" })
      .returning({ id: tournaments.id });
    const [g] = await db
      .insert(games)
      .values({
        tournamentId: t.id,
        source: "lichess",
        sourceId: "game-1",
        white: "Carlsen, Magnus",
        black: "Nepomniachtchi, Ian",
        currentFen: "",
      })
      .returning({ id: games.id });
    gameId = g.id;
  });

  it("rejects a duplicate identity key at the constraint", async () => {
    await db.insert(moves).values({
      gameId,
      ply: 1,
      san: "e4",
      fen: "fen-1",
      source: "lichess",
    });
    const err = await db
      .insert(moves)
      .values({
        gameId,
        ply: 1,
        san: "e4",
        fen: "fen-1",
        source: "lichess",
      })
      .then(
        () => null,
        (e: unknown) => e as { code?: string; cause?: { code?: string } },
      );
    expect(err).not.toBeNull();
    expect(err?.code ?? err?.cause?.code).toBe("23505");
  });

  it("commits move plus outbox atomically with monotonic ids", async () => {
    const state = emptyGame();
    const first = applyMoveReceived(state, {
      ply: 3,
      san: "Bb5",
      fen: "fen-3",
      clock: "0:02:55.1",
      source: "lichess",
    });
    if (first.outcome === "duplicate-noop") throw new Error("unexpected noop");
    await persistIngestResult(db, gameId, first);
    const second = applyMoveReceived(state, {
      ply: 4,
      san: "a6",
      fen: "fen-4",
      clock: null,
      source: "lichess",
    });
    if (second.outcome === "duplicate-noop") throw new Error("unexpected noop");
    await persistIngestResult(db, gameId, second);
    const rows = await db.select().from(outboxEvents);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const ids = rows.map((r) => r.id).sort((a, b) => a - b);
    expect(ids[1]).toBeGreaterThan(ids[0]);
    const stored = await db.select().from(moves);
    expect(stored.some((m) => m.ply === 3 && m.clock === "0:02:55.1")).toBe(
      true,
    );
  });

  it("marks only the corrected ply superseded", async () => {
    const state = emptyGame();
    const first = applyMoveReceived(state, {
      ply: 5,
      san: "e5",
      fen: "fen-5",
      clock: null,
      source: "lichess",
    });
    if (first.outcome === "duplicate-noop") throw new Error("unexpected noop");
    await persistIngestResult(db, gameId, first);
    const fix = applyMoveReceived(state, {
      ply: 5,
      san: "c5",
      fen: "fen-5b",
      clock: null,
      source: "lichess",
    });
    if (fix.outcome !== "correction") throw new Error("expected correction");
    await persistIngestResult(db, gameId, fix);
    const stored = await db.select().from(moves);
    const atFive = stored.filter((m) => m.ply === 5);
    expect(atFive).toHaveLength(2);
    expect(atFive.filter((m) => m.superseded)).toHaveLength(1);
    // Unrelated plies untouched by the correction.
    expect(stored.filter((m) => m.ply === 3 && m.superseded)).toHaveLength(0);
  });
});
