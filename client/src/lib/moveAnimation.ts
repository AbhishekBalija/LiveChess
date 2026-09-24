import { fenToBoard } from "@/lib/fen"

// Which pieces slid where between two positions, for animating a move.
// Returns, per destination square ("f5"), the offset back to where the
// piece came from, in squares (x right, y down). Castling moves two
// pieces, en passant one. Anything bigger (a new game, a resync that
// skipped moves) returns nothing: animating a jump would look wrong.

export interface Slide {
  dx: number
  dy: number
}

const FILES = "abcdefgh"

export function slidesBetween(before: string, after: string): Map<string, Slide> {
  const a = fenToBoard(before)
  const b = fenToBoard(after)
  const left: Array<{ row: number; file: number; piece: string }> = []
  const arrived: Array<{ row: number; file: number; piece: string }> = []
  for (let row = 0; row < 8; row++) {
    for (let file = 0; file < 8; file++) {
      const was = a[row]?.[file] ?? null
      const now = b[row]?.[file] ?? null
      if (was === now) continue
      if (was) left.push({ row, file, piece: was })
      if (now) arrived.push({ row, file, piece: now })
    }
  }
  const slides = new Map<string, Slide>()
  // One move changes at most 4 squares (castling). More is a jump.
  if (arrived.length === 0 || arrived.length > 2 || left.length > 3) return slides
  for (const to of arrived) {
    // A promotion arrives as a different piece than the pawn that left.
    const from =
      left.find((l) => l.piece === to.piece) ??
      left.find((l) => l.piece.toLowerCase() === "p" && (l.piece === "P") === (to.piece === to.piece.toUpperCase()))
    if (!from) continue
    slides.set(`${FILES[to.file]}${8 - to.row}`, { dx: from.file - to.file, dy: from.row - to.row })
  }
  return slides
}

// The square a move landed on, for the Move classification badge. When
// castling, that is the king's square.
export function destinationSquare(before: string, after: string): string | null {
  const squares = [...slidesBetween(before, after).keys()]
  if (squares.length <= 1) return squares[0] ?? null
  const board = fenToBoard(after)
  return (
    squares.find((sq) => {
      const piece = board[8 - Number(sq[1])]?.[FILES.indexOf(sq[0] ?? "")]
      return piece?.toLowerCase() === "k"
    }) ?? null
  )
}
