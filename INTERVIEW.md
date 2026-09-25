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

## Eval worker

**Q: How do you run a GPL engine from an Apache-2.0 project?**
Stockfish runs as its own process and we only talk to it over UCI, a plain text protocol on stdin and stdout (`position fen ...`, `go nodes 300000`, read `info ... score cp 35` lines until `bestmove`). Nothing is linked or bundled: the binary is installed on the machine. That separation is the usual way GUIs and servers use Stockfish without their own code becoming GPL.

**Q: Why a fixed node count instead of a time limit?**
With a time limit, the same position gets a deeper search on a quiet server and a shallower one under load, so its eval changes with server load. The move classifier compares evals between moves, so that noise would look like mistakes. A fixed node count does the same work every time and gives the same answer.

**Q: Stockfish says `e7e8q` but the move list says `e8=Q+`. How do you compare them?**
Stockfish speaks UCI notation (from square, to square, promotion piece), while PGN and the move list use SAN (piece letter, capture, check and mate marks). SAN depends on the position: `Nbd2` versus `Nd2` depends on whether another knight can also go there. So the worker converts once, on the server, by playing the UCI move in chess.js from the position Stockfish searched and reading back its SAN. The Best label is then a plain string match with the move that was played. The stored best move belongs to the position after a ply, so the next ply is compared with it.

**Q: How do you tell a sacrifice apart from a trade without asking the engine?**
Count material. Before the move, add up both sides' pieces (pawn 100, knight and bishop 300, rook 500, queen 900). After the move, run a tiny search that only looks at captures: the side to move either stops or takes something, and each side picks whatever keeps it more material. This is called a quiescence search, the same idea engines use so they never stop counting in the middle of an exchange. If the mover ends up at least 200 down, it gave something away on purpose: a trade comes out even and a recapture comes out ahead. Searching the biggest captures first lets alpha-beta skip most lines, so it takes a few milliseconds, next to hundreds for the Stockfish search.

**Q: The Great label needs the second-best move's score. Why a second search instead of MultiPV 2?**
MultiPV 2 asks Stockfish for its top two lines in one search. With a fixed node count it takes no longer, but the nodes are split between two lines, so the main eval is shallower and can even pick a different best move. Every eval stored before the change would then come from a different kind of search than every eval after it. A second search with `searchmoves` (every legal move except the best one) leaves the first search exactly as it was. It costs more CPU, so it only runs when it can matter: when the next move was the engine's choice, or is not played yet. That was about 55% of real moves, measured from our own data before deciding.

**Q: How does the worker pick what to analyze without a job queue?**
Its to-do list is a query: live moves with no eval yet, a game's newest move first, most recently active games first, older moves after. A partial index keeps it small once the backlog is done. No queue state means a restart just carries on, and nothing can get lost between a queue and the database. When the worker saves a result it updates the move only if it is still live; if a correction superseded it mid-search, the update matches nothing and the result is dropped.

**Q: How does the eval worker know which games matter most right now?**
It asks who is watching. The gateway already knows every WebSocket subscription, so every 10 seconds (and on each new subscribe) it writes the open game ids into a Redis sorted set with the time as the score. The worker reads the ids seen in the last minute and sorts its to-do query by "is watched" first. It is a priority queue driven by viewers instead of a fixed order, with no new service: if Redis is down, the worker just loses the priority, never the work.

**Q: The eval worker publishes events too. Why does an eval not bump the game's Version?**
Version orders changes to the game itself, and a gap in it makes the client resync. Evals arrive late and out of order by design (newest move first, older ones backfilled), so putting them on Version would make clients see "gaps" and resync all the time over something that did not change the game at all. Instead, the eval event names the move row's own Version, and the client only attaches it to that exact move: an eval computed for a move that was later corrected is simply ignored. The trade-off is that resync cannot find missed evals by version, so it returns the game's stored evals separately.

**Q: How do you turn a centipawn eval into a win-probability bar?**
Centipawns are not a percentage: +1 pawn in a level middlegame and +1 pawn when already +8 mean very different things. The bar runs the eval through a logistic curve (the one Lichess uses: `50 + 50 * (2 / (1 + e^(-0.00368 * cp)) - 1)`, with cp clamped at plus or minus 1000), so small edges move the bar a little and big ones saturate near the ends. A forced mate or a tablebase win fills it completely, and a finished game shows its result instead.

## Move classification

**Q: How do you decide a move was a blunder?**
Not by centipawns lost. Going from -8 to -12 in a lost position costs four pawns but changes nothing. Both evals go through the same winning-chances curve as the eval bar, from the mover's side, and the drop is what counts: 5, 10 and 15 points (out of 100) are inaccuracy, mistake and blunder. Those are Lichess's exact thresholds, read from its source, so the labels match what strong players already trust.

**Q: Why are mates handled separately?**
A mate score has no centipawn value to put on the curve. Lichess's small mate table covers it: allowing a forced mate is a blunder unless you were already clearly lost, losing your own forced mate depends on how much advantage is left, and finding a slower mate is never an error. A tablebase-proven win counts as keeping the mate.

**Q: Why compute labels on the client instead of storing them?**
They are a pure function of evals the client already has, so there is no migration, no backfill, and a Correction or a late eval relabels itself automatically. The one thing the client cannot work out, the engine's best move and whether a move was a sacrifice, the eval worker will store as plain facts.

## Featured game

**Q: How do you pick "the most exciting game" without it jumping around?**
Two layers. A pure scoring function turns each live game's facts into a 0-1 hype score: six signals (strength, drama, tier, tension, board, freshness), each scaled to 0-1 and weighted, plus hard rules (live, has a move, moved in the last 10 minutes). Then a separate `pickFeatured` adds hysteresis: it re-checks once a minute but only switches after 2 minutes and only to a game scoring at least 0.1 more, so small score wobbles never flip the pick. Keeping scoring and stickiness apart means each is simple to test and tune on its own.

**Q: Where do the ratings and board numbers come from?**
From data we already read: Lichess broadcast PGNs carry `WhiteElo`, `WhiteTitle`, `WhiteFideId`, `WhiteTeam` and `Round "8.3"` (round 8, board 3), and the broadcast list carries each event's `tier`. Board numbers are turned into a rank within the round, because raw numbers differ per event (an Olympiad tour starts at board 169).

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
