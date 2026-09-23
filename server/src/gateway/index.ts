import { Redis } from "ioredis";
import { drizzleGamesDb, GamesHttpError, listGames, parseStatus } from "../api/games";
import { UpcomingCache } from "../api/upcoming";
import { nodeHttp } from "../ingestion/worker";
import { drizzleStateDb, getGameState, parseSinceVersion, StateHttpError } from "../api/state";
import { db } from "../db/client";
import { consumeOnce } from "./consumer";
import { Router } from "./router";
import { STREAM } from "../publisher/publisher";

// Thin transport process. All routing decisions live in router.ts;
// this only binds sockets to the router and the stream to the router.
const PORT = Number(process.env["GATEWAY_PORT"] ?? 3001);
const CONSUMER = `gw-${process.pid}`;
const redis = new Redis(process.env["REDIS_URL"] ?? "redis://localhost:6379");
const CLIENT_ORIGIN = process.env["CLIENT_ORIGIN"] ?? "http://localhost:5173";

function corsHeaders(): Record<string, string> {
  return { "Access-Control-Allow-Origin": CLIENT_ORIGIN };
}

const STATE_ROUTE = /^\/games\/([^/]+)\/state$/;

// Resync wiring only. All snapshot-vs-cache decisions live in state.ts;
// this parses the path plus query, maps StateHttpError to status, and
// returns JSON. Read-only: HGETALL plus Postgres reads, never a write.
async function handleStateGet(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  const match = STATE_ROUTE.exec(url.pathname);
  if (!match) return null;
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(),
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  if (req.method !== "GET") return null;
  try {
    const gameId = decodeURIComponent(match[1] ?? "");
    if (!gameId) throw new StateHttpError(404, "game not found");
    const sinceVersion = parseSinceVersion(url.searchParams.get("since_version"));
    const state = await getGameState(
      drizzleStateDb(db()),
      {
        hgetall: async (key) => {
          const hash = await redis.hgetall(key);
          return Object.keys(hash).length > 0 ? hash : null;
        },
      },
      gameId,
      sinceVersion,
    );
    return Response.json(state, { headers: corsHeaders() });
  } catch (err) {
    if (err instanceof StateHttpError) {
      return Response.json({ error: err.message }, { status: err.status, headers: corsHeaders() });
    }
    console.error("resync failed", err);
    return Response.json({ error: "internal error" }, { status: 500, headers: corsHeaders() });
  }
}

// Games list for the home live strip. Same CORS posture as resync.
async function handleGamesGet(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  if (url.pathname !== "/games") return null;
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...corsHeaders(), "Access-Control-Allow-Methods": "GET, OPTIONS" },
    });
  }
  if (req.method !== "GET") return null;
  try {
    const status = parseStatus(url.searchParams.get("status"));
    const body = await listGames(drizzleGamesDb(db()), status);
    return Response.json(body, { headers: corsHeaders() });
  } catch (err) {
    if (err instanceof GamesHttpError) {
      return Response.json({ error: err.message }, { status: err.status, headers: corsHeaders() });
    }
    console.error("games list failed", err);
    return Response.json({ error: "internal error" }, { status: 500, headers: corsHeaders() });
  }
}

// Rounds starting soon, from Lichess's broadcast list (cached 5 minutes).
const upcoming = new UpcomingCache(nodeHttp);

async function handleUpcomingGet(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  if (url.pathname !== "/upcoming" || req.method !== "GET") return null;
  try {
    return Response.json({ rounds: await upcoming.get() }, { headers: corsHeaders() });
  } catch (err) {
    console.error("upcoming failed", err);
    return Response.json({ error: "upcoming unavailable" }, { status: 502, headers: corsHeaders() });
  }
}

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
  async fetch(req, server) {
    const state = (await handleStateGet(req)) ?? (await handleGamesGet(req)) ?? (await handleUpcomingGet(req));
    if (state) return state;
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
