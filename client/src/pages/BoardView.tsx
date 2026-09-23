import { useEffect, useRef } from "react"
import { Link, useParams } from "react-router"
import { ChevronLeft } from "lucide-react"
import { AppShell } from "@/components/AppShell"
import { ChessBoard } from "@/components/ChessBoard"
import { SideDot } from "@/components/MatchCard"
import { paletteFor } from "@/lib/boardPalette"
import { runningClock, useNow } from "@/lib/clock"
import { changedSquares, START_FEN } from "@/lib/fen"
import { clocksOf, type GameState, type LiveMove } from "@/lib/game"
import { splitTournamentName } from "@/lib/names"
import { formatMove, moveNumber, sideToMove, type Side } from "@/lib/ply"
import { useLiveGame, type ConnectionStatus } from "@/lib/useLiveGame"

// Live board page (issue #19, Matchday design). Desktop: a scoreboard
// across the top (White left, status center, Black right, big clocks),
// then the board with the move list beside it. Phone: back header, the
// board between both players, moves below. Key moment cards join the
// side column when commentary lands (Slice 3). State comes from
// useLiveGame: resync over HTTP, live moves over the WebSocket.

export function BoardView() {
  const { id = "" } = useParams()
  const { state, status, notFound } = useLiveGame(id)
  const now = useNow()
  const palette = paletteFor(id)

  if (notFound || !id) {
    return (
      <AppShell>
        <div className="flex flex-col items-start gap-3 px-4 py-10 md:px-12">
          <p className="text-muted-foreground">Game not found.</p>
          <Link to="/" className="font-semibold">Back to live games</Link>
        </div>
      </AppShell>
    )
  }

  const tournament = state?.tournament ? splitTournamentName(state.tournament) : null
  const eventLine = tournament ? [tournament.title, tournament.subtitle].filter(Boolean).join(" · ") : "Live game"

  if (state === null) {
    return (
      <AppShell phoneChrome={false}>
        <PhoneHeader eventLine={eventLine} status={status} />
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3 px-4 py-6">
          <ChessBoard palette={palette} />
          <p role="status" className="text-sm text-muted-foreground">
            {status === "error"
              ? "Could not load this game."
              : status === "reconnecting"
                ? "Can't reach server, retrying..."
                : "Loading board..."}
          </p>
        </div>
      </AppShell>
    )
  }

  const toMove: Side = sideToMove(state.lastPly + 1)
  const lastMove = state.moves.get(state.lastPly) ?? null
  const prevFen = state.lastPly > 1 ? state.moves.get(state.lastPly - 1)?.fen : START_FEN
  const highlight = lastMove && prevFen ? changedSquares(prevFen, state.fen) : undefined
  const lastMoveAgo = state.lastMoveAt !== null && state.lastPly > 0 ? timeAgo(now - state.lastMoveAt) : null
  // Only the side to move's clock runs, and only while the game is on.
  const running = status === "live" && (state.result ?? "*") === "*" && state.lastPly > 0
  const lastClocks = clocksOf(state)
  const clocks = {
    white: runningClock(lastClocks.white, running && toMove === "white", state.lastMoveAt, now),
    black: runningClock(lastClocks.black, running && toMove === "black", state.lastMoveAt, now),
  }
  const white = state.white ?? "White"
  const black = state.black ?? "Black"
  const statusText = lastMove
    ? `${toMove === "white" ? "White" : "Black"} to move after ${formatMove(lastMove.ply, lastMove.san)}`
    : "Waiting for the first move"

  return (
    <AppShell phoneChrome={false}>
      <PhoneHeader eventLine={eventLine} status={status} />

      {/* Desktop: breadcrumb plus scoreboard */}
      <div className="hidden md:block">
        <div className="px-8 pt-5 text-[15px] text-muted-foreground lg:px-12">
          <Link to="/" className="text-muted-foreground hover:text-foreground">Live</Link>
          {" · "}
          {eventLine}
        </div>
        <section
          aria-label="Scoreboard"
          className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6 border-b border-border px-8 pt-7 pb-8 lg:px-12"
        >
          <ScoreSide side="white" name={white} clock={clocks.white} active={toMove === "white"} />
          <div className="flex flex-col items-center gap-2 text-center">
            <LiveBadge status={status} lastMoveAgo={lastMoveAgo} />
            <span className="text-xl font-bold text-gold lg:text-[26px]">{statusText}</span>
          </div>
          <ScoreSide side="black" name={black} clock={clocks.black} active={toMove === "black"} align="right" />
        </section>
      </div>

      <main className="mx-auto grid w-full max-w-[1440px] gap-6 pb-8 md:grid-cols-[minmax(0,640px)_minmax(0,1fr)] md:gap-10 md:px-8 md:pt-7 lg:px-12">
        <div className="flex flex-col">
          <PhonePlayer side="black" name={black} clock={clocks.black} active={toMove === "black"} />
          {/* Desktop: never taller than the screen under the scoreboard. */}
          <div className="px-4 md:max-w-[min(640px,calc(100svh-20rem))] md:px-0">
            <ChessBoard fen={state.fen} highlight={highlight} palette={palette} />
          </div>
          <PhonePlayer side="white" name={white} clock={clocks.white} active={toMove === "white"} />
          <p className="px-5 pt-1 text-sm font-bold text-gold md:hidden">{statusText}</p>
        </div>

        <section aria-labelledby="moves-heading" className="flex min-w-0 flex-col gap-4 px-4 md:px-0">
          <h2 id="moves-heading" className="text-lg font-bold md:text-xl">Moves</h2>
          <MoveList moves={state.moves} lastPly={state.lastPly} />
        </section>
      </main>
    </AppShell>
  )
}

