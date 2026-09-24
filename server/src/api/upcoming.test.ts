import { describe, expect, it } from "vitest";
import type { HttpPort, HttpResponse } from "../ingestion/worker";
import { pickUpcoming, UpcomingCache } from "./upcoming";

const now = Date.parse("2026-09-23T18:00:00Z");
const hour = 60 * 60 * 1000;
const entry = (id: string, startsAt: number | undefined, ongoing = false) => ({
  tour: { name: `Tour ${id}` },
  round: { id, name: "Round 8", startsAt, ongoing, url: `https://lichess.org/broadcast/t/r/${id}` },
});

describe("pickUpcoming", () => {
  it("keeps future rounds within a week, soonest first, once each", () => {
    const list = pickUpcoming(
      [
        entry("later", now + 20 * hour),
        entry("soon", now + 2 * hour),
        entry("soon", now + 2 * hour),
        entry("past", now - hour),
        entry("live", now + hour, true),
        entry("far", now + 9 * 24 * hour),
        entry("nostart", undefined),
      ],
      now,
    );
    expect(list.map((r) => r.roundId)).toEqual(["soon", "later"]);
    expect(list[0]).toMatchObject({ tournament: "Tour soon", round: "Round 8", startsAt: "2026-09-23T20:00:00.000Z" });
  });

  it("leaves out engine events (#39)", () => {
    const engine = { ...entry("tcec", now + hour), tour: { name: "Some Cup", info: { format: "8-engine round robin" } } };
    expect(pickUpcoming([engine, entry("human", now + hour)], now).map((r) => r.roundId)).toEqual(["human"]);
  });
});

describe("UpcomingCache", () => {
  function http(responses: Array<() => HttpResponse>): HttpPort & { calls: number } {
    const port = {
      calls: 0,
      get: async () => {
        const next = responses[Math.min(port.calls, responses.length - 1)]!;
        port.calls += 1;
        return next();
      },
    };
    return port;
  }
  const ok = (ids: string[]): HttpResponse => ({
    status: 200,
    ok: true,
    headers: { get: () => null },
    text: async () => "",
    json: async () => ({ active: ids.map((id) => entry(id, now + hour)) }),
  });
  const fail: HttpResponse = { status: 503, ok: false, headers: { get: () => null }, text: async () => "", json: async () => ({}) };

  it("serves from cache within the ttl, refreshes after it", async () => {
    const port = http([() => ok(["a"]), () => ok(["b"])]);
    const cache = new UpcomingCache(port, 1000);
    expect((await cache.get(now)).map((r) => r.roundId)).toEqual(["a"]);
    expect((await cache.get(now + 500)).map((r) => r.roundId)).toEqual(["a"]);
    expect(port.calls).toBe(1);
    expect((await cache.get(now + 1500)).map((r) => r.roundId)).toEqual(["b"]);
  });

  it("keeps the last good list when Lichess fails", async () => {
    const port = http([() => ok(["a"]), () => fail]);
    const cache = new UpcomingCache(port, 1000);
    await cache.get(now);
    expect((await cache.get(now + 1500)).map((r) => r.roundId)).toEqual(["a"]);
  });
});
