import { describe, expect, it } from "vitest"
import { barPercent, evalWords, formatEval, whiteWinPercent } from "./eval"

describe("formatEval", () => {
  it("shows pawns with one decimal from White's side", () => {
    expect(formatEval({ cp: 35, mate: null })).toBe("+0.4")
    expect(formatEval({ cp: -130, mate: null })).toBe("-1.3")
    expect(formatEval({ cp: 0, mate: null })).toBe("0.0")
    expect(formatEval({ cp: -4, mate: null })).toBe("0.0")
  })

  it("shows mates and proven endgame wins", () => {
    expect(formatEval({ cp: null, mate: 3 })).toBe("#3")
    expect(formatEval({ cp: null, mate: -2 })).toBe("#-2")
    expect(formatEval({ cp: null, mate: 0 })).toBe("#")
    expect(formatEval({ cp: 20_000, mate: null })).toBe("White wins")
    expect(formatEval({ cp: -20_000, mate: null })).toBe("Black wins")
  })
})

describe("whiteWinPercent", () => {
  it("is 50 when level and grows with White's advantage", () => {
    expect(whiteWinPercent({ cp: 0, mate: null }, "white")).toBe(50)
    expect(whiteWinPercent({ cp: 100, mate: null }, "white")).toBeCloseTo(59.1, 1)
    expect(whiteWinPercent({ cp: -100, mate: null }, "white")).toBeCloseTo(40.9, 1)
  })

  it("clamps big scores and fills the bar for mates", () => {
    expect(whiteWinPercent({ cp: 5000, mate: null }, "white")).toBe(whiteWinPercent({ cp: 1000, mate: null }, "white"))
    expect(whiteWinPercent({ cp: 20_000, mate: null }, "white")).toBe(100)
    expect(whiteWinPercent({ cp: null, mate: 4 }, "black")).toBe(100)
    expect(whiteWinPercent({ cp: null, mate: -1 }, "white")).toBe(0)
    // Checkmate on the board: the side to move lost.
    expect(whiteWinPercent({ cp: null, mate: 0 }, "black")).toBe(100)
  })
})

describe("barPercent", () => {
  it("shows the result once the game is over, else the eval, else level", () => {
    expect(barPercent("0-1", { cp: 300, mate: null }, 40)).toBe(0)
    expect(barPercent("1/2-1/2", null, 40)).toBe(50)
    expect(barPercent("*", { cp: null, mate: 2 }, 40)).toBe(100)
    expect(barPercent("*", null, 40)).toBe(50)
  })
})

describe("evalWords", () => {
  it("reads the eval like a commentator would", () => {
    expect(evalWords({ cp: 20, mate: null })).toBe("Equal")
    expect(evalWords({ cp: -90, mate: null })).toBe("Black is slightly better")
    expect(evalWords({ cp: 200, mate: null })).toBe("White is better")
    expect(evalWords({ cp: -450, mate: null })).toBe("Black is winning")
    expect(evalWords({ cp: null, mate: 3 })).toBe("White mates in 3")
    expect(evalWords({ cp: null, mate: -1 })).toBe("Black mates in 1")
    expect(evalWords({ cp: null, mate: 0 })).toBe("Checkmate")
  })
})
