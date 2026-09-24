import { describe, expect, it } from "vitest"
import type { RoundInfo } from "@/types"
import { roundPhase, STARTING_GRACE_MS } from "./round"

const start = Date.parse("2026-09-24T13:00:00Z")
const info = (over: Partial<RoundInfo> = {}): RoundInfo => ({
  roundId: "1eg9tNMk",
  tournament: "Club Open",
  round: "Round 5",
  startsAt: new Date(start).toISOString(),
  ongoing: false,
  finished: false,
  format: null,
  timeControl: null,
  location: null,
  url: "",
  pairings: [],
  ...over,
})

describe("roundPhase", () => {
  it("shows boards whenever we have games", () => {
    expect(roundPhase(info({ finished: true }), 3, start)).toBe("live")
  })

  it("counts down before the start, then waits a little for the supervisor", () => {
    expect(roundPhase(info(), 0, start - 60_000)).toBe("upcoming")
    expect(roundPhase(info({ ongoing: true }), 0, start + 60_000)).toBe("starting")
    // A late start: Lichess does not call it ongoing yet, so never claim
    // it is being played without us.
    expect(roundPhase(info(), 0, start + 3_600_000)).toBe("starting")
  })

  it("says so when Lichess plays it but we do not follow it, or it is over", () => {
    expect(roundPhase(info({ ongoing: true }), 0, start + STARTING_GRACE_MS + 1)).toBe("uncovered")
    expect(roundPhase(info({ finished: true }), 0, start + 5 * 3_600_000)).toBe("finished")
  })
})
