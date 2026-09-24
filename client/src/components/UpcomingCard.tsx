import { Link } from "react-router"
import { ChevronRight } from "lucide-react"
import { splitTournamentName } from "@/lib/names"
import { countdown, startLabel } from "@/lib/upcoming"
import type { UpcomingRound } from "@/types"

// A round that has not started yet, in the same scoreboard-card shape as
// MatchCard: event header, round, start time big, countdown in grey. It
// opens the round page (#51), which becomes the live grid at the start.

export function UpcomingCard({ round, now, className = "" }: { round: UpcomingRound; now: number; className?: string }) {
  const { title, subtitle } = splitTournamentName(round.tournament)
  return (
    <Link
      to={`/rounds/${round.roundId}`}
      className={`flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${className}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 text-sm font-bold">
        <span className="truncate">{title}</span>
        <ChevronRight className="size-4 shrink-0" aria-hidden />
      </div>
      <div className="flex flex-col gap-2 px-4 pt-3.5 pb-4">
        <span className="truncate text-xs text-muted-foreground">{[subtitle, round.round].filter(Boolean).join(" · ")}</span>
        <span className="font-display text-[28px] leading-none font-bold">{startLabel(round.startsAt, now)}</span>
        <span className="text-[13px] font-bold text-muted-foreground">Starts {countdown(round.startsAt, now)}</span>
      </div>
    </Link>
  )
}
