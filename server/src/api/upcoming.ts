import type { HttpPort } from "../ingestion/worker";
import { TOP_URL } from "../ingestion/supervisor";

// "Starting soon" for the home page: rounds that have not started yet,
// from the same Lichess broadcast list the supervisor reads. Each active
// tournament lists its next round with a start time; the separate
// `upcoming` list holds tournaments that have not begun. Cached for a
// few minutes so visitors never cause extra Lichess requests.

export interface UpcomingRound {
  roundId: string;
  tournament: string;
  round: string;
  startsAt: string;
  url: string | null;
}

type Entry = { tour?: { name?: unknown }; round?: { id?: unknown; name?: unknown; startsAt?: unknown; ongoing?: unknown; url?: unknown } };

export const UPCOMING_LIMIT = 12;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Pure: rounds starting within the next week, soonest first, one per
// round id.
export function pickUpcoming(entries: Entry[], now: number): UpcomingRound[] {
  const seen = new Set<string>();
  const out: Array<UpcomingRound & { at: number }> = [];
  for (const e of entries) {
    const id = e.round?.id;
    const at = e.round?.startsAt;
    if (typeof id !== "string" || typeof at !== "number" || e.round?.ongoing === true) continue;
    if (at <= now || at > now + WEEK_MS || seen.has(id)) continue;
    seen.add(id);
    out.push({
      roundId: id,
      tournament: String(e.tour?.name ?? ""),
      round: String(e.round?.name ?? ""),
      startsAt: new Date(at).toISOString(),
      url: typeof e.round?.url === "string" ? e.round.url : null,
      at,
    });
  }
  return out
    .sort((a, b) => a.at - b.at)
    .slice(0, UPCOMING_LIMIT)
    .map(({ at: _at, ...round }) => round);
}

export async function fetchUpcoming(http: HttpPort, now = Date.now()): Promise<UpcomingRound[]> {
  const res = await http.get(TOP_URL, "application/json");
  if (!res.ok) throw new Error(`broadcast list failed with ${res.status}`);
  const body = (await res.json()) as { active?: Entry[]; upcoming?: Entry[] };
  return pickUpcoming([...(body.active ?? []), ...(body.upcoming ?? [])], now);
}

// Serves the last good list for `ttlMs`; on a Lichess failure keeps the
// old list rather than showing nothing.
export class UpcomingCache {
  private value: UpcomingRound[] | null = null;
  private fetchedAt = 0;
  private inFlight: Promise<UpcomingRound[]> | null = null;

  constructor(
    private readonly http: HttpPort,
    private readonly ttlMs = 5 * 60_000,
  ) {}

  async get(now = Date.now()): Promise<UpcomingRound[]> {
    if (this.value && now - this.fetchedAt < this.ttlMs) return this.value;
    this.inFlight ??= fetchUpcoming(this.http, now)
      .then((list) => {
        this.value = list;
        this.fetchedAt = now;
        return list;
      })
      .catch((err) => {
        if (this.value) return this.value;
        throw err;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}
