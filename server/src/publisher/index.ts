import { Redis } from "ioredis";
import { db } from "../db/client";
import { pollOnce } from "./publisher";

// Separate Bun process. Polls continuously; each cycle is one pollOnce.
const INTERVAL_MS = Number(process.env["PUBLISHER_INTERVAL_MS"] ?? 500);

const redis = new Redis(process.env["REDIS_URL"] ?? "redis://localhost:6379");

async function tick(): Promise<void> {
  try {
    await pollOnce(db(), {
      xadd: (stream, fields) => redis.xadd(stream, "*", ...Object.entries(fields).flat()),
      hset: (key, fields) => redis.hset(key, fields),
    });
  } catch (err) {
    console.error("publisher tick failed, retrying next interval", err);
  }
}

setInterval(() => void tick(), INTERVAL_MS);
await tick();
