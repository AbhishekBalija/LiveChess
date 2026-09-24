import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { Link } from "react-router"
import { ChevronLeft, ChevronRight, LayoutGrid } from "lucide-react"
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
// game, then (on All live) a list of the events being played, each one
// click away from its grid. Boards themselves live in the grids.

// How many scoreboard cards the strip holds before the grid takes over.
const STRIP_CARDS = 12

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
        {tab.tournamentId && (
          <Link
            to={`/events/${tab.tournamentId}`}
            className="mx-4 -mb-2 flex w-fit items-center gap-2 rounded-full border border-line-strong px-4 py-2.5 text-sm font-semibold text-foreground hover:border-primary md:mx-8 lg:mx-12"
          >
            <LayoutGrid className="size-4" aria-hidden />
            Watch all {live.games?.filter((g) => g.tournament.id === tab.tournamentId).length ?? 0} boards
          </Link>
        )}
        {tab.finished ? (
          <FinishedGames />
        ) : (
          <LiveGames
            games={live.games?.filter((g) => !tab.tournamentId || g.tournament.id === tab.tournamentId) ?? null}
            startingSoon={tab.id === "live" ? <StartingSoon /> : null}
            oneEvent={Boolean(tab.tournamentId)}
          />
        )}
      </main>
    </AppShell>
  )
}

function LiveGames({
  games,
  startingSoon,
  oneEvent,
}: {
  games: GameListItem[] | null
  startingSoon: ReactNode
  oneEvent: boolean
}) {
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
  const [featured] = games
  return (
    <>
      <Strip>
        {games.slice(0, STRIP_CARDS).map((g) => (
          <MatchCard key={g.id} game={g} now={now} className="w-[300px] shrink-0 snap-start md:w-[330px]" />
        ))}
      </Strip>
      {startingSoon}
      {featured && <Featured game={featured} />}
      {!oneEvent && <LiveEvents games={games} />}
    </>
  )
}

type EventGroup = { id: string; name: string; subtitle: string | null; count: number }

// Live games grouped by event, biggest event first.
function byEvent(games: GameListItem[]): EventGroup[] {
  const groups = new Map<string, EventGroup>()
  for (const g of games) {
    const group = groups.get(g.tournament.id)
    if (group) {
      group.count += 1
      continue
    }
    const { title, subtitle } = splitTournamentName(g.tournament.name)
    groups.set(g.tournament.id, { id: g.tournament.id, name: title, subtitle, count: 1 })
  }
  return [...groups.values()].sort((x, y) => y.count - x.count)
}

// Every event being played, one click from its grid of boards. The
// subtitle tells apart events Lichess splits into several tours.
function LiveEvents({ games }: { games: GameListItem[] }) {
  const events = byEvent(games)
  return (
    <section aria-labelledby="live-events" className="flex flex-col gap-4 px-4 md:px-8 lg:px-12">
      <h2 id="live-events" className="text-[17px] font-bold md:text-lg">
        Live events
      </h2>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {events.map((event) => (
          <li key={event.id} className="min-w-0">
            <Link
              to={`/events/${event.id}`}
              className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3.5 transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[15px] font-bold">{event.name}</span>
                {event.subtitle && <span className="truncate text-sm text-muted-foreground">{event.subtitle}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-primary">
                <span aria-hidden className="size-2 rounded-full bg-live" />
                {event.count} {event.count === 1 ? "board" : "boards"}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
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

// Sideways strip; bleeds to the screen edge so a cut-off card hints at
// more. No visible scrollbar: touch and trackpads swipe, and desktop gets
// arrow buttons at either end while there is more to see that way.
function Strip({ children }: { children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: true, end: true })

  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    setEdges({ start: el.scrollLeft <= 1, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 })
  }, [])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure])

  const page = (direction: 1 | -1) => {
    const el = scroller.current
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" })
  }

  const arrow =
    "absolute top-1/2 z-10 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-line-strong bg-background/90 text-foreground shadow-lg backdrop-blur hover:border-primary md:flex"
  return (
    <div className="relative">
      <div
        ref={scroller}
        onScroll={measure}
        className="flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:scroll-px-8 md:gap-4 md:px-8 lg:scroll-px-12 lg:px-12 [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
      {!edges.start && (
        <button type="button" aria-label="Scroll left" onClick={() => page(-1)} className={`${arrow} left-3 lg:left-5`}>
          <ChevronLeft className="size-5" aria-hidden />
        </button>
      )}
      {!edges.end && (
        <button type="button" aria-label="Scroll right" onClick={() => page(1)} className={`${arrow} right-3 lg:right-5`}>
          <ChevronRight className="size-5" aria-hidden />
        </button>
      )}
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
