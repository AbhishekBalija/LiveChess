import { Redis } from "ioredis";
import { envInt } from "../env";
import { db } from "../db/client";
import { pollOnce, pruneOnce } from "./publisher";

// Separate Bun process. Polls continuously; each cycle is one pollOnce.
const INTERVAL_MS = envInt("PUBLISHER_INTERVAL_MS", 500, { min: 100 });
const OUTBOX_KEEP = envInt("OUTBOX_KEEP_ROWS", 10_000, { min: 0 });
// Approximate cap on the Redis stream. "~" lets Redis trim in whole
// blocks, which is much cheaper than an exact cap. Clients that miss
// trimmed entries (gateway down for a long time) catch up via resync.
const STREAM_MAXLEN = envInt("STREAM_MAXLEN", 10_000, { min: 100 });
const PRUNE_MS = 60 * 60 * 1000;

const redis = new Redis(process.env["REDIS_URL"] ?? "redis://localhost:6379");

async function tick(): Promise<void> {
  try {
    await pollOnce(db(), {
      xadd: (stream, fields) => redis.xadd(stream, "MAXLEN", "~", STREAM_MAXLEN, "*", ...Object.entries(fields).flat()),
      hset: (key, fields) => redis.hset(key, fields),
    });
  } catch (err) {
    console.error("publisher tick failed, retrying next interval", err);
  }
}

async function prune(): Promise<void> {
  try {
    const deleted = await pruneOnce(db(), OUTBOX_KEEP);
    if (deleted > 0) console.log(`publisher pruned ${deleted} published outbox rows`);
  } catch (err) {
    console.error("outbox prune failed, retrying next hour", err);
  }
}

setInterval(() => void tick(), INTERVAL_MS);
setInterval(() => void prune(), PRUNE_MS);
await tick();
await prune();
