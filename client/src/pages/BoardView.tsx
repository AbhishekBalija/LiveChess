import { Link, useParams } from "react-router"
import { BoardPlaceholder } from "@/components/BoardPlaceholder"
import { Badge } from "@/components/ui/badge"
import type { LiveMove } from "@/lib/game"
import { moveNumber, sideToMove } from "@/lib/ply"
import { useLiveGame } from "@/lib/useLiveGame"

// Live board view. The mock is gone: state comes from useLiveGame,
// which resyncs over HTTP and advances over the gateway WebSocket.
// The home page stays on mock data (no games-list endpoint exists yet).

// "Ply 23 · 12. Nf3" for White, "Ply 24 · 12... Nf6" for Black.
function formatLastMove(ply: number, san: string): string {
  const n = moveNumber(ply)
  return sideToMove(ply) === "white" ? `Ply ${ply} · ${n}. ${san}` : `Ply ${ply} · ${n}... ${san}`
}

export function BoardView() {
  const { id } = useParams()
  const { state, status, notFound } = useLiveGame(id ?? "")

  if (notFound || !id) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
        <nav>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← All games
          </Link>
        </nav>
        <p className="text-sm text-muted-foreground">Game not found.</p>
      </main>
    )
  }

  if (state === null) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
        <nav>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← All games
          </Link>
        </nav>
        <BoardPlaceholder />
        <p className="text-sm text-muted-foreground">
          {status === "error" ? "Could not load this game." : "Loading board…"}
        </p>
      </main>
    )
  }

  const lastMove = state.moves.get(state.lastPly) ?? null
  const mover = sideToMove(state.lastPly + 1)

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <nav>
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← All games
        </Link>
      </nav>
      <div className="flex items-center justify-between gap-2">
        <h1 className="truncate text-lg font-semibold">Board</h1>
        <div className="flex items-center gap-2">
          <ConnectionDot status={status} />
          <Badge variant="secondary">v{state.version}</Badge>
        </div>
      </div>
      <BoardPlaceholder fen={state.fen} />
      <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3 text-sm">
        <span aria-label="Last move">
          {lastMove ? formatLastMove(lastMove.ply, lastMove.san) : "No moves yet"}
        </span>
        <span className="text-muted-foreground">
          {state.lastPly === 0 ? "White to move" : `${mover === "white" ? "White" : "Black"} to move`}
        </span>
      </div>
      <MoveList moves={state.moves} />
      <p className="truncate font-mono text-xs text-muted-foreground" title={state.fen}>
        {state.fen}
      </p>
      <p className="truncate font-mono text-xs text-muted-foreground">game {id}</p>
    </main>
  )
}

function ConnectionDot({ status }: { status: "loading" | "live" | "reconnecting" | "error" }) {
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

// Compact notation grouped by move number: "12. Nf3 Nf6".
function MoveList({ moves }: { moves: Map<number, LiveMove> }) {
  const plies = [...moves.keys()].sort((a, b) => a - b)
  if (plies.length === 0) return null
  const last = plies[plies.length] ?? 0
  const rows: Array<{ n: number; white?: string; black?: string }> = []
  for (let n = 1; n <= moveNumber(last); n++) {
    const white = moves.get(2 * n - 1)?.san
    const black = moves.get(2 * n)?.san
    if (white === undefined && black === undefined) continue
    rows.push({ n, white, black })
  }
  return (
    <ol aria-label="Moves" className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3 text-sm">
      {rows.map((row) => (
        <li key={row.n} className="flex gap-2">
          <span className="w-8 shrink-0 text-muted-foreground">{row.n}.</span>
          <span className="w-16">{row.white ?? ""}</span>
          <span className="w-16">{row.black ?? ""}</span>
        </li>
      ))}
    </ol>
  )
}
