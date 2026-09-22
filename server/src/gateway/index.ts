import { Redis } from "ioredis";
import { consumeOnce } from "./consumer";
import { Router } from "./router";
import { STREAM } from "../publisher/publisher";

// Thin transport process. All routing decisions live in router.ts;
// this only binds sockets to the router and the stream to the router.
const PORT = Number(process.env["GATEWAY_PORT"] ?? 3001);
const CONSUMER = `gw-${process.pid}`;
const redis = new Redis(process.env["REDIS_URL"] ?? "redis://localhost:6379");

const router = new Router();
const sockets = new Map<object, { send(message: string): void }>();

try {
  await redis.xgroup("CREATE", STREAM, "gateway", "$", "MKSTREAM");
} catch {
  // Group already exists; restart reuses it and clients resync any gap.
}

async function pump(): Promise<void> {
  try {
    await consumeOnce(
      {
        readGroup: async (group, consumer, stream) => {
          const res = await redis.xreadgroup(
            "GROUP",
            group,
            consumer,
            "COUNT",
            50,
            "BLOCK",
            1000,
            "STREAMS",
            stream,
            ">",
          );
          const [, entries] = res?.[0] ?? [];
          return (entries ?? []).map(([id, fields]) => ({
            id: id as string,
            fields: Object.fromEntries(
              Array.from(
                { length: (fields as string[]).length / 2 },
                (_, i) => [(fields as string[])[i * 2], (fields as string[])[i * 2 + 1]],
              ),
            ) as Record<string, string>,
          }));
        },
        ack: (stream, group, id) => redis.xack(stream, group, id),
      },
      router,
      CONSUMER,
      (conn, message) => sockets.get(conn)?.send(message),
    );
  } catch (err) {
    console.error("gateway pump failed, continuing", err);
  }
  setTimeout(() => void pump(), 100);
}

void pump();

Bun.serve({
  port: PORT,
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response("livechess gateway", { status: 200 });
  },
  websocket: {
    // No game state is sent on open or subscribe. The client renders
    // from GET /games/:id/state (resync) and applies live events after.
    open(ws) {
      sockets.set(ws, ws);
    },
    message(ws, raw) {
      const msg = JSON.parse(String(raw)) as { subscribe?: string };
      if (msg.subscribe) router.subscribe(ws, msg.subscribe);
    },
    close(ws) {
      router.unsubscribeAll(ws);
      sockets.delete(ws);
    },
  },
});

console.log(`gateway listening on ${PORT}`);
