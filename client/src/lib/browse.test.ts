import { describe, expect, it } from "vitest"
import { clampView, stepView } from "./browse"

describe("stepView", () => {
  it("steps back from live and forward to live again", () => {
    expect(stepView(null, 10, -1)).toBe(9)
    expect(stepView(9, 10, 1)).toBeNull()
    expect(stepView(3, 10, -1)).toBe(2)
  })

  it("stops at the start position and at live", () => {
    expect(stepView(0, 10, -1)).toBe(0)
    expect(stepView(null, 10, 1)).toBeNull()
    expect(stepView(null, 0, -1)).toBeNull()
  })
})

describe("clampView", () => {
  it("follows live again when the viewed ply was taken back", () => {
    expect(clampView(8, 6)).toBeNull()
    expect(clampView(4, 6)).toBe(4)
    expect(clampView(null, 6)).toBeNull()
  })
})
