// Pure Move Handler core. No Postgres, no Redis imports here by design:
// the caller persists the returned move row plus outbox row in one
// transaction (ADR 0003: this module never touches Redis).

export interface StoredMove {
  ply: number;
  san: string;
  fen: string;
  clock: string | null;
  superseded: boolean;
  source: string;
}

export interface GameState {
  version: number;
  moves: Map<number, StoredMove>;
}

export interface IngestInput {
  ply: number;
  san: string;
  fen: string;
  clock: string | null;
  source: string;
}

export interface OutboxRow {
  eventType: "MoveReceived" | "GameCorrected" | "GameTruncated" | "GameResult";
  payload: Record<string, unknown>;
}

export type IngestOutcome =
  | { outcome: "duplicate-noop" }
  | {
      outcome: "inserted";
      version: number;
      move: StoredMove;
      outbox: OutboxRow;
    }
  | {
      outcome: "correction";
      version: number;
      move: StoredMove;
      outbox: OutboxRow;
    };

export function emptyGame(): GameState {
  return { version: 0, moves: new Map() };
}

export function applyMoveReceived(
  state: GameState,
  input: IngestInput,
): IngestOutcome {
  const existing = state.moves.get(input.ply);
  if (existing && !existing.superseded && existing.san === input.san) {
    return { outcome: "duplicate-noop" };
  }
  if (existing && existing.san !== input.san) {
    existing.superseded = true;
    const version = state.version + 1;
    state.version = version;
    const move: StoredMove = {
      ply: input.ply,
      san: input.san,
      fen: input.fen,
      clock: input.clock,
      superseded: false,
      source: input.source,
    };
    state.moves.set(input.ply, move);
    return {
      outcome: "correction",
      version,
      move,
      outbox: {
        eventType: "GameCorrected",
        payload: {
          ply: input.ply,
          oldSan: existing.san,
          newSan: input.san,
          fen: input.fen,
          clock: input.clock,
          version,
        },
      },
    };
  }
  const version = state.version + 1;
  state.version = version;
  const move: StoredMove = {
    ply: input.ply,
    san: input.san,
    fen: input.fen,
    clock: input.clock,
    superseded: false,
    source: input.source,
  };
  state.moves.set(input.ply, move);
  return {
    outcome: "inserted",
    version,
    move,
    outbox: {
      eventType: "MoveReceived",
      payload: {
        ply: input.ply,
        san: input.san,
        fen: input.fen,
        clock: input.clock,
        version,
      },
    },
  };
}

// Takebacks (ADR 0004). Broadcast PGNs get fixed after the fact: a wrong
// move at ply N is replaced and everything after it disappears, or the
// PGN simply gets shorter. Every stored ply after the first changed ply
// was derived from the old line, so it must go.

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export interface TruncateOutcome {
  outcome: "truncated";
  version: number;
  // New last ply after the truncation; 0 means back to the start position.
  toPly: number;
  fen: string;
  lastSan: string;
  outbox: OutboxRow;
}

function lastLivePly(state: GameState): number {
  let last = 0;
  for (const [ply, move] of state.moves) {
    if (!move.superseded && ply > last) last = ply;
  }
  return last;
}

// Decide whether the incoming PGN needs a truncation first, and to which
// ply. Returns null when the normal per-ply path is enough.
// - First ply whose SAN differs, with stored plies after it: truncate to
//   that ply (the ply itself is then fixed by the normal correction path).
// - Same moves but the PGN is shorter: truncate to the PGN's length.
export function planTruncation(
  state: GameState,
  incoming: Array<{ ply: number; san: string }>,
): number | null {
  const stored = lastLivePly(state);
  if (stored === 0) return null;
  const byPly = new Map(incoming.map((m) => [m.ply, m.san]));
  for (let ply = 1; ply <= Math.min(stored, incoming.length); ply++) {
    const current = state.moves.get(ply);
    if (current && byPly.get(ply) !== current.san) {
      return stored > ply ? ply : null;
    }
  }
  return incoming.length < stored ? incoming.length : null;
}

// Drop every ply after toPly and rewind the position to it. Version bumps
// once, so clients see exactly one event for the whole truncation.
export function applyTruncate(state: GameState, toPly: number): TruncateOutcome {
  for (const ply of [...state.moves.keys()]) {
    if (ply > toPly) state.moves.delete(ply);
  }
  const version = state.version + 1;
  state.version = version;
  const at = state.moves.get(toPly);
  const fen = at?.fen ?? START_FEN;
  return {
    outcome: "truncated",
    version,
    toPly,
    fen,
    lastSan: at?.san ?? "",
    outbox: {
      eventType: "GameTruncated",
      payload: { ply: toPly, fen, version },
    },
  };
}

export interface ResultOutcome {
  outcome: "result";
  version: number;
  result: string;
  // Position the game ended in, for the cache checkpoint.
  lastPly: number;
  fen: string;
  lastSan: string;
  outbox: OutboxRow;
}

// The source's Result changed (usually "*" to a score when the game
// ends). Bumps Version like any other change so clients learn about it
// live and in order. Null when the Result is unchanged.
export function applyResultChange(
  state: GameState,
  stored: string,
  incoming: string,
): ResultOutcome | null {
  if (incoming === stored) return null;
  const version = state.version + 1;
  state.version = version;
  const lastPly = lastLivePly(state);
  const at = state.moves.get(lastPly);
  const fen = at?.fen ?? START_FEN;
  return {
    outcome: "result",
    version,
    result: incoming,
    lastPly,
    fen,
    lastSan: at?.san ?? "",
    outbox: {
      eventType: "GameResult",
      payload: { ply: lastPly, fen, version, result: incoming },
    },
  };
}
