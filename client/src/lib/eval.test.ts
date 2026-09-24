import { describe, expect, it } from "vitest"
import { formatEval } from "./eval"

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
