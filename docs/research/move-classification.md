# How chess platforms classify moves

Research only. No code changed. Any ADR or ticket for the classifier comes
later, from these findings.

Scope: how Lichess, Chess.com and a few open-source tools decide that a move
is an inaccuracy, mistake, blunder, or a good label (best, excellent, great,
brilliant, book, miss). The goal is enough detail to implement a
**Move classification** (see `CONTEXT.md`) for LiveChess, shown on the board
by highlighting the move, Chess.com-style.

## Summary

- **Lichess** labels only bad moves: Inaccuracy, Mistake, Blunder. The rule
  is a drop in "winning chances" (the same logistic curve our client already
  uses) of at least 0.1 / 0.2 / 0.3 on a -1..+1 scale, which is **5 / 10 / 15
  win-percent points**. Mate scores go through separate rules. Everything
  needed is two evals per move, exactly what LiveChess already stores.
- **Chess.com** (Classification V2) publishes its cutoffs as "expected
  points" lost: Best 0, Excellent up to 0.02, Good up to 0.05, Inaccuracy up
  to 0.10, Mistake up to 0.20, Blunder above 0.20. The curve that turns an
  eval into expected points depends on the players' ratings and **is not
  published**. Brilliant, Great and Miss are rule-based and described only in
  words; no exact rules are published.
- **WintrChess** (GPL-3.0, third-party) is the most complete open
  reimplementation of the Chess.com labels. It shows what the special labels
  need: the engine's best move (Best), the second-best line's eval (Great,
  and a guard for Brilliant), piece-safety checks on the board (Brilliant)
  and an opening list (Book).
