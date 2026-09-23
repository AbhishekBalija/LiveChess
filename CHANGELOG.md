# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Apache-2.0 license with NOTICE, contributing guide, code of conduct,
  security policy, issue and pull request templates, README with
  screenshots, features and architecture.
- Broadcast supervisor (#28): follows live Lichess rounds on its own
  (streams what the limit allows, polls the rest), gives every round a final
  pull when it ends, and finishes off rounds left with unfinished games.
  `bun run dev` now starts it.
- Games store their Lichess round id.
- Matchday design system (#19): navy, lime and gold tokens, Barlow
  Condensed / Manrope / JetBrains Mono, app shell with a desktop top bar
  and a phone bottom nav, Chessnut SVG pieces (Apache-2.0).
- Six board palettes, one per game picked from its id, so each game keeps
  its colors everywhere.
- Home redesign: competition tabs, scoreboard match cards with clocks,
  featured game, more live boards, finished games tab.
- Board page redesign: scoreboard with big clocks and game status, "updated
  Xs ago" stale-feed hint, phone layout with the board between players.
- Clocks end to end: games list, resync and live events carry each move's
  %clk.
- `bun run dev [roundId]` at the repo root starts gateway, publisher and
  client (plus ingestion for a round) with prefixed logs; Ctrl+C stops all.
- Streaming ingestion: the worker holds the Lichess round stream open
  instead of polling, cutting lag from 20 to 30 seconds on large rounds
  to a few seconds. Reconnects with backoff, stops when the round ends.
  `--poll` keeps the old path as a fallback.
- Takebacks (ADR 0004): when a broadcast fixes a move and drops later
  plies, those plies are superseded, the board rewinds, and clients get a
  `GameTruncated` event (and trim on resync if they missed it).
- CI on every pull request and push to main: server typecheck and tests
  (integration tests run against Postgres and Redis service containers),
  client lint, typecheck, tests and build.

### Fixed
- Flaky publisher integration test: test files now run one at a time,
  since they share one database and one Redis stream.
- Tests default to Redis database 1, so they no longer write into the
  dev stream in database 0.

## [0.1.0] - 2026-09-23

Slice 1: the live spine, verified against a live Lichess broadcast
(46th FIDE Chess Olympiad).

### Added
- Postgres schema for tournaments, games, moves and outbox events, with
  Ply-based move identity (ADR 0001) and bigserial outbox ordering (ADR 0002).
- Lichess broadcast ingestion worker: polls a round's PGN, upserts
  tournaments and games, runs every Ply through the Move Handler with
  Version loaded from Postgres, so restarts and re-polls are safe.
- Outbox publisher that owns all Redis writes (ADR 0003): stream events
  plus a per-game cache carrying the board checkpoint.
- Stateless WebSocket gateway with consumer-group fan-out.
- Resync endpoint `GET /games/:id/state?since_version=N` with a cache
  fast path and Postgres fallback.
- Games list endpoint `GET /games?status=live|finished|all`.
- Client: live board over WebSocket with resync on gaps, reconnect and
  network changes; move list, last-move highlight, player names.
- Client: home live strip grouped by tournament with board thumbnails.
- Local tooling: seed and sim scripts, run-locally guide.
- Slice roadmap (`docs/roadmap.md`) mapped to GitHub milestones.

### Fixed
- Cache no longer rewinds the board on a correction to an older Ply.
- Board rows stay equal height in sparse endgame positions.
