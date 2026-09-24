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

// Real broadcast PGN is noisy: move comments carry [%eval] alongside
// [%clk], SANs carry ?!/!? suffixes, and free-text comments appear.
// Walk a flat stream of words and brace blocks instead, so eval noise
// can never become a phantom ply. A %clk block annotates the move
// before it.
const ITEM_RE = /([^\s{}()]+)|\{([^}]*)\}/g;
const MOVE_NUMBER_RE = /^\d+\.+$/;
const CLOCK_RE = /\[%clk\s+([^\]]+)\]/;
const SUFFIX_RE = /[!?]+$/;

function stripVariations(movetext: string): string {
  let out = "";
  let depth = 0;
  for (const ch of movetext) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

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
  const text = stripVariations(movetext.replace(/;[^\n]*/g, ""));
  for (const match of text.matchAll(ITEM_RE)) {
    const block = match[2];
    if (block !== undefined) {
      const clock = block.match(CLOCK_RE)?.[1]?.trim();
      const last = plies[plies.length - 1];
      if (clock && last && last.clock === null) last.clock = clock;
      continue;
    }
    const token = match[1] ?? "";
    if (!token || RESULT_TOKENS.has(token)) continue;
    if (MOVE_NUMBER_RE.test(token)) continue;
    if (token.startsWith("$")) continue;
    const san = token.replace(SUFFIX_RE, "");
    if (!san) continue;
    ply += 1;
    plies.push({
      ply,
      moveNumber: Math.ceil(ply / 2),
      side: ply % 2 === 1 ? "white" : "black",
      san,
      clock: null,
    });
  }
  return plies;
}

// FEN after each SAN, stopping at the first move that is not legal in the
// position (a relay typo, a DGT glitch). The legal prefix is still worth
// showing; the rest usually gets fixed by a later correction.
export function fensForSans(sans: string[]): string[] {
  const chess = new Chess();
  const fens: string[] = [];
  for (const san of sans) {
    try {
      chess.move(san);
    } catch {
      break;
    }
    fens.push(chess.fen());
  }
  return fens;
}

// Logged once per game and ply: the same bad PGN comes back on every poll.
const reportedIllegal = new Set<string>();

export function parseBroadcastGame(pgn: string): {
  headers: Record<string, string>;
  plies: ParsedPly[];
} {
  const headers: Record<string, string> = {};
  const lines = pgn.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length && /^\[.*\]\s*$/.test(lines[i].trim())) {
    const match = lines[i].trim().match(/\[(\w+)\s+"([^"]*)"\]/);
    if (match) headers[match[1]] = match[2];
    i += 1;
  }
  const movetext = lines.slice(i).join("\n");
  const moves = parseMovetext(movetext);
  const fens = fensForSans(moves.map((m) => m.san));
  if (fens.length < moves.length) {
    const bad = moves[fens.length];
    const key = `${headers["GameURL"] ?? headers["Site"] ?? "?"}#${bad?.ply}`;
    if (!reportedIllegal.has(key)) {
      reportedIllegal.add(key);
      console.warn(`illegal move ${bad?.san} at ply ${bad?.ply} in ${key.split("#")[0]}; keeping the ${fens.length} plies before it`);
    }
  }
  return {
    headers,
    plies: moves.slice(0, fens.length).map((m, i) => ({ ...m, fen: fens[i] as string })),
  };
}

// A round export concatenates games, each starting with [Event "..."].
export function splitPgnGames(pgn: string): string[] {
  return pgn
    .replace(/\r\n/g, "\n")
    .split(/(?=^\[Event\s)/m)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const LICHESS_ID_RE = /^[A-Za-z0-9]{8}$/;

// Lichess game id from the GameURL header, falling back to Site.
// Both end in the 8-char game id. Null when neither parses, so the
// worker skips the game instead of crashing the poll.
export function gameSourceId(headers: Record<string, string>): string | null {
  for (const key of ["GameURL", "Site"]) {
    const value = headers[key];
    if (!value) continue;
    const segment = value.split("?")[0]?.split("/").filter(Boolean).pop();
    if (segment && LICHESS_ID_RE.test(segment)) return segment;
  }
  return null;
}

// Tour and round slugs from the BroadcastURL header, for the round
// metadata endpoint that carries the broadcast tour id and name.
export function broadcastSlugs(
  headers: Record<string, string>,
): { tourSlug: string; roundSlug: string } | null {
  const url = headers["BroadcastURL"] ?? headers["Site"] ?? "";
  const match = url.match(/lichess\.org\/broadcast\/([^/]+)\/([^/]+)\//);
  if (!match) return null;
  return { tourSlug: match[1] as string, roundSlug: match[2] as string };
}

// Engine-vs-engine events (TCEC and the like) are broadcast on Lichess
// next to human ones. LiveChess covers human chess only (#39), so the
// supervisor and "Starting soon" skip them. Lichess has no flag for it;
// the tour name or its format ("14-engine double round-robin") tells.
const ENGINE_EVENT = /\b(engines?|tcec|ccc|computer chess)\b/i;

export function isEngineEvent(tour: { name?: unknown; info?: { format?: unknown } } | undefined): boolean {
  const text = `${String(tour?.name ?? "")} ${String(tour?.info?.format ?? "")}`;
  return ENGINE_EVENT.test(text);
}

// Player and board facts from a broadcast game's PGN headers, for the
// featured game (#52) and later personalization (#54). Anything missing or
// malformed is null; nothing here is required.
export interface GameFacts {
  whiteRating: number | null;
  blackRating: number | null;
  whiteTitle: string | null;
  blackTitle: string | null;
  whiteFideId: number | null;
  blackFideId: number | null;
  whiteFed: string | null;
  blackFed: string | null;
  whiteTeam: string | null;
  blackTeam: string | null;
  board: number | null;
}

export function gameFacts(headers: Record<string, string | undefined>): GameFacts {
  const int = (raw: string | undefined): number | null => {
    const n = Number(raw);
    return raw !== undefined && raw.trim() !== "" && Number.isInteger(n) && n > 0 ? n : null;
  };
  const str = (raw: string | undefined): string | null => (raw && raw.trim() !== "" && raw !== "?" ? raw.trim() : null);
  // Lichess writes the board as "round.board", e.g. "8.3".
  const board = /^\d+\.(\d+)$/.exec(headers["Round"] ?? "")?.[1];
  return {
    whiteRating: int(headers["WhiteElo"]),
    blackRating: int(headers["BlackElo"]),
    whiteTitle: str(headers["WhiteTitle"]),
    blackTitle: str(headers["BlackTitle"]),
    whiteFideId: int(headers["WhiteFideId"]),
    blackFideId: int(headers["BlackFideId"]),
    whiteFed: str(headers["WhiteFed"]),
    blackFed: str(headers["BlackFed"]),
    whiteTeam: str(headers["WhiteTeam"]),
    blackTeam: str(headers["BlackTeam"]),
    board: int(board),
  };
}
