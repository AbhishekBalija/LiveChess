# Live Chess App — High-Level Flowcharts

*Plain-language overview diagrams covering the whole project — what the app does, how people use it, where the data comes from, how it works under the hood, and where it's headed. For deep technical detail, see the Technical Architecture Spec.*

*These are the original target diagrams, drawn before implementation
started. Live boards and clocks are built; the win-probability bar,
commentary, rankings and news in diagrams 1-2 and 4-5 are not built yet.
Diagram 6 is the original high-level phasing; for the current, detailed
Slice-by-Slice plan and delivery status see `docs/roadmap.md`.*

---

## 1. How the App is Organized

```mermaid
flowchart TD
    A[Open the App] --> B[Home Screen]
    B --> C[Live Matches]
    B --> D[Upcoming Matches]
    B --> E[Rankings]
    B --> F[News]
    C --> G[Tap a Match]
    G --> H[Live Board View]
    H --> I[Win-Probability Bar]
    H --> J[Live Commentary]
    H --> K[Move List]
```

---

## 2. How Someone Uses the App

```mermaid
flowchart TD
    A[User opens the app] --> B[Sees what's live right now]
    B --> C{Interested in a match?}
    C -- Yes --> D[Taps into that match]
    D --> E[Watches the board update live]
    E --> F[Sees who's winning - eval bar]
    E --> G[Reads live commentary]
    C -- No --> H[Checks upcoming matches, rankings, or news]
    F --> I[Follows the match to the end]
    G --> I
    H --> I
```

---

## 3. Where the App Gets Its Data

```mermaid
flowchart LR
    A[Lichess - live games] --> E[App collects and combines it all]
    B[chess-results.com - tournaments big & small] --> E
    C[FIDE - official ratings] --> E
    D[News sites] --> E
    E --> F[Shown to users in one clean place]
```

---

## 4. How the App Works, Simply Put

```mermaid
flowchart TD
    A[Chess games happening around the world] --> B[App receives the moves]
    B --> C[App saves every move safely]
    C --> D[App shares the update live]
    D --> E[Players & fans see the move instantly]
    D --> F[App works out who's winning]
    D --> G[App writes simple live commentary]
    F --> E
    G --> E
```

---

## 5. What Happens When One Move is Played

```mermaid
flowchart TD
    A[A move is played somewhere] --> B[App receives the move]
    B --> C[App checks: new move, repeat, or a correction?]
    C --> D[App saves the move]
    D --> E[App tells everyone watching]
    E --> F[Board updates on your screen]
    E --> G[Win-probability bar updates]
    E --> H[Commentary appears, if it's a notable moment]
    F --> I{Did your app miss an update?}
    I -- Yes --> J[App fetches the latest position for you]
    I -- No --> K[You're already caught up]
```

---

## 6. Project Roadmap

```mermaid
flowchart TD
    A[Phase 1: Live boards for major events] --> B[Phase 2: Rankings & news]
    B --> C[Phase 3: Player profiles & local tournament search]
    C --> D[Phase 4: Alerts, norm tracker, fan predictions]
    D --> E[Phase 5: Let organizers report their own local tournaments live]
```
