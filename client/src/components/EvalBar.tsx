// Horizontal eval bar from the Matchday design (ADR 0006): White's share
// fills from the left over a navy track, and slides to each new eval.
// The board page uses a 6px rounded bar under the board; match cards a
// 4px strip along their bottom edge.
export function EvalBar({ whitePercent, label, className = "" }: { whitePercent: number; label: string | null; className?: string }) {
  const white = Math.max(0, Math.min(100, whitePercent))
  return (
    <div
      role="meter"
      aria-label={label ? `Evaluation ${label}` : "Evaluation pending"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(white)}
      aria-valuetext={`White ${Math.round(white)}%`}
      className={`flex overflow-hidden bg-muted ${className}`}
    >
      <div
        className="bg-foreground transition-[width] duration-700 ease-out motion-reduce:transition-none"
        style={{ width: `${white}%` }}
      />
    </div>
  )
}
