# Live Chess App — Product Overview

*Non-technical companion to the Technical Architecture Spec. For anyone who wants to understand what this project is and why, without the engineering detail.*

---

## 1. Vision

A universal live-chess app — every chess game being played right now, from small local club tournaments to the world's biggest events, in one place.

The idea started from being a cricket fan: cricket has apps (like CREX) that cover every match happening anywhere, big or small, with live scores, upcoming fixtures, rankings, and news, all in one clean interface. Chess has nothing equivalent — existing apps either cover only a handful of elite tournaments beautifully, or cover thousands of tournaments in a dated, hard-to-use way. Nothing does both.

**The one-line pitch: "CREX, but for chess."**

---

## 2. The Problem

Existing options each solve part of the problem, none solve all of it:

| App / Site | What it's good at | Where it falls short |
|---|---|---|
| Chess.com | Polished live coverage, analysis | Only major/elite events |
| ChessBase Live | Live GM games with analysis | Only top-tier tournaments |
| Lichess Broadcasts | Open to any organizer, reaches smaller events | No unified rankings/news; coverage depends on someone opting in |
| chess-results.com | Huge database — 40,000+ tournaments, including grassroots | Pairings/standings only, dated interface, not built for live viewing |
| 2700chess.com | Wider net than the big sites (norm-hunting opens) | Still a niche audience, not mainstream-friendly |
| FollowChess | Multi-tournament watchlist | Still scoped to national/international events, not grassroots |

The gap isn't a missing feature — it's that nobody has unified "genuinely live, genuinely small-to-big, genuinely easy to use" into one product.

---

## 3. What Makes This Different

- **One app for everything live** — big events and small local tournaments, in a single feed, instead of five different sites.
- **AI-powered live insights for every game** — a win-probability indicator and live commentary generated automatically, so even a small tournament with no human commentator still feels covered.
- **Clean, fast, mobile-first design** — built around how a fan actually checks scores (quick glance, not a stat wall), not a dense professional-analysis tool.
- **A long-term path to true grassroots coverage** — a "report this tournament live" mode lets local organizers and arbiters bring their own events into the app, closing the gap that no existing product has solved.

---

## 4. Feature List (Plain Language)

- **Live matches** — every ongoing game across tracked tournaments, updating in real time.
- **Upcoming matches & tournaments** — what's coming up, across all levels.
- **Rankings** — official FIDE ratings, kept current.
- **News** — chess news from around the web, plus auto-generated recaps of matches as they finish.
- **Live win-probability bar** — a simple visual read of who's winning a given game, without needing to understand the position yourself.
- **AI live commentary** — plain-language, real-time explanation of what's happening in a game (a blunder, a tactical shot, a big swing), generated automatically for every tracked game.
- **Upset alerts** — notified when a lower-rated player is beating a much higher-rated one.
- **Title-norm tracker** — for fans following whether a player is on pace for a GM/IM norm mid-tournament.
- **Local tournament finder** — browse tournaments by city, rating category, entry fee.
- **Fan predictions/polls** — lightweight per-round engagement, similar to what cricket apps do.
- **(Future) Report this tournament live** — a lightweight tool for organizers/arbiters to bring their own local tournament's live moves into the app.

---

## 5. UI/UX Principles

- **What's live comes first.** The home screen leads with a horizontal strip of live matches, above any menu or navigation — nothing requires more than one tap to reach.
- **One-glance readability.** The win-probability bar does more work than a move list — most fans can read a bar swinging even if they can't read a position.
- **Not a stat wall.** Existing cricket-style apps (including CREX itself) lean text-dense. Chess fans lean more toward "let me see the position" — so the design stays cleaner than that, not a copy of it.
- **Dark mode by default** — matches how most chess audiences already prefer to browse.
- **Built for patchy mobile data** — live updates are kept lightweight so the app stays usable on average mobile connections, not just fast wifi.

---

## 6. Roadmap (Plain Language)

1. **Launch core experience** — live boards for major/available tournaments, with the win-probability bar and AI commentary working end to end.
2. **Round out the app** — rankings and news, so it doesn't feel like just a board viewer.
3. **Bring in the long tail** — player profiles and a local tournament finder, pulling from the broader tournament database.
4. **Engagement layer** — upset alerts, title-norm tracking, fan predictions.
5. **Close the grassroots gap** — the "report this tournament live" tool, once there's a real user base to test it with.
