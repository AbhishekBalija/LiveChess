import type { Redis } from "ioredis";

// Games people have open (ADR 0006, "watched games first"). The gateway
// knows who is subscribed to what; it keeps this sorted set of game id to
// last-seen time, and the eval worker analyzes those games before others.
// It is viewer bookkeeping, not game data, so it sits outside the
// publisher's stream and cache (ADR 0003).
export const WATCHED_KEY = "livechess:watched";

// A game counts as watched for this long after its last viewer update.
export const WATCHED_FOR_MS = 60_000;

export async function markWatched(redis: Redis, gameIds: Iterable<string>, now = Date.now()): Promise<void> {
  const args = [...gameIds].flatMap((id) => [now, id]);
  if (args.length > 0) await redis.zadd(WATCHED_KEY, ...args);
  // Keep the set small: drop games nobody has looked at for a while.
  await redis.zremrangebyscore(WATCHED_KEY, 0, now - 5 * WATCHED_FOR_MS);
}

export async function watchedGames(redis: Redis, now = Date.now()): Promise<string[]> {
  return redis.zrangebyscore(WATCHED_KEY, now - WATCHED_FOR_MS, "+inf");
}
