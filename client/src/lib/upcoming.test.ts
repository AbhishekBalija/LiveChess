import { describe, expect, it } from "vitest"
import { countdown, startLabel } from "./upcoming"

describe("countdown", () => {
  const now = Date.parse("2026-09-23T18:00:00Z")
  it("reads naturally at each scale", () => {
    expect(countdown("2026-09-23T18:45:00Z", now)).toBe("in 45m")
    expect(countdown("2026-09-23T21:20:00Z", now)).toBe("in 3h 20m")
    expect(countdown("2026-09-26T18:00:00Z", now)).toBe("in 3d")
  })
})

describe("startLabel", () => {
  it("says today or tomorrow in local time", () => {
    const now = new Date(2026, 8, 23, 20, 0).getTime()
    expect(startLabel(new Date(2026, 8, 23, 22, 30).toISOString(), now)).toMatch(/^Today /)
    expect(startLabel(new Date(2026, 8, 24, 15, 45).toISOString(), now)).toMatch(/^Tomorrow /)
  })
})
