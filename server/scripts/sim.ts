// Simulate a live game: persist one ply every 2s, with chess.js FENs.
// Resumes from games.version, so re-running continues instead of colliding.
// With --correct, re-sends ply 4 with a different legal SAN once after ply 6.
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { Chess } from "chess.js";
import postgres from "postgres";
import { persistIngestResult } from "../src/db/client";
import * as schema from "../src/db/schema";
import { games, moves } from "../src/db/schema";
import { applyMoveReceived, type GameState } from "../src/ingestion/handler";

// Ruy Lopez, 20 plies.
const SANS = [
  "e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7",
  "Re1", "b5", "Bb3", "d6", "c3", "O-O", "h3", "Na5", "Bc2", "c5",
];
const CORRECTION_PLY = 4;
// Philidor instead of the Ruy Lopez knight. Any ply-4 change invalidates
// the Bb5/a6 already on the board, so the scripted line ends right after
// the correction lands (expected, and the message says so).
const CORRECTION_SAN = "d6";
const ORIGINAL_SAN = "Nc6";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function fenAfter(sans: string[]): string {
  const chess = new Chess();
  for (const san of sans) chess.move(san);
  return chess.fen();
}

const gameId = process.argv[2];
const wantCorrection = process.argv.includes("--correct");
if (!gameId) {
  console.error("usage: bun run sim <gameId> [--correct]");
  process.exit(1);
}
const url = process.env["DATABASE_URL"];
if (!url) throw new Error("DATABASE_URL is not set");
const sql = postgres(url);
const db = drizzle(sql, { schema });

async function load(): Promise<{ state: GameState; sans: string[]; maxPly: number }> {
  const [game] = await db.select().from(games).where(eq(games.id, gameId));
  if (!game) {
    console.error(`unknown game ${gameId} (run bun run seed first)`);
    process.exit(1);
  }
  const rows = await db
    .select()
    .from(moves)
    .where(eq(moves.gameId, gameId))
    .orderBy(asc(moves.ply));
  const live = rows.filter((r) => !r.superseded);
  for (let i = 0; i < live.length; i++) {
    if (live[i]?.ply !== i + 1) throw new Error(`non-contiguous plies, stopping`);
  }
  return {
    state: {
      version: game.version,
      moves: new Map(
        live.map((r) => [
          r.ply,
          {
            ply: r.ply,
            san: r.san,
            fen: r.fen,
            clock: r.clock,
            superseded: false,
            source: r.source,
          },
        ]),
      ),
    },
    sans: live.map((r) => r.san),
    maxPly: live.length,
  };
}

let corrected = false;

for (;;) {
  const { state, sans, maxPly } = await load();

  if (
    wantCorrection &&
    !corrected &&
    maxPly >= 6 &&
    state.moves.get(CORRECTION_PLY)?.san === ORIGINAL_SAN
  ) {
    const fixed = [...sans.slice(0, CORRECTION_PLY - 1), CORRECTION_SAN];
    const fen = fenAfter(fixed);
    await sleep(2000);
    const r = applyMoveReceived(state, {
      ply: CORRECTION_PLY,
      san: CORRECTION_SAN,
      fen,
      clock: null,
      source: "lichess",
    });
    if (r.outcome === "duplicate-noop") {
      corrected = true;
      continue;
    }
    await persistIngestResult(db, gameId, r);
    console.log(`correction ply ${CORRECTION_PLY} -> ${CORRECTION_SAN} version=${r.version}`);
    corrected = true;
    continue;
  }

  if (maxPly >= SANS.length) {
    console.log(`game complete at version ${state.version}`);
    break;
  }
  const san = SANS[maxPly] ?? "";
  let fen: string;
  try {
    fen = fenAfter([...sans, san]);
  } catch {
    // A correction rewrites history, so the remaining scripted moves can
    // stop fitting the new position. That is the demo working, not a bug.
    if (corrected || state.moves.get(CORRECTION_PLY)?.san !== ORIGINAL_SAN) {
      console.log(`scripted line no longer fits after the correction, stopping at version ${state.version}`);
      break;
    }
    console.error(`illegal move ${san} after the current line, stopping`);
    process.exit(1);
  }
  await sleep(2000);
  const r = applyMoveReceived(state, {
    ply: maxPly + 1,
    san,
    fen,
    clock: null,
    source: "lichess",
  });
  if (r.outcome === "duplicate-noop") {
    console.log(`ply ${maxPly + 1} ${san} already present, stopping`);
    break;
  }
  await persistIngestResult(db, gameId, r);
  console.log(`ply ${maxPly + 1} ${san} version=${r.version}`);
}

await sql.end();
