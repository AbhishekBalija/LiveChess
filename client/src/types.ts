// Mirrors the server's GameStateResponse from GET /games/:id/state
// (server/src/api/state.ts). #8 will reuse this for live data.

export interface LastMove {
  ply: number
  san: string
}

export interface MissedMove {
  ply: number
  san: string
  fen: string
  clock: string | null
  version: number
}

// Stored eval of one move, from White's side (server EvalRow, ADR 0006).
export interface EvalRow {
  ply: number
  // The move row's Version: only attach the eval to that exact move.
  version: number
  cp: number | null
  mate: number | null
}

export interface GameStateResponse {
  gameId: string
  version: number
  fen: string
  lastMove: LastMove | null
  missedMoves: MissedMove[]
  // Every stored eval on the Postgres path, only the newest on the cache path.
  evals?: EvalRow[]
  // Only on the Postgres path; a cache fast-path resync omits them.
  white?: string
  black?: string
  tournament?: string
  // Postgres path only: "*" while in progress, and when the last change landed.
  result?: string
  updatedAt?: string
}

// One row of GET /games (server/src/api/games.ts).
export interface GameListItem {
  id: string
  white: string
  black: string
  result: string
  tournament: { id: string; name: string }
  lastPly: number
  lastSan: string | null
  whiteClock: string | null
  blackClock: string | null
  fen: string
  version: number
  updatedAt: string
  // Eval of the current position from White's side, null until analyzed.
  evalCp: number | null
  evalMate: number | null
  // Lichess round id (server GameListItem.roundId).
  roundId: string | null
}

// GET /rounds/:roundId (server/src/api/round.ts).
export interface RoundPlayer {
  name: string
  rating: number | null
  title: string | null
  fed: string | null
}

export interface RoundInfo {
  roundId: string
  tournament: string
  round: string
  startsAt: string | null
  ongoing: boolean
  finished: boolean
  format: string | null
  timeControl: string | null
  location: string | null
  url: string
  pairings: Array<{ white: RoundPlayer; black: RoundPlayer }>
}

// One row of GET /upcoming (server/src/api/upcoming.ts).
export interface UpcomingRound {
  roundId: string
  tournament: string
  round: string
  startsAt: string
  url: string | null
}
