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

// How many plies back the bar may borrow an eval from while the newest
// position is still being analyzed. Enough for a quick exchange, short
// enough that a stuck eval worker shows "pending" instead of an old eval.
const EVAL_LOOKBACK_PLIES = 4

// Eval for the position at `ply`. A fresh move has no eval for a second
// or so; showing the last analyzed position meanwhile keeps the bar from
// jumping to the middle and back on every move.
export function evalAt(state: GameState, ply: number): MoveEval | null {
  for (let p = ply; p >= Math.max(0, ply - EVAL_LOOKBACK_PLIES); p--) {
    const e = state.moves.get(p)?.eval
    if (e) return e
  }
  return null
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

// The eval in words for the thick board-page bar. Thresholds follow the
// usual chess reading: under half a pawn is equal, 1.5 pawns is a clear
// edge, 3 pawns is usually winning.
export function evalWords(e: MoveEval): string {
  if (e.mate !== null) {
    if (e.mate === 0) return "Checkmate"
    return `${e.mate > 0 ? "White" : "Black"} mates in ${Math.abs(e.mate)}`
  }
  const cp = e.cp ?? 0
  const side = cp > 0 ? "White" : "Black"
  const size = Math.abs(cp)
  if (size < 50) return "Equal"
  if (size < 150) return `${side} is slightly better`
  if (size < 300) return `${side} is better`
  return `${side} is winning`
}

// Words for a finished game's bar.
export function resultWords(result: string): string | null {
  if (result === "1-0") return "White won"
  if (result === "0-1") return "Black won"
  if (result === "1/2-1/2") return "Draw"
  return null
}
