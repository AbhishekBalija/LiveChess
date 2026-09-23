import { Children, type ReactNode } from "react"
import { LiveGameCard, LiveGameCardSkeleton } from "@/components/LiveGameCard"
import { useLiveGames } from "@/lib/useLiveGames"
import type { GameListItem } from "@/types"

// Home leads with what is live (product principle: live first, one tap
// to any board). Games are grouped by tournament, each group a
// horizontal strip that scrolls sideways on phones.

interface TournamentGroup {
  id: string
  title: string
  subtitle: string | null
  games: GameListItem[]
}

// Lichess names look like "46th FIDE Chess Olympiad 2026 | Open | Matches 1-12".
// First part is the title, the rest reads better as a quiet subtitle.
export function splitTournamentName(name: string): { title: string; subtitle: string | null } {
  const [title = name, ...rest] = name.split("|").map((part) => part.trim()).filter(Boolean)
  return { title, subtitle: rest.length > 0 ? rest.join(" · ") : null }
}

// Groups keep the order of their first game, which is already stable.
function groupByTournament(games: GameListItem[]): TournamentGroup[] {
  const groups = new Map<string, TournamentGroup>()
  for (const game of games) {
    let group = groups.get(game.tournament.id)
    if (!group) {
      group = { id: game.tournament.id, ...splitTournamentName(game.tournament.name), games: [] }
      groups.set(game.tournament.id, group)
    }
    group.games.push(game)
  }
  return [...groups.values()]
}

export function Home() {
  const { games, failing } = useLiveGames()
  const groups = games ? groupByTournament(games) : []

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-4">
      <header className="flex flex-col gap-1 pt-2">
        <h1 className="text-2xl font-bold tracking-tight">LiveChess</h1>
        <p className="text-sm text-muted-foreground">Live boards from grassroots to elite events.</p>
      </header>

      <section aria-labelledby="live-now" className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          <h2 id="live-now" className="flex items-center gap-2 text-sm font-semibold tracking-wide uppercase">
            <span aria-hidden className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-red-500" />
            </span>
            Live now
            {games && games.length > 0 && (
              <span className="font-normal text-muted-foreground tabular-nums">{games.length}</span>
            )}
          </h2>
          {failing && (
            <span role="status" className="text-xs text-amber-400">
              Can't reach server, retrying...
            </span>
          )}
        </div>

        {games === null ? (
          <Strip label="Loading live games">
            {Array.from({ length: 6 }, (_, i) => (
              <LiveGameCardSkeleton key={i} />
            ))}
          </Strip>
        ) : groups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            No live games right now.
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.id} aria-label={group.title} className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold">{group.title}</h3>
                  {group.subtitle && (
                    <p className="truncate text-xs text-muted-foreground">{group.subtitle}</p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {group.games.length} live
                </span>
              </div>
              <Strip label={`${group.title} live games`}>
                {group.games.map((game) => (
                  <LiveGameCard key={game.id} game={game} />
                ))}
              </Strip>
            </section>
          ))
        )}
      </section>
    </main>
  )
}

// Sideways strip. Bleeds to the screen edge on phones so the cut-off
// card hints that there is more to scroll.
function Strip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul
      aria-label={label}
      className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pt-1 pb-3 [scrollbar-width:thin]"
    >
      {Children.map(children, (child) => (
        <li className="shrink-0 snap-start">{child}</li>
      ))}
    </ul>
  )
}
