import { describe, expect, it } from "vitest"
import { moveNumber, sideToMove } from "./ply"

describe("moveNumber", () => {
  it("derives the full-move count as ceil(ply / 2)", () => {
    expect(moveNumber(1)).toBe(1)
    expect(moveNumber(2)).toBe(1)
    expect(moveNumber(23)).toBe(12)
    expect(moveNumber(24)).toBe(12)
  })
})

describe("sideToMove", () => {
  it("is white on odd plies and black on even plies", () => {
    expect(sideToMove(1)).toBe("white")
    expect(sideToMove(23)).toBe("white")
    expect(sideToMove(2)).toBe("black")
    expect(sideToMove(24)).toBe("black")
  })
})
