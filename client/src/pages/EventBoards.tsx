import { Link, useParams } from "react-router"
import { ChevronLeft } from "lucide-react"
import { AppShell } from "@/components/AppShell"
import { ChessBoard } from "@/components/ChessBoard"
import { EvalBar } from "@/components/EvalBar"
import { SideDot } from "@/components/MatchCard"
import { paletteFor } from "@/lib/boardPalette"
import { runningClock, useNow } from "@/lib/clock"
import { barPercent, formatEval, listEval } from "@/lib/eval"
import { resultLine, splitTournamentName } from "@/lib/names"
import { formatMove, sideToMove, type Side } from "@/lib/ply"
import { useLiveGames } from "@/lib/useLiveGames"
import type { GameListItem } from "@/types"

// Every live board of one Tournament at once (Slice 2 multi-board grid;
// a Tournament's live games are normally its current Round),
// in the Matchday look. Each tile reads like a small board page: Black on
// top, the board, the eval strip, White below.
// ponytail: polls the games list every 3s instead of a WebSocket per
// board; one small request covers every board on the page. Move to one shared
// socket subscribed to every game if 3s ever feels slow.
const GRID_POLL_MS = 3_000

export function EventBoards() {
  const { tournamentId = "" } = useParams()
  const { games, failing } = useLiveGames("live", GRID_POLL_MS)
  const now = useNow()
  const boards = games?.filter((g) => g.tournament.id === tournamentId) ?? null
  const name = boards?.[0] ? splitTournamentName(boards[0].tournament.name) : null

  return (
    <AppShell>
      <header className="flex flex-col gap-1 px-4 pt-4 pb-5 md:px-8 md:pt-6 lg:px-12">
        <Link to="/" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden />
          Live
        </Link>
        <h1 className="font-display text-3xl leading-tight font-bold uppercase md:text-4xl">
          {name?.title ?? "Live boards"}
        </h1>
        {boards && (
          <p className="text-sm text-muted-foreground">
            {name?.subtitle ? `${name.subtitle} · ` : ""}
            {boards.length} live {boards.length === 1 ? "board" : "boards"}
          </p>
        )}
      </header>

      <main className="mx-auto w-full max-w-[1600px] px-4 pb-10 md:px-8 lg:px-12">
        {failing && (
          <p role="status" className="mb-4 text-sm text-destructive">
            Can't reach server, retrying...
          </p>
        )}
        {boards === null ? (
          <p className="text-sm text-muted-foreground">Loading boards...</p>
        ) : boards.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong px-4 py-12 text-center text-sm text-muted-foreground">
            No live boards in this competition right now.{" "}
            <Link to="/" className="font-semibold">
              See what is live
            </Link>
          </p>
        ) : (
          <BoardGrid games={boards} now={now} />
        )}
      </main>
    </AppShell>
  )
}

// The grid of tiles, shared with the round page.
export function BoardGrid({ games, now }: { games: GameListItem[]; now: number }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-5 lg:grid-cols-4 2xl:grid-cols-5">
      {games.map((g) => (
        <li key={g.id}>
          <GridTile game={g} now={now} />
        </li>
      ))}
    </ul>
  )
}

function GridTile({ game, now }: { game: GameListItem; now: number }) {
  const live = game.result === "*"
  const toMove: Side | null = live && game.lastPly > 0 ? sideToMove(game.lastPly + 1) : null
  const since = Date.parse(game.updatedAt)
  const clock = (value: string | null, side: Side) =>
    runningClock(value, toMove === side, Number.isNaN(since) ? null : since, now)
  const evalNow = listEval(game)
  const evalText = live && evalNow ? formatEval(evalNow) : null
  return (
    <Link
      to={`/games/${game.id}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2.5 transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:gap-2.5 md:p-3.5"
    >
      <TileRow side="black" name={game.black} clock={clock(game.blackClock, "black")} active={toMove === "black"} />
      <div className="flex flex-col gap-1.5">
        <ChessBoard fen={game.fen || undefined} palette={paletteFor(game.id)} coords={false} />
        <EvalBar
          whitePercent={barPercent(game.result, evalNow, game.lastPly)}
          label={evalText}
          className="h-1 rounded-full"
        />
      </div>
      <TileRow side="white" name={game.white} clock={clock(game.whiteClock, "white")} active={toMove === "white"} />
      <div className="flex items-center justify-between gap-2 text-xs font-bold md:text-[13px]">
        {live ? (
          <span className="truncate text-primary">
            {game.lastSan ? formatMove(game.lastPly, game.lastSan) : "Not started"}
          </span>
        ) : (
          <span className="truncate text-win">{resultLine(game.result, game.white, game.black)}</span>
        )}
        {evalText && <span className="shrink-0 font-mono font-medium text-muted-foreground">{evalText}</span>}
      </div>
    </Link>
  )
}

function TileRow({ side, name, clock, active }: { side: Side; name: string; clock: string | null; active: boolean }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2 text-xs font-semibold md:text-sm">
        <SideDot side={side} className="size-2.5" />
        <span className="truncate">{name}</span>
      </span>
      {clock && (
        <span
          className={`shrink-0 font-display text-base font-bold tabular-nums md:text-lg ${active ? "text-primary" : "text-muted-foreground"}`}
        >
          {clock}
        </span>
      )}
    </div>
  )
}
