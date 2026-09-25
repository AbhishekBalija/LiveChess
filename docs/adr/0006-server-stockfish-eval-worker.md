# Eval comes from our own Stockfish worker, plus the Lichess tablebase

Slice 2 needs an eval and win-probability bar on the board page, and
Slice 3's move classifier needs a stored eval for every ply. Human
broadcasts on Lichess carry no `[%eval]` in their PGN, the Lichess cloud
eval only covers positions someone already analyzed (mostly openings), and
Stockfish in the browser gives each viewer their own number with nothing
stored. So a single eval worker on our server computes the eval for every
live ply, with no paid service involved. The research, with sources, is in
`docs/research/eval-options.md`.

## Decision

- **Sources.** Positions with 7 pieces or fewer are looked up in the
  Lichess tablebase (`tablebase.lichess.org/standard`): an exact win,
  draw or loss for no CPU. Every other position is searched by Stockfish,
  run as a native binary in its own process and driven over UCI.
- **Fixed node count per search**, not fixed time or depth, so the same
  position always gets the same eval whatever the server load is. The
  exact count is set after benchmarking on the VM we deploy to.
- **Latest first, then backfill.** The worker always takes each game's
  newest position without an eval first, so the live bar stays current,
  and fills in older plies when it has nothing newer to do. Every ply
  gets an eval eventually, which the classifier needs.
- **Watched games first** (added after launch): a game someone has open
  jumps the queue, newest ply first, then the newest ply of every other
  game, then the backlog. Without it, stepping back through a game showed
  unanalyzed positions for hours while the worker worked through other
  games. The gateway, which knows the WebSocket subscriptions, keeps a
  Redis sorted set of open games (`livechess:watched`); this is viewer
  bookkeeping, not game data, so ADR 0003's single writer for the stream
  and cache still holds.
- **The eval belongs to the move row.** It is stored on the `moves` row
  it was computed for. A result is thrown away only if that row was
  superseded (Correction or Truncation) while the search ran. A newer
  move arriving does not make an older ply's eval stale.
- **Eval does not bump Version.** Version orders changes to the game
  itself (moves, Corrections, Truncations, Results). An eval result is
  published through the outbox as its own event naming the ply and the
  move row's Version, and resync returns the stored eval with each move.
- **A second search for the Great label** (added for #73). Great needs
  the score of the best move other than the engine's choice. After the
  normal search, the worker searches again at the same node count,
  limited to every other legal move (`go nodes N searchmoves ...`), and
  stores that score next to the eval. It only does this when the move
  played next was the engine's choice, or is not played yet (a game's
  newest position), because no other move can be Great. Tablebase
  positions need no search: the second move in its list is exact. The
  normal search is unchanged, so every stored eval and best move stays
  comparable with the ones before it.
- **No job queue library.** The worker finds its work by querying
  Postgres for live moves that have no eval yet, the same polling shape as
  the outbox publisher, so it keeps no state of its own and a restart
  simply carries on.

## Considered Options

- **Lichess cloud eval for openings (deferred):** deep and free, but the
  API allows one request at a time, and mixing its depth-65 evals with our
  shallower ones would show the classifier eval swings that never
  happened. It is worth adding later only if round starts, when 100+ games
  play their opening moves at once, overload the VM.
- **Organizer `[%eval]` from the PGN (rejected):** present only in engine
  broadcasts such as TCEC, and a different engine and depth from ours.
  Using one source keeps every stored number comparable.
- **chess-api.com, a free hosted Stockfish (rejected as the source):**
  it stops each search after a short time, so the same position came back
  at different depths with different evals, and it is a one-person
  service with no stated limits or terms. It stays a possible emergency
  fallback if our VM is too slow for the live bar.
- **Stockfish in the browser (rejected):** nothing is stored for the
  classifier, battery and CPU cost land on phones, and a multi-board grid
  would run many engines on one device.
- **MultiPV 2 for every search (rejected for Great):** it costs no extra
  time at a fixed node count, but the nodes are split between two lines,
  so the main eval gets shallower and even its best move can change. The
  evals already stored would no longer match new ones, and the Best label
  would shift with them.
- **A separate, low-priority pass for Great (rejected):** it would search
  only the plies that need it and never delay the live eval, but it needs
  a second kind of job in the queue and a second event per candidate, and
  Great labels would show up later than the other labels.
- **BullMQ (rejected for eval):** the original architecture sketch named
  it, but it is a new dependency with no clear Bun story, and "which
  moves lack an eval" is already a simple Postgres query.

## Consequences

The architecture doc's "discard the job when Version moves on" rule no
longer applies to eval: staleness is judged per move row, as above.
Stockfish is GPL-3.0. Running it as a separate process that we only talk
to over UCI keeps the Apache-2.0 code separate from it; the binary is
installed on the machine and is not bundled into this repository.
Capacity depends on the VM's CPU, so on a busy day the backfill falls
behind first while the live bar stays current.
The Great label's second search costs extra engine time. In a sample of
2,761 real broadcast moves, 55% were the engine's choice, so older plies
need about 55% more search time. A game's newest position always gets the
second search, so its live eval lands one search later (about 0.4-0.7s
at 300k nodes on a laptop core). If the VM cannot keep up, lower
`EVAL_NODES` or add `EVAL_THREADS` before changing this design.
