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
  version: number
}

export interface GameStateResponse {
  gameId: string
  version: number
  fen: string
  lastMove: LastMove | null
  missedMoves: MissedMove[]
  // Only on the Postgres path; a cache fast-path resync omits them.
  white?: string
  black?: string
}
