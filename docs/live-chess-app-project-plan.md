# Live Chess App — Project Plan & Conversation Log

*A full record of how this project has developed in our conversation so far — the reasoning, the critiques, and the decisions — so nothing gets lost between sessions.*

*Historical: this log covers the design conversation before implementation
started (through architecture v4). Sections 4 and 5 below describe that
point in time; the schema, adapter and wireframe-equivalent screens they
list as not yet started have since been built. For current status, see
`docs/roadmap.md` and `CHANGELOG.md`.*

---

## 1. Executive Summary

**The pitch:** "CREX, but for chess" — a single app covering every chess game being played live, from small local tournaments to the world's biggest events, plus upcoming fixtures, rankings, news, and AI-generated commentary. Motivated by being a cricket fan and wanting the same universal live-coverage experience for chess, which nothing currently offers.

---

## 2. Project Timeline

### Stage 1 — Initial concept & market check
Uploaded original handwritten notes: overview, motivation (cricket fan wanting a CREX-equivalent for chess), and the core wishlist — live matches, upcoming matches/tournaments, rankings, news.

**Research findings:** no existing app does all of this well.
| App | Strength | Gap |
|---|---|---|
| Chess.com | Polished live coverage | Only major/elite events |
| ChessBase Live | Live GM games w/ analysis | Only top-tier tournaments |
| Lichess Broadcasts | Open to any organizer | No unified rankings/news |
| chess-results.com | Huge database (40,000+ events) | Dated, not built for live viewing |
| 2700chess.com | Wider net (norm-hunting opens) | Still niche |
| FollowChess | Multi-tournament watchlist | Still scoped to national/international |

**Key insight:** the gap isn't a UI problem — cricket apps can crowdsource grassroots scoring because anyone can manually score a match; chess needs real move transmission (electronic board or arbiter software), so most small tournaments simply have no live data source at all. This reframes "cover small tournaments" from a UI task into a data-supply problem.

### Stage 2 — Brainstorming
**Your ideas:** live commentary similar to CREX (if feasible); UI/UX quality as the main driver of adoption; take the best-fitting parts of CREX rather than copying it 1:1.

**My suggested ideas:** live win-probability/eval bar, multi-board grid view for tournament rounds, upset alerts, player profile pages (rating history + results), title-norm tracker, local tournament finder, auto-generated plain-language match recaps, blunder/brilliancy clips, fan predictions/polls, and a long-term "report this tournament live" mode for grassroots coverage.

**Resolution on commentary:** split into two tiers — human commentary only scales to marquee events (embed existing streams); AI-generated commentary can cover every game, including small tournaments, at near-zero marginal cost. This became the project's key differentiator.

### Stage 3 — Architecture v1
First proposal: Go (ingestion) + Node (API/WebSocket/AI) + PostgreSQL + Redis (Pub/Sub) + MongoDB (optional, for news/commentary logs).

### Stage 4 — External critique round 1 → resolved in v2
Raised: two backend languages without a proven bottleneck; Redis Pub/Sub is fire-and-forget (events lost if no subscriber); no distinction between live-event distribution and background job processing; Mongo unjustified; Stockfish evaluation coupled directly into ingestion; no control on commentary frequency; WebSocket delivery coupled to LLM latency; no missed-event recovery; no ingestion reliability story; chess-results.com scraping risk; "report tournament live" should be source-agnostic from day one, not bolted on later; DB schema undefined; "Postgres too slow for live" was an overstated claim.

**Changes made:** leaner v1 (one backend language — Go deferred until ingestion is a proven bottleneck), Redis Streams instead of Pub/Sub, dropped Mongo entirely, decoupled Stockfish into its own worker, added a `TournamentSource` adapter interface so new sources (including future organizer feeds) don't require core rewrites, corrected the Postgres-vs-Redis framing (durability vs. cheap distribution, not a performance claim).

### Stage 5 — External critique round 2 → resolved in v3
Raised: Redis Streams were still conflating the event log with the job queue; no backpressure policy if Stockfish falls behind (proposed "latest-position-wins"); no distinction between durable state / live state / event stream; Streams retention and durability weren't defined; adapters should emit normalized domain events, not source-tagged data; wanted explicit system invariants instead of a vague "80% improved" claim; wanted the design driven by 14 concrete failure scenarios rather than more component debate.

**Changes made:** separated the async job queue from the live event stream; added a Redis current-state cache distinct from the stream; made write ordering explicit (Postgres durable write happens before anything is published live); adopted latest-position-wins backpressure; wrote out 8 core invariants; answered all 14 failure scenarios, explicitly marking two as deferred rather than solved (Postgres-unavailable buffering, sudden large concurrent-board spikes) rather than hand-waving them.

