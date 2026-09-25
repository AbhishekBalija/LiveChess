import { Chess, validateFen } from "chess.js";

// Sacrifice check for the Brilliant label (spec #69). Material only, no
// engine: compare the mover's material before the move with what is left
// once the opponent's best captures (and the mover's recaptures) are
// played out. Idea from En Croissant, reimplemented.

const VALUE: Record<string, number> = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 };

// Net material the mover must lose for the move to count as a sacrifice.
export const SACRIFICE_MIN_LOSS = 200;

// Deep enough for any normal exchange on one square; keeps the search
// cheap in positions full of captures.
const MAX_DEPTH = 8;

// Material from White's side.
function material(chess: Chess): number {
  let total = 0;
  for (const row of chess.board()) {
    for (const square of row) {
      if (square) total += square.color === "w" ? VALUE[square.type] : -VALUE[square.type];
    }
  }
  return total;
}

// Capture-only search, from the side to move's point of view: it may
// stop ("stand pat") or capture, and picks whichever keeps more material.
// Biggest captures first, so alpha-beta cuts most of the tree.
// ponytail: standing pat is allowed even in check, where a real search
// would have to answer the check; fine for a material estimate.
function quiesce(chess: Chess, alpha: number, beta: number, depth: number): number {
  const standPat = material(chess) * (chess.turn() === "w" ? 1 : -1);
  if (standPat >= beta || depth === 0) return standPat;
  let best = Math.max(alpha, standPat);
  const captures = chess
    .moves({ verbose: true })
    .filter((m) => m.captured)
    .sort((a, b) => VALUE[b.captured ?? "p"] - VALUE[a.captured ?? "p"]);
  for (const move of captures) {
    chess.move(move);
    const score = -quiesce(chess, -beta, -best, depth - 1);
    chess.undo();
    if (score >= beta) return score;
    best = Math.max(best, score);
  }
  return best;
}

// How much material the mover gives up net with the move from `before`
// to `after`. Null when either FEN is unusable.
export function sacrificedMaterial(before: string, after: string): number | null {
  if (!validateFen(before).ok || !validateFen(after).ok) return null;
  const start = new Chess(before);
  const moverSign = start.turn() === "w" ? 1 : -1;
  const materialBefore = material(start) * moverSign;
  // After the move the opponent is to move, so its score is negated.
  const materialAfter = -quiesce(new Chess(after), -Infinity, Infinity, MAX_DEPTH);
  return materialBefore - materialAfter;
}

export function isSacrifice(before: string, after: string): boolean | null {
  const lost = sacrificedMaterial(before, after);
  return lost === null ? null : lost >= SACRIFICE_MIN_LOSS;
}
