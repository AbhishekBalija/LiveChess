import { describe, expect, it } from "vitest"
import { BOARD_PALETTES, paletteFor } from "./boardPalette"

describe("paletteFor", () => {
  it("always gives the same game the same board", () => {
    const id = "ec31c4e7-a37e-443a-8837-ba11b9cbd375"
    expect(paletteFor(id)).toBe(paletteFor(id))
  })

  it("spreads different games across the palettes", () => {
    const names = new Set(
      Array.from({ length: 60 }, (_, i) => paletteFor(`game-${i}`).name),
    )
    expect(names.size).toBe(BOARD_PALETTES.length)
  })
})
