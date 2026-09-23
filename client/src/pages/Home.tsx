import { useState, type ReactNode } from "react"
import { Link } from "react-router"
import { AppShell } from "@/components/AppShell"
import { ChessBoard } from "@/components/ChessBoard"
import { MatchCard, MatchCardSkeleton } from "@/components/MatchCard"
import { UpcomingCard } from "@/components/UpcomingCard"
import { paletteFor } from "@/lib/boardPalette"
import { useNow } from "@/lib/clock"
import { splitTournamentName, surname } from "@/lib/names"
import { formatMove, sideToMove } from "@/lib/ply"
import { useUpcoming } from "@/lib/upcoming"
import { useLiveGames } from "@/lib/useLiveGames"
import type { GameListItem } from "@/types"

// Home (issue #19, Matchday design). What is live comes first: a tab row
// of competitions, a sideways strip of scoreboard cards, the featured
// game, then every other live board, each in its own board colors.

type Tab = { id: string; label: string; tournamentId?: string; finished?: boolean }

function tabsFor(games: GameListItem[]): Tab[] {
  const tournaments = new Map<string, { name: string; count: number }>()
  for (const g of games) {
    const t = tournaments.get(g.tournament.id) ?? { name: splitTournamentName(g.tournament.name).title, count: 0 }
    t.count += 1
    tournaments.set(g.tournament.id, t)
  }
  return [
    { id: "live", label: `All live (${games.length})` },
    ...[...tournaments].map(([id, t]) => ({ id, label: `${t.name} (${t.count})`, tournamentId: id })),
    { id: "finished", label: "Finished", finished: true },
  ]
}

