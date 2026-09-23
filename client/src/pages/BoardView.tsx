import { Link, useParams } from "react-router"
import { BoardPlaceholder } from "@/components/BoardPlaceholder"
import { Badge } from "@/components/ui/badge"
import { mockGameState } from "@/data/mock"
import { moveNumber, sideToMove } from "@/lib/ply"

// Board view shell. Slots are fed from a hard-coded mock shaped like the
// server's GameStateResponse; #8 replaces it with live resync data.
export function BoardView() {
  const { id } = useParams()
  const state = mockGameState
  const lastMove = state.lastMove

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <nav>
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← All games
        </Link>
      </nav>
      <div className="flex items-center justify-between gap-2">
        <h1 className="truncate text-lg font-semibold">Board</h1>
        <Badge variant="secondary">v{state.version}</Badge>
      </div>
      <BoardPlaceholder />
      <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3 text-sm">
        <span aria-label="Last move">
          {lastMove
            ? `Ply ${lastMove.ply} · ${moveNumber(lastMove.ply)}. ${lastMove.san}`
            : "No moves yet"}
        </span>
        {lastMove && (
          <span className="text-muted-foreground">
            {sideToMove(lastMove.ply) === "white" ? "White" : "Black"} to move
          </span>
        )}
      </div>
      <p className="truncate font-mono text-xs text-muted-foreground" title={state.fen}>
        {state.fen}
      </p>
      <p className="truncate font-mono text-xs text-muted-foreground">game {id}</p>
    </main>
  )
}
