import { describe, expect, it } from "vitest";
import {
  boardScore,
  clockSeconds,
  dramaScore,
  eligible,
  freshScore,
  hype,
  pickFeatured,
  strengthScore,
  SWITCH_AFTER_MS,
  tensionScore,
  tierScore,
  whiteWin,
  type Candidate,
  type HypeInput,
} from "./hype";

const NOW = Date.parse("2026-09-24T15:00:00Z");
const MIN = 60_000;

const game = (over: Partial<HypeInput> = {}): HypeInput => ({
  id: "g1",
  result: "*",
  lastPly: 40,
  lastMoveAt: NOW - MIN,
  whiteRating: null,
  blackRating: null,
  whiteTitle: null,
  blackTitle: null,
  tier: null,
  classical: true,
  boardRank: null,
  toMoveClockSec: null,
  recentWin: [],
  ...over,
});

describe("eligibility", () => {
  it("needs a live game with a move in the last 10 minutes", () => {
    expect(eligible(game(), NOW)).toBe(true);
    expect(eligible(game({ result: "1-0" }), NOW)).toBe(false);
    expect(eligible(game({ lastPly: 0 }), NOW)).toBe(false);
    expect(eligible(game({ lastMoveAt: NOW - 11 * MIN }), NOW)).toBe(false);
  });
});

describe("signals", () => {
  it("scales strength from 2000 to 2800 with title bonuses, unrated as 2000", () => {
    expect(strengthScore(game())).toBe(0);
    expect(strengthScore(game({ whiteRating: 2400, blackRating: 2400 }))).toBeCloseTo(0.5);
    expect(strengthScore(game({ whiteRating: 2400, blackRating: 2400, whiteTitle: "GM", blackTitle: "IM" }))).toBeCloseTo(0.65);
    expect(strengthScore(game({ whiteRating: 2850, blackRating: 2800, whiteTitle: "GM" }))).toBe(1);
  });

  it("scores the biggest recent swing in win chance, full at 30 points", () => {
    expect(dramaScore(game({ recentWin: [50, 52, null, 51] }))).toBeCloseTo(2 / 30);
    expect(dramaScore(game({ recentWin: [50, 60, 85] }))).toBe(1);
    expect(dramaScore(game({ recentWin: [null, 50] }))).toBe(0);
  });

  it("maps Lichess tiers", () => {
    expect([5, 4, 3, null].map((tier) => tierScore(game({ tier })))).toEqual([1, 0.6, 0.3, 0]);
  });

  it("counts a close game after move 30 and classical time trouble, half each", () => {
    expect(tensionScore(game({ lastPly: 70, recentWin: [48] }), NOW)).toBe(0.5);
    expect(tensionScore(game({ lastPly: 40, recentWin: [48] }), NOW)).toBe(0);
    // 5:30 at their last move, one minute thinking since: under 5 left.
    expect(tensionScore(game({ toMoveClockSec: 330 }), NOW)).toBe(0.5);
    expect(tensionScore(game({ toMoveClockSec: 480 }), NOW)).toBe(0.25);
    // Blitz and rapid always run low on the clock; not a signal there.
    expect(tensionScore(game({ toMoveClockSec: 60, classical: false }), NOW)).toBe(0);
  });

  it("prefers top boards and recent moves", () => {
    expect(boardScore(game({ boardRank: 1 }))).toBe(1);
    expect(boardScore(game({ boardRank: 6 }))).toBeCloseTo(0.5);
    expect(freshScore(game({ lastMoveAt: NOW - 2 * MIN }), NOW)).toBe(1);
    expect(freshScore(game({ lastMoveAt: NOW - 6 * MIN }), NOW)).toBeCloseTo(0.5);
    expect(freshScore(game({ lastMoveAt: NOW - 10 * MIN }), NOW)).toBe(0);
  });
});

describe("hype", () => {
  it("weighs a top-board clash of stars above a quiet club game, and says why", () => {
    const stars = hype(
      game({ whiteRating: 2760, blackRating: 2750, whiteTitle: "GM", blackTitle: "GM", tier: 5, boardRank: 1, recentWin: [50, 80] }),
      NOW,
    );
    const club = hype(game({ whiteRating: 1600, blackRating: 1550, tier: 3, boardRank: 12 }), NOW);
    expect(stars.score).toBeGreaterThan(club.score + 0.4);
    expect(stars.reason).toBe("Top board · avg 2755 · big swing");
    expect(club.reason).toBe("Live now");
  });

  it("reads evals and clocks the way the board page does", () => {
    expect(whiteWin(0, null, true)).toBe(50);
    expect(whiteWin(null, 3, false)).toBe(100);
    expect(whiteWin(null, 0, true)).toBe(0);
    expect(clockSeconds("1:29:10")).toBe(5350);
    expect(clockSeconds("0:02:55.1")).toBeCloseTo(175.1);
    expect(clockSeconds(null)).toBeNull();
  });
});

describe("pickFeatured", () => {
  const cand = (id: string, score: number, ok = true): Candidate => ({ id, score, reason: id, eligible: ok });

  it("picks the best eligible game", () => {
    expect(pickFeatured(null, [cand("a", 0.4), cand("b", 0.9, false), cand("c", 0.6)], NOW)?.gameId).toBe("c");
  });

  it("switches only after 2 minutes and for a clearly better game", () => {
    const prev = pickFeatured(null, [cand("a", 0.5)], NOW)!;
    const better = [cand("a", 0.5), cand("b", 0.7)];
    expect(pickFeatured(prev, better, NOW + MIN)?.gameId).toBe("a");
    expect(pickFeatured(prev, [cand("a", 0.5), cand("b", 0.55)], NOW + SWITCH_AFTER_MS)?.gameId).toBe("a");
    expect(pickFeatured(prev, better, NOW + SWITCH_AFTER_MS)?.gameId).toBe("b");
  });

  it("keeps a finished game one more pass, but drops a stale one at once", () => {
    const prev = pickFeatured(null, [cand("a", 0.5)], NOW)!;
    const kept = pickFeatured(prev, [cand("b", 0.9)], NOW + MIN)!;
    expect(kept).toMatchObject({ gameId: "a", finishing: true });
    expect(pickFeatured(kept, [cand("b", 0.9)], NOW + 2 * MIN)?.gameId).toBe("b");
    expect(pickFeatured(prev, [cand("a", 0.5, false), cand("b", 0.3)], NOW + MIN)?.gameId).toBe("b");
  });
});
