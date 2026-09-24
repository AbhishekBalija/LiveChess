import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray, sql } from "drizzle-orm";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import { games, moves, tournaments } from "../db/schema";
import type { StreamPort } from "./stream";
import { fetchOngoingRounds, roundsToStart, sectionOf, staleRoundIds, Supervisor, TOP_URL } from "./supervisor";
import type { HttpPort, HttpResponse } from "./worker";

function json(body: unknown, status = 200): HttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => body,
  };
}

const active = (rounds: Array<{ id: string; ongoing: boolean }>) => ({
  active: rounds.map((r) => ({ tour: { name: `Tour ${r.id}` }, round: { id: r.id, name: "Round 1", ongoing: r.ongoing } })),
});

describe("fetchOngoingRounds", () => {
  it("keeps only ongoing rounds, in Lichess's order", async () => {
    const http: HttpPort = {
      get: async (url) => {
        expect(url).toBe(TOP_URL);
        return json(active([{ id: "aaaaaaaa", ongoing: true }, { id: "bbbbbbbb", ongoing: false }, { id: "cccccccc", ongoing: true }]));
      },
    };
    const rounds = await fetchOngoingRounds(http);
    expect(rounds.map((r) => r.roundId)).toEqual(["aaaaaaaa", "cccccccc"]);
  });

  it("skips engine events (#39)", async () => {
    const http: HttpPort = {
      get: async () =>
        json({
          active: [
            { tour: { name: "TCEC S30: Playoff", info: { format: "14-engine double round-robin" } }, round: { id: "tcec0001", ongoing: true } },
            { tour: { name: "Club Open", info: { format: "9-round Swiss" } }, round: { id: "human001", ongoing: true } },
          ],
        }),
    };
    expect((await fetchOngoingRounds(http)).map((r) => r.roundId)).toEqual(["human001"]);
  });
});

describe("split events (#48)", () => {
  it("groups tours into sections by the part before the first bar", () => {
    expect(sectionOf("Open | Matches 13-37")).toBe("Open");
    expect(sectionOf("Women | Matches 1-25")).toBe("Women");
    expect(sectionOf("GM-A")).toBe("GM-A");
  });

  it("also follows the first live tour of every other section, right after the listed one", async () => {
    const group = {
      tours: [
        { id: "open0001", name: "Open | Matches 1-12", live: true },
        { id: "open0002", name: "Open | Matches 13-37", live: true },
        { id: "wom00001", name: "Women | Matches 1-25", live: true },
        { id: "wom00002", name: "Women | Matches 26-50", live: true },
      ],
    };
    const urls: string[] = [];
    const http: HttpPort = {
      get: async (url) => {
        urls.push(url);
        if (url === TOP_URL) {
          return json({
            active: [
              { tour: { id: "open0001", name: "Olympiad | Open | Matches 1-12" }, group: "Olympiad", round: { id: "rOpen001", name: "Round 8", ongoing: true } },
              { tour: { id: "club0001", name: "Club Open" }, round: { id: "rClub001", name: "Round 3", ongoing: true } },
            ],
          });
        }
        if (url.endsWith("/open0001")) return json({ tour: { name: "Olympiad | Open | Matches 1-12" }, group, rounds: [] });
        if (url.endsWith("/wom00001")) {
          return json({ tour: { name: "Olympiad | Women | Matches 1-25" }, group, rounds: [{ id: "rWomen01", name: "Round 8", ongoing: true }] });
        }
        throw new Error(`unexpected ${url}`);
      },
    };
    const rounds = await fetchOngoingRounds(http);
    expect(rounds.map((r) => r.roundId)).toEqual(["rOpen001", "rWomen01", "rClub001"]);
    expect(rounds[1]?.name).toBe("Olympiad | Women | Matches 1-25 · Round 8");
    // Lower match groups (Open 13-37, Women 26-50) are never fetched.
    expect(urls.some((u) => u.endsWith("/open0002") || u.endsWith("/wom00002"))).toBe(false);
  });

  it("keeps the listed tour when expanding its group fails", async () => {
    const http: HttpPort = {
      get: async (url) =>
        url === TOP_URL
          ? json({ active: [{ tour: { id: "open0001", name: "Olympiad" }, group: "Olympiad", round: { id: "rOpen001", ongoing: true } }] })
          : json({}, 500),
    };
    expect((await fetchOngoingRounds(http)).map((r) => r.roundId)).toEqual(["rOpen001"]);
  });
});

