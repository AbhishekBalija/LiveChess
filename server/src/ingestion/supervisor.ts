import { and, isNotNull, eq, lt, sql } from "drizzle-orm";
import { envInt } from "../env";
import { db, type Db } from "../db/client";
import { games, tournaments } from "../db/schema";
import { isEngineEvent } from "./lichess";
import { fetchStream, type StreamPort } from "./stream";
import {
  announceLichessAuth,
  ingestRound,
  lichessToken,
  nodeHttp,
  runStreamWorker,
  USER_AGENT,
  type HttpPort,
  type TourCache,
} from "./worker";

// Broadcast supervisor (issue #28). Instead of starting rounds by hand,
// it keeps following whatever Lichess says is live:
// - every few minutes it reads the active broadcasts and picks up to
//   `maxRounds` ongoing rounds, in Lichess's own priority order;
// - it streams as many as the stream limit allows (2 per IP anonymous,
//   8 with a LICHESS_TOKEN) and polls the rest one request at a time;
// - a round that ends, or drops off the live list, is stopped and gets one
//   final export pull so every result is stored;
// - on startup, rounds left with unfinished games get the same final pull.

export const TOP_URL = "https://lichess.org/api/broadcast/top?page=1";

export interface OngoingRound {
  roundId: string;
  name: string;
  // The event's Lichess id, tier and FIDE time control class, saved onto
  // our tournament row for the featured game (#52).
  tourId?: string;
  tier?: number | null;
  fideTc?: string | null;
  // The Lichess group it belongs to and its short name there (#47).
  groupName?: string | null;
  groupTourName?: string | null;
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

// Ongoing rounds from the active broadcasts, in Lichess's order.
// Lichess lists one tour per group, but big events are split into many
// tours (the Olympiad: Open "Matches 1-12", "13-37"..., Women "1-25"...).
// For each group we also follow the first live tour of every other
// section (Women next to Open), right after the listed one; lower match
// groups are left out so one event cannot take every slot (#48).
export async function fetchOngoingRounds(http: HttpPort): Promise<OngoingRound[]> {
  const res = await http.get(TOP_URL, "application/json");
  if (!res.ok) throw new Error(`broadcast list failed with ${res.status}`);
  const body = (await res.json()) as {
    active?: Array<{
      tour?: { id?: unknown; name?: unknown; tier?: unknown; info?: { format?: unknown; fideTC?: unknown } };
      group?: unknown;
      round?: { id?: unknown; name?: unknown; ongoing?: unknown };
    }>;
  };
  const out: OngoingRound[] = [];
  const seen = new Set<string>();
  const add = (round: OngoingRound): void => {
    if (seen.has(round.roundId)) return;
    seen.add(round.roundId);
    out.push(round);
  };
  for (const b of body.active ?? []) {
    const id = b.round?.id;
    if (typeof id !== "string" || b.round?.ongoing !== true || isEngineEvent(b.tour)) continue;
    const listed: OngoingRound = {
      roundId: id,
      name: `${String(b.tour?.name ?? "")} · ${String(b.round?.name ?? "")}`,
      tourId: str(b.tour?.id) ?? undefined,
      tier: num(b.tour?.tier),
      fideTc: str(b.tour?.info?.fideTC),
      groupName: str(b.group),
    };
    add(listed);
    if (typeof b.group === "string" && typeof b.tour?.id === "string") {
      try {
        const group = await otherSectionRounds(http, b.tour.id);
        listed.groupTourName = group.listedName;
        for (const round of group.rounds) add(round);
      } catch (err) {
        // The listed tour is still followed; the rest waits for next pass.
        console.warn(`supervisor: could not expand group of ${b.tour.id}`, err);
      }
    }
  }
  return out;
}

const tourUrl = (tourId: string): string => `https://lichess.org/api/broadcast/${tourId}`;

// "Open | Matches 1-12" and "Open | Matches 13-37" are one section.
export function sectionOf(groupTourName: string): string {
  return groupTourName.split(" | ")[0]?.trim() ?? groupTourName;
}

type TourResponse = {
  tour?: { name?: unknown; tier?: unknown; info?: { fideTC?: unknown } };
  group?: { name?: unknown; tours?: Array<{ id?: unknown; name?: unknown; live?: unknown }> };
  rounds?: Array<{ id?: unknown; name?: unknown; ongoing?: unknown }>;
};

async function fetchTour(http: HttpPort, tourId: string): Promise<TourResponse> {
  const res = await http.get(tourUrl(tourId), "application/json");
  if (!res.ok) throw new Error(`broadcast ${tourId} failed with ${res.status}`);
  return (await res.json()) as TourResponse;
}

// The first live tour of each section other than the listed tour's, and
// each one's ongoing round; plus the listed tour's short name in the group.
async function otherSectionRounds(
  http: HttpPort,
  listedTourId: string,
): Promise<{ listedName: string | null; rounds: OngoingRound[] }> {
  const group = (await fetchTour(http, listedTourId)).group;
  const tours = group?.tours ?? [];
  const groupName = str(group?.name);
  const listed = tours.find((t) => t.id === listedTourId);
  const covered = new Set<string>(listed ? [sectionOf(String(listed.name ?? ""))] : []);
  const picks: Array<{ id: string; name: string }> = [];
  for (const t of tours) {
    const section = sectionOf(String(t.name ?? ""));
    if (typeof t.id !== "string" || t.live !== true || covered.has(section)) continue;
    covered.add(section);
    picks.push({ id: t.id, name: String(t.name ?? "") });
  }
  const rounds: OngoingRound[] = [];
  for (const { id: tourId, name: shortName } of picks) {
    const tour = await fetchTour(http, tourId);
    const round = tour.rounds?.find((r) => r.ongoing === true);
    if (typeof round?.id === "string") {
      rounds.push({
        roundId: round.id,
        name: `${String(tour.tour?.name ?? "")} · ${String(round.name ?? "")}`,
        tourId,
        tier: num(tour.tour?.tier),
        fideTc: str(tour.tour?.info?.fideTC),
        groupName,
        groupTourName: shortName,
      });
    }
  }
  return { listedName: listed ? str(listed.name) : null, rounds };
}

// Which new rounds to start: ongoing ones we do not follow yet, while
// staying under the total cap.
export function roundsToStart(ongoing: OngoingRound[], following: ReadonlySet<string>, maxRounds: number): OngoingRound[] {
  const room = Math.max(0, maxRounds - following.size);
  return ongoing.filter((r) => !following.has(r.roundId)).slice(0, room);
}

// Rounds with unfinished games that nobody has touched for a while: their
// followers stopped before the end, so their results are missing.
export async function staleRoundIds(database: Db, idleMinutes = 30): Promise<string[]> {
  const rows = await database
    .selectDistinct({ roundId: games.roundSourceId, tournament: tournaments.name })
    .from(games)
    .innerJoin(tournaments, eq(tournaments.id, games.tournamentId))
    .where(
      and(
        eq(games.result, "*"),
        isNotNull(games.roundSourceId),
        lt(games.updatedAt, sql`now() - make_interval(mins => ${idleMinutes})`),
      ),
    );
  // Engine events are not covered (#39), not even for a last pull.
  return rows.flatMap((r) => (r.roundId && !isEngineEvent({ name: r.tournament }) ? [r.roundId] : []));
}

// Keep each followed event's tier and time control class current; events
// stored before these existed get them here too.
export async function saveTourFacts(database: Db, rounds: OngoingRound[]): Promise<void> {
  for (const r of rounds) {
    if (!r.tourId) continue;
    const facts = Object.fromEntries(
      Object.entries({ tier: r.tier, fideTc: r.fideTc, groupName: r.groupName, groupTourName: r.groupTourName }).filter(([, v]) => v !== null && v !== undefined),
    );
    if (Object.keys(facts).length === 0) continue;
    await database
      .update(tournaments)
      .set(facts)
      .where(and(eq(tournaments.source, "lichess"), eq(tournaments.sourceId, r.tourId)));
  }
}

export interface SupervisorOptions {
  maxRounds?: number;
  streamSlots?: number;
  discoverMs?: number;
  pollMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class Supervisor {
  private readonly streams = new Map<string, AbortController>();
  private readonly polled = new Set<string>();
  private readonly tours = new Map<string, TourCache>();
  // Rounds seen off the live list once; stopped on the second miss so a
  // single flaky list response does not end a live round.
  private readonly missing = new Set<string>();
  private running = true;

  constructor(
    private readonly database: Db,
    private readonly http: HttpPort,
    private readonly stream: StreamPort,
    private readonly opts: Required<SupervisorOptions>,
  ) {}

  following(): ReadonlySet<string> {
    return new Set([...this.streams.keys(), ...this.polled]);
  }

  private tour(roundId: string): TourCache {
    let cache = this.tours.get(roundId);
    if (!cache) {
      cache = { tournamentId: null };
      this.tours.set(roundId, cache);
    }
    return cache;
  }

  // One export pull; the way every round we stop following ends.
  async finalPull(roundId: string): Promise<void> {
    try {
      const counts = await ingestRound(this.database, this.http, roundId, this.tour(roundId));
      console.log(`supervisor: final pull ${roundId}, ${counts.games} games, finished=${counts.finished}`);
    } catch (err) {
      console.warn(`supervisor: final pull ${roundId} failed`, err);
    }
    this.tours.delete(roundId);
  }

  // Start new rounds, stop rounds that left the live list.
  async discover(): Promise<void> {
    const ongoing = await fetchOngoingRounds(this.http);
    const live = new Set(ongoing.map((r) => r.roundId));
    await saveTourFacts(this.database, ongoing).catch((err) => console.warn("supervisor: could not save tour facts", err));

    for (const roundId of this.following()) {
      if (live.has(roundId)) {
        this.missing.delete(roundId);
        continue;
      }
      if (!this.missing.has(roundId)) {
        this.missing.add(roundId);
        continue;
      }
      this.missing.delete(roundId);
      console.log(`supervisor: ${roundId} is no longer live, stopping`);
      this.streams.get(roundId)?.abort();
      this.streams.delete(roundId);
      this.polled.delete(roundId);
      await this.finalPull(roundId);
    }

    for (const round of roundsToStart(ongoing, this.following(), this.opts.maxRounds)) {
      if (this.streams.size < this.opts.streamSlots) this.startStream(round);
      else {
        console.log(`supervisor: polling ${round.roundId} (${round.name})`);
        this.polled.add(round.roundId);
      }
    }
  }

  private startStream(round: OngoingRound): void {
    console.log(`supervisor: streaming ${round.roundId} (${round.name})`);
    const controller = new AbortController();
    this.streams.set(round.roundId, controller);
    void runStreamWorker(this.database, this.http, this.stream, round.roundId, { signal: controller.signal })
      .catch((err) => console.error(`supervisor: stream ${round.roundId} crashed`, err))
      .finally(() => {
        // Ended on its own (round finished): free the slot for the next round.
        if (this.streams.get(round.roundId) === controller) this.streams.delete(round.roundId);
      });
  }

  // Polled rounds, one request at a time, round-robin.
  private async pollLoop(): Promise<void> {
    while (this.running) {
      const rounds = [...this.polled];
      if (rounds.length === 0) await sleep(this.opts.pollMs);
      for (const roundId of rounds) {
        if (!this.polled.has(roundId)) continue;
        try {
          const counts = await ingestRound(this.database, this.http, roundId, this.tour(roundId));
          if (counts.finished) {
            console.log(`supervisor: ${roundId} finished`);
            this.polled.delete(roundId);
            this.tours.delete(roundId);
          }
        } catch (err) {
          console.warn(`supervisor: poll ${roundId} failed`, err);
        }
        await sleep(this.opts.pollMs);
      }
    }
  }

  async run(): Promise<never> {
    for (const roundId of await staleRoundIds(this.database)) await this.finalPull(roundId);
    void this.pollLoop();
    for (;;) {
      try {
        await this.discover();
      } catch (err) {
        console.warn("supervisor: discovery failed, retrying next cycle", err);
      }
      await sleep(this.opts.discoverMs);
    }
  }
}

if (import.meta.main) {
  const token = lichessToken();
  await announceLichessAuth(nodeHttp, token, "supervisor");
  const opts: Required<SupervisorOptions> = {
    maxRounds: envInt("SUPERVISOR_MAX_ROUNDS", 8, { min: 1, max: 50 }),
    streamSlots: envInt("SUPERVISOR_STREAM_SLOTS", token ? 8 : 2, { min: 0, max: 32 }),
    discoverMs: envInt("SUPERVISOR_DISCOVER_MS", 5 * 60_000, { min: 30_000 }),
    pollMs: envInt("INGEST_INTERVAL_MS", 3000, { min: 1000 }),
  };
  console.log(`supervisor: following up to ${opts.maxRounds} rounds, ${opts.streamSlots} streamed`);
  await new Supervisor(db(), nodeHttp, fetchStream(USER_AGENT, token), opts).run();
}
