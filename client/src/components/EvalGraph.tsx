import { useState } from "react"
import { evalWords, formatEval, whiteWinPercent } from "@/lib/eval"
import type { GameState } from "@/lib/game"
import { formatMove, sideToMove } from "@/lib/ply"

// The game's story at a glance: White's win chance after every move, on
// the same scale as the eval bar (top is White, bottom is Black, the
// hairline is level). Hover shows the move and eval; a click shows that
// position on the board. Moves the worker has not analyzed yet leave a
// gap instead of a guessed line.
const HEIGHT = 120

export function EvalGraph({
  moves,
  lastPly,
  viewedPly,
  onPick,
}: {
  moves: GameState["moves"]
  lastPly: number
  viewedPly: number
  onPick: (ply: number | null) => void
}) {
  const [hover, setHover] = useState<number | null>(null)
  if (lastPly < 2) return null

  // x: ply 1..lastPly across the width; y: 0 (White wins) .. 100 (Black wins).
  const x = (ply: number) => ((ply - 1) / (lastPly - 1)) * 100
  const y = (ply: number): number | null => {
    const e = moves.get(ply)?.eval
    return e ? 100 - whiteWinPercent(e, sideToMove(ply + 1)) : null
  }

  // One path per run of analyzed plies, so gaps stay gaps.
  const runs: Array<Array<[number, number]>> = []
  let run: Array<[number, number]> = []
  for (let ply = 1; ply <= lastPly; ply++) {
    const value = y(ply)
    if (value === null) {
      if (run.length > 0) runs.push(run)
      run = []
    } else {
      run.push([x(ply), value])
    }
  }
  if (run.length > 0) runs.push(run)
  // The worker fills in older moves after the newest ones, so a game
  // opened mid-way can have few evals yet; say so instead of a blank box.
  let analyzed = 0
  for (let ply = 1; ply <= lastPly; ply++) if (moves.get(ply)?.eval) analyzed += 1

  const line = (points: Array<[number, number]>) => points.map(([px, py], i) => `${i ? "L" : "M"}${px},${py}`).join("")
  const area = (points: Array<[number, number]>) =>
    `${line(points)}L${points[points.length - 1]![0]},100L${points[0]![0]},100Z`

  const plyAt = (clientX: number, box: DOMRect) =>
    Math.max(1, Math.min(lastPly, Math.round(((clientX - box.left) / box.width) * (lastPly - 1)) + 1))

  const hovered = hover !== null ? moves.get(hover) : undefined
  const tip = hovered
    ? {
        left: x(hovered.ply),
        value: hovered.eval ? formatEval(hovered.eval) : "Not analyzed yet",
        detail: `${formatMove(hovered.ply, hovered.san)}${hovered.eval ? ` · ${evalWords(hovered.eval)}` : ""}`,
      }
    : null

  return (
    <div className="relative select-none">
      <svg
        role="img"
        aria-label="Evaluation over the game: White's winning chances after each move. Use the move list or arrow keys to step through positions."
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="block w-full cursor-crosshair overflow-visible rounded-lg bg-card"
        style={{ height: HEIGHT }}
        onPointerMove={(e) => setHover(plyAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const ply = plyAt(e.clientX, e.currentTarget.getBoundingClientRect())
          onPick(ply >= lastPly ? null : ply)
        }}
      >
        {/* Level: where the eval bar's centre tick is. */}
        <line x1="0" x2="100" y1="50" y2="50" className="stroke-line-strong" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {runs.map((points, i) => (
          <g key={i}>
            <path d={area(points)} className="fill-foreground" fillOpacity={0.1} />
            <path
              d={line(points)}
              className="stroke-foreground"
              fill="none"
              strokeWidth="2"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
        {/* The position on the board. */}
        {viewedPly >= 1 && (
          <line
            x1={x(viewedPly)}
            x2={x(viewedPly)}
            y1="0"
            y2="100"
            className="stroke-primary"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1="0"
            y2="100"
            className="stroke-muted-foreground"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {analyzed < lastPly && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Engine has analyzed {analyzed} of {lastPly} moves so far.
        </p>
      )}
      {tip && (
        <div
          role="status"
          className="pointer-events-none absolute -top-2 z-10 flex -translate-y-full flex-col rounded-md border border-line-strong bg-background px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg"
          style={{ left: `clamp(0px, calc(${tip.left}% - 60px), calc(100% - 140px))` }}
        >
          <span className="font-mono font-bold text-foreground">{tip.value}</span>
          <span className="text-muted-foreground">{tip.detail}</span>
        </div>
      )}
    </div>
  )
}
