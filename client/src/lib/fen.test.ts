import { describe, expect, it } from "vitest"
import { changedSquares, fenToBoard } from "./fen"

const STARTPOS = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

describe("fenToBoard", () => {
  it("maps the start position onto 8 ranks by 8 files", () => {
    const board = fenToBoard(STARTPOS)
    expect(board).toHaveLength(8)
    for (const row of board) expect(row).toHaveLength(8)
    expect(board[0]).toEqual(["r", "n", "b", "q", "k", "b", "n", "r"])
    expect(board[1]).toEqual(Array(8).fill("p"))
    expect(board[4]).toEqual(Array(8).fill(null))
    expect(board[7]).toEqual(["R", "N", "B", "Q", "K", "B", "N", "R"])
  })

  it("expands digits and ignores the trailing fields", () => {
    const board = fenToBoard("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3")
    expect(board[0]?.slice(0, 3)).toEqual(["r", null, "b"])
    expect(board[2]).toEqual([null, null, "n", null, null, null, null, null])
  })
})

describe("changedSquares", () => {
  it("returns the from and to squares of a move", () => {
    const afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    expect(changedSquares(STARTPOS, afterE4)).toEqual(new Set(["e2", "e4"]))
  })
})
