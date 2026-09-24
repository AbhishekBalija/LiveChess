import type { HttpPort } from "../ingestion/worker";

// One Lichess broadcast round, for the round page (#51): what it is, when
// it starts, and its pairings once the organizer has published them.
// Read from Lichess's round endpoint and cached briefly; nothing stored.

export interface RoundPlayer {
  name: string;
  rating: number | null;
  title: string | null;
  // FIDE federation code, e.g. "IND".
  fed: string | null;
}

export interface RoundInfo {
  roundId: string;
  tournament: string;
  round: string;
  startsAt: string | null;
  ongoing: boolean;
  finished: boolean;
  format: string | null;
  timeControl: string | null;
  location: string | null;
  url: string;
  pairings: Array<{ white: RoundPlayer; black: RoundPlayer }>;
}

export class RoundHttpError extends Error {
  constructor(
    readonly status: 400 | 404 | 502,
    message: string,
  ) {
    super(message);
  }
}

// Lichess round ids are 8 letters and digits.
export const ROUND_ID = /^[A-Za-z0-9]{8}$/;

export const roundUrl = (roundId: string): string => `https://lichess.org/api/broadcast/-/-/${roundId}`;

type RawPlayer = { name?: unknown; rating?: unknown; title?: unknown; fed?: unknown };
type RawRound = {
  round?: { name?: unknown; startsAt?: unknown; ongoing?: unknown; finished?: unknown; url?: unknown };
  tour?: { name?: unknown; info?: { format?: unknown; tc?: unknown; location?: unknown } };
  games?: Array<{ players?: RawPlayer[] }>;
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

function player(raw: RawPlayer | undefined): RoundPlayer {
  return {
    name: text(raw?.name) ?? "?",
    rating: typeof raw?.rating === "number" ? raw.rating : null,
    title: text(raw?.title),
    fed: text(raw?.fed),
  };
}

// Pure mapping from Lichess's response; players[0] is White.
export function parseRound(roundId: string, body: RawRound): RoundInfo {
  const startsAt = body.round?.startsAt;
  return {
    roundId,
    tournament: text(body.tour?.name) ?? "",
    round: text(body.round?.name) ?? "",
    startsAt: typeof startsAt === "number" ? new Date(startsAt).toISOString() : null,
    ongoing: body.round?.ongoing === true,
    finished: body.round?.finished === true,
    format: text(body.tour?.info?.format),
    timeControl: text(body.tour?.info?.tc),
    location: text(body.tour?.info?.location),
    url: text(body.round?.url) ?? `https://lichess.org/broadcast/-/-/${roundId}`,
    pairings: (body.games ?? []).map((g) => ({ white: player(g.players?.[0]), black: player(g.players?.[1]) })),
  };
}

export async function fetchRound(http: HttpPort, roundId: string): Promise<RoundInfo> {
  if (!ROUND_ID.test(roundId)) throw new RoundHttpError(400, "invalid round id");
  const res = await http.get(roundUrl(roundId), "application/json");
  if (res.status === 404) throw new RoundHttpError(404, "round not found");
  if (!res.ok) throw new RoundHttpError(502, `lichess round failed with ${res.status}`);
  return parseRound(roundId, (await res.json()) as RawRound);
}

// Each round is fetched at most once per `ttlMs`, however many viewers
// have its page open.
// ponytail: evicts everything once it holds `maxRounds`; fine for the
// handful of rounds starting soon, use an LRU if it churns.
export class RoundCache {
  private entries = new Map<string, { at: number; value: RoundInfo }>();

  constructor(
    private readonly http: HttpPort,
    private readonly ttlMs = 2 * 60_000,
    private readonly maxRounds = 200,
  ) {}

  async get(roundId: string, now = Date.now()): Promise<RoundInfo> {
    const hit = this.entries.get(roundId);
    if (hit && now - hit.at < this.ttlMs) return hit.value;
    const value = await fetchRound(this.http, roundId);
    if (this.entries.size >= this.maxRounds) this.entries.clear();
    this.entries.set(roundId, { at: now, value });
    return value;
  }
}
