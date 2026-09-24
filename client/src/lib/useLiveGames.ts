import { useEffect, useState } from "react"
import { API_URL } from "@/lib/api"
import type { Featured, GameListItem } from "@/types"

// Live games list for the home strip. Plain polling every 10s: the strip
// only needs "roughly now", and each board page has its own WebSocket
// for exact live moves. Polling pauses while the tab is hidden.

const POLL_MS = 10_000

export interface UseLiveGames {
  games: GameListItem[] | null
  failing: boolean
  // The server's featured picks; only on the live list.
  featured: Featured | null
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

// pollMs: the round grid polls faster than home, since it is the page
// people watch moves on.
export function useLiveGames(status: "live" | "finished" = "live", pollMs = POLL_MS): UseLiveGames {
  const [games, setGames] = useState<GameListItem[] | null>(null)
  const [failing, setFailing] = useState(false)
  const [featured, setFeatured] = useState<Featured | null>(null)

  useEffect(() => {
    // A different list: start clean instead of merging into the old one.
    setGames(null)
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined

    async function load(): Promise<void> {
      try {
        const res = await fetch(`${API_URL}/games?status=${status}`)
        if (!res.ok) throw new Error(`games list failed with ${res.status}`)
        const body = (await res.json()) as { games: GameListItem[]; featured?: Featured | null }
        if (cancelled) return
        setGames((prev) => stableOrder(prev, body.games))
        setFeatured(body.featured ?? null)
        setFailing(false)
      } catch {
        // Keep the last good list on screen; just flag the problem.
        if (!cancelled) setFailing(true)
      }
    }

    function start(): void {
      void load()
      timer = setInterval(() => void load(), pollMs)
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
  }, [status, pollMs])

  return { games, failing, featured }
}
