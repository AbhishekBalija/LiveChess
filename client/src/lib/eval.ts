import type { GameState, MoveEval } from "./game"

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