describe("roundsToStart", () => {
  const ongoing = ["r1", "r2", "r3", "r4"].map((roundId) => ({ roundId, name: roundId }));
  it("skips rounds already followed and stays under the cap", () => {
    expect(roundsToStart(ongoing, new Set(["r1"]), 3).map((r) => r.roundId)).toEqual(["r2", "r3"]);
    expect(roundsToStart(ongoing, new Set(["r1", "r2", "r3"]), 3)).toEqual([]);
  });
});

describe("Supervisor.discover", () => {
  // Round list is mutable per test step; round PGN exports are empty, so
  // ingestion never touches the database (a stand-in object is enough).
  function setup(streamSlots: number) {
    let list = active([]);
    const pulls: string[] = [];
    const opened: string[] = [];
    const http: HttpPort = {
      get: async (url) => {
        if (url === TOP_URL) return json(list);
        pulls.push(url);
        return json("");
      },
    };
    // A stream that stays open until the supervisor aborts it.
    const stream: StreamPort = {
      async open(url, signal) {
        opened.push(url);
        async function* body(): AsyncIterable<string> {
          await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
        }
        return body();
      },
    };
    const sup = new Supervisor({} as Db, http, stream, { maxRounds: 3, streamSlots, discoverMs: 1, pollMs: 1 });
    return { sup, pulls, opened, setList: (l: ReturnType<typeof active>) => (list = l) };
  }

  it("streams up to the slot limit and polls the rest, capped in total", async () => {
    const { sup, opened, setList } = setup(1);
    setList(active(["r1", "r2", "r3", "r4"].map((id) => ({ id, ongoing: true }))));
    await sup.discover();
    await new Promise((r) => setTimeout(r, 10));
    expect([...sup.following()].sort()).toEqual(["r1", "r2", "r3"]);
    expect(opened).toEqual(["https://lichess.org/api/stream/broadcast/round/r1.pgn"]);
  });

  it("stops a round only after it is missing twice, then pulls it once", async () => {
    const { sup, pulls, setList } = setup(2);
    setList(active([{ id: "r1", ongoing: true }]));
    await sup.discover();
    setList(active([]));
    await sup.discover();
    expect(sup.following().has("r1")).toBe(true);
    expect(pulls).toEqual([]);
    await sup.discover();
    expect(sup.following().has("r1")).toBe(false);
    expect(pulls).toEqual(["https://lichess.org/api/broadcast/round/r1.pgn"]);
  });
});

const URL = process.env["TEST_DATABASE_URL"];

describe.runIf(URL)("staleRoundIds (integration)", () => {
  it("finds rounds with unfinished games that nobody updated lately", async () => {
    const client = postgres(URL as string);
    const database = drizzle(client, { schema }) as unknown as Db;
    const ids = ["stale0001", "fresh0001", "done00001"];
    const old = await database.select({ id: games.id }).from(games).where(inArray(games.sourceId, ids));
    for (const { id } of old) await database.delete(moves).where(eq(moves.gameId, id));
    await database.delete(games).where(inArray(games.sourceId, ids));
    const [t] = await database
      .insert(tournaments)
      .values({ source: "lichess", sourceId: `sup-${Date.now()}`, name: "Supervisor Test" })
      .returning({ id: tournaments.id });
    const base = { tournamentId: t!.id, source: "lichess", white: "A", black: "B", currentFen: "" };
    await database.insert(games).values([
      { ...base, sourceId: "stale0001", roundSourceId: "staleRnd", result: "*", updatedAt: sql`now() - interval '2 hours'` },
      { ...base, sourceId: "fresh0001", roundSourceId: "freshRnd", result: "*" },
      { ...base, sourceId: "done00001", roundSourceId: "doneRnd1", result: "1-0", updatedAt: sql`now() - interval '2 hours'` },
    ]);
    const stale = await staleRoundIds(database);
    expect(stale).toContain("staleRnd");
    expect(stale).not.toContain("freshRnd");
    expect(stale).not.toContain("doneRnd1");
    await client.end();
  });
});
