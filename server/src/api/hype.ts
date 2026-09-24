// Featured game (#52): how exciting a live game is right now, as a 0-1
// "hype" score, and which game to feature. Pure: the caller loads the
// facts; nothing here touches the database. Weights and scales are the
// ones agreed with the owner; tune them here, with the tests.

export interface HypeInput {
  id: string;
  result: string;
  lastPly: number;
  // When the last move landed (ms).
  lastMoveAt: number;
  whiteRating: number | null;
  blackRating: number | null;
  whiteTitle: string | null;
  blackTitle: string | null;
  // Lichess tier: 5 best, 4 high, 3 normal.
  tier: number | null;
  // Time trouble only means something in classical ("standard") chess.
  classical: boolean;
  // 1 for the top board of its round, 2 for the next, ...
  boardRank: number | null;
  // Side to move's clock at their last move, in seconds.
  toMoveClockSec: number | null;
  // White's win chance (0-100) after each of the last 7 plies, oldest
  // first; null where the engine has not analyzed that ply yet.
  recentWin: Array<number | null>;
}

export const WEIGHTS = {
  strength: 0.3,
  drama: 0.2,
  tier: 0.15,
  tension: 0.15,
  board: 0.1,
  fresh: 0.1,
} as const;

const MINUTE = 60_000;

