import { describe, expect, it } from "vitest"
import { resultLine, splitTournamentName, surname } from "./names"

describe("splitTournamentName", () => {
  it("splits Lichess broadcast names into title and subtitle", () => {
    expect(splitTournamentName("46th FIDE Chess Olympiad 2026 | Open | Matches 1-12")).toEqual({
      title: "46th FIDE Chess Olympiad 2026",
      subtitle: "Open · Matches 1-12",
    })
  })

  it("leaves plain names alone", () => {
    expect(splitTournamentName("Test Open")).toEqual({ title: "Test Open", subtitle: null })
  })
})

describe("surname", () => {
  it("takes the part before the comma", () => {
    expect(surname("Abdusattorov, Nodirbek")).toBe("Abdusattorov")
    expect(surname("Nihal Sarin")).toBe("Nihal Sarin")
  })
})

describe("resultLine", () => {
  it("names the winner, or calls the draw", () => {
    expect(resultLine("0-1", "Rapport, Richard", "Cheng, Bobby")).toBe("Cheng won · 0-1")
    expect(resultLine("1-0", "Rapport, Richard", "Cheng, Bobby")).toBe("Rapport won · 1-0")
    expect(resultLine("1/2-1/2", "A", "B")).toBe("Draw · ½-½")
  })
})
