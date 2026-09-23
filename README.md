# LiveChess

[![CI](https://github.com/AbhishekBalija/LiveChess/actions/workflows/ci.yml/badge.svg)](https://github.com/AbhishekBalija/LiveChess/actions/workflows/ci.yml)

Universal live-chess coverage from grassroots to elite events, with real-time boards, eval, and AI commentary.

## Run locally

Prereqs: Bun, Postgres, Redis.

```sh
cp server/.env.example server/.env   # edit only if your Postgres differs
cd server && bun install && cd ..
cd client && bun install && cd ..
```

One-time database setup (from `server/`):

```sh
bun run migrate   # apply drizzle migrations to DATABASE_URL
bun run seed      # upsert the 3 games shown on the home page
```

Then one command from the repo root starts the gateway, publisher and
client together (Ctrl+C stops all of them):

```sh
bun run dev              # gateway + publisher + client (http://localhost:5173)
bun run dev <roundId>    # ...plus streaming a live Lichess broadcast round
```

To watch the simulator instead of a real broadcast, run it in a second
terminal:

```sh
cd server && bun run sim 123e4567-e89b-12d3-a456-426614174000 [--correct]
```

Each service can still be started on its own (`bun run gateway`,
`bun run publisher`, `bun run ingest <roundId>` in `server/`, `bun run dev`
in `client/`).

Open http://localhost:5173, pick a game, and watch a ply land every 2s.
`--correct` re-sends ply 4 with a different SAN once after ply 6 to show
a correction; the scripted line then ends once later moves stop fitting
the corrected position (expected). Re-running `sim` on a finished game
just reports it complete.

## Real broadcast ingestion

Instead of the simulator, point the worker at a Lichess broadcast round
(round id from lichess.org/broadcast, 8 chars):

```sh
cd server && bun run ingest <broadcastRoundId>          # streams the round (default)
cd server && bun run ingest <broadcastRoundId> --poll   # fallback: polls every INGEST_INTERVAL_MS (default 3000)
```

The worker holds the Lichess round stream open, so moves arrive within a
few seconds of Lichess. It reconnects on its own (every reconnect replays
all games, and re-ingesting is a no-op), and it exits once every game has
a result. Anonymous access allows 2 streams per IP; set `LICHESS_TOKEN`
in `server/.env` for more.

The worker upserts the tournament plus games and runs every ply through
the Move Handler; restarts continue Version from Postgres. Live games
show up on the home page at http://localhost:5173.
