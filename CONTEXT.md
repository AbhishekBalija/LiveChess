# LiveChess

Universal live-chess coverage from grassroots to elite events, with real-time boards, eval, and AI commentary.

## Language

**Ply**:
Half-move index incrementing on every single move regardless of color.
_Avoid_: move number, move index

**Move number**:
Full-move count for display, derived as ceil(ply / 2).
_Avoid_: ply

**Side to move**:
Color to move at a ply, derived as white when ply is odd, black when even.

**Game**:
A single chess game within a tournament round, identified by internal UUID mapped from source game ID.
_Avoid_: broadcast game, source game

**Tournament**:
A collection of games from one source event, identified by internal UUID mapped from source tournament ID.

**Move**:
One ply played in a game, stored with SAN and FEN and never deleted.
_Avoid_: half-move record

**Source**:
External origin of chess data, with source_id the external identifier resolved to an internal UUID.

**Version**:
Monotonic counter per game bumped on every new ply and every correction, the single ordering authority for jobs and resync.

**Correction**:
Same identity key with different SAN, superseding the old row without deletion.
_Avoid_: update, overwrite

**Clock**:
Remaining time for the side to move at a ply, parsed from Lichess `%clk` and stored unused in Slice 1.
