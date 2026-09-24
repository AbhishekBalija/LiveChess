import { useEffect, useRef, type ReactNode } from "react"
import { Link, useParams } from "react-router"
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"
import { AppShell } from "@/components/AppShell"
import { ChessBoard } from "@/components/ChessBoard"
import { SideDot } from "@/components/MatchCard"
import { paletteFor } from "@/lib/boardPalette"
import { runningClock, useNow } from "@/lib/clock"
import { EvalBar } from "@/components/EvalBar"
import { useMoveBrowser, type MoveBrowser } from "@/lib/browse"
import { barPercent, evalAt, evalWords, formatEval, resultWords } from "@/lib/eval"
import { changedSquares, START_FEN } from "@/lib/fen"
import { clocksOf, type GameState, type LiveMove, type MoveEval } from "@/lib/game"
import { resultLine, splitTournamentName } from "@/lib/names"
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
  const browser = useMoveBrowser(id, state?.lastPly ?? 0)
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
  // The position on the board: the newest one, or a ply being looked at.
  const viewed = browser.viewedPly
  const fenAt = (ply: number): string | undefined => (ply === 0 ? START_FEN : state.moves.get(ply)?.fen)
  const viewedFen = viewed === state.lastPly ? state.fen : (fenAt(viewed) ?? state.fen)
  const prevFen = viewed > 0 ? fenAt(viewed - 1) : undefined
  const highlight = prevFen ? changedSquares(prevFen, viewedFen) : undefined
  const lastMoveAgo = state.lastMoveAt !== null && state.lastPly > 0 ? timeAgo(now - state.lastMoveAt) : null
  // A finished game: clocks stop, nobody is "to move", and the status
  // line shows the result instead.
  const finished = (state.result ?? "*") !== "*"
  // Only the side to move's clock runs, and only while the game is on.
  const running = status === "live" && !finished && state.lastPly > 0
  const lastClocks = clocksOf(state)
  const clocks = {
    white: runningClock(lastClocks.white, running && toMove === "white", state.lastMoveAt, now),
    black: runningClock(lastClocks.black, running && toMove === "black", state.lastMoveAt, now),
  }
  // Engine eval of the position on the board (ADR 0006), or the last
  // analyzed one while the worker catches up. At the end of a finished
  // game the bar shows the result.
  const evalNow = evalAt(state, viewed)
  const showResult = finished && !browser.browsing
  const evalText = !showResult && evalNow ? formatEval(evalNow) : null
  const white = state.white ?? "White"
  const black = state.black ?? "Black"
  const statusText = finished
    ? resultLine(state.result ?? "", white, black)
    : lastMove
    ? `${toMove === "white" ? "White" : "Black"} to move after ${formatMove(lastMove.ply, lastMove.san)}`
    : "Waiting for the first move"

  return (
    <AppShell phoneChrome={false}>
      <PhoneHeader eventLine={eventLine} status={status} finished={finished} />

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
          <ScoreSide side="white" name={white} clock={clocks.white} active={!finished && toMove === "white"} />
          <div className="flex flex-col items-center gap-2 text-center">
            <LiveBadge status={status} lastMoveAgo={lastMoveAgo} finished={finished} />
            <span className={`text-xl font-bold lg:text-[26px] ${finished ? "text-win" : "text-gold"}`}>{statusText}</span>
          </div>
          <ScoreSide side="black" name={black} clock={clocks.black} active={!finished && toMove === "black"} align="right" />
        </section>
      </div>

      <main className="mx-auto grid w-full max-w-[1440px] gap-6 pb-8 md:grid-cols-[minmax(0,640px)_minmax(0,1fr)] md:gap-10 md:px-8 md:pt-7 lg:px-12">
        <div className="flex flex-col">
          <PhonePlayer side="black" name={black} clock={clocks.black} active={!finished && toMove === "black"} />
          {/* Desktop: never taller than the screen under the scoreboard. */}
          <div className="px-4 md:max-w-[min(640px,calc(100svh-20rem))] md:px-0">
            <ChessBoard fen={viewedFen} highlight={highlight} palette={palette} />
            {/* Exactly the board's width, so level (the centre tick) sits
                under the middle of the board. */}
            <EvalBar
              whitePercent={barPercent(showResult ? state.result : undefined, evalNow, viewed)}
              label={evalText}
              {...barWords(showResult ? state.result ?? "" : null, evalNow, viewed, viewedFen)}
              className="mt-2.5 h-7 rounded-md md:mt-3"
            />
            <MoveControls browser={browser} lastPly={state.lastPly} viewedMove={state.moves.get(viewed) ?? null} />
          </div>
          <PhonePlayer side="white" name={white} clock={clocks.white} active={!finished && toMove === "white"} />
          <p className={`px-5 pt-1 text-sm font-bold md:hidden ${finished ? "text-win" : "text-gold"}`}>{statusText}</p>
        </div>

        <section aria-labelledby="moves-heading" className="flex min-w-0 flex-col gap-4 px-4 md:px-0">
          <h2 id="moves-heading" className="text-lg font-bold md:text-xl">Moves</h2>
          <MoveList moves={state.moves} viewedPly={viewed} lastPly={state.lastPly} onPick={browser.goTo} />
        </section>
      </main>
    </AppShell>
  )
}

