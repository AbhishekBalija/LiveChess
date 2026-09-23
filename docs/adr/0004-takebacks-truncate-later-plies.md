# Takebacks truncate later plies

Broadcast PGNs get fixed after the fact: a DGT board records a wrong move,
the arbiter corrects it, and the PGN now has a different SAN at ply N and
often ends there. Every stored ply after N was derived from the old line
(its FEN comes from the old position), so keeping it shows a board that
never happened.

## Decision

- A different SAN at ply N while later plies exist is a **Truncation** to
  N, followed by the normal Correction at N and MoveReceived for any new
  plies after it. A PGN that is simply shorter than the stored live
  history is a Truncation to its length.
- A Truncation supersedes every live ply after the target ply (rows are
  kept, never deleted) and **rewinds the games checkpoint** (last_ply,
  current_fen) to it. This is the one intentional exception to "the
  checkpoint never rewinds", which still holds for a Correction alone.
- A Truncation bumps Version once and emits one `GameTruncated` outbox
  event carrying the new last ply, its FEN and the Version. Ply 0 means
  back to the start position.
- Clients drop every ply after the event's ply and redraw. On resync,
  clients also drop any ply after the response's last move, so a client
  that missed the event still converges.

## Considered Options

- **New `GameTruncated` event (accepted):** one meaning per event type,
  small payloads for patchy mobile data, easy to test.
- **`lastPly` on every event:** fewer event types, but heavier payloads
  on every move, and a plain shortening with no new move still needs an
  event to carry it.

## Consequences

The publisher needs no change: the cache already mirrors the payload's
checkpoint, which now rewinds on a Truncation. A Correction to an older
ply with later plies is now three or more events (truncate, correct,
re-add) instead of one, each with its own Version.
