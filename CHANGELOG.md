# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- Home is calmer (#50): the card strip keeps the first 12 games and has
  no visible scrollbar (swipe or trackpad, plus arrow buttons on desktop),
  and the wall of boards under the featured game is replaced by a "Live
  events" list: each event with its subtitle and live board count, one
  click from its grid. Competition tabs keep the strip, the featured game
  and "Watch all N boards".

### Added
- Round page (#51, `/rounds/:roundId`): "Starting soon" cards open it
  instead of Lichess. Before the start it shows the event, a big start time
  and countdown, format, time control and location, and the pairings with
  titles, ratings and federations once published. When LiveChess has the
  round's games, the same page is the live board grid. If Lichess plays the
  round but LiveChess isn't following it, it says so and links to Lichess.
  New `GET /rounds/:roundId` (Lichess round info, cached 2 minutes) and a
  `roundId` on each games-list row.
- Board page (#49):
  - A thick eval bar exactly the board's width, saying who is better in
    words ("Black is better -2.6", "White mates in 3", "White won") on the
    leading side, with notches marking level under the board's centre.
  - Step through the game: click any move, use the arrow keys (Home and
    End jump to the start and back to live), or the first / previous /
    next / newest buttons. New moves do not move the board while you look
    back; "Back to live" returns. The bar follows the viewed position.
  - An eval graph of the whole game above the moves: hover for the move
    and eval, click to jump there. It shows how many moves the engine has
    analyzed so far.

### Fixed
- Split events are covered (#48): Lichess lists one tour per group, so the
  supervisor only saw the Olympiad's "Open | Matches 1-12", missed Women
  entirely, and dropped other Open tours it had picked up, leaving their
  games frozen as live. It now also follows the first live tour of each
  other section of a group (Women next to Open). Lower match groups stay
  unfollowed so one event cannot take every slot.

### Changed
- Engine-vs-engine events (TCEC and the like) are no longer followed or
  shown in "Starting soon" (#39): LiveChess covers human chess. They are
  recognized by the tour name or its format ("14-engine double
  round-robin"), since Lichess has no flag for them.

### Added
- Multi-board grid (`/events/:tournamentId`): every live board of a
  tournament at once, each tile with both players and clocks, the board,
  the eval strip, the last move and the eval. Reached from "Watch all N
  boards" on a competition tab on home. It refreshes every 3 seconds.

## [0.3.0] - 2026-09-24

Engine eval: every live move analyzed on the server, with win-probability
bars on the board page and the home cards.

### Added
- Engine eval (ADR 0006): a new eval worker (`bun run eval`, started by
  `bun run dev` when Stockfish is installed) analyzes every live move with
  Stockfish at a fixed node count (`EVAL_NODES`), or asks the Lichess
  tablebase for positions with 7 pieces or fewer. Newest moves go first,
  older ones are filled in after. Evals are stored on the move, pushed live
  as `EvalUpdated` events, and returned by resync and the games list.
- Win-probability bars from the Matchday design: a 6px bar under the board
  and a 4px strip along each home match card, White's share filling from
  the left (the same curve Lichess uses), with the eval ("+0.4", "#3")
  beside it. Finished games show their result on the bar.
- Eval research (`docs/research/eval-options.md`) and ADR 0006.

## [0.2.0] - 2026-09-24

Slice 1.5 and the start of Slice 2: LiveChess follows live Lichess
broadcasts on its own, streams moves in seconds, and has its Matchday
design.

### Added
- Board page game-over state: a Finished badge, the winner and score in
  place of "to move", and stopped clocks. It appears live: a Result change
  from the source now bumps Version and emits a `GameResult` event, so an
  open board no longer needs a reload to see the game end.
- "Starting soon" on home: rounds starting within a week, from Lichess's
  broadcast list, with local start time and countdown (`GET /upcoming`,
  cached 5 minutes).
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

### Removed
- Unused `server/src/ingestion/events.ts` zod schemas.

### Fixed
- Outbox and stream no longer grow forever (#33): the publisher prunes
  published outbox rows hourly, keeping the newest 10,000
  (`OUTBOX_KEEP_ROWS`), and caps the Redis stream at about 10,000
  entries (`STREAM_MAXLEN`).
- Dead WebSocket connections are detected (#34): the gateway sends a
  heartbeat every 25s and drops sockets silent for 60s; the board page
  reconnects and resyncs when it hears nothing for 60s.
- Numeric env settings are validated at startup: a typo like
  `INGEST_INTERVAL_MS=3s` used to become NaN and hot-loop against Lichess.
- The gateway drops malformed WebSocket frames instead of throwing.
- An illegal move in a relayed PGN keeps the legal moves before it instead
  of skipping the whole game on every poll.
- The publisher's poll uses a partial index on unpublished outbox rows, so it
  stays fast as history grows.
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

[Unreleased]: https://github.com/AbhishekBalija/LiveChess/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/AbhishekBalija/LiveChess/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/AbhishekBalija/LiveChess/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/AbhishekBalija/LiveChess/releases/tag/v0.1.0
