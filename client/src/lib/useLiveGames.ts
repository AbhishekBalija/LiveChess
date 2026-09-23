import { useEffect, useState } from "react"
import { API_URL } from "@/lib/api"
import type { GameListItem } from "@/types"

// Live games list for the home strip. Plain polling every 10s: the strip
// only needs "roughly now", and each board page has its own WebSocket
// for exact live moves. Polling pauses while the tab is hidden.

const POLL_MS = 10_000

export interface UseLiveGames {
  games: GameListItem[] | null
  failing: boolean
}

// The API orders by latest activity, which would reshuffle cards on every
// poll. Keep the order in which games were first seen, so cards stay put
// and only their contents change.
export function stableOrder(previous: GameListItem[] | null, next: GameListItem[]): GameListItem[] {
  if (!previous) return next
  const rank = new Map(previous.map((g, i) => [g.id, i]))
  const known = next.filter((g) => rank.has(g.id))
  const fresh = next.filter((g) => !rank.has(g.id))
  known.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
  return [...known, ...fresh]
}

export function useLiveGames(status: "live" | "finished" = "live"): UseLiveGames {
  const [games, setGames] = useState<GameListItem[] | null>(null)
  const [failing, setFailing] = useState(false)

  useEffect(() => {
    // A different list: start clean instead of merging into the old one.
    setGames(null)
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined

    async function load(): Promise<void> {
      try {
        const res = await fetch(`${API_URL}/games?status=${status}`)
        if (!res.ok) throw new Error(`games list failed with ${res.status}`)
        const body = (await res.json()) as { games: GameListItem[] }
        if (cancelled) return
        setGames((prev) => stableOrder(prev, body.games))
        setFailing(false)
      } catch {
        // Keep the last good list on screen; just flag the problem.
        if (!cancelled) setFailing(true)
      }
    }

    function start(): void {
      void load()
      timer = setInterval(() => void load(), POLL_MS)
    }

    function onVisibility(): void {
      if (timer) clearInterval(timer)
      timer = undefined
      if (document.visibilityState === "visible") start()
    }

    start()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [status])

  return { games, failing }
}
