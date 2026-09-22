import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { IngestOutcome } from "../ingestion/handler";
import { moves, outboxEvents } from "./schema";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

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
  if (result.outcome === "duplicate-noop") return;
  await database.transaction(async (tx) => {
    if (result.outcome === "correction") {
      await tx
        .update(moves)
        .set({ superseded: true })
        .where(eq(moves.gameId, gameId));
    }
    await tx.insert(moves).values({
      gameId,
      ply: result.move.ply,
      san: result.move.san,
      fen: result.move.fen,
      clock: result.move.clock,
      superseded: false,
      source: result.move.source,
    });
    await tx.insert(outboxEvents).values({
      eventType: result.outbox.eventType,
      payload: result.outbox.payload,
    });
  });
}
