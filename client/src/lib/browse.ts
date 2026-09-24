import { useCallback, useEffect, useState } from "react"

// Stepping back and forth through a game's moves. `null` means "follow
// live": the board shows the newest position and moves along with it.
// Any other value is a ply being looked at; new moves do not move it.

// One step (or a jump) from the current view. Reaching the newest ply
// returns to following live.
export function stepView(view: number | null, lastPly: number, delta: number): number | null {
  const current = view ?? lastPly
  const target = Math.max(0, Math.min(lastPly, current + delta))
  return target >= lastPly ? null : target
}

// A view past the end (a takeback removed those plies) follows live again.
export function clampView(view: number | null, lastPly: number): number | null {
  return view === null || view >= lastPly ? null : view
}

export interface MoveBrowser {
  // The ply on the board; equals lastPly while following live.
  viewedPly: number
  browsing: boolean
  goTo(ply: number | null): void
  step(delta: number): void
}

// Keyboard: left/right step, Home jumps to the start, End back to live.
export function useMoveBrowser(gameId: string, lastPly: number): MoveBrowser {
  // Tied to the game id, so opening another game starts at live.
  const [saved, setSaved] = useState<{ gameId: string; ply: number | null }>({ gameId, ply: null })
  const view = clampView(saved.gameId === gameId ? saved.ply : null, lastPly)

  const goTo = useCallback(
    (ply: number | null) => setSaved({ gameId, ply: ply === null ? null : clampView(ply, lastPly) }),
    [gameId, lastPly],
  )
  const step = useCallback((delta: number) => goTo(stepView(view, lastPly, delta)), [goTo, view, lastPly])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === "ArrowLeft") step(-1)
      else if (e.key === "ArrowRight") step(1)
      else if (e.key === "Home") goTo(0)
      else if (e.key === "End") goTo(null)
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [step, goTo])

  return { viewedPly: view ?? lastPly, browsing: view !== null, goTo, step }
}
