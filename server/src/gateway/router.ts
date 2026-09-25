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
  bestReply: string;
  sacrifice: string;
  secondCp: string;
  secondMate: string;
}

export interface Socket {
  send(message: string): void;
}

export class Router {
  // Connection identity to its game subscriptions. Lifetime is the
  // process lifetime; a restart empties it and clients resync.
  private subs = new Map<object, Set<string>>();
  // The same subscriptions by game, so an event only touches the sockets
  // watching that game instead of every connection (#32).
  private watchers = new Map<string, Set<object>>();

  subscribe(conn: object, gameId: string): void {
    const games = this.subs.get(conn) ?? new Set<string>();
    games.add(gameId);
    this.subs.set(conn, games);
    const conns = this.watchers.get(gameId) ?? new Set<object>();
    conns.add(conn);
    this.watchers.set(gameId, conns);
  }

  unsubscribeAll(conn: object): void {
    for (const gameId of this.subs.get(conn) ?? []) {
      const conns = this.watchers.get(gameId);
      conns?.delete(conn);
      if (conns?.size === 0) this.watchers.delete(gameId);
    }
    this.subs.delete(conn);
  }

  // Games that someone has open right now.
  watchedGames(): Set<string> {
    return new Set(this.watchers.keys());
  }

  connectionCount(): number {
    return this.subs.size;
  }

  // Targeted fan-out only. A socket gets the event iff it subscribed
  // to that game. No broadcast-everything, no catch-up from memory:
  // the router stores subscriptions, never events.
  fanout(event: LiveEvent, send: (conn: object, message: string) => void): number {
    const conns = this.watchers.get(event.gameId);
    if (!conns) return 0;
    const message = JSON.stringify(event);
    for (const conn of conns) send(conn, message);
    return conns.size;
  }
}
