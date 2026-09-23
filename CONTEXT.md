# LiveChess

Universal live-chess coverage from grassroots to elite events, with real-time boards, eval, and AI commentary.

## Moves and versioning

**Ply**:
Half-move index incrementing on every single move regardless of color.
_Avoid_: move number, move index

**Move number**:
Full-move count for display, derived as ceil(ply / 2).
_Avoid_: ply

**Side to move**:
Color to move at a ply, derived as white when ply is odd, black when even.

**Move**:
One ply played in a game, stored with SAN and FEN and never deleted.
_Avoid_: half-move record

**Clock**:
Remaining time for the side to move at a ply, parsed from Lichess `%clk`. Carried on the games list, resync and live move events; the client ticks the side to move's clock forward from the last move's time.

**Version**:
Monotonic counter per game bumped on every new ply and every correction, the single ordering authority for jobs and resync.

**Correction**:
Same identity key with different SAN, superseding the old row without deletion.
_Avoid_: update, overwrite

**Truncation**:
Superseding every live Ply after a given Ply because the source took moves back, rewinding the game to that Ply (ADR 0004).
_Avoid_: rollback, delete, undo

## Games, tournaments and rounds

**Game**:
A single chess game within a tournament round, identified by internal UUID mapped from source game ID.
_Avoid_: broadcast game, source game

**Tournament**:
A collection of games from one source event, identified by internal UUID mapped from source tournament ID.
_Avoid_: Broadcast (Lichess's name for the same event)

**Round**:
A stage of a Tournament on Lichess (e.g. "Round 5"), identified by its Lichess round id. The unit the Supervisor discovers, follows and stops on its own; games store it as `round_source_id`.

**Result**:
The PGN score of a Game: `1-0`, `0-1`, `1/2-1/2`, or `*` while still in progress.

**Live game**:
A Game whose Result is still `*` and that had a move or correction in the last three hours. `GET /games?status=live` returns these; `status=finished` returns every Game with a Result other than `*`.
_Avoid_: in-progress game, ongoing game

**Upcoming round**:
A Round that has not started yet, starting within the next week, from Lichess's broadcast list (`GET /upcoming`, cached 5 minutes). Shown on the home page as "Starting soon".

## Ingestion

**Source**:
External origin of chess data, with source_id the external identifier resolved to an internal UUID.

**Supervisor**:
The process that follows live Lichess Rounds on its own instead of being pointed at one by hand: it discovers ongoing Rounds, streams as many as the stream limit allows and polls the rest, and stops a Round two misses after it leaves the live list.
_Avoid_: worker (the per-Round streaming or polling loop that the Supervisor and the standalone `ingest` command both run)

**Final pull**:
The one PGN export request a Round gets when the Supervisor stops following it, or on startup for a Round left with an unfinished Game, so its last result is captured even though nothing streams or polls it anymore.
