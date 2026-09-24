import { Link } from "react-router"
import { ChevronRight } from "lucide-react"
import { AppShell } from "@/components/AppShell"
import { UpcomingCard } from "@/components/UpcomingCard"
import { useNow } from "@/lib/clock"
import { splitTournamentName } from "@/lib/names"
import { useUpcoming } from "@/lib/upcoming"
import { useLiveGames } from "@/lib/useLiveGames"
import type { GameListItem } from "@/types"

// Events tab: what is being played now, each event one click from its
// grid of boards, then the rounds starting soon.
export function EventsPage() {
  const { games, failing } = useLiveGames("live")
  const rounds = useUpcoming()
  const now = useNow(30_000)
  return (
    <AppShell>
      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-10 px-4 py-6 md:px-8 md:py-8 lg:px-12">
        <h1 className="font-display text-3xl leading-tight font-bold uppercase md:text-4xl">Events</h1>
        {failing && (
          <p role="status" className="-mt-6 text-sm text-destructive">
            Can't reach server, retrying...
          </p>
        )}
        {games === null ? (
          <p className="text-sm text-muted-foreground">Loading events...</p>
        ) : games.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events are live right now.</p>
        ) : (
          <LiveEvents games={games} />
        )}
        {rounds.length > 0 && (
          <section aria-labelledby="starting-soon" className="flex flex-col gap-4">
            <h2 id="starting-soon" className="text-[17px] font-bold md:text-lg">
              Starting soon
            </h2>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {rounds.map((r) => (
                <li key={r.roundId} className="min-w-0">
                  <UpcomingCard round={r} now={now} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </AppShell>
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
    <section aria-labelledby="live-events" className="flex flex-col gap-4">
      <h2 id="live-events" className="text-[17px] font-bold md:text-lg">
        Live now
      </h2>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {events.map((event) => (
          <li key={event.id} className="min-w-0">
            <Link
              to={`/events/${event.id}`}
              className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3.5 transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                {/* Two lines, not one: several events differ only at the end of
                    their name ("... MA-WM C9", "... MA-WM C11"). */}
                <span className="line-clamp-2 text-[15px] font-bold">{event.name}</span>
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

