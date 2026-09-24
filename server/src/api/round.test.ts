import { describe, expect, it } from "vitest";
import type { HttpPort, HttpResponse } from "../ingestion/worker";
import { fetchRound, parseRound, RoundCache, RoundHttpError } from "./round";

const reply = (status: number, body: unknown): HttpResponse => ({
  status,
  ok: status >= 200 && status < 300,
  headers: new Headers(),
  text: async () => JSON.stringify(body),
  json: async () => body,
});

const LICHESS = {
  round: { name: "Round 5", startsAt: Date.parse("2026-09-24T13:00:00Z"), url: "https://lichess.org/broadcast/x/round-5/1eg9tNMk" },
  tour: { name: "Club Open", info: { format: "9-round Swiss", tc: "90 min + 30 sec / move", location: "Jadwisin, Poland" } },
  games: [
    {
      players: [
        { name: "Michalski, Maksymilian" },
        { name: "Szymko, Lucas", rating: 1568, fed: "POL", title: "FM" },
      ],
    },
  ],
};

describe("parseRound", () => {
  it("maps round, event facts and pairings with White first", () => {
    expect(parseRound("1eg9tNMk", LICHESS)).toEqual({
      roundId: "1eg9tNMk",
      tournament: "Club Open",
      round: "Round 5",
      startsAt: "2026-09-24T13:00:00.000Z",
      ongoing: false,
      finished: false,
      format: "9-round Swiss",
      timeControl: "90 min + 30 sec / move",
      location: "Jadwisin, Poland",
      url: "https://lichess.org/broadcast/x/round-5/1eg9tNMk",
      pairings: [
        {
          white: { name: "Michalski, Maksymilian", rating: null, title: null, fed: null },
          black: { name: "Szymko, Lucas", rating: 1568, title: "FM", fed: "POL" },
        },
      ],
    });
  });
});

describe("fetchRound", () => {
  it("rejects malformed ids before calling Lichess and maps a 404", async () => {
    let calls = 0;
    const http: HttpPort = {
      get: async () => {
        calls += 1;
        return reply(404, {});
      },
    };
    await expect(fetchRound(http, "../../x")).rejects.toMatchObject({ status: 400 });
    expect(calls).toBe(0);
    await expect(fetchRound(http, "1eg9tNMk")).rejects.toBeInstanceOf(RoundHttpError);
  });

  it("caches each round for its ttl", async () => {
    let calls = 0;
    const http: HttpPort = {
      get: async () => {
        calls += 1;
        return reply(200, LICHESS);
      },
    };
    const cache = new RoundCache(http, 60_000);
    await cache.get("1eg9tNMk", 0);
    await cache.get("1eg9tNMk", 30_000);
    expect(calls).toBe(1);
    await cache.get("1eg9tNMk", 61_000);
    expect(calls).toBe(2);
  });
});