// What the thick bar says, and on which side: the leading side's end, or
// the middle when level.
function barWords(
  result: string | null,
  e: MoveEval | null,
  ply: number,
  fen: string,
): { words: ReactNode; align: "left" | "center" | "right" } {
  if (result) {
    return { words: resultWords(result) ?? result, align: result === "1-0" ? "left" : result === "0-1" ? "right" : "center" }
  }
  if (!e) return { words: ply === 0 ? "Start position" : "Analyzing this position...", align: "center" }
  const number = formatEval(e)
  // Mates and proven wins already say it all in words.
  const words =
    number.startsWith("#") || number.endsWith("wins") ? (
      evalWords(e)
    ) : (
      <>
        <span>{evalWords(e)}</span>
        <span className="font-mono font-semibold opacity-70">{number}</span>
      </>
    )
  let lead: number
  if (e.mate === 0) lead = fen.split(" ")[1] === "w" ? -1 : 1
  else if (e.mate !== null) lead = e.mate
  else lead = Math.abs(e.cp ?? 0) < 50 ? 0 : (e.cp ?? 0)
  return { words, align: lead > 0 ? "left" : lead < 0 ? "right" : "center" }
}

// First / previous / next / newest, plus "Back to live" while looking back.
function MoveControls({
  browser,
  lastPly,
  viewedMove,
}: {
  browser: MoveBrowser
  lastPly: number
  viewedMove: LiveMove | null
}) {
  const atStart = browser.viewedPly === 0
  const atLive = !browser.browsing
  const button =
    "flex size-10 items-center justify-center rounded-md text-foreground hover:bg-secondary disabled:text-muted-foreground disabled:opacity-40 disabled:hover:bg-transparent"
  return (
    <div className="mt-2 flex items-center justify-between gap-3">
      <span className="min-w-0 truncate text-sm text-muted-foreground">
        {browser.browsing ? (viewedMove ? `Viewing ${formatMove(viewedMove.ply, viewedMove.san)}` : "Viewing the start") : ""}
      </span>
      <div className="flex items-center gap-1">
        {browser.browsing && (
          <button
            type="button"
            onClick={() => browser.goTo(null)}
            className="mr-2 h-9 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground"
          >
            Back to live
          </button>
        )}
        <button type="button" aria-label="First move" className={button} disabled={atStart || lastPly === 0} onClick={() => browser.goTo(0)}>
          <ChevronsLeft className="size-5" aria-hidden />
        </button>
        <button type="button" aria-label="Previous move" className={button} disabled={atStart || lastPly === 0} onClick={() => browser.step(-1)}>
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <button type="button" aria-label="Next move" className={button} disabled={atLive} onClick={() => browser.step(1)}>
          <ChevronRight className="size-5" aria-hidden />
        </button>
        <button type="button" aria-label="Newest move" className={button} disabled={atLive} onClick={() => browser.goTo(null)}>
          <ChevronsRight className="size-5" aria-hidden />
        </button>
      </div>
    </div>
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

function LiveBadge({
  status,
  lastMoveAgo,
  finished = false,
}: {
  status: ConnectionStatus
  lastMoveAgo?: string | null
  finished?: boolean
}) {
  const live = status === "live"
  if (finished && live) {
    return (
      <span role="status" className="flex items-center gap-1.5 text-[13px] font-bold text-muted-foreground">
        <span aria-hidden className="size-2 rounded-full bg-muted-foreground" />
        Finished
      </span>
    )
  }
  return (
    <span role="status" className="flex items-center gap-1.5 text-[13px] font-bold">
      <span aria-hidden className={`size-2 rounded-full ${live ? "bg-live" : "animate-pulse bg-gold"}`} />
      {live ? "Live" : status === "loading" ? "Connecting..." : "Reconnecting..."}
      {live && lastMoveAgo && <span className="font-medium text-muted-foreground">· last move {lastMoveAgo}</span>}
    </span>
  )
}

function PhoneHeader({
  eventLine,
  status,
  finished = false,
}: {
  eventLine: string
  status: ConnectionStatus
  finished?: boolean
}) {
  return (
    <header className="flex items-center gap-1 px-3 pt-2.5 pb-3.5 md:hidden">
      <Link to="/" aria-label="Back to live games" className="flex size-11 items-center justify-center text-foreground">
        <ChevronLeft className="size-5" aria-hidden />
      </Link>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{eventLine}</span>
      <span className="pr-2">
        <LiveBadge status={status} finished={finished} />
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
// Grouped notation, one row per move number: "12. Nf3 Nf6". Each move is
// a button that shows that position. The list scrolls its own box (not the
// page): to the newest row while following live, else to the viewed move.
function MoveList({
  moves,
  viewedPly,
  lastPly,
  onPick,
}: {
  moves: GameState["moves"]
  viewedPly: number
  lastPly: number
  onPick: (ply: number | null) => void
}) {
  const scroller = useRef<HTMLOListElement>(null)
  const plies = [...moves.keys()].sort((a, b) => a - b)
  const last = plies[plies.length - 1] ?? 0

  useEffect(() => {
    const box = scroller.current
    if (!box) return
    if (viewedPly === lastPly) {
      box.scrollTop = box.scrollHeight
      return
    }
    const cell = box.querySelector<HTMLElement>('[aria-current="step"]')
    if (!cell) return
    const top = cell.offsetTop
    if (top < box.scrollTop || top + cell.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = top - box.clientHeight / 2
    }
  }, [viewedPly, lastPly, last])

  if (plies.length === 0) {
    return <p className="rounded-lg bg-card px-4 py-6 text-sm text-muted-foreground">Waiting for the first move...</p>
  }

  const rows: Array<{ n: number; white?: LiveMove; black?: LiveMove }> = []
  for (let n = 1; n <= moveNumber(last); n++) {
    const white = moves.get(2 * n - 1)
    const black = moves.get(2 * n)
    if (white || black) rows.push({ n, white, black })
  }
  const pick = (ply: number) => onPick(ply >= lastPly ? null : ply)

  return (
    <ol
      ref={scroller}
      aria-label="Moves"
      className="relative max-h-80 overflow-y-auto rounded-lg bg-card py-2 font-mono text-[15px] md:max-h-[560px]"
    >
      {rows.map((row) => (
        <li key={row.n} className="grid grid-cols-[3.25rem_1fr_1fr] items-center px-2 odd:bg-white/[0.02]">
          <span className="pl-2 text-muted-foreground">{row.n}.</span>
          <MoveCell move={row.white} current={row.white?.ply === viewedPly} onPick={pick} />
          <MoveCell move={row.black} current={row.black?.ply === viewedPly} onPick={pick} />
        </li>
      ))}
    </ol>
  )
}

function MoveCell({ move, current, onPick }: { move?: LiveMove; current: boolean; onPick: (ply: number) => void }) {
  if (!move) return <span />
  return (
    <button
      type="button"
      aria-current={current ? "step" : undefined}
      onClick={() => onPick(move.ply)}
      className={`mx-0.5 my-1 w-fit rounded-md px-2.5 py-1 text-left ${
        current ? "bg-primary font-bold text-primary-foreground" : "hover:bg-secondary"
      }`}
    >
      {move.san}
    </button>
  )
}
