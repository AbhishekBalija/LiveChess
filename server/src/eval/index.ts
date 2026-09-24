import { Redis } from "ioredis";
import { envInt } from "../env";
import { db } from "../db/client";
import { lichessHttp } from "../ingestion/worker";
import { Stockfish } from "./engine";
import { watchedGames } from "./watched";
import { Evaluator, evalOnce } from "./worker";

// Separate Bun process: `bun run eval`. Needs a Stockfish binary on the
// machine (STOCKFISH_PATH, default "stockfish" on the PATH).
// ponytail: EVAL_NODES default is a guess from a laptop bench (~700k
// nodes/s per core); benchmark on the deploy VM and tune it there.
const NODES = envInt("EVAL_NODES", 300_000, { min: 1_000 });
const THREADS = envInt("EVAL_THREADS", 1, { min: 1, max: 64 });
const IDLE_MS = envInt("EVAL_IDLE_MS", 1_000, { min: 100 });
const STOCKFISH = process.env["STOCKFISH_PATH"] || "stockfish";

if (!Bun.which(STOCKFISH)) {
  console.error(`eval: Stockfish not found ("${STOCKFISH}"). Install it (brew install stockfish) or set STOCKFISH_PATH.`);
  process.exit(1);
}

const redis = new Redis(process.env["REDIS_URL"] ?? "redis://localhost:6379");
const engine = new Stockfish(STOCKFISH, THREADS);
// A dead engine cannot recover on its own: exit and let whatever runs
// this process (bun run dev, systemd) notice.
void engine.exited.then((code) => {
  console.error(`eval: stockfish exited with code ${code}`);
  process.exit(1);
});
await engine.ready();
// No token: the tablebase is not lichess.org and does not need one.
const evaluator = new Evaluator(engine, lichessHttp(), NODES);
console.log(`eval: stockfish ready, ${NODES} nodes per position, ${THREADS} thread(s)`);

let done = 0;
setInterval(() => {
  if (done > 0) console.log(`eval: ${done} positions in the last minute`);
  done = 0;
}, 60_000);

for (;;) {
  try {
    // Redis down only loses the priority, never the analysis itself.
    const watched = await watchedGames(redis).catch(() => []);
    if (await evalOnce(db(), evaluator, watched)) {
      done += 1;
      continue;
    }
  } catch (err) {
    console.error("eval step failed, retrying", err);
  }
  await Bun.sleep(IDLE_MS);
}
