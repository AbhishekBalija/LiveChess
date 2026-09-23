# Supervisor auto-follows live Lichess broadcasts

Before this, someone had to find a round id on lichess.org/broadcast and run
`bun run ingest <roundId>` for each one by hand: nothing started a round
when it went live, and a round whose follower had stopped (crashed, or
never started) never got a last pull once it finished, so its result
stayed unstored.

## Decision

- The Supervisor polls Lichess's broadcast list every few minutes
  (`SUPERVISOR_DISCOVER_MS`, default 5 min) and follows every ongoing
  round it finds, up to `SUPERVISOR_MAX_ROUNDS` (default 8), in Lichess's
  own priority order.
- Lichess caps concurrent round streams per IP (2 anonymous, 8 with a
  `LICHESS_TOKEN`; these numbers come from Lichess's server source, the
  API docs give none). The Supervisor streams up to that many rounds
  (`SUPERVISOR_STREAM_SLOTS`) and polls the rest one request at a time,
  so every followed round still gets moves, just slower once the stream
  slots are full.
- A round is stopped, and given one Final pull, only after it is missing
  from the live list on two discovery passes in a row, not the first, so
  one flaky list response cannot end a round that is still live.
- On startup, any round with an unfinished game nobody has touched in 30
  minutes also gets a Final pull, in case its follower died mid-round
  last time.

## Considered Options

- **Keep starting rounds by hand (rejected):** does not scale past a
  handful of hand-picked rounds, and leaves "cover whatever is live" to
  a person watching Lichess.
- **Poll every followed round instead of streaming (rejected as the
  default):** stays within the same rate limits, but reintroduces the
  20-30s lag that streaming ingestion (`server/src/ingestion/stream.ts`)
  was built to remove. Streaming stays the default per round; polling is
  now only the overflow path once stream slots are full, plus the
  explicit `--poll` fallback on the standalone `ingest` command.

## Consequences

`games.round_source_id` lets a round be found again by its Lichess id
(for the Final pull and the startup sweep) without the Supervisor
keeping its own durable state. Coverage now depends on Lichess's
broadcast list staying accurate: a round Lichess never marks `ongoing`
is never picked up automatically, same as before this change.
