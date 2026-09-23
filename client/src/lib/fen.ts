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

// One filled set for both sides; the component colors them. The
// outline set read poorly on light squares.
const GLYPHS: Record<string, string> = {
  K: "♚",
  Q: "♛",
  R: "♜",
  B: "♝",
  N: "♞",
  P: "♟",
}

export function pieceGlyph(piece: string): { glyph: string; side: "white" | "black" } {
  const side = piece === piece.toUpperCase() ? "white" : "black"
  return { glyph: GLYPHS[piece.toUpperCase()] ?? "?", side }
}

// Squares whose contents differ between two positions: the last move's
// from/to (four squares for castling, three for en passant). SAN alone
// does not name the from-square, so diffing FENs is the cheap route.
export function changedSquares(before: string, after: string): Set<string> {
  const a = fenToBoard(before)
  const b = fenToBoard(after)
  const out = new Set<string>()
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      if (a[r]?.[f] !== b[r]?.[f]) out.add(`${"abcdefgh"[f]}${8 - r}`)
    }
  }
  return out
}

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