### Stage 6 — External critique round 3 → resolved in v4 (current)
Raised: the biggest one — a **Postgres → Redis dual-write gap** (a process could crash after committing to Postgres but before publishing to Redis, silently losing the event); "unique constraint" alone can't distinguish a duplicate move from a correction to the same move; "resume from last persisted move" assumed a checkpoint capability the source might not have; needed an explicit rule for which Postgres representation is canonical; "latest-position-wins" needed an actual versioning mechanism, not just a policy statement; commentary significance needed deterministic chess-aware classification, not eval-delta alone; no cap on LLM calls per game; a race condition between a correction arriving and a stale evaluation completing; Redis's three roles (cache/stream/queue) needed explicit boundaries; requested a full "architecture contract" with concrete event-flow examples before moving to schema design.

**Changes made (current architecture):**
- **Transactional outbox pattern** — the outbox row is written in the same Postgres transaction as the move, so a crash between commit and publish can never silently lose an event; a separate publisher guarantees eventual delivery.
- **Move identity + versioning model** — `(game_id, move_number, source)` as identity key; same key + same notation = duplicate (no-op); same key + different notation = correction (`GameCorrected`, `Game.version += 1`). Every async job captures a `version` snapshot at creation and discards its result if the version has since moved on — this single mechanism solves both eval backpressure and the correction race condition.
- **Canonical data rule** — move history is canonical; `Game.current_fen`/`version` is a derived, cheap checkpoint, rebuilt from history if the two ever disagree.
- **Commentary cost control** — a deterministic chess-aware classifier (blunder, tactic, check, promotion, material swing) gates commentary before any LLM call, plus a rate limit and a hard per-game cap.
- **Resource responsibility table** — explicit boundaries between PostgreSQL, the Redis current-state cache, the Redis Stream, and BullMQ.
- **10 concrete event-flow examples** worked through end to end (normal move, duplicate, missed publish, Redis restart, client reconnect, stale eval, LLM failure, correction, duplicate ingestion workers, source reconnect).

### Stage 7 — Documentation & diagrams
Split project documentation into a **Technical Architecture Spec** (engineering audience) and a **Product Overview** (non-technical audience), published as living documents.

First attempt at flowcharts missed the mark — five separate narrow mechanism-level diagrams (outbox pattern, versioning, resync, commentary pipeline) instead of the overall picture, and the layout was cluttered with crossing arrows.

**Corrected:** two clean diagrams — an **Overall Architecture** diagram (layered: Sources → Ingestion → Data Layer → Live Consumers → API → Clients, with a single clean fan-out and secondary relationships written into box labels instead of extra crossing arrows) and an **Overall Flow** diagram (numbered end-to-end sequence of how one move moves through the whole system). Delivered as `.drawio` files for direct editing in draw.io.

### Stage 8 — Delivery format fix
Published docs (Artifact links) turned out not to be directly downloadable — they're view/share pages, not files. Fixed by delivering the underlying `.md` files directly as downloadable file cards instead.

### Stage 9 — This document
Consolidated project plan + full conversation log, so the whole history is in one place going forward.

---

## 3. Current Reference Documents

- **Technical Architecture Spec** — full v4 architecture: system diagram, invariants, move versioning & outbox pattern, resource responsibility table, commentary cost control, failure behavior, event-flow examples, data source integration notes, feature mapping, build order.
- **Product Overview** — vision, problem statement, competitive landscape, feature list, UI/UX principles, roadmap, all in plain language.
- **Overall Architecture diagram** (`.drawio`) — how everything connects.
- **Overall Flow diagram** (`.drawio`) — how a single move runs through the system, step by step.

*(All four are available as downloadable files from earlier in this conversation.)*

---

## 4. Known Open Items (not yet solved, by design)

- **Postgres unavailability** — not hardened in v1; ingestion would stall rather than gracefully buffer. Deferred past v1 intentionally.
- **Sudden large spikes in concurrent live boards** — no load-tested scaling story yet; deferred until it's a real problem.
- **chess-results.com integration** — scrape vs. partnership decision not yet made; isolated behind its own adapter so it doesn't block anything else.
- **Database schema** — not yet designed (Game/Move/Tournament/Round/Player/outbox_events entities).
- **Screens/wireframes** — not yet started.
- **Go for ingestion** — intentionally deferred until Node ingestion demonstrably becomes a bottleneck.

---

## 5. Suggested Next Steps

1. Postgres schema design (Game, Move, Tournament, Round, Player, outbox_events — following the event model established above, not designed independently of it).
2. Wireframes for the core screens (home/live feed, board view, multi-board grid).
