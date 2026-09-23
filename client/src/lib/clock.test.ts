import { describe, expect, it } from "vitest"
import { formatClock, parseClock, runningClock } from "./clock"

describe("parseClock / formatClock", () => {
  it("round-trips hours and minutes", () => {
    expect(parseClock("1:29:10")).toBe(5350)
    expect(parseClock("29:10")).toBe(1750)
    expect(formatClock(5350)).toBe("1:29:10")
    expect(formatClock(545)).toBe("9:05")
  })

  it("rejects junk", () => {
    expect(parseClock("soon")).toBeNull()
  })
})

describe("runningClock", () => {
  const since = 1_000_000
  it("counts the side to move down from the last move", () => {
    expect(runningClock("0:01:16", true, since, since + 16_000)).toBe("1:00")
  })

  it("leaves the waiting side alone", () => {
    expect(runningClock("0:01:56", false, since, since + 16_000)).toBe("1:56")
  })

  it("stops at zero and passes through what it cannot parse", () => {
    expect(runningClock("0:00:05", true, since, since + 60_000)).toBe("0:00")
    expect(runningClock("?", true, since, since + 1000)).toBe("?")
    expect(runningClock(null, true, since, since)).toBeNull()
  })
})
