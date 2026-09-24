import { useEffect, useState } from "react"
import { API_URL } from "@/lib/api"
import type { RoundInfo } from "@/types"

// What the round page shows (#51):
// - live: LiveChess has games for this round, show the board grid
// - upcoming: not started yet, countdown and pairings
// - starting: the start time has passed but no boards yet, either because
//   the organizer starts late (Lichess does not call it ongoing yet) or
//   because the supervisor, which checks every few minutes, has not
//   picked it up yet (a short grace period)
// - uncovered: Lichess has been playing it for a while, but LiveChess is
//   not following it
// - finished: over, and we never had its games
export type RoundPhase = "live" | "upcoming" | "starting" | "uncovered" | "finished"

export const STARTING_GRACE_MS = 10 * 60_000

export function roundPhase(info: RoundInfo, liveGames: number, now: number): RoundPhase {
  if (liveGames > 0) return "live"
  if (info.finished) return "finished"
  const start = info.startsAt ? Date.parse(info.startsAt) : null
  if (!info.ongoing) return start === null || start > now ? "upcoming" : "starting"
  if (start !== null && now - start < STARTING_GRACE_MS) return "starting"
  return "uncovered"
}

// The round from our gateway, refreshed every minute so the page notices
// the start without a reload.
export function useRound(roundId: string): { round: RoundInfo | null; notFound: boolean; failing: boolean } {
  const [round, setRound] = useState<RoundInfo | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [failing, setFailing] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      try {
        const res = await fetch(`${API_URL}/rounds/${encodeURIComponent(roundId)}`)
        if (cancelled) return
        if (res.status === 404 || res.status === 400) {
          setNotFound(true)
          return
        }
        if (!res.ok) throw new Error(`round failed with ${res.status}`)
        const body = (await res.json()) as RoundInfo
        if (!cancelled) {
          setRound(body)
          setFailing(false)
        }
      } catch {
        if (!cancelled) setFailing(true)
      }
    }
    void load()
    const timer = setInterval(() => void load(), 60_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [roundId])

  return { round, notFound, failing }
}
