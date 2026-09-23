import { and, eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { IngestOutcome } from "../ingestion/handler";
import type { CheckpointFields } from "../publisher/publisher";
import { games, moves, outboxEvents } from "./schema";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

// A transaction opened by Db["transaction"]. The ingestion worker opens
// one transaction per game (SELECT games FOR UPDATE, load moves, persist
// each ply) and reuses the persist core below instead of duplicating it.
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

let client: Db | null = null;

// Lazy so unit tests never open a connection.
export function db(): Db {
  if (!client) {
    const url = process.env["DATABASE_URL"];
    if (!url) throw new Error("DATABASE_URL is not set");
    client = drizzle(postgres(url), { schema });
  }
  return client;
}

// Thin persistence mapping. The Handler core decides insert/noop/correction;
// this only executes move row plus outbox row in one transaction (ADR 0003).
// Live-DB round-trip is verified at T3/T5 integration; unit tests cover the core.
export async function persistIngestResult(
  database: Db,
  gameId: string,
  result: IngestOutcome,
): Promise<void> {
  await database.transaction((tx) => persistIngestResultTx(tx, gameId, result));
}

export async function persistIngestResultTx(
  tx: DbTx,
  gameId: string,
  result: IngestOutcome,
): Promise<void> {
  if (result.outcome === "duplicate-noop") return;
  if (result.outcome === "correction") {
    await tx
      .update(moves)
      .set({ superseded: true })
      .where(
        and(eq(moves.gameId, gameId), eq(moves.ply, result.move.ply)),
      );
  }
  await tx.insert(moves).values({
    gameId,
    ply: result.move.ply,
    san: result.move.san,
    fen: result.move.fen,
    clock: result.move.clock,
    superseded: false,
    source: result.move.source,
    version: result.version,
  });
  // Postgres stays authoritative for resync: the games checkpoint moves
  // in the same transaction as the move row, BEFORE the outbox row, so
  // the payload can carry the resulting snapshot. Version always
  // advances; the board position only advances, never rewinds on an
  // old-ply fix. The publisher copies that snapshot to the cache
  // without any Postgres reads of its own.
  const [existing] = await tx
    .select({ lastPly: games.lastPly, currentFen: games.currentFen })
    .from(games)
    .where(eq(games.id, gameId));
  let checkpoint: CheckpointFields;
  if (!existing || result.move.ply >= existing.lastPly) {
    await tx
      .update(games)
      .set({
        version: result.version,
        currentFen: result.move.fen,
        lastPly: result.move.ply,
      })
      .where(eq(games.id, gameId));
    checkpoint = {
      fen: result.move.fen,
      lastPly: result.move.ply,
      lastSan: result.move.san,
      version: result.version,
    };
  } else {
    await tx
      .update(games)
      .set({ version: result.version })
      .where(eq(games.id, gameId));
    const [current] = await tx
      .select({ san: moves.san })
      .from(moves)
      .where(
        and(
          eq(moves.gameId, gameId),
          eq(moves.ply, existing.lastPly),
          eq(moves.superseded, false),
        ),
      );
    checkpoint = {
      fen: existing.currentFen,
      lastPly: existing.lastPly,
      lastSan: current?.san ?? result.move.san,
      version: result.version,
    };
  }
  await tx.insert(outboxEvents).values({
    eventType: result.outbox.eventType,
    // The publisher reads rows without joining moves, so the payload
    // carries the game identity plus the checkpoint snapshot it needs
    // for stream and cache keys.
    payload: { gameId, ...result.outbox.payload, checkpoint },
  });
}
