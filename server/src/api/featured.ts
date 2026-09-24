import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../db/client";
import { games, moves, tournaments } from "../db/schema";
import { LIVE_WINDOW, type GameListItem, type GamesDbPort } from "./games";
import { clockSeconds, eligible, hype, pickFeatured, whiteWin, type Candidate, type HypeInput, type Pick } from "./hype";

// The featured game (#52): for "All live" and for each event, the most
// exciting live game, kept stable by pickFeatured. The gateway asks on
// every games-list request; the picks are refreshed at most once a minute.

export interface FeaturedPick {
  gameId: string;
  score: number;
  reason: string;
  game: GameListItem;
}

export interface Featured {
  global: FeaturedPick | null;
  byTournament: Record<string, FeaturedPick>;
}

// One live game as loaded for scoring, before board ranks and evals are
// folded in.
export interface HypeRow {
  id: string;
  tournamentId: string;
  roundId: string | null;
  result: string;
  lastPly: number;
  lastMoveAt: number;
  whiteRating: number | null;
  blackRating: number | null;
  whiteTitle: string | null;
  blackTitle: string | null;
  board: number | null;
  tier: number | null;
  fideTc: string | null;
  // Clock on the side to move's own last move (ply lastPly - 1).
  toMoveClock: string | null;
}

export interface EvalPoint {
  gameId: string;
  ply: number;
  cp: number | null;
  mate: number | null;
}

// Pure: board rank within each round, the last 7 plies' win chances, and
// the side to move's clock, from the loaded rows.
export function buildInputs(rows: HypeRow[], evals: EvalPoint[]): Array<HypeInput & { tournamentId: string }> {
  const byGame = new Map<string, Map<number, EvalPoint>>();
  for (const e of evals) {
    const plies = byGame.get(e.gameId) ?? new Map<number, EvalPoint>();
    plies.set(e.ply, e);
    byGame.set(e.gameId, plies);
  }
  const rank = new Map<string, number>();
  const rounds = new Map<string, HypeRow[]>();
  for (const r of rows) {
    if (r.board === null) continue;
    const key = r.roundId ?? r.tournamentId;
    rounds.set(key, [...(rounds.get(key) ?? []), r]);
  }
  for (const list of rounds.values()) {
    list.sort((a, b) => (a.board ?? 0) - (b.board ?? 0)).forEach((r, i) => rank.set(r.id, i + 1));
  }
  return rows.map((r) => {
    const plies = byGame.get(r.id);
    const recentWin: Array<number | null> = [];
    for (let ply = Math.max(1, r.lastPly - 6); ply <= r.lastPly; ply++) {
      const e = plies?.get(ply);
      // After an odd ply (White's move) it is Black to move.
      recentWin.push(e ? whiteWin(e.cp, e.mate, ply % 2 === 0) : null);
    }
    return {
      id: r.id,
      tournamentId: r.tournamentId,
      result: r.result,
      lastPly: r.lastPly,
      lastMoveAt: r.lastMoveAt,
      whiteRating: r.whiteRating,
      blackRating: r.blackRating,
      whiteTitle: r.whiteTitle,
      blackTitle: r.blackTitle,
      tier: r.tier,
      classical: r.fideTc === "standard",
      boardRank: rank.get(r.id) ?? null,
      toMoveClockSec: clockSeconds(r.toMoveClock),
      recentWin,
    };
  });
}

export interface FeaturedDbPort {
  hypeRows(): Promise<HypeRow[]>;
  recentEvals(): Promise<EvalPoint[]>;
}

export const REFRESH_MS = 60_000;

export class FeaturedService {
  private picks = new Map<string, Pick>();
  private cached: Featured = { global: null, byTournament: {} };
  private refreshedAt = 0;
  private inFlight: Promise<Featured> | null = null;

  constructor(
    private readonly db: FeaturedDbPort,
    private readonly gamesDb: GamesDbPort,
  ) {}

  get(now = Date.now()): Promise<Featured> {
    if (now - this.refreshedAt < REFRESH_MS) return Promise.resolve(this.cached);
    this.inFlight ??= this.refresh(now).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async refresh(now: number): Promise<Featured> {
    const inputs = buildInputs(await this.db.hypeRows(), await this.db.recentEvals());
    const scored = inputs.map((g) => ({ tournamentId: g.tournamentId, candidate: { id: g.id, eligible: eligible(g, now), ...hype(g, now) } }));

    const scopes = new Map<string, Candidate[]>([["global", scored.map((s) => s.candidate)]]);
    for (const s of scored) scopes.set(s.tournamentId, [...(scopes.get(s.tournamentId) ?? []), s.candidate]);
    // Events with no live games left: let their pick run out too.
    for (const scope of this.picks.keys()) if (!scopes.has(scope)) scopes.set(scope, []);

    for (const [scope, candidates] of scopes) {
      const pick = pickFeatured(this.picks.get(scope) ?? null, candidates, now);
      if (pick) this.picks.set(scope, pick);
      else this.picks.delete(scope);
    }

    const rows = new Map(
      (await this.gamesDb.listGamesByIds([...new Set([...this.picks.values()].map((p) => p.gameId))])).map((g) => [g.id, g]),
    );
    const out = (pick: Pick | undefined): FeaturedPick | null => {
      const game = pick ? rows.get(pick.gameId) : undefined;
      return pick && game ? { gameId: pick.gameId, score: pick.score, reason: pick.reason, game } : null;
    };
    const byTournament: Record<string, FeaturedPick> = {};
    for (const [scope, pick] of this.picks) {
      if (scope === "global") continue;
      const featured = out(pick);
      if (featured) byTournament[scope] = featured;
    }
    this.cached = { global: out(this.picks.get("global")), byTournament };
    this.refreshedAt = now;
    return this.cached;
  }
}

// Two reads: the live games with what scoring needs, and the evals of their
// last 7 plies.
export function drizzleFeaturedDb(database: Db): FeaturedDbPort {
  const prev = alias(moves, "prev");
  const live = and(eq(games.result, "*"), gt(games.updatedAt, LIVE_WINDOW));
  return {
    async hypeRows() {
      const rows = await database
        .select({
          id: games.id,
          tournamentId: games.tournamentId,
          roundId: games.roundSourceId,
          result: games.result,
          lastPly: games.lastPly,
          updatedAt: games.updatedAt,
          whiteRating: games.whiteRating,
          blackRating: games.blackRating,
          whiteTitle: games.whiteTitle,
          blackTitle: games.blackTitle,
          board: games.board,
          tier: tournaments.tier,
          fideTc: tournaments.fideTc,
          toMoveClock: prev.clock,
        })
        .from(games)
        .innerJoin(tournaments, eq(tournaments.id, games.tournamentId))
        .leftJoin(
          prev,
          and(eq(prev.gameId, games.id), eq(prev.ply, sql`${games.lastPly} - 1`), eq(prev.superseded, false)),
        )
        .where(live);
      return rows.map(({ updatedAt, ...r }) => ({ ...r, lastMoveAt: updatedAt.getTime() }));
    },
    async recentEvals() {
      return database
        .select({ gameId: moves.gameId, ply: moves.ply, cp: moves.evalCp, mate: moves.evalMate })
        .from(moves)
        .innerJoin(games, eq(games.id, moves.gameId))
        .where(
          and(
            live,
            eq(moves.superseded, false),
            inArray(moves.evalSource, ["stockfish", "tablebase"]),
            gt(moves.ply, sql`${games.lastPly} - 7`),
          ),
        );
    },
  };
}
