import type { EvalRow, GameStateResponse } from "@/types"

// Pure live-board state. Version is the only ordering authority: the
// client applies events and resync snapshots, and never guesses or
// patches locally (a gap always means resync, same rule as the server).

// Eval from White's side: centipawns, or mate in N (+ White mates,
// - Black mates, 0 the side to move is checkmated).
export interface MoveEval {
  cp: number | null
  mate: number | null
}

export interface LiveMove {
  ply: number
  san: string
  fen: string
  // Mover's remaining time after this move, when the source has it.
  clock: string | null
  version: number
  // Set once the server's eval worker has analyzed the position.
  eval?: MoveEval
}

export interface GameState {
  version: number
  fen: string
  lastPly: number
  moves: Map<number, LiveMove>
  white?: string
  black?: string
  tournament?: string
  result?: string
  // When the last move landed (ms), so the side to move's clock can run.
  lastMoveAt: number | null
}

// Parsed server push. The gateway sends every value as a string;
// numbers are parsed once at the boundary (parseLiveEvent).
export interface LiveEvent {
  type: string
  gameId: string
  ply: number
  san: string
  fen: string
  clock: string | null
  version: number
  // Only on GameResult events.
  result: string | null
  // Only on EvalUpdated events.
  eval: MoveEval | null
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
  // A takeback can rewind all the way to the start position (ply 0), and
  // a game can end without a move (forfeit).
  const minPly = r["type"] === "GameTruncated" || r["type"] === "GameResult" ? 0 : 1
  if (!Number.isInteger(ply) || ply < minPly) return null
  if (!Number.isInteger(version) || version < 1) return null
  if (typeof r["san"] !== "string" || typeof r["fen"] !== "string") return null
  return {
    type: typeof r["type"] === "string" ? r["type"] : "",
    gameId,
    ply,
    san: r["san"],
    fen: r["fen"],
    clock: typeof r["clock"] === "string" && r["clock"] !== "" ? r["clock"] : null,
    version,
    result: typeof r["result"] === "string" && r["result"] !== "" ? r["result"] : null,
    eval: parseEval(r["evalCp"], r["evalMate"]),
  }
}

function parseEval(rawCp: unknown, rawMate: unknown): MoveEval | null {
  const num = (raw: unknown): number | null =>
    typeof raw === "string" && raw !== "" && Number.isInteger(Number(raw)) ? Number(raw) : null
  const cp = num(rawCp)
  const mate = num(rawMate)
  return cp === null && mate === null ? null : { cp, mate }
}

// Attach evals to the moves they were computed for. An eval for an older
// version of a ply (since corrected) is ignored.
function withEvals(moves: Map<number, LiveMove>, evals: EvalRow[] = []): Map<number, LiveMove> {
  for (const e of evals) {
    const move = moves.get(e.ply)
    if (move && move.version === e.version) moves.set(e.ply, { ...move, eval: { cp: e.cp, mate: e.mate } })
  }
  return moves
}

// Full snapshot (GET since_version=0): missedMoves carry the whole live
// history, so the map is rebuilt from them directly.
export function fromSnapshot(res: GameStateResponse): GameState {
  const moves = new Map<number, LiveMove>()
  for (const m of res.missedMoves) moves.set(m.ply, { ...m })
  withEvals(moves, res.evals)
  return {
    version: res.version,
    fen: res.fen,
    lastPly: res.lastMove?.ply ?? 0,
    moves,
    white: res.white,
    black: res.black,
    tournament: res.tournament,
    result: res.result,
    lastMoveAt: res.updatedAt ? Date.parse(res.updatedAt) : null,
  }
}

// Incremental snapshot (GET since_version=N): merge missed moves by ply,
// a later version replacing an earlier one at the same ply, then take
// version, position, and last move from the response. A snapshot older
// than current state is stale (overlapping resyncs) and ignored outright,
// so it can never regress version or position.
export function applyResync(state: GameState, res: GameStateResponse): GameState {
  if (res.version < state.version) return state
  const moves = new Map(state.moves)
  for (const m of res.missedMoves) {
    const prev = moves.get(m.ply)
    if (!prev || m.version > prev.version) moves.set(m.ply, { ...m })
  }
  // Plies past the server's last ply were taken back while we were away
  // (ADR 0004); missed moves only carry live rows, so trim them here.
  const lastPly = res.lastMove?.ply ?? 0
  for (const ply of [...moves.keys()]) {
    if (ply > lastPly) moves.delete(ply)
  }
  withEvals(moves, res.evals)
  return {
    version: res.version,
    fen: res.fen,
    lastPly,
    moves,
    // Fast-path resyncs omit names; keep the ones we already have.
    white: res.white ?? state.white,
    black: res.black ?? state.black,
    tournament: res.tournament ?? state.tournament,
    result: res.result ?? state.result,
    lastMoveAt: res.updatedAt ? Date.parse(res.updatedAt) : state.lastMoveAt,
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
export function applyEvent(state: GameState, ev: LiveEvent, now = Date.now()): EventOutcome {
  // Evals do not bump Version (ADR 0006): here ev.version is the move
  // row's Version, and the eval only lands on that exact move.
  if (ev.type === "EvalUpdated") {
    const move = state.moves.get(ev.ply)
    if (!move || move.version !== ev.version || !ev.eval) return { state }
    const moves = new Map(state.moves)
    moves.set(ev.ply, { ...move, eval: ev.eval })
    return { state: { ...state, moves } }
  }
  if (ev.version <= state.version) return { state }
  if (ev.version > state.version + 1) return { resync: true }
  // The game's Result changed (usually it ended). No move, no new position.
  if (ev.type === "GameResult") {
    return { state: { ...state, version: ev.version, result: ev.result ?? state.result } }
  }
  // Takeback (ADR 0004): drop every ply after ev.ply and rewind the board.
  if (ev.type === "GameTruncated") {
    const kept = new Map([...state.moves].filter(([ply]) => ply <= ev.ply))
    return { state: { ...state, version: ev.version, fen: ev.fen, lastPly: ev.ply, moves: kept, lastMoveAt: now } }
  }
  const moves = new Map(state.moves)
  moves.set(ev.ply, { ply: ev.ply, san: ev.san, fen: ev.fen, clock: ev.clock, version: ev.version })
  const advanced = ev.ply >= state.lastPly
  return {
    state: {
      ...state,
      lastMoveAt: now,
      version: ev.version,
      fen: advanced ? ev.fen : state.fen,
      lastPly: advanced ? ev.ply : state.lastPly,
      moves,
    },
  }
}

// Each side's clock is on its own latest move: odd plies are White's.
export function clocksOf(state: GameState): { white: string | null; black: string | null } {
  let white: string | null = null
  let black: string | null = null
  for (let ply = state.lastPly; ply >= 1 && (white === null || black === null); ply--) {
    const move = state.moves.get(ply)
    if (!move?.clock) continue
    if (ply % 2 === 1) white ??= move.clock
    else black ??= move.clock
  }
  return { white, black }
}
