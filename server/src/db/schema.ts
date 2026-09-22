import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
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
  },
  (t) => [uniqueIndex("moves_identity_idx").on(t.gameId, t.ply, t.source)],
);

// Monotonic bigserial id so the publisher polls in happened-order.
export const outboxEvents = pgTable("outbox_events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  published: boolean("published").notNull().default(false),
});
