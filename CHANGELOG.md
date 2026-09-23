# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
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
