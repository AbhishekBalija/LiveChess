import { describe, expect, it } from "vitest";
import { buildInputs, type HypeRow } from "./featured";

const row = (over: Partial<HypeRow>): HypeRow => ({
  id: "g",
  tournamentId: "t1",
  roundId: "r1",
  result: "*",
  lastPly: 20,
  lastMoveAt: 0,
  whiteRating: null,
  blackRating: null,
  whiteTitle: null,
  blackTitle: null,
  board: null,
  tier: null,
  fideTc: null,
  toMoveClock: null,
  ...over,
});

describe("buildInputs", () => {
  it("ranks boards within each round, whatever their raw numbers", () => {
    const inputs = buildInputs(
      [
        row({ id: "a", board: 169 }),
        row({ id: "b", board: 170 }),
        row({ id: "c", board: 3, roundId: "r2" }),
        row({ id: "d", board: null }),
      ],
      [],
    );
    expect(inputs.map((i) => [i.id, i.boardRank])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 1],
      ["d", null],
    ]);
  });

  it("reads the last 7 plies' evals as White's win chance, gaps as null", () => {
    const [input] = buildInputs(
      [row({ id: "a", lastPly: 20, fideTc: "standard", toMoveClock: "0:04:30" })],
      [
        { gameId: "a", ply: 14, cp: 0, mate: null },
        { gameId: "a", ply: 20, cp: null, mate: 2 },
        { gameId: "a", ply: 13, cp: 500, mate: null },
      ],
    );
    expect(input?.recentWin).toEqual([50, null, null, null, null, null, 100]);
    expect(input?.classical).toBe(true);
    expect(input?.toMoveClockSec).toBe(270);
  });
});
