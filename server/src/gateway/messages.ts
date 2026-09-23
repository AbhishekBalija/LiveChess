// Client -> gateway WebSocket frames. The only message is
// {"subscribe": "<game id>"}. Anything else (bad JSON, wrong shape, a
// huge string) is ignored: one bad frame must never throw inside the
// socket handler.

const GAME_ID_RE = /^[0-9a-f-]{36}$/i;

export function parseClientMessage(raw: unknown): { subscribe: string } | null {
  if (typeof raw !== "string" && !(raw instanceof Uint8Array) && !(raw instanceof ArrayBuffer)) return null;
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  if (text.length > 1024) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof msg !== "object" || msg === null) return null;
  const id = (msg as { subscribe?: unknown }).subscribe;
  return typeof id === "string" && GAME_ID_RE.test(id) ? { subscribe: id } : null;
}
