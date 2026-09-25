import { whiteWinPercent } from "./eval"
import type { LiveMove, MoveEval } from "./game"

// Move classification (CONTEXT.md, spec #69): how good a Move was, judged
// from the Evals before and after it. The rules are Lichess's, exactly
// (docs/research/move-classification.md): the mover's winning chances
// dropping 5, 10 or 15 points on a 0-100 scale, plus its mate table.
// Best is the engine's own choice from the position before the move,
// Great is a Best move that was the only good one, and Brilliant is a Best
// move that sacrifices material.

export type Classification = "brilliant" | "great" | "best" | "miss" | "inaccuracy" | "mistake" | "blunder"

// How each label looks: its name, the badge glyph, and its colour token
// (index.css).
export const CLASSIFICATION_STYLE: Record<Classification, { name: string; glyph: string; color: string }> = {
  brilliant: { name: "Brilliant", glyph: "!!", color: "var(--cls-brilliant)" },
  great: { name: "Great", glyph: "!", color: "var(--cls-great)" },
  best: { name: "Best", glyph: "★", color: "var(--cls-best)" },
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

// A Best move is Brilliant when it gives up material (checked on the
// server), leaves the mover at 50% or better, and was played from under
// 90%: a sacrifice when already completely winning is not special.
// The win% (0-100) of the player who moved at `ply`, from an eval of a
// position where `sideToMove` is to move.
function moverPercent(ply: number, e: MoveEval, sideToMove: "white" | "black"): number {
  const percent = whiteWinPercent(e, sideToMove)
  return ply % 2 === 1 ? percent : 100 - percent
}

function sides(ply: number) {
  const white = ply % 2 === 1
  return { mover: white ? "white" : "black", opponent: white ? "black" : "white" } as const
}

function isBrilliant(moves: Map<number, LiveMove>, ply: number): boolean {
  const move = moves.get(ply)
  const before = moves.get(ply - 1)?.eval
  if (!move?.sacrifice || !move.eval || !before) return false
  // Before the move the mover is to move; after it, the opponent is.
  const { mover, opponent } = sides(ply)
  return moverPercent(ply, before, mover) < 90 && moverPercent(ply, move.eval, opponent) >= 50
}

// A Best move is Great when it was the only good one: the best of the
// other moves (searched by the server) would have cost at least 10 win%
// points. Both scores are for the position before the move.
// Two guards keep it rare (docs/research/move-classification.md): taking
// back material right after the opponent took some is the obvious move,
// not a find, and an only move that still leaves the mover worse off did
// not save anything.
function isGreat(moves: Map<number, LiveMove>, ply: number): boolean {
  const move = moves.get(ply)
  const before = moves.get(ply - 1)
  if (!move?.eval || !before?.eval || !before.second) return false
  if (move.san.includes("x") && before.san.includes("x")) return false
  const { mover, opponent } = sides(ply)
  if (moverPercent(ply, move.eval, opponent) < 50) return false
  return moverPercent(ply, before.eval, mover) - moverPercent(ply, before.second, mover) >= 10
}

const isError = (label: Classification | null) => label === "mistake" || label === "blunder"

// The Move classification of the move at `ply`, or null when it gets no
// label (a fine move, or its Evals are not in yet).
export function classifyMove(moves: Map<number, LiveMove>, ply: number): Classification | null {
  const label = labelAt(moves, ply)
  // Failing to punish the opponent's mistake or blunder is a Miss.
  if (isError(label) && isError(labelAt(moves, ply - 1))) return "miss"
  // A bad label wins over Best. That should not happen (the engine's own
  // move losing ground), but the order keeps it defined.
  if (label) return label
  const best = moves.get(ply - 1)?.bestReply
  if (best === undefined || best !== moves.get(ply)?.san) return null
  if (isBrilliant(moves, ply)) return "brilliant"
  return isGreat(moves, ply) ? "great" : "best"
}
