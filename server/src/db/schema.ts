import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Source origin shared by tournaments and games so the adapter can
// resolve an external Lichess identifier to the internal UUID.
export const tournaments = pgTable(
  "tournaments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    sourceId: text("source_id").notNull(),
    name: text("name").notNull(),
    // Lichess's importance tier (3 normal, 4 high, 5 best) and FIDE time
    // control class ("standard", "rapid", "blitz"), for the featured game.
    tier: integer("tier"),
    fideTc: text("fide_tc"),
    // Lichess splits big events into several tours under one group (the
    // Olympiad: "Open | Matches 1-12", "Women | Matches 1-25", ...). The
    // group's name, and this tour's short name within it (#47).
    groupName: text("group_name"),
    groupTourName: text("group_tour_name"),
  },
  (t) => [uniqueIndex("tournaments_source_idx").on(t.source, t.sourceId)],
);

export const games = pgTable(
  "games",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id").notNull(),
    source: text("source").notNull(),
    sourceId: text("source_id").notNull(),
    white: text("white").notNull(),
    black: text("black").notNull(),
    // Monotonic counter per game, single ordering authority for jobs and resync.
    version: integer("version").notNull().default(0),
    currentFen: text("current_fen").notNull().default(""),
    lastPly: integer("last_ply").notNull().default(0),
    // Lichess broadcast round this game was ingested from, so a round that
    // stopped being followed before it ended can be finished off later.
    roundSourceId: text("round_source_id"),
    // PGN Result header: "*" while the game is in progress, else the score.
    result: text("result").notNull().default("*"),
    // Players as the PGN headers give them (WhiteElo, WhiteTitle,
    // WhiteFideId, WhiteFed, WhiteTeam); null when the source leaves them out.
    whiteRating: integer("white_rating"),
    blackRating: integer("black_rating"),
    whiteTitle: text("white_title"),
    blackTitle: text("black_title"),
    whiteFideId: integer("white_fide_id"),
    blackFideId: integer("black_fide_id"),
    whiteFed: text("white_fed"),
    blackFed: text("black_fed"),
    whiteTeam: text("white_team"),
    blackTeam: text("black_team"),
    // Board number within the round, from the PGN Round header "8.3".
    board: integer("board"),
    // Bumped with every checkpoint change, so lists can show latest activity first.
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("games_source_idx").on(t.source, t.sourceId)],
);

export const moves = pgTable(
  "moves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id").notNull(),
    // Half-move index, increments on every move. Move number and side are derived.
    ply: integer("ply").notNull(),
    san: text("san").notNull(),
    fen: text("fen").notNull(),
    // Remaining time from Lichess %clk, stored in Slice 1, used in Slice 2.
    clock: text("clock"),
    superseded: boolean("superseded").notNull().default(false),
    source: text("source").notNull(),
    // Version at insert time. Corrections bump Version without a new Ply,
    // so ordering by ply alone cannot answer "moves since version X".
    version: integer("version").notNull(),
    // Eval of the position after this move, from White's point of view
    // (ADR 0006). Mate is signed: +3 means White mates in 3, and 0 means
    // the side to move in `fen` is checkmated. Null until the eval worker
    // has run; eval_source says which source produced it.
    evalCp: integer("eval_cp"),
    evalMate: integer("eval_mate"),
    evalSource: text("eval_source"),
    // Best reply from the position after this move, as SAN (Stockfish's
    // bestmove or the tablebase's first move). The next Move is labelled
    // Best when it matches. Null for plies evaluated before it existed.
    bestReply: text("best_reply"),
    // Whether this move gave up material net (the Brilliant label's
    // sacrifice check). Null for ply 1 and plies evaluated before it existed.
    sacrifice: boolean("sacrifice"),
  },
  // One live row per identity key. Superseded history rows are exempt,
  // otherwise a correction could never coexist with the row it replaces.
  (t) => [
    uniqueIndex("moves_identity_idx")
      .on(t.gameId, t.ply, t.source)
      .where(sql`"moves"."superseded" = false`),
    index("moves_game_version_idx").on(t.gameId, t.version),
    // The eval worker's to-do list: live moves with no eval yet. Stays
    // small once the backlog is done, like the outbox index.
    index("moves_needs_eval_idx")
      .on(t.gameId, t.ply)
      .where(sql`"moves"."superseded" = false and "moves"."eval_source" is null`),
  ],
);

// Monotonic bigserial id so the publisher polls in happened-order.
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    published: boolean("published").notNull().default(false),
  },
  // The publisher asks for the oldest unpublished rows every 500ms. Only a
  // handful are ever unpublished while the table grows with every move,
  // so index just those: the poll stays constant-time as history grows.
  (t) => [index("outbox_unpublished_idx").on(t.id).where(sql`"outbox_events"."published" = false`)],
);
