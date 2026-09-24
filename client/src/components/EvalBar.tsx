import type { ReactNode } from "react"

// Horizontal eval bar from the Matchday design (ADR 0006): White's share
// fills from the left over a navy track, and slides to each new eval.
// Match cards use a thin strip. The board page passes `words` for a thick
// bar that says who is better, with a tick at the centre (level).
export function EvalBar({
  whitePercent,
  label,
  words,
  align = "center",
  className = "",
}: {
  whitePercent: number
  // Short value for screen readers ("+0.4").
  label: string | null
  // Thick bar only: the text shown inside it.
  words?: ReactNode
  // Put the words on the leading side: left for White, right for Black.
  align?: "left" | "center" | "right"
  className?: string
}) {
  const white = Math.max(0, Math.min(100, whitePercent))
  return (
    <div
      role="meter"
      aria-label={label ? `Evaluation ${label}` : "Evaluation pending"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(white)}
      aria-valuetext={`White ${Math.round(white)}%`}
      className={`relative flex overflow-hidden bg-muted ${className}`}
    >
      <div
        className="bg-foreground transition-[width] duration-700 ease-out motion-reduce:transition-none"
        style={{ width: `${white}%` }}
      />
      {words !== undefined && (
        <>
          {/* Level: notches at the top and bottom edge, clear of the words. */}
          <span aria-hidden className="absolute top-0 left-1/2 h-1.5 w-0.5 -translate-x-1/2 bg-line-strong" />
          <span aria-hidden className="absolute bottom-0 left-1/2 h-1.5 w-0.5 -translate-x-1/2 bg-line-strong" />
          {/* The same words twice: dark where they sit on White's fill,
              light where they sit on the navy track, so they read at any
              split. */}
          <BarWords align={align} className="text-background" clip={`inset(0 ${100 - white}% 0 0)`}>
            {words}
          </BarWords>
          <BarWords align={align} className="text-foreground" clip={`inset(0 0 0 ${white}%)`}>
            {words}
          </BarWords>
        </>
      )}
    </div>
  )
}

function BarWords({
  align,
  className,
  clip,
  children,
}: {
  align: "left" | "center" | "right"
  className: string
  clip: string
  children: ReactNode
}) {
  const justify = align === "left" ? "justify-start" : align === "right" ? "justify-end" : "justify-center"
  return (
    <span
      aria-hidden
      className={`absolute inset-0 flex items-center gap-2 px-3 text-xs font-bold whitespace-nowrap transition-[clip-path] duration-700 ease-out motion-reduce:transition-none ${justify} ${className}`}
      style={{ clipPath: clip }}
    >
      {children}
    </span>
  )
}
