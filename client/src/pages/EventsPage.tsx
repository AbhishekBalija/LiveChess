import { Link } from "react-router"
import { ChevronRight } from "lucide-react"
import { AppShell } from "@/components/AppShell"
import { UpcomingCard } from "@/components/UpcomingCard"
import { useNow } from "@/lib/clock"
import { eventCards, showAsChips, type EventCard } from "@/lib/events"
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

// One card per event: the event name and its live total, then each of its
// tours (a row, or a chip when the names are short like "C9"), each one
// click from its grid. Cards flow in columns so heights never leave gaps.
function LiveEvents({ games }: { games: GameListItem[] }) {
  const cards = eventCards(games)
  return (
    <section aria-labelledby="live-events" className="flex flex-col gap-4">
      <h2 id="live-events" className="text-[17px] font-bold md:text-lg">
        Live now
      </h2>
      <ul className="gap-4 lg:columns-2">
        {cards.map((card) => (
          <li key={card.key} className="mb-4 break-inside-avoid">
            <EventCardView card={card} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function EventCardView({ card }: { card: EventCard }) {
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3.5">
        <h3 className="min-w-0 font-display text-lg leading-tight font-bold uppercase md:text-xl">{card.title}</h3>
        <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-muted-foreground">
          <span aria-hidden className="size-2 rounded-full bg-live" />
          {card.total} live
        </span>
      </header>
      {showAsChips(card) ? (
        <ul className="flex flex-wrap gap-2 p-3">
          {card.tours.map((tour) => (
            <li key={tour.tournamentId}>
              <Link
                to={`/events/${tour.tournamentId}`}
                className="flex items-center gap-2 rounded-full border border-line-strong px-3.5 py-2 text-sm hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="font-bold">{tour.label}</span>
                <span className="text-muted-foreground">{boards(tour.count)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-border">
          {card.tours.map((tour) => (
            <li key={tour.tournamentId}>
              <Link
                to={`/events/${tour.tournamentId}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
              >
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{tour.label}</span>
                <span className="shrink-0 text-sm text-muted-foreground">{boards(tour.count)}</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

const boards = (n: number): string => `${n} ${n === 1 ? "board" : "boards"}`