// "just now", "40s ago", "3m ago". Next to "Live" it reads as "connected,
// and this is how long the player on move has been thinking".
function timeAgo(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 10) return "just now"
  if (seconds < 60) return `${seconds}s ago`
  return `${Math.floor(seconds / 60)}m ago`
}

function LiveBadge({ status, lastMoveAgo }: { status: ConnectionStatus; lastMoveAgo?: string | null }) {
  const live = status === "live"
  return (
    <span role="status" className="flex items-center gap-1.5 text-[13px] font-bold">
      <span aria-hidden className={`size-2 rounded-full ${live ? "bg-live" : "animate-pulse bg-gold"}`} />
      {live ? "Live" : status === "loading" ? "Connecting..." : "Reconnecting..."}
      {live && lastMoveAgo && <span className="font-medium text-muted-foreground">· last move {lastMoveAgo}</span>}
    </span>
  )
}

function PhoneHeader({ eventLine, status }: { eventLine: string; status: ConnectionStatus }) {
  return (
    <header className="flex items-center gap-1 px-3 pt-2.5 pb-3.5 md:hidden">
      <Link to="/" aria-label="Back to live games" className="flex size-11 items-center justify-center text-foreground">
        <ChevronLeft className="size-5" aria-hidden />
      </Link>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{eventLine}</span>
      <span className="pr-2">
        <LiveBadge status={status} />
      </span>
    </header>
  )
}

function ScoreSide({
  side,
  name,
  clock,
  active,
  align = "left",
}: {
  side: Side
  name: string
  clock: string | null
  active: boolean
  align?: "left" | "right"
}) {
  const right = align === "right"
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${right ? "items-end text-right" : "items-start"}`}>
      <span className={`flex min-w-0 items-center gap-2.5 text-lg font-bold lg:text-xl ${right ? "flex-row-reverse" : ""}`}>
        <SideDot side={side} className="size-3.5" />
        <span className="truncate">{name}</span>
      </span>
      <span
        className={`font-display text-[44px] leading-none font-bold tabular-nums lg:text-[52px] ${
          active ? "text-primary" : "text-foreground"
        }`}
      >
        {clock ?? "--:--"}
      </span>
    </div>
  )
}

function PhonePlayer({ side, name, clock, active }: { side: Side; name: string; clock: string | null; active: boolean }) {
  return (
    <div className="flex h-11 items-center justify-between px-5 md:hidden">
      <span className="flex min-w-0 items-center gap-2.5 text-[15px] font-semibold">
        <SideDot side={side} className="size-2.5" />
        <span className="truncate">{name}</span>
      </span>
      {clock && (
        <span className={`font-display text-2xl font-bold tabular-nums ${active ? "text-primary" : "text-muted-foreground"}`}>
          {clock}
        </span>
      )}
    </div>
  )
}

// Grouped notation, one row per move number: "12. Nf3 Nf6". Scrolls its
// own box (not the page) to the newest row.
function MoveList({ moves, lastPly }: { moves: GameState["moves"]; lastPly: number }) {
  const scroller = useRef<HTMLOListElement>(null)
  const plies = [...moves.keys()].sort((a, b) => a - b)
  const last = plies[plies.length - 1] ?? 0

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [last])

  if (plies.length === 0) {
    return <p className="rounded-lg bg-card px-4 py-6 text-sm text-muted-foreground">Waiting for the first move...</p>
  }

  const rows: Array<{ n: number; white?: LiveMove; black?: LiveMove }> = []
  for (let n = 1; n <= moveNumber(last); n++) {
    const white = moves.get(2 * n - 1)
    const black = moves.get(2 * n)
    if (white || black) rows.push({ n, white, black })
  }

  return (
    <ol
      ref={scroller}
      aria-label="Moves"
      className="max-h-80 overflow-y-auto rounded-lg bg-card py-2 font-mono text-[15px] md:max-h-[560px]"
    >
      {rows.map((row) => (
        <li key={row.n} className="grid grid-cols-[3.25rem_1fr_1fr] items-center px-2 odd:bg-white/[0.02]">
          <span className="pl-2 text-muted-foreground">{row.n}.</span>
          <MoveCell move={row.white} current={row.white?.ply === lastPly} />
          <MoveCell move={row.black} current={row.black?.ply === lastPly} />
        </li>
      ))}
    </ol>
  )
}

function MoveCell({ move, current }: { move?: LiveMove; current: boolean }) {
  if (!move) return <span />
  return (
    <span
      aria-current={current ? "step" : undefined}
      className={`mx-0.5 my-1 w-fit rounded-md px-2.5 py-1 ${current ? "bg-primary font-bold text-primary-foreground" : ""}`}
    >
      {move.san}
    </span>
  )
}
