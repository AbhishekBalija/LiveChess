import { describe, expect, it } from "vitest"
import { splitTournamentName } from "./Home"

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
