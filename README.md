# LiveChess

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
