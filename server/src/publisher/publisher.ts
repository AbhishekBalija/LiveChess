import { and, asc, eq, lte, sql } from "drizzle-orm";
import { outboxEvents } from "../db/schema";
import type { Db } from "../db/client";

// Minimal Redis surface the publisher needs. Injected so unit tests
// use a fake and only the integration test touches real Redis.
export interface RedisPort {
  xadd(stream: string, fields: Record<string, string>): Promise<string | null>;
  hset(key: string, fields: Record<string, string>): Promise<unknown>;
}

export const STREAM = "livechess:events";
export const cacheKey = (gameId: string): string => `game:${gameId}`;

export interface StreamFields extends Record<string, string> {
  type: string;
  gameId: string;
  ply: string;
  san: string;
  fen: string;
  // Mover's clock after this move; empty when the source has none.
  clock: string;
  version: string;
  // Game Result, only on GameResult events; empty otherwise.
  result: string;
  // Eval from White's side, only on EvalUpdated events; empty otherwise.
  evalCp: string;
  evalMate: string;
  // Best reply (SAN) from this position, only on EvalUpdated events.
  bestReply: string;
  // "true" / "false" when the eval worker checked the move for a sacrifice.
  sacrifice: string;
}

export interface CacheFields extends Record<string, string> {
  fen: string;
  version: string;
  lastPly: string;
  lastSan: string;
}

// Latest eval in the cache hash, next to the checkpoint fields.
export interface EvalCacheFields extends Record<string, string> {
  evalPly: string;
  evalVersion: string;
  evalCp: string;
  evalMate: string;
  evalBest: string;
  evalSacrifice: string;
}

// Board-position snapshot attached to every outbox payload by the
// persistence layer. The cache mirrors the position, not the event:
// an old-ply correction bumps Version but must not rewind fen/lastPly.
export interface CheckpointFields {
  fen: string;
  lastPly: number;
  lastSan: string;
  version: number;
}

// Pure mapping: one outbox row becomes both Redis writes.
// Both writes derive from the same row, which is the whole point:
// a single poll cycle, a single reliability posture (ADR 0003).
export function buildWrites(row: {
  eventType: string;
  payload: Record<string, unknown>;
}): { stream: StreamFields; cacheKey: string; cache: CacheFields | EvalCacheFields | null } {
  const str = (v: unknown): string => String(v ?? "");
  const gameId = str(row.payload["gameId"]);
  const stream: StreamFields = {
    type: row.eventType,
    gameId,
    ply: str(row.payload["ply"]),
    san: str(row.payload["san"] ?? row.payload["newSan"]),
    fen: str(row.payload["fen"]),
    clock: str(row.payload["clock"]),
    version: str(row.payload["version"]),
    result: str(row.payload["result"]),
    evalCp: str(row.payload["evalCp"]),
    evalMate: str(row.payload["evalMate"]),
    bestReply: str(row.payload["bestReply"]),
    sacrifice: str(row.payload["sacrifice"]),
  };
  // An eval never moves the board, so it must not touch the checkpoint
  // fields. Only the newest ply's eval is cached, for the resync fast path.
  if (row.eventType === "EvalUpdated") {
    const cache: EvalCacheFields | null =
      row.payload["latest"] === true
        ? { evalPly: stream.ply, evalVersion: stream.version, evalCp: stream.evalCp, evalMate: stream.evalMate, evalBest: stream.bestReply, evalSacrifice: stream.sacrifice }
        : null;
    return { stream, cacheKey: cacheKey(gameId), cache };
  }
  // Cache follows the checkpoint snapshot, never the event itself, so a
  // correction to an older ply cannot rewind the cached board position.
  // Rows written before the checkpoint existed fall back to the event.
  const checkpoint = row.payload["checkpoint"] as CheckpointFields | undefined;
  const cache: CacheFields =
    checkpoint !== undefined && checkpoint !== null
      ? {
          fen: str(checkpoint.fen),
          version: str(checkpoint.version),
          lastPly: str(checkpoint.lastPly),
          lastSan: str(checkpoint.lastSan),
        }
      : {
          fen: stream.fen,
          version: stream.version,
          lastPly: stream.ply,
          lastSan: stream.san,
        };
  return {
    stream,
    cacheKey: cacheKey(gameId),
    cache,
  };
}

// One poll cycle: oldest unpublished rows first, both Redis writes per row,
// mark published only after both succeed. A crash between XADD and marking
// redelivers on the next poll; downstream dedupes via Version (tolerated,
// not engineered around for Slice 1).
export async function pollOnce(
  database: Db,
  redis: RedisPort,
  limit = 100,
): Promise<number> {
  const rows = await database
    .select()
    .from(outboxEvents)
    .where(eq(outboxEvents.published, false))
    .orderBy(asc(outboxEvents.id))
    .limit(limit);
  for (const row of rows) {
    const payload = row.payload as Record<string, unknown>;
    const writes = buildWrites({ eventType: row.eventType, payload });
    await redis.xadd(STREAM, writes.stream);
    if (writes.cache) await redis.hset(writes.cacheKey, writes.cache);
    await database
      .update(outboxEvents)
      .set({ published: true })
      .where(eq(outboxEvents.id, row.id));
  }
  return rows.length;
}

// Published rows are only kept for debugging: the moves table and the
// Redis stream already hold the history. Delete published rows outside the
// newest `keep` ids; unpublished rows are never touched. Counting rows instead of days avoids a created_at
// column (and a migration); at a few thousand moves a day, 10k rows is a
// few days of history.
export async function pruneOnce(database: Db, keep = 10_000): Promise<number> {
  const deleted = await database
    .delete(outboxEvents)
    .where(
      and(
        eq(outboxEvents.published, true),
        lte(outboxEvents.id, sql`(select max(${outboxEvents.id}) from ${outboxEvents}) - ${keep}`),
      ),
    )
    .returning({ id: outboxEvents.id });
  return deleted.length;
}
