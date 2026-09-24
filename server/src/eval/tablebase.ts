import type { HttpPort } from "../ingestion/worker";
import type { Eval } from "./engine";

// Lichess tablebase (ADR 0006): exact results for positions with at most
// 7 pieces, so endgames cost no engine time and are never guessed.
export const TABLEBASE_URL = "https://tablebase.lichess.org/standard";
export const MAX_PIECES = 7;

// A won tablebase position, as centipawns. Far above anything a search
// returns for a normal position, so the win-probability bar reads 100%.
export const TABLEBASE_WIN_CP = 20_000;

export function pieceCount(fen: string): number {
  const board = fen.split(" ")[0] ?? "";
  return board.replace(/[^a-zA-Z]/g, "").length;
}

// Tablebase categories are for the side to move. "cursed-win" and
// "blessed-loss" are draws under the 50-move rule; "maybe-*" and
// "unknown" are not exact, so those positions go to Stockfish instead.
export function categoryToEval(category: string, fen: string): Eval | null {
  let cp: number;
  if (category === "win" || category === "syzygy-win") cp = TABLEBASE_WIN_CP;
  else if (category === "loss" || category === "syzygy-loss") cp = -TABLEBASE_WIN_CP;
  else if (category === "draw" || category === "cursed-win" || category === "blessed-loss") cp = 0;
  else return null;
  const blackToMove = fen.split(" ")[1] === "b";
  return { cp: blackToMove && cp !== 0 ? -cp : cp, mate: null };
}

export class TablebaseRateLimited extends Error {}

// Null when the tablebase has no exact answer; the caller falls back to
// Stockfish. A 429 is thrown so the caller can pause lookups for a minute
// (the Lichess API asks for one request at a time and a minute's wait).
export async function tablebaseEval(http: HttpPort, fen: string): Promise<Eval | null> {
  if (pieceCount(fen) > MAX_PIECES) return null;
  const res = await http.get(`${TABLEBASE_URL}?fen=${encodeURIComponent(fen)}`);
  if (res.status === 429) throw new TablebaseRateLimited("tablebase rate limit");
  if (!res.ok) return null;
  const body = (await res.json()) as { category?: unknown };
  return typeof body.category === "string" ? categoryToEval(body.category, fen) : null;
}
