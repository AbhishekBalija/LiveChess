import type { GameStateResponse } from "@/types"

// Placeholder content until #8 wires live data. Ids are well-formed
// UUIDs so they can be pasted straight into GET /games/:id/state later.

export interface PlaceholderGame {
  id: string
  white: string
  black: string
  event: string
}

export const placeholderGames: PlaceholderGame[] = [
  {
    id: "123e4567-e89b-12d3-a456-426614174000",
    white: "Carlsen, Magnus",
    black: "Nepomniachtchi, Ian",
    event: "Test Open · Round 1",
  },
  {
    id: "123e4567-e89b-12d3-a456-426614174001",
    white: "Ju, Wenjun",
    black: "Tan, Zhongyi",
    event: "Test Open · Round 1",
  },
  {
    id: "123e4567-e89b-12d3-a456-426614174002",
    white: "Gukesh, D",
    black: "Erigaisi, Arjun",
    event: "Test Open · Round 2",
  },
]

export const mockGameState: GameStateResponse = {
  gameId: "123e4567-e89b-12d3-a456-426614174000",
  version: 42,
  fen: "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
  lastMove: { ply: 23, san: "Nf3" },
  missedMoves: [],
}
