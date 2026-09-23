// Seed the games shown on the client home page. Idempotent: re-running
// only refreshes names, never touches moves or versions.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { games, tournaments } from "../src/db/schema";

const GAMES = [
  {
    id: "123e4567-e89b-12d3-a456-426614174000",
    white: "Carlsen, Magnus",
    black: "Nepomniachtchi, Ian",
  },
  {
    id: "123e4567-e89b-12d3-a456-426614174001",
    white: "Ju, Wenjun",
    black: "Tan, Zhongyi",
  },
  {
    id: "123e4567-e89b-12d3-a456-426614174002",
    white: "Gukesh, D",
    black: "Erigaisi, Arjun",
  },
];

const url = process.env["DATABASE_URL"];
if (!url) throw new Error("DATABASE_URL is not set");
const sql = postgres(url);
const db = drizzle(sql, { schema });

const [tournament] = await db
  .insert(tournaments)
  .values({ source: "lichess", sourceId: "test-open", name: "Test Open" })
  .onConflictDoUpdate({
    target: [tournaments.source, tournaments.sourceId],
    set: { name: "Test Open" },
  })
  .returning({ id: tournaments.id });
if (!tournament) throw new Error("seed failed: no tournament row");

for (const g of GAMES) {
  await db
    .insert(games)
    .values({
      id: g.id,
      tournamentId: tournament.id,
      source: "lichess",
      sourceId: g.id,
      white: g.white,
      black: g.black,
      currentFen: "",
    })
    .onConflictDoUpdate({
      target: games.id,
      set: { white: g.white, black: g.black, sourceId: g.id },
    });
  console.log(`seeded ${g.white} vs ${g.black} (${g.id})`);
}

await sql.end();
