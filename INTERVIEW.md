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
