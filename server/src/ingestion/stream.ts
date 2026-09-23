// Streaming ingestion for a Lichess broadcast round (issue #20).
//
// GET /api/stream/broadcast/round/{id}.pgn sends every game's full PGN on
// connect, then the full PGN of one game each time it changes. It never
// closes on its own. Each message is a complete game, so the per-game
// ingest used by polling works unchanged, and a reconnect's initial dump
// covers anything missed while disconnected (ingest is idempotent).
//
// Limits (Lichess API): anonymous 2 streams per IP, a token raises it.
// A 429 carries no Retry-After, so we wait a full minute.

export const roundStreamUrl = (roundId: string): string =>
  `https://lichess.org/api/stream/broadcast/round/${roundId}.pgn`;

// Games are separated by a blank line pair after the result token.
// Keepalives are a lone space. Returns complete games plus the unfinished
// tail, which the caller keeps for the next chunk.
export function splitStreamBuffer(buffer: string): { games: string[]; rest: string } {
  const parts = buffer.split(/\n\n\n/);
  const rest = parts.pop() ?? "";
  const games = parts.map((p) => p.trim()).filter((p) => p.startsWith("["));
  return { games, rest };
}

// Feed text chunks in, get whole games out, in order.
export async function consumePgnStream(
  chunks: AsyncIterable<string>,
  onGame: (pgn: string) => Promise<void>,
): Promise<void> {
  let buffer = "";
  for await (const chunk of chunks) {
    buffer += chunk;
    const { games, rest } = splitStreamBuffer(buffer);
    buffer = rest;
    for (const game of games) await onGame(game);
  }
  // A final game without the trailing separator still counts.
  const tail = buffer.trim();
  if (tail.startsWith("[")) await onGame(tail);
}

// Exponential backoff with jitter, capped at a minute.
export function backoffMs(attempt: number, random = Math.random): number {
  const base = Math.min(1000 * 2 ** attempt, 60_000);
  return Math.round(base / 2 + random() * (base / 2));
}

export class StreamRateLimitedError extends Error {
  constructor() {
    super("lichess stream 429");
  }
}

export interface StreamPort {
  // Resolves with a text chunk iterator; throws StreamRateLimitedError on 429.
  open(url: string, signal: AbortSignal): Promise<AsyncIterable<string>>;
}

// Wraps a chunk iterator so it aborts when nothing (not even a keepalive)
// arrives for idleMs. Lichess sends a keepalive every 60s.
export async function* withIdleTimeout(
  chunks: AsyncIterable<string>,
  idleMs: number,
  abort: () => void,
): AsyncIterable<string> {
  let timer = setTimeout(abort, idleMs);
  try {
    for await (const chunk of chunks) {
      clearTimeout(timer);
      timer = setTimeout(abort, idleMs);
      yield chunk;
    }
  } finally {
    clearTimeout(timer);
  }
}

export const fetchStream = (userAgent: string, token?: string): StreamPort => ({
  async open(url, signal) {
    const headers: Record<string, string> = { "User-Agent": userAgent, Accept: "application/x-chess-pgn" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(url, { headers, signal });
    if (res.status === 429) throw new StreamRateLimitedError();
    if (!res.ok || !res.body) throw new Error(`round stream failed with ${res.status}`);
    const body = res.body.pipeThrough(new TextDecoderStream());
    return body as unknown as AsyncIterable<string>;
  },
});
