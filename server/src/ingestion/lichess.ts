import { Chess } from "chess.js";

export interface ParsedPly {
  // Half-move index, increments on every SAN token in sequence order.
  // Derived from position in the PGN move sequence, never from the
  // printed move-number prefix, so White and Black at the same
  // move number get distinct plies. See ADR 0001.
  ply: number;
  moveNumber: number;
  side: "white" | "black";
  san: string;
  clock: string | null;
  fen: string;
}

const RESULT_TOKENS = new Set(["1-0", "0-1", "1/2-1/2", "*"]);

// One SAN token with optional move-number prefix and optional %clk comment.
// Non-clk comments and NAGs are ignored, not parsed.
const TOKEN_RE =
  /(?:\d+\.(\.\.)?)?\s*([^\s{}]+)\s*(?:\{\s*\[%clk\s+([^\]]+)\]\s*\})?/g;

export function parseMovetext(movetext: string): Array<{
  ply: number;
  moveNumber: number;
  side: "white" | "black";
  san: string;
  clock: string | null;
}> {
  const plies: Array<{
    ply: number;
    moveNumber: number;
    side: "white" | "black";
    san: string;
    clock: string | null;
  }> = [];
  let ply = 0;
  for (const match of movetext.matchAll(TOKEN_RE)) {
    const token = match[2];
    if (!token || RESULT_TOKENS.has(token)) continue;
    if (/^\d+\.+$/.test(token)) continue;
    if (token.startsWith("$")) continue;
    if (token === "(" || token === ")") continue;
    ply += 1;
    plies.push({
      ply,
      moveNumber: Math.ceil(ply / 2),
      side: ply % 2 === 1 ? "white" : "black",
      san: token,
      clock: match[3]?.trim() ?? null,
    });
  }
  return plies;
}

export function fensForSans(sans: string[]): string[] {
  const chess = new Chess();
  return sans.map((san) => {
    chess.move(san);
    return chess.fen();
  });
}

export function parseBroadcastGame(pgn: string): {
  headers: Record<string, string>;
  plies: ParsedPly[];
} {
  const headers: Record<string, string> = {};
  const lines = pgn.split("\n");
  let i = 0;
  while (i < lines.length && /^\[.*\]\s*$/.test(lines[i].trim())) {
    const match = lines[i].trim().match(/\[(\w+)\s+"([^"]*)"\]/);
    if (match) headers[match[1]] = match[2];
    i += 1;
  }
  const movetext = lines.slice(i).join("\n");
  const moves = parseMovetext(movetext);
  const fens = fensForSans(moves.map((m) => m.san));
  return {
    headers,
    plies: moves.map((m, i) => ({ ...m, fen: fens[i] })),
  };
}
