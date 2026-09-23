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

Then 4 terminals:

| # | dir      | command                                   |
|---|----------|-------------------------------------------|
| 1 | `server` | `bun run gateway`                         |
| 2 | `server` | `bun run publisher`                       |
| 3 | `client` | `bun run dev` (serves http://localhost:5173) |
| 4 | `server` | `bun run sim 123e4567-e89b-12d3-a456-426614174000 [--correct]` |

Open http://localhost:5173, pick a game, and watch a ply land every 2s.
`--correct` re-sends ply 4 with a different SAN once after ply 6 to show
a correction; the scripted line then ends once later moves stop fitting
the corrected position (expected). Re-running `sim` on a finished game
just reports it complete.

## Real broadcast ingestion

Instead of the simulator, point the worker at a Lichess broadcast round
(round id from lichess.org/broadcast, 8 chars):

```sh
cd server && bun run ingest <broadcastRoundId>   # polls every INGEST_INTERVAL_MS (default 3000)
```

The worker upserts the tournament plus games and runs every ply through
the Move Handler. Re-polls are no-ops and restarts continue Version from
Postgres. Look up an ingested game id with
`psql $DATABASE_URL -c "select id, white, black from games;"` and open
http://localhost:5173/games/<id>.
