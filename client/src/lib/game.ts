import type { GameStateResponse } from "@/types"

// Pure live-board state. Version is the only ordering authority: the
// client applies events and resync snapshots, and never guesses or
// patches locally (a gap always means resync, same rule as the server).

export interface LiveMove {
  ply: number
  san: string
  fen: string
  version: number
}

export interface GameState {
  version: number
  fen: string
  lastPly: number
  moves: Map<number, LiveMove>
}

// Parsed server push. The gateway sends every value as a string;
// numbers are parsed once at the boundary (parseLiveEvent).
export interface LiveEvent {
  type: string
  gameId: string
  ply: number
  san: string
  fen: string
  version: number
}

// Parse one raw WebSocket message for this game. Null when the payload
// is not a usable event (wrong game, non-integer ply/version, missing
// SAN/FEN); the caller drops it without touching state.
export function parseLiveEvent(gameId: string, raw: unknown): LiveEvent | null {
  if (typeof raw !== "object" || raw === null) return null
  const r = raw as Record<string, unknown>
  if (r["gameId"] !== gameId) return null
  const ply = Number(r["ply"])
  const version = Number(r["version"])
  if (!Number.isInteger(ply) || ply < 1) return null
  if (!Number.isInteger(version) || version < 1) return null
  if (typeof r["san"] !== "string" || typeof r["fen"] !== "string") return null
  return {
    type: typeof r["type"] === "string" ? r["type"] : "",
    gameId,
    ply,
    san: r["san"],
    fen: r["fen"],
    version,
  }
}

// Full snapshot (GET since_version=0): missedMoves carry the whole live
// history, so the map is rebuilt from them directly.
export function fromSnapshot(res: GameStateResponse): GameState {
  const moves = new Map<number, LiveMove>()
  for (const m of res.missedMoves) moves.set(m.ply, { ...m })
  return {
    version: res.version,
    fen: res.fen,
    lastPly: res.lastMove?.ply ?? 0,
    moves,
  }
}

// Incremental snapshot (GET since_version=N): merge missed moves by ply,
// a later version replacing an earlier one at the same ply, then take
// version, position, and last move from the response.
export function applyResync(state: GameState, res: GameStateResponse): GameState {
  const moves = new Map(state.moves)
  for (const m of res.missedMoves) {
    const prev = moves.get(m.ply)
    if (!prev || m.version > prev.version) moves.set(m.ply, { ...m })
  }
  return {
    version: res.version,
    fen: res.fen,
    lastPly: res.lastMove?.ply ?? state.lastPly,
    moves,
  }
}

export type EventOutcome = { state: GameState } | { resync: true }

// Fold one live event into state:
// - version behind or equal: duplicate/redelivery, ignore, same reference
// - exactly next version: apply; a correction replaces the SAN at its ply
//   while every other ply is untouched, and the board only advances when
//   the ply reaches past the current lastPly (old-ply fixes must not
//   rewind the position, same rule as the server)
// - anything newer: gap, the caller must resync instead of guessing
export function applyEvent(state: GameState, ev: LiveEvent): EventOutcome {
  if (ev.version <= state.version) return { state }
  if (ev.version > state.version + 1) return { resync: true }
  const moves = new Map(state.moves)
  moves.set(ev.ply, { ply: ev.ply, san: ev.san, fen: ev.fen, version: ev.version })
  const advanced = ev.ply >= state.lastPly
  return {
    state: {
      version: ev.version,
      fen: advanced ? ev.fen : state.fen,
      lastPly: advanced ? ev.ply : state.lastPly,
      moves,
    },
  }
}
