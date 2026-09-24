import { Link, useParams } from "react-router"
import { ArrowUpRight, ChevronLeft } from "lucide-react"
import { AppShell } from "@/components/AppShell"
import { SideDot } from "@/components/MatchCard"
import { useNow } from "@/lib/clock"
import { splitTournamentName } from "@/lib/names"
import { roundPhase, useRound, type RoundPhase } from "@/lib/round"
import { countdown, startLabel } from "@/lib/upcoming"
import { useLiveGames } from "@/lib/useLiveGames"
import type { RoundPlayer } from "@/types"
import { BoardGrid } from "@/pages/EventBoards"

// One Lichess round (#51), opened from "Starting soon". Before the start:
// the event, a big start time and countdown, and the pairings. Once
// LiveChess has its games, the same page is the live grid, so a link
// shared before the start keeps working. Lichess ids are used because the
// round is not in our database until it starts.
export function RoundPage() {
  const { roundId = "" } = useParams()
  const { round, notFound, failing } = useRound(roundId)
  const { games } = useLiveGames("live", 3_000)
  const now = useNow()
  const boards = games?.filter((g) => g.roundId === roundId) ?? []

  if (notFound) {
    return (
      <AppShell>
        <div className="flex flex-col items-start gap-3 px-4 py-10 md:px-12">
          <p className="text-muted-foreground">Round not found.</p>
          <Link to="/" className="font-semibold">Back to live games</Link>
        </div>
      </AppShell>
    )
  }

  const name = round ? splitTournamentName(round.tournament) : null
  const phase: RoundPhase | null = round ? roundPhase(round, boards.length, now) : null
  const facts = round ? [round.format, round.timeControl, round.location].filter(Boolean).join(" · ") : ""

  return (
    <AppShell>
      <header className="flex flex-col gap-1 border-b border-border px-4 pt-4 pb-6 md:px-8 md:pt-6 md:pb-8 lg:px-12">
        <Link to="/" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden />
          Live
        </Link>
        <h1 className="font-display text-3xl leading-tight font-bold uppercase md:text-4xl">
          {name?.title ?? "Round"}
        </h1>
        {round && (
          <p className="text-sm text-muted-foreground md:text-[15px]">
            {[name?.subtitle, round.round].filter(Boolean).join(" · ")}
            {phase === "live" && ` · ${boards.length} live ${boards.length === 1 ? "board" : "boards"}`}
          </p>
        )}
        {round?.startsAt && (phase === "upcoming" || phase === "starting") && (
          <div className="mt-4 flex flex-col gap-1">
            <span className="font-display text-4xl leading-none font-bold md:text-5xl">
              {startLabel(round.startsAt, now)}
            </span>
            <span className="text-base font-bold text-gold md:text-lg">
              {phase === "upcoming" ? `Starts ${countdown(round.startsAt, now)}` : "Starting now"}
            </span>
          </div>
        )}
        {facts && phase !== "live" && <p className="mt-2 text-sm text-muted-foreground">{facts}</p>}
      </header>

      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 md:px-8 md:py-8 lg:px-12">
        {failing && (
          <p role="status" className="text-sm text-destructive">
            Can't reach server, retrying...
          </p>
        )}
        {round === null || phase === null ? (
          <p className="text-sm text-muted-foreground">Loading round...</p>
        ) : phase === "live" ? (
          <BoardGrid games={boards} now={now} />
        ) : (
          <>
            <PhaseMessage phase={phase} url={round.url} />
            {phase !== "finished" && <Pairings pairings={round.pairings} />}
          </>
        )}
      </main>
    </AppShell>
  )
}

function PhaseMessage({ phase, url }: { phase: Exclude<RoundPhase, "live">; url: string }) {
  const text = {
    upcoming: "The boards go live here as soon as the round starts.",
    starting: "The round is starting. Boards appear here within a few minutes.",
    uncovered: "This round is live on Lichess, but LiveChess isn't covering it right now.",
    finished: "This round has finished.",
  }[phase]
  const showLichess = phase === "uncovered" || phase === "finished"
  return (
    <div role="status" className="flex flex-col gap-3 rounded-lg border border-dashed border-line-strong px-5 py-6 md:flex-row md:items-center md:justify-between">
      <p className="flex items-center gap-2.5 text-[15px] font-semibold">
        {(phase === "upcoming" || phase === "starting") && (
          <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-gold" />
        )}
        {text}
      </p>
      {showLichess && (
        <a href={url} target="_blank" rel="noreferrer" className="flex w-fit items-center gap-1 text-sm font-semibold">
          Watch on Lichess
          <ArrowUpRight className="size-4" aria-hidden />
        </a>
      )}
    </div>
  )
}

// Board-by-board pairings, White first, as the organizer published them.
function Pairings({ pairings }: { pairings: Array<{ white: RoundPlayer; black: RoundPlayer }> }) {
  if (pairings.length === 0) {
    return <p className="text-sm text-muted-foreground">Pairings are not published yet.</p>
  }
  return (
    <section aria-labelledby="pairings" className="flex flex-col gap-4">
      <h2 id="pairings" className="text-lg font-bold md:text-xl">
        Pairings
      </h2>
      <ol className="grid gap-x-8 gap-y-2 lg:grid-cols-2">
        {pairings.map((p, i) => (
          <li
            key={i}
            className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-lg bg-card px-3 py-3"
          >
            <span className="font-mono text-sm text-muted-foreground">{i + 1}</span>
            <PlayerCell side="white" player={p.white} />
            <span className="text-xs font-bold text-muted-foreground uppercase">vs</span>
            <PlayerCell side="black" player={p.black} align="right" />
          </li>
        ))}
      </ol>
    </section>
  )
}

function PlayerCell({ side, player, align = "left" }: { side: "white" | "black"; player: RoundPlayer; align?: "left" | "right" }) {
  const right = align === "right"
  return (
    <span className={`flex min-w-0 items-center gap-2 ${right ? "flex-row-reverse text-right" : ""}`}>
      <SideDot side={side} className="size-2.5" />
      <span className="flex min-w-0 flex-col">
        <span className={`flex min-w-0 items-center gap-1.5 text-sm font-semibold ${right ? "flex-row-reverse" : ""}`}>
          {player.title && (
            <span className="shrink-0 rounded bg-gold px-1 text-[10px] font-extrabold text-background">{player.title}</span>
          )}
          <span className="truncate">{player.name}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {[player.rating, player.fed].filter((v) => v !== null).join(" · ") || "Unrated"}
        </span>
      </span>
    </span>
  )
}
