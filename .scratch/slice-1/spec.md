## Problem Statement

Chess fans have no single place to follow every live game from grassroots to elite events with a clean, fast, mobile-first board view that recovers from missed events without guessing.

## Solution

Slice 1 delivers the live spine: Lichess broadcast ingestion through versioned domain events into durable Postgres via outbox, published to Redis Stream and cache by a single publisher, delivered over stateless WebSocket with resync fallback, viewed in a dark-first live board.

## User Stories

1. As a fan, I want to see a live strip of ongoing games on home, so that what is live comes first in one tap.
2. As a fan, I want to open a live board and see the current position, so that I can follow the game without reading notation.
3. As a fan, I want the board to update on each Ply without refresh, so that live feels live on patchy mobile data.
4. As a fan, I want the board to show last move and Version, so that I can tell at a glance it is current.
5. As a fan, I want the client to recover after a dropped connection via resync, so that I never see a guessed position.
6. As a fan, I want White and Black moves at the same Move number to both appear correctly, so that every move pair is intact.
7. As a fan, I want a corrected move to replace the prior notation without losing history, so that arbiter corrections do not corrupt the game.
8. As an organizer, I want my Lichess broadcast tournament to appear with id and name, so that its games are discoverable.
9. As a system, I want duplicate Lichess deliveries to be no-ops, so that retries never double-apply a Ply.
10. As a system, I want moves durable in Postgres before publish, so that a crash never loses a Ply.
11. As a system, I want unpublished outbox rows polled in happened-order, so that Stream and cache reflect real sequence.
12. As a viewer on reconnect, I want missed Plies returned with Ply identifiers, so that the client orders them unambiguously.

## Implementation Decisions

- Runtime Bun with TypeScript strict for ingestion, API, WebSocket gateway, and publisher. Go deferred until ingestion is a proven bottleneck.
- Postgres with Drizzle ORM as canonical store. moves table canonical. Game current_fen and Version derived checkpoint rebuilt from history on disagreement.
- Move identity key (game_id, Ply, Source) with unique constraint. Ply is half-move index incrementing every move. Move number ceil(Ply/2) and Side to move derived display only, never keyed.
- Duplicate vs Correction: same key plus same SAN is no-op with no publish. Same key plus different SAN bumps Game Version, emits GameCorrected, marks old moves row superseded without deletion, inserts new row plus outbox row in one transaction.
- Tables: tournaments with source and source_id, games with tournament reference plus source and source_id plus white and black as text plus Version plus current_fen plus last_ply, moves with game reference plus Ply plus SAN plus FEN plus Clock plus superseded plus Source plus unique key, outbox_events with bigserial monotonic id plus event type plus JSON payload plus published flag. Players table deferred. Clock parsed from Lichess percent-clk annotations and carried through but unused in Slice 1.
- Adapter emits normalized domain events only: GameStarted with game, tournament, white, black; MoveReceived with game, Ply, SAN, FEN, Clock, Version; GameCorrected with game, Ply, old and new SAN, Version. Lichess only. chess-results.com stays behind its own future adapter.
- Move Handler writes only to Postgres (moves plus outbox_events, one transaction) and returns. It performs no direct Redis writes, avoiding a second dual-write risk.
- Outbox Publisher is a separate Bun process polling outbox_events where published false ordered by id ascending, performing both Redis writes from the same row: Stream XADD and cache update with FEN, last move, and Version. Polling not LISTEN/NOTIFY for v1. Duplicate XADD on crash between XADD and marking published is tolerated downstream via Version checks.
- Redis roles: Stream for live event distribution with short retention, current-state cache per game with FEN, Version, and last move (eval field arrives in Slice 2), BullMQ provisioned idle until Slice 2 jobs.
- Resync contract GET /games/:id/state with since_version query returns authoritative game id, Version, FEN, last move with Ply, and missed moves with Ply. Version is single ordering authority. Client on WebSocket gap calls resync, never guesses.
- WebSocket gateway stateless with no durable session state. Recovery is client resync, not gateway replay. In-memory per-connection subscriptions tracking which client watches which game are expected during process lifetime.
- Client scaffold via Bun Vite React with TypeScript strict, Tailwind, shadcn/ui, lucide-react, dark mode default. Home leads with live strip. Board view shows position, last move, Version indicator. Chess rendering library without analysis UI. No rankings or news UI.
- Source mapping: tournaments and games both carry source and source_id so MoveReceived resolves external Lichess identifiers to internal UUIDs.

## Testing Decisions

- Good tests assert external behavior at seams, not implementation details. Idempotency, ordering, and recovery are the behaviors under test.
- Seam Adapter to Move Handler: duplicate delivery is no-op, correction supersedes without deletion, White and Black at same Move number yield two distinct Plies, Clock passes through on MoveReceived.
- Seam Postgres plus Publisher: crash between commit and publish leaves unpublished row picked up on next poll, poll order is id ascending, Stream and cache both reflect same row, cache stale on Redis blip recovers via next poll replay.
- Seam WebSocket plus resync: dropped connection followed by resync with since_version returns full state plus missed moves with Ply, gateway restart loses only in-memory subscriptions with no durable loss.
- Seam client board: live Ply advances position, Version indicator advances, correction updates notation without history loss.
- Prior art: none yet in repo (empty client and server). New Vitest units for identity and correction logic, plus Playwright end to end for board live and resync recovery per project defaults.

## Out of Scope

- Eval job with Stockfish and win-probability bar, commentary classifier plus LLM with rate limits, upset alerts, title-norm tracker, fan polls and predictions.
- Rankings, news RSS plus auto recaps, player profiles with rating history, local tournament finder, chess-results.com scrape versus partnership decision.
- Organizer report-live feed adapter, Go ingestion rewrite, Postgres-unavailable buffering hardening, large concurrent-board spike load testing, auth, wireframes beyond live strip and board view.

## Further Notes

- Vocabulary follows CONTEXT.md: Ply versus Move number, Side to move, Game, Tournament, Move, Source, Version, Correction, Clock.
- Decisions recorded in ADRs 0001 ply identity, 0002 outbox ordering and games source mapping, 0003 publisher owns all Redis writes.
- Slice 2 will need re-read of architecture doc for multi-PV spread difficulty signal, Clock context-builder use, and commentary tone guidance. None blocks Slice 1.
