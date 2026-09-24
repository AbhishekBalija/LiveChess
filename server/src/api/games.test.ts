import { describe, expect, it } from "vitest";
import {
  clocksFor,
  GamesHttpError,
  LIST_LIMIT,
  listGames,
  parseStatus,
  type GameListItem,
  type GamesDbPort,
} from "./games";

const item = (id: string, result = "*"): GameListItem => ({
  id,
  white: "Gukesh, D",
  black: "Erigaisi, Arjun",
  result,
  tournament: { id: "t1", name: "Olympiad" },
  lastPly: 3,
  lastSan: "Nf3",
  whiteClock: "0:10:00",
  blackClock: "0:09:30",
  fen: "fen",
  version: 3,
  updatedAt: "2026-09-23T12:00:00.000Z",
  evalCp: null,
  evalMate: null,
  roundId: null,
});

describe("parseStatus", () => {
  it("defaults to live", () => {
    expect(parseStatus(null)).toBe("live");
  });

  it("accepts live, finished and all", () => {
    expect(parseStatus("finished")).toBe("finished");
    expect(parseStatus("all")).toBe("all");
  });

  it("rejects anything else with a 400", () => {
    expect(() => parseStatus("ongoing")).toThrow(GamesHttpError);
    expect(() => parseStatus("")).toThrow(GamesHttpError);
  });
});

describe("listGames", () => {
  it("passes the status and the list limit to the port", async () => {
    const calls: Array<[string, number]> = [];
    const db: GamesDbPort = {
      listGames: async (status, limit) => {
        calls.push([status, limit]);
        return [item("a"), item("b")];
      },
      listGamesByIds: async () => [],
    };
    const res = await listGames(db, "live");
    expect(calls).toEqual([["live", LIST_LIMIT]]);
    expect(res.games.map((g) => g.id)).toEqual(["a", "b"]);
  });
});

describe("clocksFor", () => {
  it("puts each clock on the side that made that move", () => {
    expect(clocksFor(89, "0:38:12", "0:27:13")).toEqual({ whiteClock: "0:38:12", blackClock: "0:27:13" });
    expect(clocksFor(88, "0:27:13", "0:37:49")).toEqual({ whiteClock: "0:37:49", blackClock: "0:27:13" });
  });

  it("has no clocks before the first move", () => {
    expect(clocksFor(0, null, null)).toEqual({ whiteClock: null, blackClock: null });
  });
});
