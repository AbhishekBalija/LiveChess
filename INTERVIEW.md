# INTERVIEW.md

Interview-relevant concepts from building LiveChess, basic to advanced. Written while the reasoning is fresh.

## The outbox pattern

**Q: What problem does the outbox pattern solve?**
A write to Postgres followed by a publish to Redis is two systems with no shared transaction. A crash between them silently loses the event. Writing the event row in the same Postgres transaction as the data, then having a separate publisher poll unpublished rows, turns the loss into a retry.

**Q: Why polling instead of LISTEN/NOTIFY for v1?**
Polling `WHERE published = false ORDER BY id ASC` is simple, durable, and replays after any crash with no extra infrastructure. LISTEN/NOTIFY is faster but fire-and-forget across a restart. Throughput does not need it yet.

**Q: Why must the outbox id be a bigserial and not a UUID?**
The publisher processes rows in happened-order via `ORDER BY id`. UUIDs do not sort chronologically, so a UUID key would XADD events out of order silently. Monotonic ids are the ordering mechanism.

**Q: Who owns Redis writes, and why only one writer?**
The Outbox Publisher does both the Stream XADD and the cache update from the same polled row (ADR 0003). Letting the Move Handler write the cache directly would recreate the exact dual-write risk the outbox removes, just on a second path with no retry.

**Q: If published rows are never read again, how do you stop the outbox growing forever?**
Prune them. The publisher deletes published rows outside the newest 10,000 ids once an hour; unpublished rows are never touched, so nothing waiting to go out can be lost. Keeping a row count instead of a time window avoided adding a `created_at` column and a migration. The Redis stream gets the same treatment with `XADD MAXLEN ~ 10000`: the `~` lets Redis trim whole internal blocks, which is far cheaper than an exact cap. A client that misses trimmed entries catches up through resync, so the cap cannot lose moves.

**Q: A game's Result changes but no move is played. Why bump Version for that?**
Because Version is the only thing clients use to order and gap-check events. The Result used to be written straight to `games.result` during the upsert, with no event: an open board page kept its clocks running until a reload. Now the result change goes through the same path as a move: the handler bumps Version, the row and a `GameResult` outbox row are written in one transaction, and the client applies it like any other event. It is applied after the plies in the same PGN, so the Result never arrives before the move that ended the game.

## WebSocket heartbeats

**Q: What is a half-open connection and why does it matter for live updates?**
When a phone switches networks or a laptop sleeps, the other side never gets a close frame. Both ends think the socket is open until TCP gives up, which can take minutes. The server keeps sending to a dead subscriber, and the client shows "Live" while receiving nothing.

**Q: Why an app-level heartbeat when WebSocket already has ping/pong?**
Protocol pings solve the server side: Bun pings every socket and closes it after `idleTimeout` (60s here) with no pong. But browsers answer pings automatically and never expose them to JavaScript, so the client cannot use them. The gateway also sends a small `{"type":"ping"}` frame every 25s, and the client reconnects if it hears nothing for 60s (two missed heartbeats plus margin). On reconnect it resyncs from its version, so nothing is lost.

## Ply vs move number

**Q: Why is move identity keyed on ply and not move number?**
One full move covers both White and Black, so `(game_id, move_number, source)` collides on literally every move pair. The second move looks like a correction to the first: false `GameCorrected`, real move marked superseded, silent corruption of every game. Ply increments per half-move, so it is unambiguous.

**Q: How do you verify the parser actually does this?**
Feed PGN with no Black move-number prefixes at all and confirm plies still come out 1..N. If ply were read from the printed numbers, prefix-less input would break. The regression test pins White+Black at move 1 to plies 1 and 2.

**Q: Why is the identity unique index partial (`WHERE superseded = false`)?**
A full unique index on `(game_id, ply, source)` makes corrections impossible: the replacement row collides with the superseded row it must coexist with. The live-DB round-trip test proved this, the insert failed with 23505 on the correction path. A partial index enforces one live row per key while history rows stay exempt. Mocks could never catch this; only real Postgres did.

**Q: Duplicate vs correction, in one line each?**
Same key plus same SAN is a no-op with nothing published. Same key plus different SAN bumps Version, emits `GameCorrected`, marks the old row superseded without deletion. History wins over the checkpoint.

## Ingestion worker

**Q: How does the worker survive restarts without reusing Versions?**
It keeps no in-memory game state. Every poll opens one transaction per game, locks the row with `SELECT ... FOR UPDATE`, rebuilds the handler state from `games.version` plus live moves, then applies each ply. A restart just rebuilds from the same rows, so Versions continue and re-polls are all duplicate-noops.

**Q: Why does the row lock matter if only one worker runs?**
Without it, two overlapping polls (slow PGN fetch plus short interval) could read the same version and both insert version N+1, colliding on the identity index or forking Versions. `FOR UPDATE` serializes polls per game; the second waits, then sees the first poll's rows and no-ops.

**Q: Why is real broadcast PGN harder to parse than it looks?**
Move comments bundle `[%eval]` with `[%clk]`, SANs carry `?!` suffixes, and free-text notes appear. A naive tokenizer counts `[eval` and `Inaccuracy.` as plies. The fix walks words and brace blocks separately and reads `%clk` out of the blocks, so comment noise can never become a phantom ply. Proven against a 48-game Olympiad export: zero unparseable games.
