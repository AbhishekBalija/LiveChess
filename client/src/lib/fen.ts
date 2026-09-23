// Minimal FEN placement parser for the board shell. Returns ranks
// 8 to 1, files a to h; each square holds a piece letter (uppercase is
// White) or null. No chess library, glyphs only.

export type BoardSquare = string | null

export function fenToBoard(fen: string): BoardSquare[][] {
  const placement = fen.split(" ")[0] ?? ""
  const ranks = placement.split("/")
  const board: BoardSquare[][] = []
  for (let r = 0; r < 8; r++) {
    const row: BoardSquare[] = []
    for (const ch of ranks[r] ?? "") {
      if (ch >= "1" && ch <= "8") {
        for (let i = 0; i < Number(ch); i++) row.push(null)
      } else if (/^[prnbqkPRNBQK]$/.test(ch)) {
        row.push(ch)
      }
    }
    while (row.length < 8) row.push(null)
    board.push(row.slice(0, 8))
  }
  return board
}

const WHITE_GLYPHS: Record<string, string> = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
  P: "♙",
}

const BLACK_GLYPHS: Record<string, string> = {
  K: "♚",
  Q: "♛",
  R: "♜",
  B: "♝",
  N: "♞",
  P: "♟",
}

export function pieceGlyph(piece: string): { glyph: string; side: "white" | "black" } {
  const side = piece === piece.toUpperCase() ? "white" : "black"
  const table = side === "white" ? WHITE_GLYPHS : BLACK_GLYPHS
  return { glyph: table[piece.toUpperCase()] ?? "?", side }
}
