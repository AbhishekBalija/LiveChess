import { describe, expect, it } from "vitest"
import { START_FEN } from "./fen"
import { slidesBetween } from "./moveAnimation"

describe("slidesBetween", () => {
  it("slides a normal move back to its origin", () => {
    const afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    expect(slidesBetween(START_FEN, afterE4)).toEqual(new Map([["e4", { dx: 0, dy: 2 }]]))
  })

  it("slides both king and rook when castling", () => {
    const before = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"
    const after = "r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1"
    expect(slidesBetween(before, after)).toEqual(
      new Map([
        ["f1", { dx: 2, dy: 0 }],
        ["g1", { dx: -2, dy: 0 }],
      ]),
    )
  })

  it("slides a capture onto the taken piece's square", () => {
    const before = "4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1"
    const after = "4k3/8/8/3P4/8/8/8/4K3 b - - 0 1"
    expect(slidesBetween(before, after)).toEqual(new Map([["d5", { dx: 1, dy: 1 }]]))
  })

  it("slides the pawn into a promotion", () => {
    const before = "4k3/2P5/8/8/8/8/8/4K3 w - - 0 1"
    const after = "2Q1k3/8/8/8/8/8/8/4K3 b - - 0 1"
    expect(slidesBetween(before, after)).toEqual(new Map([["c8", { dx: 0, dy: 1 }]]))
  })

  it("does not animate a jump of several moves", () => {
    const later = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"
    expect(slidesBetween(START_FEN, later).size).toBe(0)
  })
})
