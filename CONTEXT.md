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
Time a player has left, as recorded on the ply they just made. Between plies, only the side to move's Clock runs.

**Version**:
Monotonic counter per game bumped on every new ply, Correction, Truncation and Result change, the single ordering authority for jobs and resync.

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
One scheduled set of Games within a Tournament (e.g. "Round 5"), played at the same time. The unit the Supervisor follows.

**Result**:
The PGN score of a Game: `1-0`, `0-1`, `1/2-1/2`, or `*` while still in progress.

**Live game**:
A Game whose Result is still `*` and that had a move or Correction in the last three hours. A Game with any other Result is finished.
_Avoid_: in-progress game, ongoing game

**Upcoming round**:
A Round scheduled to start within the next week that has not started yet. Shown to fans as "Starting soon".

## Ingestion

**Source**:
External origin of chess data, with source_id the external identifier resolved to an internal UUID.

**Supervisor**:
The part of LiveChess that decides which live Rounds to follow, starts following them when they go live, and stops once a Round is no longer live, giving it a Final pull.
_Avoid_: worker (that is the loop following a single Round)

**Final pull**:
One last complete read of a Round when LiveChess stops following it, so every Result is captured even after nothing is watching the Round anymore.
