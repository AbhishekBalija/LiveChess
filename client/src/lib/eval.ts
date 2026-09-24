import type { GameState, MoveEval } from "./game"
import { sideToMove } from "./ply"

// Matches the server's TABLEBASE_WIN_CP: a tablebase-proven win.
const TABLEBASE_WIN_CP = 20_000

// Eval as chess players read it, from White's side: "+0.4", "-1.3",
// "#3" (White mates in 3), "#-2" (Black mates in 2), "#" (checkmate on
// the board), and a proven endgame win spelled out.
export function formatEval(e: MoveEval): string {
  if (e.mate !== null) return e.mate === 0 ? "#" : `#${e.mate}`
  const cp = e.cp ?? 0
  if (cp >= TABLEBASE_WIN_CP) return "White wins"
  if (cp <= -TABLEBASE_WIN_CP) return "Black wins"
  // Round in whole tenths of a pawn, the same way for both sides
  // (toFixed would turn 35 into "0.3" because of floating point).
  const tenths = Math.round(Math.abs(cp) / 10)
  if (tenths === 0) return "0.0"
  const pawns = (tenths / 10).toFixed(1)
  return cp > 0 ? `+${pawns}` : `-${pawns}`
}

// Eval of the position on the board right now, once the worker has it.
export function currentEval(state: GameState): MoveEval | null {
  return state.moves.get(state.lastPly)?.eval ?? null
}

// White's share of the eval bar, 0 to 100. Centipawns go through the same
// curve Lichess uses for its bar (a logistic curve, clamped at +-10 pawns),
// so +1 pawn is about 59%. Mate and tablebase wins fill the bar; mate 0 means the side to
// move on the board is checkmated.
export function whiteWinPercent(e: MoveEval, fenSideToMove: "white" | "black"): number {
  if (e.mate !== null) {
    if (e.mate === 0) return fenSideToMove === "white" ? 0 : 100
    return e.mate > 0 ? 100 : 0
  }
  // A tablebase-proven result is certain, not just "a lot".
  if ((e.cp ?? 0) >= TABLEBASE_WIN_CP) return 100
  if ((e.cp ?? 0) <= -TABLEBASE_WIN_CP) return 0
  const cp = Math.max(-1000, Math.min(1000, e.cp ?? 0))
  const chances = 2 / (1 + Math.exp(-0.00368208 * cp)) - 1
  return 50 + 50 * chances
}

// What a bar shows right now: the result once the game is over,
// otherwise the current eval, otherwise an even 50 while waiting.
export function barPercent(result: string | undefined, e: MoveEval | null, lastPly: number): number {
  if (result === "1-0") return 100
  if (result === "0-1") return 0
  if (result === "1/2-1/2") return 50
  return e ? whiteWinPercent(e, sideToMove(lastPly + 1)) : 50
}

// Eval from a games-list row (home cards), null until analyzed.
export function listEval(row: { evalCp: number | null; evalMate: number | null }): MoveEval | null {
  return row.evalCp === null && row.evalMate === null ? null : { cp: row.evalCp, mate: row.evalMate }
}
