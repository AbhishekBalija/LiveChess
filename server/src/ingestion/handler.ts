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
  eventType: "MoveReceived" | "GameCorrected";
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
        payload: { ply: input.ply, oldSan: existing.san, newSan: input.san, version },
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
