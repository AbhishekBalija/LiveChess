import { Link } from "react-router"
import { ChevronRight } from "lucide-react"
import { EvalBar } from "@/components/EvalBar"
import { runningClock } from "@/lib/clock"
import { barPercent, formatEval, listEval } from "@/lib/eval"
import { formatMove, sideToMove, type Side } from "@/lib/ply"
import { resultLine, splitTournamentName } from "@/lib/names"
import type { GameListItem } from "@/types"

// Scoreboard card for one game (issue #19, CREX-style): event header,
// both players with their clocks, and one colored status line. Lime is
// the side to move and live moves, green is a result.

// `now` makes the side to move's clock run between polls (home ticks it).
export function MatchCard({ game, now, className = "" }: { game: GameListItem; now?: number; className?: string }) {
  const { title, subtitle } = splitTournamentName(game.tournament.name)
  const live = game.result === "*"
  const toMove: Side | null = live && game.lastPly > 0 ? sideToMove(game.lastPly + 1) : null
  const since = Date.parse(game.updatedAt)
  const evalNow = listEval(game)
  const evalText = live && evalNow ? formatEval(evalNow) : null
  const clock = (value: string | null, side: Side) =>
    runningClock(value, now !== undefined && toMove === side, Number.isNaN(since) ? null : since, now ?? 0)
  return (
    <Link
      to={`/games/${game.id}`}
      className={`flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${className}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 text-sm font-bold">
        <span className="truncate">{title}</span>
        <ChevronRight className="size-4 shrink-0" aria-hidden />
      </div>
      <div className="flex flex-col gap-3 px-4 pt-3.5 pb-4">
        {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
        <PlayerRow side="white" name={game.white} clock={clock(game.whiteClock, "white")} active={toMove === "white"} />
        <PlayerRow side="black" name={game.black} clock={clock(game.blackClock, "black")} active={toMove === "black"} />
        <div className="flex items-center justify-between gap-2.5">
          {live ? (
            <span className="text-[13px] font-bold text-primary">
              Live{game.lastSan ? ` · ${formatMove(game.lastPly, game.lastSan)}` : " · not started"}
            </span>
          ) : (
            <span className="text-[13px] font-bold text-win">{resultLine(game.result, game.white, game.black)}</span>
          )}
          {evalText && <span className="font-mono text-xs text-muted-foreground">{evalText}</span>}
        </div>
      </div>
      <EvalBar
        whitePercent={barPercent(game.result, evalNow, game.lastPly)}
        label={evalText}
        className="mt-auto h-1"
      />
    </Link>
  )
}

export function SideDot({ side, className = "size-3" }: { side: Side; className?: string }) {
  return (
    <span
      aria-hidden
      className={`shrink-0 rounded-full ${className} ${
        side === "white" ? "bg-white" : "bg-background ring-1 ring-muted-foreground"
      }`}
    />
  )
}

function PlayerRow({ side, name, clock, active }: { side: Side; name: string; clock: string | null; active: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2.5">
      <span className="flex min-w-0 items-center gap-2.5 text-[15px] font-semibold">
        <SideDot side={side} />
        <span className="truncate">{name}</span>
      </span>
      {clock && (
        <span className={`font-display text-xl font-bold tabular-nums ${active ? "text-primary" : "text-foreground"}`}>
          {clock}
        </span>
      )}
    </div>
  )
}

export function MatchCardSkeleton({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`flex flex-col gap-3 rounded-lg border border-border bg-card p-4 ${className}`}>
      <div className="h-4 w-3/5 animate-pulse rounded bg-secondary" />
      <div className="h-4 w-4/5 animate-pulse rounded bg-secondary" />
      <div className="h-4 w-4/5 animate-pulse rounded bg-secondary" />
      <div className="h-3 w-2/5 animate-pulse rounded bg-secondary" />
    </div>
  )
}