- **For LiveChess:** Inaccuracy, Mistake, Blunder, Excellent, Good and Miss
  can be done with the evals already stored. **Best** needs the engine's best
  move, which the worker already receives and throws away (`bestmove` line),
  so it is nearly free. **Great** needs a second-best line (MultiPV 2).
  **Brilliant** needs a sacrifice check (chess.js, already a dependency, no
  engine time) and ideally the second-best line too. **Book** needs a small
  static opening list (Lichess's CC0 `chess-openings`).

Recommendation (for the owner to decide, see open questions): ship
Inaccuracy/Mistake/Blunder with Lichess's exact rules, add Best by storing
the best move, then Brilliant and Miss. Treat Great and MultiPV 2 as a
separate decision, since it changes the eval worker's search and so the
stored evals (ADR 0006).

## What was actually checked

Source code read on 2026-09-25, links pinned to the commit read:

- lichess-org/lila at
  [`202dba2`](https://github.com/lichess-org/lila/tree/202dba26a1c0ef1f3153e44ef736258b68d33a63):
  `modules/tree/src/main/Advice.scala`, `modules/tree/src/main/Info.scala`,
  `modules/analyse/src/main/AccuracyPercent.scala`,
  `modules/fishnet/src/main/{Work,JsonApi}.scala`,
  `ui/analyse/src/practice/practiceCtrl.ts`,
  `ui/lib/src/ceval/winningChances.ts`.
- lichess-org/scalachess at
  [`57d3483`](https://github.com/lichess-org/scalachess/tree/57d3483869abde8a7dbd867520fe78f8f7e87d79):
  `core/src/main/scala/eval.scala` (where `WinPercent` lives now; there is no
  `WinPercent.scala` in lila any more).
- Chess.com help center and news pages (fetched directly, quoted below).
- WintrCat/wintrchess at
  [`d145b20`](https://github.com/WintrCat/wintrchess/tree/d145b20968955ca955cafe3fc3b51305f3bf41f9),
  WintrCat/freechess (its older predecessor), and
  franciscoBSalgueiro/en-croissant at
  [`23f8314`](https://github.com/franciscoBSalgueiro/en-croissant/tree/23f83142fcbd4d3af60a524855defe8c9a5703fe).
- A small local Stockfish 19 run (Apple M2, one thread) comparing MultiPV 1
  and 2 at our 300k-node budget. Not a benchmark, just a sanity check.

---

## 1. Lichess

### The win-percent curve

From scalachess `core/src/main/scala/eval.scala`
([link](https://github.com/lichess-org/scalachess/blob/57d3483869abde8a7dbd867520fe78f8f7e87d79/core/src/main/scala/eval.scala#L67-L89)):

```scala
val CEILING = Cp(1000)
...
def fromMate(mate: Eval.Mate) = fromCentiPawns(Eval.Cp.ceilingWithSignum(mate.signum))

// [0, 100]
def fromCentiPawns(cp: Eval.Cp) = WinPercent:
  50 + 50 * winningChances(cp.ceiled)

// [-1, +1]
def winningChances(cp: Eval.Cp) = {
  val MULTIPLIER = -0.00368208 // https://github.com/lichess-org/lila/pull/11148
  2 / (1 + Math.exp(MULTIPLIER * cp.value)) - 1
}.atLeast(-1).atMost(+1)
```

- Win% = `50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)`, with cp clamped
  to +-1000 and any mate counted as +-1000 cp.
- The constant came from
  [lila PR #11148](https://github.com/lichess-org/lila/pull/11148) (merged
  2022-07-09): fitted with `scipy.optimize.curve_fit` on "75k positions
  appeared in 2300+ ELO rated rapid games", replacing the old `-0.004`. The
  PR notes the value "will be closer and closer to -0.002 as the ELO
  decreases and closer to -0.0038 when elo increases". So the curve is
  already tuned to strong players, which suits elite broadcasts.
- Note: the classifier (below) calls `winningChances(cp)` directly, **without
  the 1000 cp clamp**. It makes almost no difference because the curve is
  already flat there.

### The Inaccuracy / Mistake / Blunder rule (server analysis)

From lila `modules/tree/src/main/Advice.scala`
([link](https://github.com/lichess-org/lila/blob/202dba26a1c0ef1f3153e44ef736258b68d33a63/modules/tree/src/main/Advice.scala#L45-L60)):

```scala
private val winningChanceJudgements = List(
  .3 -> Advice.Judgement.Blunder,
  .2 -> Advice.Judgement.Mistake,
  .1 -> Advice.Judgement.Inaccuracy
)

def apply(prev: Info, info: Info): Option[CpAdvice] =
  for
    cp <- prev.cp
    infoCp <- info.cp
    prevWinningChances = WinPercent.winningChances(cp)
    currentWinningChances = WinPercent.winningChances(infoCp)
    delta = (currentWinningChances - prevWinningChances).pipe(d => info.color.fold(-d, d))
    judgement <- winningChanceJudgements.find((d, _) => d <= delta)._2F
  yield CpAdvice(judgement, info, prev)
```

- `prev` is the eval before the move, `info` the eval after it
  (`Info.scala`: "ply AFTER the move was played", `color = prevPly.turn`, the
  side that moved;
  [link](https://github.com/lichess-org/lila/blob/202dba26a1c0ef1f3153e44ef736258b68d33a63/modules/tree/src/main/Info.scala)).
  Evals are from White's side, and `fold(-d, d)` turns the change into "how
  much the mover lost". This is the same layout as our `moves` table: the
  eval stored on ply N is the position after move N.
- Thresholds are on the -1..+1 scale. In win-percent points (0..100):
  **Inaccuracy >= 5, Mistake >= 10, Blunder >= 15.** Checked worst first, so
  the biggest matching label wins.
- It only runs when **both** evals are centipawns. If either is a mate
  score, the mate rules below apply instead.

### Mate handling

Same file
([link](https://github.com/lichess-org/lila/blob/202dba26a1c0ef1f3153e44ef736258b68d33a63/modules/tree/src/main/Advice.scala#L64-L108)),
scores taken from the mover's side:

```scala
case (Score.Cp(_), Score.Mate(n)) if n.negative => MateCreated
case (Score.Mate(p), Score.Cp(_)) if p.positive => MateLost
case (Score.Mate(p), Score.Mate(n)) if p.positive && n.negative => MateLost
...
case MateCreated if prevPovCpOrZero < -999 => Some(Advice.Judgement.Inaccuracy)
case MateCreated if prevPovCpOrZero < -700 => Some(Advice.Judgement.Mistake)
case MateCreated => Some(Advice.Judgement.Blunder)
case MateLost if povCpOrZero > 999 => Some(Advice.Judgement.Inaccuracy)
case MateLost if povCpOrZero > 700 => Some(Advice.Judgement.Mistake)
case MateLost => Some(Advice.Judgement.Blunder)
case MateDelayed => None
```

| Before (mover's side) | After | Lichess text | Label |
|---|---|---|---|
| cp, worse than -999 | opponent mates | "Checkmate is now unavoidable" | Inaccuracy (already lost) |
| cp, -999 to -701 | opponent mates | same | Mistake |
| cp, -700 or better | opponent mates | same | Blunder |
| mover mates | cp above +999 | "Lost forced checkmate sequence" | Inaccuracy (still winning big) |
| mover mates | cp +701 to +999 | same | Mistake |
| mover mates | cp +700 or less | same | Blunder |
| mover mates | opponent mates | same | Blunder (cp counted as 0) |
| mover mates in N | mover mates in more moves | "Not the best checkmate sequence" | none |
| opponent mates | anything | (no rule) | none |

`MateDelayed` exists but no case ever produces it, so a slower mate is never
flagged. The comment text is `"<description>. <best move> was best."`, using
the first move of the engine's line (`makeComment`, same file).

### Good labels

**Lichess does not label good moves in game analysis.** The `Judgement` enum
has only Inaccuracy, Mistake and Blunder (`Advice.scala`, lines 26-31). There
is no "best", "great" or "brilliant" label; `!`/`!!` only appear when a human
adds them as glyphs in a study.

The one place with a positive verdict is **practice mode** ("Learn from your
mistakes"), which runs in the browser against the local engine
([`practiceCtrl.ts`](https://github.com/lichess-org/lila/blob/202dba26a1c0ef1f3153e44ef736258b68d33a63/ui/analyse/src/practice/practiceCtrl.ts#L101-L129)):

```ts
if (!best) verdict = 'goodMove';
else if (shift < 0.025) verdict = 'goodMove';
else if (shift < 0.06) verdict = 'inaccuracy';
else if (shift < 0.14) verdict = 'mistake';
else verdict = 'blunder';
```

Here `shift` comes from `povDiff`, which divides by 2
([`winningChances.ts`](https://github.com/lichess-org/lila/blob/202dba26a1c0ef1f3153e44ef736258b68d33a63/ui/lib/src/ceval/winningChances.ts#L36-L37)),
so it is on a 0..1 scale: **good under 2.5%, inaccuracy under 6%, mistake
under 14%, blunder above** (stricter than server analysis). If the played
move equals the engine's best move, it is always "good". The client also
turns mate into cp differently: `(21 - min(10, |mate|)) * 100`, so mate in 1
is 2000 cp and mate in 10+ is 1100 cp (same file, line 18).

### Accuracy (for reference)

Per-move accuracy from `AccuracyPercent.scala`
([link](https://github.com/lichess-org/lila/blob/202dba26a1c0ef1f3153e44ef736258b68d33a63/modules/analyse/src/main/AccuracyPercent.scala#L47-L55)):
`103.1668100711649 * exp(-0.04354415386753951 * winDiff) - 3.166924740191411 + 1`,
clamped to 0..100, 100 if win% did not drop. Game accuracy mixes a
volatility-weighted mean and a harmonic mean. Not a classifier, but it uses
the same stored evals if we ever want an accuracy number.

### Engine settings for server analysis (fishnet)

Lichess analysis runs on fishnet at a **fixed node count per move**, by
request type (`Work.scala`,
[link](https://github.com/lichess-org/lila/blob/202dba26a1c0ef1f3153e44ef736258b68d33a63/modules/fishnet/src/main/Work.scala#L74-L78)):

```scala
case officialBroadcast extends Origin(5_000_000, false)
case manualRequest extends Origin(1_000_000, false) // games & studies
case autoHunter extends Origin(300_000, true)
case autoTutor extends Origin(100_000, true)
```

The same count is sent for Stockfish 18, 17.1 and 16, times 3 for the
classical engine (`JsonApi.scala`,
[link](https://github.com/lichess-org/lila/blob/202dba26a1c0ef1f3153e44ef736258b68d33a63/modules/fishnet/src/main/JsonApi.scala#L151-L156)).
So a user-requested analysis is 1M nodes and official broadcasts get 5M; our
300k matches Lichess's automatic "hunter" analysis. It is one line per
position (the analysis `Info` stores one eval plus one line). Whether the 5M
broadcast analysis is exposed through any API we could read was not checked;
`docs/research/eval-options.md` found no `%eval` in live broadcast PGN.

---

## 2. Chess.com

### Expected points cutoffs (primary source)

From Chess.com's help article "How are moves classified?"
([support.chess.com/en/articles/8572705](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-etc),
last updated 2026-02-09):

> With Classification V2, Chess.com has adopted an Expected Points Model...
> Expected Points uses data science to determine a player's winning chances
> based on their rating and the engine evaluation, where 1.00 is always
> winning, 0.00 is always losing, and 0.50 is even.

| Classification | Expected points lost, lower | upper |
|---|---|---|
| Best | 0.00 | 0.00 |
| Excellent | 0.00 | 0.02 |
| Good | 0.02 | 0.05 |
| Inaccuracy | 0.05 | 0.10 |
| Mistake | 0.10 | 0.20 |
| Blunder | 0.20 | 1.00 |

On a 0..100 scale that is Inaccuracy 5-10, Mistake 10-20, Blunder 20+
points. Compared with Lichess (5 / 10 / 15), the inaccuracy and mistake
starts match; Chess.com's blunder starts later.

**Not published:** the function from (eval, rating) to expected points.
Chess.com says only that it depends on rating. Any exact curve in blogs is a
guess. The engine and depth Chess.com uses for Game Review are also not
stated on these pages (unverified).

"Best" is described as "The chess engine's top choice" in the Game Review
article
([support.chess.com/en/articles/8584089](https://support.chess.com/en/articles/8584089-how-does-game-review-work)),
so in practice it means "played the engine's move", not only "lost 0.00".

### Special labels (primary source, wording only)

Quoted from the same classification article:

- **Great Move:** "moves that were critical to the outcome of the game,
  such as turning a losing position into an equal one, an equal position
  into a winning one, or finding the only good move in a position." "We are
  more generous in what we call a Great Move for new players compared to
  higher-rated players."
- **Brilliant:** "Brilliant Moves are always the best or nearly best move in
  the position, but they are also special in some way... a Brilliant move is
  when you find a good piece sacrifice." Conditions: "You should not be in a
  bad position after a Brilliant move" and "You should not be completely
  winning even if you hadn't found the move." Also more generous for newer
  players.
- **Miss:** "when you fail to capitalize on your opponent's mistake and miss
  the opportunity to gain a winning position, often resulting in an equal or
  worse outcome. The engine evaluation required to determine a winning,
  equal, or losing position varies according to the player's rating."

From the Game Review article (same link as above): Book is "A conventional
opening move"; Miss is "A move that missed a tactical opportunity or a chance
to punish the opponent"; Blunder is "A very bad move that also loses material
or the game".

From the 2023 Game Review V2 announcement
([chess.com/news/view/chesscom-launches-game-review-v2](https://www.chess.com/news/view/chesscom-launches-game-review-v2)):
"a blunder must not only drop the position's evaluation significantly but
also lose material or allow checkmate", and Chess.com "completely overhauled
our book move database to align it with well-known opening theory... removing
moves that are bad". The 2026 help article's table does not repeat the
"loses material" condition, so whether it still applies is **unclear**.

**Not published:** what counts as "winning", "equal" or "losing" per rating,
what counts as a "piece sacrifice", how "only good move" is measured, and
the book database. Secondary sites that give exact percentages for these
(for example the numbers in
[chessrank.org](https://chessrank.org/blog/chess-move-classifications) or
[chesssolve.com](https://chesssolve.com/blog/chess-com-move-classifications-explained))
do not cite Chess.com sources; treat them as **unverified**.

"Great move: turning a losing position into an equal one" cannot mean the
eval went up after the move, because the engine's eval before a move already
assumes the best move. Most likely it means the alternatives would have left
you losing, which is the same "only move" test below. This is an
interpretation, not something Chess.com states.

---

## 3. Third-party open implementations

All three are unofficial. Their numbers are their authors' choices, not
Chess.com's.

### WintrChess (GPL-3.0, active, ~260 stars)

The fullest Chess.com-style classifier found. `shared/src/lib/reporter/`
([link](https://github.com/WintrCat/wintrchess/tree/d145b20968955ca955cafe3fc3b51305f3bf41f9/shared/src/lib/reporter)):

- **Order of checks** (`classify.ts`): Forced (only one legal move) → Theory
  (position's FEN board part is in an openings JSON) → checkmate is Best →
  Best if the played move equals the engine's top move, else point-loss
  label → Critical (their Great) if top move and critical → Brilliant if
  Best-or-better and a sacrifice.
- **Expected points** (`expectedPoints.ts`): `1 / (1 + exp(-0.0035 * cp))`,
  mate = 1 or 0. Loss is clamped at 0.
- **Point-loss cutoffs** (`pointLoss.ts`, line 96): Best < 0.01, Excellent
  < 0.045, Okay < 0.08, Inaccuracy < 0.12, Mistake < 0.22, else Blunder.
  Separate tables for mate→mate, mate→cp and cp→mate (for example, cp → the
  opponent mates in 1 or 2 is a Blunder, in 3-5 a Mistake, longer an
  Inaccuracy).
- **Critical / Great** (`critical.ts`): the top move was played, and the
  **second-best line** loses at least 0.10 expected points ("10% loss =
  middle between inaccuracy and mistake"). Not if the mover has a forced
  mate, not if the move captures a free piece.
- **Shared guard** (`utils/criticalMove.ts`): neither Great nor Brilliant if
  the second-best line is still +700 cp or more for the mover ("still
  completely winning even if this move hadn't been found"), if the mover is
  worse after the move, if it is a queen promotion, or if the mover was in
  check.
- **Brilliant** (`brilliant.ts`, `utils/pieceSafety.ts`): after the move,
  the mover has a non-pawn, non-king piece that is "unsafe" (attacked by a
  cheaper piece, or more attackers than defenders, with some exceptions),
  worth more than anything the move captured; not a promotion; not just
  moving a piece out of danger; not a piece that was trapped anyway; not
  when the opponent taking it walks into an equal or bigger threat.
- **Engine input:** each position needs the top line and the second line
  (`topMove`, `secondTopLine`), so MultiPV 2. There is **no Miss label**.
- License is GPL-3.0; LiveChess is Apache-2.0, so reimplement ideas, do not
  copy code.

Its predecessor **Freechess** (same author,
[WintrCat/freechess](https://github.com/WintrCat/freechess), license
CC BY-NC-SA 4.0) used quadratic centipawn-loss formulas in
`src/lib/classification.ts` (for example Excellent if the loss is under
`0.0002*e^2 + 0.1231*e + 27.5` cp, where e is the previous eval). Superseded
by WintrChess; listed only for completeness.

### En Croissant (GPL-3.0, desktop app, ~1.9k stars)

`src/utils/score.ts`
([link](https://github.com/franciscoBSalgueiro/en-croissant/blob/23f83142fcbd4d3af60a524855defe8c9a5703fe/src/utils/score.ts#L34-L119)),
uses Lichess's curve and 1000 cp ceiling:

- `??` if win% drops more than 20, `?` more than 10, `?!` more than 5.
- With 2+ engine lines, if the played move is the top move and the second
  line is more than 10 win% worse: `!!` if it is a sacrifice, else `!` if
  the position improved more than 5 win% over two plies. A sacrifice that is
  not the only move and leaves the eval above -200 cp gets `!?`.
- Sacrifice test (`src-tauri/src/chess.rs`,
  [link](https://github.com/franciscoBSalgueiro/en-croissant/blob/23f83142fcbd4d3af60a524855defe8c9a5703fe/src-tauri/src/chess.rs#L511-L519)):
  a tiny capture-only search on material (P 90, N/B 300, R 500, Q 1000) for
  the position before and after the move; a sacrifice is when the mover's
  material outcome drops by more than 100. Cheaper and simpler than
  WintrChess's piece-safety rules.

---

## 4. What each label needs from the engine

"Eval before" is the stored eval on ply N-1, "eval after" is ply N.

| Label | Evals before/after | Engine best move (for ply N-1) | Second-best line (MultiPV 2) | Board/material check | Opening list |
|---|---|---|---|---|---|
| Inaccuracy / Mistake / Blunder | yes | no (only for "X was best" text) | no | Chess.com 2023: Blunder "loses material", optional | no |
| Excellent / Good | yes | yes, to tell apart from Best | no | no | no |
| Best | helpful | **yes** | no | no | no |
| Miss | yes, plus ply N-2 (was the opponent's move a mistake?) | no | no | no | no |
| Great (only move) | yes | yes | **yes** | no | no |
| Brilliant | yes | yes (best or near best) | recommended ("not completely winning anyway" guard) | **yes** (sacrifice) | no |
| Book | no | no | no | no | **yes** |
| Forced (WintrChess only) | no | no | no | legal move count | no |

Why Best needs the best move and not just "loss 0": the eval before and the
eval after come from two separate searches, so even the engine's own move
usually shows a small loss or gain. WintrChess and Lichess practice mode both
check "played move == engine best move" instead.

---

## 5. Implications for LiveChess

### What we already have

- One eval per ply, White's side, cp or mate, 300k nodes, tablebase results
  as +-20000 cp (`server/src/eval/`, `moves.eval_cp`, `eval_mate`,
  `eval_source`). The layout matches Lichess's `Info` (eval after the move),
  so Lichess's rules port directly.
- The same win% curve on the client (`client/src/lib/eval.ts`) and server
  (`server/src/api/hype.ts`).
- `Stockfish.evaluate` in `server/src/eval/engine.ts` already waits for the
  `bestmove` line and discards it. Keeping it costs no engine time.
- The Lichess tablebase response lists legal moves "best first" (Lichess
  API spec, `docs/Lichess API 1.json`), so tablebase plies can get a best
  move too.
- `chess.js` is already a server dependency (board, legal moves, attackers).

### What each label would add

| Label | Worker change | Storage | CPU cost on the free VM |
|---|---|---|---|
| Inaccuracy / Mistake / Blunder | none | none (computed from stored evals) or a label column | none |
| Excellent / Good | none | none | none |
| Miss | none | none | none |
| Best | parse `bestmove <uci>`; take `moves[0]` from tablebase | `best_uci` text on the ply N-1 row (best move *from* that position) | none |
| Great | `setoption name MultiPV value 2`, read the second line's score | second-best score (cp/mate) per position | see below |
| Brilliant | none in the engine; a sacrifice check with chess.js, plus Great's second line for the "winning anyway" guard | none or a label column | microseconds per move |
| Book | none; static lookup in Lichess's CC0 [`chess-openings`](https://github.com/lichess-org/chess-openings) TSVs (about 3,800 named lines in `a.tsv`...`e.tsv`) | none | none |

Book caveat: a named opening is not the same as sound theory (the list has
dubious gambits by name); Chess.com says it removes bad moves from its book.
The Lichess masters explorer (`explorer.lichess.org/masters`, see
`eval-options.md`) could confirm "played by masters" but is rate-limited to
one request at a time.

### MultiPV 2 cost

With a fixed node budget, MultiPV 2 does **not** cost more wall time: the
same 300k nodes are shared between two lines. What it costs is depth. The
Stockfish docs say "Leave at 1 for the best performance"
([Stockfish UCI docs](https://official-stockfish.github.io/docs/stockfish-wiki/UCI-Protocol-and-Stockfish-Commands.html)).

Quick local run (Stockfish 19, Apple M2, 1 thread, 300k nodes, 3 positions,
one run each, not a benchmark):

| Position | MultiPV 1 | MultiPV 2 |
|---|---|---|
| Scholar's-mate position | mate 1 found at 10k nodes, 4 ms (search stops early) | used all 300k nodes, 729 ms; line 2 at -255 cp |
| Queen's Gambit middlegame | depth 27, +181, best `a2a3`, 689 ms | depth 28/19, +195, best `c4d5`, 638 ms |
| Rook endgame | depth 23, 0.00, 361 ms | depth 21/15, 0.00, 372 ms |

Takeaways, with that caveat:

- Time per position stays about the same, so the worker's throughput on the
  free VM stays about the same.
- The main line's eval and even its best move can change (+181 `a2a3` vs
  +195 `c4d5`). Switching MultiPV mid-stream would mix two kinds of evals in
  the table, which ADR 0006's "fixed nodes so the same position gets the
  same eval" aims to avoid. It is a change to ADR 0006, not a small tweak.
- A cheaper option: keep MultiPV 1 for every ply, and only when the played
  move was the best move, run a second search restricted to the other legal
  moves (`go nodes N searchmoves <all legal moves except best>`, supported
  per the same Stockfish docs). This leaves stored evals untouched and adds
  one search only for plies that are Great/Brilliant candidates. How many
  plies that is at elite level is unknown; strong players play the engine's
  move often, so assume a large share (unverified, measure it).

### Recommendation (open for the owner)

1. Inaccuracy / Mistake / Blunder with Lichess's exact rules (5 / 10 / 15
   win% points, the mate table above). It is proven, uses the curve we
   already have, and needs no worker change.
2. Best by storing the best move the worker already gets. Nearly free.
   Excellent and Good come with it if wanted (Chess.com's 2 / 5 points).
3. Brilliant with a chess.js sacrifice check (En Croissant's material
   search is the simplest; WintrChess's piece safety is more precise), only
   on Best moves, and only if the mover is not worse after it.
4. Miss from evals only: the opponent's previous move was a Mistake or
   Blunder, the mover was then winning, and after this move is not.
5. Great and the second-line data as a separate decision.

### Sacrifice threshold (decided for #72)

Chess.com's own article
([How to play a brilliant move](https://www.chess.com/article/view/how-to-play-a-brilliant-move),
NM Jeremy Kane, updated 2024-02-07): "A brilliant move is usually a strong
sacrifice of a piece or an exchange (a rook for a knight or bishop)."
WintrChess ignores pawns and counts a piece left where a cheaper piece can
take it, so its smallest sacrifice is a minor for a pawn. En Croissant
counts a drop of more than 100 (pawn 90). LiveChess counts a net loss of
**200 or more**: minor for a pawn and the exchange count, a pawn alone
does not. No Chess.com staff source on pawn sacrifices was found.

## Open questions for the owner

1. **Which label set for the first version?** Lichess-style three bad labels
   only, or add Best right away? Excellent and Good add noise to the board
   (almost every move gets a badge); Chess.com shows them, Lichess does not.
2. **Lichess thresholds (Blunder from 15 points) or Chess.com's (Blunder
   from 20)?** Both start Inaccuracy at 5 and Mistake at 10. Lichess's are
   exact and public; Chess.com's curve behind them is not.
3. **What is "winning" for Miss and Brilliant?** Chess.com does not say.
   WintrChess uses +700 cp for "completely winning". A win% cut-off (for
   example 80%+ as winning, about +3.8 pawns on our curve) would be ours to
   choose.
4. **Great and MultiPV 2:** worth changing ADR 0006's search, or use the
   extra `searchmoves` search only for best-move plies, or skip Great for
   now?
5. **Book:** is the CC0 opening-name list good enough, or skip Book for
   elite games (most top games leave named lines quickly anyway)?
6. **Compute on read or store?** Labels can be derived from stored evals on
   the fly (client or API), or written to a column by the worker. Computing
   on read avoids stale labels when a ply's eval arrives late or a move is
   superseded; storing makes it queryable (for example "all blunders in this
   round" for commentary).
7. **Tablebase plies:** win→win with a slower move is not an error, but our
   +-20000 cp encoding makes any win→draw a big drop, which is correct. Do we
   want a label for "kept the tablebase win" at all?