export function Home() {
  const [tabId, setTabId] = useState("live")
  const live = useLiveGames("live")
  const tabs = tabsFor(live.games ?? [])
  const tab = tabs.find((t) => t.id === tabId) ?? tabs[0]!

  return (
    <AppShell>
      <div role="tablist" aria-label="Competitions" className="flex gap-7 overflow-x-auto border-b border-border px-4 [scrollbar-width:none] md:px-8 lg:px-12">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab.id}
            onClick={() => setTabId(t.id)}
            className={`h-12 shrink-0 border-b-[3px] text-sm font-semibold whitespace-nowrap md:text-[15px] ${
              t.id === tab.id ? "border-live font-bold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-8 py-6 md:py-8">
        {live.failing && (
          <p role="status" className="px-4 text-sm text-destructive md:px-8 lg:px-12">
            Can't reach server, retrying...
          </p>
        )}
        {tab.finished ? (
          <FinishedGames />
        ) : (
          <LiveGames
            games={live.games?.filter((g) => !tab.tournamentId || g.tournament.id === tab.tournamentId) ?? null}
            startingSoon={tab.id === "live" ? <StartingSoon /> : null}
          />
        )}
      </main>
    </AppShell>
  )
}

function LiveGames({ games, startingSoon }: { games: GameListItem[] | null; startingSoon: ReactNode }) {
  const now = useNow()
  if (games === null) {
    return (
      <Strip>
        {Array.from({ length: 4 }, (_, i) => (
          <MatchCardSkeleton key={i} className="w-[300px] shrink-0 md:w-[330px]" />
        ))}
      </Strip>
    )
  }
  if (games.length === 0) {
    return (
      <>
        <p className="mx-4 rounded-lg border border-dashed border-line-strong px-4 py-12 text-center text-sm text-muted-foreground md:mx-8 lg:mx-12">
          No live games right now.
        </p>
        {startingSoon}
      </>
    )
  }
  const [featured, ...rest] = games
  return (
    <>
      <Strip>
        {games.map((g) => (
          <MatchCard key={g.id} game={g} now={now} className="w-[300px] shrink-0 snap-start md:w-[330px]" />
        ))}
      </Strip>
      {startingSoon}
      {featured && <Featured game={featured} />}
      {rest.length > 0 && (
        <section aria-labelledby="more-boards" className="flex flex-col gap-4 px-4 md:px-8 lg:px-12">
          <h2 id="more-boards" className="text-[17px] font-bold md:text-lg">More live boards</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-5 lg:grid-cols-4">
            {rest.map((g) => (
              <li key={g.id}>
                <BoardTile game={g} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function FinishedGames() {
  const { games } = useLiveGames("finished")
  if (games === null) {
    return (
      <div className="grid gap-4 px-4 sm:grid-cols-2 md:px-8 lg:grid-cols-3 lg:px-12">
        {Array.from({ length: 3 }, (_, i) => (
          <MatchCardSkeleton key={i} />
        ))}
      </div>
    )
  }
  if (games.length === 0) {
    return <p className="px-4 text-sm text-muted-foreground md:px-8 lg:px-12">No finished games yet.</p>
  }
  return (
    <ul className="grid gap-4 px-4 sm:grid-cols-2 md:px-8 lg:grid-cols-3 lg:px-12">
      {games.map((g) => (
        <li key={g.id}>
          <MatchCard game={g} />
        </li>
      ))}
    </ul>
  )
}

// Rounds that have not started yet. Hidden when there are none.
function StartingSoon() {
  const rounds = useUpcoming()
  const now = useNow(30_000)
  if (rounds.length === 0) return null
  return (
    <section aria-labelledby="starting-soon" className="flex flex-col gap-3">
      <h2 id="starting-soon" className="px-4 text-[17px] font-bold md:px-8 md:text-lg lg:px-12">
        Starting soon
      </h2>
      <Strip>
        {rounds.map((r) => (
          <UpcomingCard key={r.roundId} round={r} now={now} className="w-[260px] shrink-0 snap-start md:w-[280px]" />
        ))}
      </Strip>
    </section>
  )
}

// Sideways strip; bleeds to the screen edge so a cut-off card hints at more.
function Strip({ children }: { children: ReactNode }) {
  return (
    <div className="flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:thin] md:scroll-px-8 md:gap-4 md:px-8 lg:scroll-px-12 lg:px-12">
      {children}
    </div>
  )
}

function Featured({ game }: { game: GameListItem }) {
  const toMove = sideToMove(game.lastPly + 1) === "white" ? "White" : "Black"
  return (
    <section aria-labelledby="featured" className="px-4 md:px-8 lg:px-12">
      <h2 id="featured" className="mb-3 text-[17px] font-bold md:sr-only">Featured game</h2>
      <Link
        to={`/games/${game.id}`}
        className="flex gap-4 rounded-[20px] bg-card p-3.5 transition-colors hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:gap-7 md:p-6"
      >
        <div className="w-[120px] shrink-0 md:w-[320px]">
          <ChessBoard fen={game.fen || undefined} palette={paletteFor(game.id)} coords={false} />
        </div>
        <div className="flex min-w-0 flex-col gap-2 md:gap-4">
          <span className="hidden text-xs font-bold tracking-[0.08em] text-muted-foreground uppercase md:block">
            Featured game
          </span>
          <span className="font-display text-xl leading-[1.05] font-bold uppercase md:text-4xl">
            {surname(game.white)} <span className="text-muted-foreground">vs</span> {surname(game.black)}
          </span>
          <span className="text-[13px] font-bold text-gold md:text-xl">
            {game.lastSan ? `${toMove} to move after ${formatMove(game.lastPly, game.lastSan)}` : "Not started yet"}
          </span>
          <span className="truncate text-[13px] text-muted-foreground md:text-sm">
            {splitTournamentName(game.tournament.name).title}
          </span>
        </div>
      </Link>
    </section>
  )
}

function BoardTile({ game }: { game: GameListItem }) {
  return (
    <Link
      to={`/games/${game.id}`}
      className="flex flex-col gap-2 rounded-lg p-0 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:gap-3 md:bg-card md:p-4 md:hover:bg-secondary/60"
    >
      <ChessBoard fen={game.fen || undefined} palette={paletteFor(game.id)} coords={false} />
      <div className="flex min-w-0 flex-col gap-0.5 md:gap-1">
        <span className="truncate text-xs font-semibold md:text-sm md:font-bold">{game.white}</span>
        <span className="hidden truncate text-sm text-muted-foreground md:block">{game.black}</span>
        <span className="font-display text-[15px] font-bold text-primary md:text-lg">
          {game.lastSan ? formatMove(game.lastPly, game.lastSan) : "Not started"}
        </span>
      </div>
    </Link>
  )
}
