// Ply helpers. A Ply is the half-move index incrementing on every move;
// move number and side to move are always derived, never stored
// (CONTEXT.md).

export type Side = "white" | "black"

/** Full-move count for display, derived as ceil(ply / 2). */
export function moveNumber(ply: number): number {
  return Math.ceil(ply / 2)
}

/** Color to move at a ply: white when ply is odd, black when even. */
export function sideToMove(ply: number): Side {
  return ply % 2 === 1 ? "white" : "black"
}

/** "24. Rg4" for White's move, "24... Bd3" for Black's. */
export function formatMove(ply: number, san: string): string {
  const n = moveNumber(ply)
  return sideToMove(ply) === "white" ? `${n}. ${san}` : `${n}... ${san}`
}