// White's win chance from a stored eval, on the same curve as the eval bar
// (client/src/lib/eval.ts). `whiteToMove` resolves mate 0 (checkmate).
export function whiteWin(cp: number | null, mate: number | null, whiteToMove: boolean): number | null {
  if (mate !== null) return mate === 0 ? (whiteToMove ? 0 : 100) : mate > 0 ? 100 : 0;
  if (cp === null) return null;
  const c = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

// "1:29:10" or "0:02:55.1" (PGN %clk) to seconds.
export function clockSeconds(clock: string | null): number | null {
  if (!clock) return null;
  const parts = clock.split(":").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
}
export const STALE_AFTER_MS = 10 * MINUTE;

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

// Only live games with a recent move can be featured, however famous.
export function eligible(g: HypeInput, now: number): boolean {
  return g.result === "*" && g.lastPly > 0 && now - g.lastMoveAt <= STALE_AFTER_MS;
}

const TITLE_BONUS: Record<string, number> = { GM: 0.1, IM: 0.05, WGM: 0.05 };

export function strengthScore(g: HypeInput): number {
  const avg = ((g.whiteRating ?? 2000) + (g.blackRating ?? 2000)) / 2;
  const bonus = (TITLE_BONUS[g.whiteTitle ?? ""] ?? 0) + (TITLE_BONUS[g.blackTitle ?? ""] ?? 0);
  return clamp01((avg - 2000) / 800 + bonus);
}

// The biggest move in White's win chance over the last 6 plies; 30 points
// or more is as dramatic as it gets.
export function dramaScore(g: HypeInput): number {
  const known = g.recentWin.filter((w): w is number => w !== null);
  if (known.length < 2) return 0;
  return clamp01((Math.max(...known) - Math.min(...known)) / 30);
}

export function tierScore(g: HypeInput): number {
  return g.tier === 5 ? 1 : g.tier === 4 ? 0.6 : g.tier === 3 ? 0.3 : 0;
}

// Half "close late" (35-65% after move 30), half time trouble for the side
// to move (under 5 minutes full, under 10 half; classical only).
export function tensionParts(g: HypeInput, now: number): { closeLate: number; trouble: number } {
  const current = [...g.recentWin].reverse().find((w) => w !== null) ?? null;
  const closeLate = current !== null && g.lastPly >= 60 && current >= 35 && current <= 65 ? 1 : 0;
  let trouble = 0;
  if (g.classical && g.toMoveClockSec !== null) {
    const left = g.toMoveClockSec - (now - g.lastMoveAt) / 1000;
    trouble = left < 5 * 60 ? 1 : left < 10 * 60 ? 0.5 : 0;
  }
  return { closeLate, trouble };
}

export function tensionScore(g: HypeInput, now: number): number {
  const { closeLate, trouble } = tensionParts(g, now);
  return 0.5 * closeLate + 0.5 * trouble;
}

// Board 1 scores 1, board 6 about 0.5, deep boards approach 0.
export function boardScore(g: HypeInput): number {
  return g.boardRank === null ? 0 : 1 / (1 + (g.boardRank - 1) / 5);
}

// A move within 2 minutes scores 1, fading to 0 at 10 minutes.
export function freshScore(g: HypeInput, now: number): number {
  const age = now - g.lastMoveAt;
  if (age <= 2 * MINUTE) return 1;
  return clamp01(1 - (age - 2 * MINUTE) / (8 * MINUTE));
}

export interface Hype {
  score: number;
  // Short "why" for fans: "Top board · avg 2750 · big swing".
  reason: string;
}

export function hype(g: HypeInput, now: number): Hype {
  const s = {
    strength: strengthScore(g),
    drama: dramaScore(g),
    tier: tierScore(g),
    tension: tensionScore(g, now),
    board: boardScore(g),
    fresh: freshScore(g, now),
  };
  const score =
    WEIGHTS.strength * s.strength +
    WEIGHTS.drama * s.drama +
    WEIGHTS.tier * s.tier +
    WEIGHTS.tension * s.tension +
    WEIGHTS.board * s.board +
    WEIGHTS.fresh * s.fresh;

  const parts: string[] = [];
  if (g.boardRank === 1) parts.push("Top board");
  if (g.whiteRating !== null && g.blackRating !== null) {
    const avg = Math.round((g.whiteRating + g.blackRating) / 2);
    if (avg >= 2400) parts.push(`avg ${avg}`);
  }
  if (s.drama >= 0.5) parts.push("big swing");
  const { closeLate, trouble } = tensionParts(g, now);
  if (trouble >= 0.5) parts.push("time scramble");
  else if (closeLate === 1) parts.push("tense finish");
  if (g.tier === 5 && parts.length < 3) parts.push("major event");
  return { score, reason: parts.slice(0, 3).join(" · ") || "Live now" };
}

// Stickiness (#52): the pick changes at most every 2 minutes, and only for
// a game that scores at least 0.1 more. A featured game that finishes (it
// drops out of the live list) stays for one more pass so fans see how it
// ended; a game that merely went stale is replaced right away.
export const SWITCH_AFTER_MS = 2 * MINUTE;
export const SWITCH_MARGIN = 0.1;

export interface Pick {
  gameId: string;
  score: number;
  reason: string;
  pickedAt: number;
  // The featured game already had its one extra pass after finishing.
  finishing: boolean;
}

export interface Candidate extends Hype {
  id: string;
  eligible: boolean;
}

export function pickFeatured(prev: Pick | null, candidates: Candidate[], now: number): Pick | null {
  let best: Candidate | null = null;
  for (const c of candidates) if (c.eligible && (best === null || c.score > best.score)) best = c;
  const fresh = (c: Candidate): Pick => ({ gameId: c.id, score: c.score, reason: c.reason, pickedAt: now, finishing: false });

  if (prev === null) return best ? fresh(best) : null;
  const current = candidates.find((c) => c.id === prev.gameId);

  if (current?.eligible) {
    const kept: Pick = { ...prev, score: current.score, reason: current.reason, finishing: false };
    const canSwitch = now - prev.pickedAt >= SWITCH_AFTER_MS;
    if (best && best.id !== current.id && canSwitch && best.score >= current.score + SWITCH_MARGIN) return fresh(best);
    return kept;
  }
  // Gone from the live list: it finished. Keep it for one pass.
  if (current === undefined && !prev.finishing) return { ...prev, finishing: true };
  return best ? fresh(best) : null;
}
