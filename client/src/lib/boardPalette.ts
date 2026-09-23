// Board colors (issue #19). Every game gets one of these, picked from its
// id, so a game looks the same on the home strip and on its board page,
// and a page of boards gets variety without a settings screen.

export interface BoardPalette {
  name: string
  light: string
  dark: string
  // Last-move highlight on light and dark squares.
  lightHighlight: string
  darkHighlight: string
}

export const BOARD_PALETTES: readonly BoardPalette[] = [
  { name: "Deep Sea", light: "#DDE9EC", dark: "#3F7F95", lightHighlight: "#D8F08E", darkHighlight: "#8FC35E" },
  { name: "Violet Hour", light: "#E6E3F2", dark: "#6E6AA8", lightHighlight: "#DDF08E", darkHighlight: "#9CB860" },
  { name: "Slate & Sand", light: "#EAE3D2", dark: "#5A6A86", lightHighlight: "#E4F08A", darkHighlight: "#9DB25A" },
  { name: "Aurora", light: "#DCEBE3", dark: "#3E7A66", lightHighlight: "#E0F28E", darkHighlight: "#93BF5C" },
  { name: "Steel Lime", light: "#E3E8E1", dark: "#56645A", lightHighlight: "#D5F07A", darkHighlight: "#9DBE45" },
  { name: "Ice", light: "#DCE2EC", dark: "#7186A8", lightHighlight: "#D6EE8A", darkHighlight: "#A4C35A" },
]

// Small stable string hash (FNV-1a). Stable across reloads and devices,
// which is the point: the same game always gets the same board.
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function paletteFor(gameId: string): BoardPalette {
  return BOARD_PALETTES[hash(gameId) % BOARD_PALETTES.length]
}
