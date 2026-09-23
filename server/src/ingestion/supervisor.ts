import { and, isNotNull, eq, lt, sql } from "drizzle-orm";
import { db, type Db } from "../db/client";
import { games } from "../db/schema";
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
}

// Ongoing rounds from the active broadcasts, in Lichess's order.
export async function fetchOngoingRounds(http: HttpPort): Promise<OngoingRound[]> {
  const res = await http.get(TOP_URL, "application/json");
  if (!res.ok) throw new Error(`broadcast list failed with ${res.status}`);
  const body = (await res.json()) as {
    active?: Array<{ tour?: { name?: unknown }; round?: { id?: unknown; name?: unknown; ongoing?: unknown } }>;
  };
  const out: OngoingRound[] = [];
  for (const b of body.active ?? []) {
    const id = b.round?.id;
    if (typeof id !== "string" || b.round?.ongoing !== true) continue;
    out.push({ roundId: id, name: `${String(b.tour?.name ?? "")} · ${String(b.round?.name ?? "")}` });
  }
  return out;
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
    .selectDistinct({ roundId: games.roundSourceId })
    .from(games)
    .where(
      and(
        eq(games.result, "*"),
        isNotNull(games.roundSourceId),
        lt(games.updatedAt, sql`now() - make_interval(mins => ${idleMinutes})`),
      ),
    );
  return rows.flatMap((r) => (r.roundId ? [r.roundId] : []));
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
    maxRounds: Number(process.env["SUPERVISOR_MAX_ROUNDS"] ?? 8),
    streamSlots: Number(process.env["SUPERVISOR_STREAM_SLOTS"] ?? (token ? 8 : 2)),
    discoverMs: Number(process.env["SUPERVISOR_DISCOVER_MS"] ?? 5 * 60_000),
    pollMs: Number(process.env["INGEST_INTERVAL_MS"] ?? 3000),
  };
  console.log(`supervisor: following up to ${opts.maxRounds} rounds, ${opts.streamSlots} streamed`);
  await new Supervisor(db(), nodeHttp, fetchStream(USER_AGENT, token), opts).run();
}
