import { useEffect, useRef, type ReactNode } from "react"
import { Link, useParams } from "react-router"
import { BoardPlaceholder } from "@/components/BoardPlaceholder"
import { Badge } from "@/components/ui/badge"
import { changedSquares, START_FEN } from "@/lib/fen"
import type { GameState, LiveMove } from "@/lib/game"
import { moveNumber, sideToMove, type Side } from "@/lib/ply"
import { useLiveGame, type ConnectionStatus } from "@/lib/useLiveGame"

// Live board view. State comes from useLiveGame, which resyncs over HTTP
// and advances over the gateway WebSocket. The home page stays on mock
// data (no games-list endpoint exists yet).
//
// Layout: board with Black above and White below, capped so board plus
// both player strips fit the viewport; the move panel sits beside it
// from md up and stacks under it on phones.

// "Ply 23 · 12. Nf3" for White, "Ply 24 · 12... Nf6" for Black.
function formatLastMove(ply: number, san: string): string {
  const n = moveNumber(ply)
  return sideToMove(ply) === "white" ? `Ply ${ply} · ${n}. ${san}` : `Ply ${ply} · ${n}... ${san}`
}

// Board column width: full width on phones, and never taller than the
// viewport minus header and player strips on desktop.
const BOARD_COLUMN = "w-full max-w-[min(100%,calc(100svh-12rem))]"

export function BoardView() {
  const { id } = useParams()
  const { state, status, notFound } = useLiveGame(id ?? "")

  if (notFound || !id) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">Game not found.</p>
      </Shell>
    )
  }

  if (state === null) {
    return (
      <Shell>
        <div className={`${BOARD_COLUMN} flex flex-col gap-3`}>
          <BoardPlaceholder />
          <p className="text-sm text-muted-foreground">
            {status === "error"
              ? "Could not load this game."
              : status === "reconnecting"
                ? "Can't reach server, retrying..."
                : "Loading board…"}
          </p>
        </div>
      </Shell>
    )
  }

  const toMove: Side = sideToMove(state.lastPly + 1)
  const lastMove = state.moves.get(state.lastPly) ?? null
  const prevFen = state.lastPly > 1 ? state.moves.get(state.lastPly - 1)?.fen : START_FEN
  const highlight = lastMove && prevFen ? changedSquares(prevFen, state.fen) : undefined

  return (
    <Shell
      title={
        state.white && state.black ? (
          <>
            {state.white} <span className="font-normal text-muted-foreground">vs</span> {state.black}
          </>
        ) : (
          "Live game"
        )
      }
      aside={
        <div className="flex items-center gap-2">
          <ConnectionDot status={status} />
          <Badge variant="secondary" className="font-mono tabular-nums">
            v{state.version}
          </Badge>
        </div>
      }
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className={`${BOARD_COLUMN} flex flex-col gap-2`}>
          <PlayerStrip side="black" name={state.black} active={toMove === "black"} />
          <BoardPlaceholder fen={state.fen} highlight={highlight} />
          <PlayerStrip side="white" name={state.white} active={toMove === "white"} />
        </div>
        <MovePanel state={state} lastMove={lastMove} />
      </div>
    </Shell>
  )
}

function Shell({
  title,
  aside,
  children,
}: {
  title?: ReactNode
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      <nav>
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← All games
        </Link>
      </nav>
      {title && (
        <header className="flex items-center justify-between gap-3">
          <h1 className="min-w-0 truncate text-lg font-semibold">{title}</h1>
          {aside}
        </header>
      )}
      {children}
    </main>
  )
}

function PlayerStrip({ side, name, active }: { side: Side; name?: string; active: boolean }) {
  return (
    <div className="flex h-8 items-center justify-between gap-2 px-0.5 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className={`size-3 shrink-0 rounded-full ring-1 ring-white/30 ${
            side === "white" ? "bg-white" : "bg-stone-900"
          }`}
        />
        <span className="truncate font-medium">{name ?? (side === "white" ? "White" : "Black")}</span>
      </span>
      {active && (
        <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">
          to move
        </span>
      )}
    </div>
  )
}

function ConnectionDot({ status }: { status: ConnectionStatus }) {
  const live = status === "live"
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      role="status"
      aria-label={live ? "Live" : "Reconnecting"}
    >
      <span
        aria-hidden
        className={`size-2 rounded-full ${live ? "bg-green-500" : "animate-pulse bg-amber-500"}`}
      />
      {live ? "Live" : status === "loading" ? "Connecting…" : "Reconnecting…"}
    </span>
  )
}

function MovePanel({ state, lastMove }: { state: GameState; lastMove: LiveMove | null }) {
  return (
    <section
      aria-label="Game moves"
      className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card md:max-h-[calc(100svh-12rem)] md:self-stretch"
    >
      <div className="border-b border-border px-3 py-2.5 text-sm">
        <span aria-label="Last move" className="font-medium tabular-nums">
          {lastMove ? formatLastMove(lastMove.ply, lastMove.san) : "No moves yet"}
        </span>
      </div>
      <MoveList moves={state.moves} lastPly={state.lastPly} />
      <p
        className="truncate border-t border-border px-3 py-2 font-mono text-[11px] text-muted-foreground select-all"
        title={state.fen}
      >
        {state.fen}
      </p>
    </section>
  )
}

// Grouped notation, one row per move number: "12. Nf3 Nf6".
// Auto-scrolls its own container (not the page) to the newest row.
function MoveList({ moves, lastPly }: { moves: Map<number, LiveMove>; lastPly: number }) {
  const scroller = useRef<HTMLOListElement>(null)
  const plies = [...moves.keys()].sort((a, b) => a - b)
  const last = plies[plies.length - 1] ?? 0

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [last])

  if (plies.length === 0) {
    return <p className="flex-1 px-3 py-4 text-sm text-muted-foreground">Waiting for the first move…</p>
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
      className="max-h-64 flex-1 overflow-y-auto py-1 text-sm tabular-nums md:max-h-none"
    >
      {rows.map((row) => (
        <li key={row.n} className="grid grid-cols-[2.5rem_1fr_1fr] items-center px-1 even:bg-white/[0.03]">
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
      className={`mx-0.5 my-0.5 rounded px-2 py-1 font-medium ${
        current ? "bg-primary text-primary-foreground" : ""
      }`}
    >
      {move.san}
    </span>
  )
}
