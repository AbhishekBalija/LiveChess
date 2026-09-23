import { Link } from "react-router"
import { BoardPlaceholder } from "@/components/BoardPlaceholder"
import { moveNumber, sideToMove, type Side } from "@/lib/ply"
import type { GameListItem } from "@/types"

// One game in the home live strip. The whole card is a single link, so
// what is live is one tap away.

export function LiveGameCard({ game }: { game: GameListItem }) {
  const toMove: Side = sideToMove(game.lastPly + 1)
  return (
    <Link
      to={`/games/${game.id}`}
      className="flex w-[7.5rem] flex-col gap-2 rounded-lg border border-border bg-card p-2 transition hover:-translate-y-0.5 hover:border-white/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:w-[9.5rem]"
    >
      <BoardPlaceholder fen={game.fen || undefined} coords={false} />
      <div className="flex min-w-0 flex-col gap-0.5 text-xs">
        <PlayerLine side="white" name={game.white} active={game.lastPly > 0 && toMove === "white"} />
        <PlayerLine side="black" name={game.black} active={game.lastPly > 0 && toMove === "black"} />
      </div>
      <p className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
        {game.lastSan ? formatMove(game.lastPly, game.lastSan) : "Not started"}
      </p>
    </Link>
  )
}

function PlayerLine({ side, name, active }: { side: Side; name: string; active: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden
        className={`size-2 shrink-0 rounded-full ring-1 ring-white/30 ${
          side === "white" ? "bg-white" : "bg-stone-900"
        }`}
      />
      <span className={`truncate ${active ? "font-semibold text-foreground" : "text-foreground/80"}`}>
        {name}
      </span>
    </span>
  )
}

// "24. Rg4" for White, "24... Bd3" for Black.
function formatMove(ply: number, san: string): string {
  const n = moveNumber(ply)
  return sideToMove(ply) === "white" ? `${n}. ${san}` : `${n}... ${san}`
}

export function LiveGameCardSkeleton() {
  return (
    <div aria-hidden className="flex w-[7.5rem] flex-col gap-2 rounded-lg border border-border bg-card p-2 sm:w-[9.5rem]">
      <div className="aspect-square w-full animate-pulse rounded-md bg-white/5" />
      <div className="h-3 w-4/5 animate-pulse rounded bg-white/5" />
      <div className="h-3 w-3/5 animate-pulse rounded bg-white/5" />
      <div className="h-3 w-2/5 animate-pulse rounded bg-white/5" />
    </div>
  )
}
