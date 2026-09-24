// Pure subscription router. In-memory only by design: nothing here
// survives a restart, and recovery is always client resync, never
// gateway replay. Transport-agnostic so Vitest can exercise it
// without a socket server; Bun.serve wiring lives in index.ts.

export interface LiveEvent {
  type: string;
  gameId: string;
  ply: string;
  san: string;
  fen: string;
  clock: string;
  version: string;
  result: string;
  evalCp: string;
  evalMate: string;
}

export interface Socket {
  send(message: string): void;
}

export class Router {
  // Connection identity to its game subscriptions. Lifetime is the
  // process lifetime; a restart empties it and clients resync.
  private subs = new Map<object, Set<string>>();

  subscribe(conn: object, gameId: string): void {
    const set = this.subs.get(conn) ?? new Set<string>();
    set.add(gameId);
    this.subs.set(conn, set);
  }

  unsubscribeAll(conn: object): void {
    this.subs.delete(conn);
  }

  connectionCount(): number {
    return this.subs.size;
  }

  // Targeted fan-out only. A socket gets the event iff it subscribed
  // to that game. No broadcast-everything, no catch-up from memory:
  // the router stores subscriptions, never events.
  fanout(event: LiveEvent, send: (conn: object, message: string) => void): number {
    const message = JSON.stringify(event);
    let delivered = 0;
    for (const [conn, games] of this.subs) {
      if (games.has(event.gameId)) {
        send(conn, message);
        delivered += 1;
      }
    }
    return delivered;
  }
}
