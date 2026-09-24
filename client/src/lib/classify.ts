import type { LiveMove, MoveEval } from "./game"

// Move classification (CONTEXT.md, spec #69): how good a Move was, judged
// from the Evals before and after it. The rules are Lichess's, exactly
// (docs/research/move-classification.md): the mover's winning chances
// dropping 5, 10 or 15 points on a 0-100 scale, plus its mate table.

export type Classification = "miss" | "inaccuracy" | "mistake" | "blunder"

// How each label looks: its name, the badge glyph, and its colour token
// (index.css).
export const CLASSIFICATION_STYLE: Record<Classification, { name: string; glyph: string; color: string }> = {
  miss: { name: "Miss", glyph: "×", color: "var(--cls-miss)" },
  inaccuracy: { name: "Inaccuracy", glyph: "?!", color: "var(--cls-inaccuracy)" },
  mistake: { name: "Mistake", glyph: "?", color: "var(--cls-mistake)" },
  blunder: { name: "Blunder", glyph: "??", color: "var(--cls-blunder)" },
}

// Matches the server's TABLEBASE_WIN_CP: a tablebase-proven win.
const TABLEBASE_WIN_CP = 20_000

// Winning chances from -1 to +1, Lichess's curve (the eval bar uses the
// same one, clamped for display). Lichess's classifier does not clamp.
function winningChances(cp: number): number {
  return 2 / (1 + Math.exp(-0.00368208 * cp)) - 1
}

// Worst first, so the biggest matching label wins. Drops are on the
// -1..+1 scale; 0.1 there is 5 points on the 0-100 scale.
const DROPS: Array<[number, Classification]> = [
  [0.3, "blunder"],
  [0.2, "mistake"],
  [0.1, "inaccuracy"],
]

// The label from the evals alone, without the Miss rule. `sign` turns a
// White-side eval into the mover's side (1 for White, -1 for Black).
function baseLabel(before: MoveEval, after: MoveEval, sign: 1 | -1): Classification | null {
  const beforeCp = before.cp === null ? null : before.cp * sign
  const afterCp = after.cp === null ? null : after.cp * sign
  const beforeMate = before.mate === null ? null : before.mate * sign
  const afterMate = after.mate === null ? null : after.mate * sign

  // Mate 0 is checkmate on the board: the mover just won.
  if (after.mate === 0) return null
  if (beforeCp !== null && afterCp !== null) {
    const drop = winningChances(beforeCp) - winningChances(afterCp)
    return DROPS.find(([size]) => drop >= size)?.[1] ?? null
  }
  // Allowed the opponent a forced mate: how bad it is depends on how bad
  // things already were.
  if (beforeCp !== null && afterMate !== null && afterMate < 0) {
    if (beforeCp < -999) return "inaccuracy"
    if (beforeCp < -700) return "mistake"
    return "blunder"
  }
  // Had a forced mate and lost it. A slower mate is fine, and so is a
  // tablebase-proven win (Stockfish's mate becomes the tablebase's cp).
  if (beforeMate !== null && beforeMate > 0) {
    if (afterMate !== null && afterMate > 0) return null
    const left = afterCp ?? 0
    if (left >= TABLEBASE_WIN_CP) return null
    if (left > 999) return "inaccuracy"
    if (left > 700) return "mistake"
    return "blunder"
  }
  return null
}

function labelAt(moves: Map<number, LiveMove>, ply: number): Classification | null {
  // Ply 0 (the start position) has no stored Eval, so the first move
  // has nothing to compare with.
  const before = moves.get(ply - 1)?.eval
  const after = moves.get(ply)?.eval
  if (!before || !after) return null
  return baseLabel(before, after, ply % 2 === 1 ? 1 : -1)
}

const isError = (label: Classification | null) => label === "mistake" || label === "blunder"

// The Move classification of the move at `ply`, or null when it gets no
// label (a fine move, or its Evals are not in yet).
export function classifyMove(moves: Map<number, LiveMove>, ply: number): Classification | null {
  const label = labelAt(moves, ply)
  // Failing to punish the opponent's mistake or blunder is a Miss.
  if (isError(label) && isError(labelAt(moves, ply - 1))) return "miss"
  return label
}
