import { GameCard } from "@/components/GameCard"
import { placeholderGames } from "@/data/mock"

export function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">LiveChess</h1>
        <p className="text-sm text-muted-foreground">
          Live boards from grassroots to elite events.
        </p>
      </header>
      <section aria-label="Live now" className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Live now
        </h2>
        <div className="grid grid-cols-1 gap-3">
          {placeholderGames.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      </section>
    </main>
  )
}
