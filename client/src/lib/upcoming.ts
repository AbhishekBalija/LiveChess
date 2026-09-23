import { useEffect, useState } from "react"
import { API_URL } from "@/lib/api"
import type { UpcomingRound } from "@/types"

// Rounds starting soon. The server caches Lichess for 5 minutes, so
// refetching every 5 minutes is plenty; failures just keep the old list.
export function useUpcoming(): UpcomingRound[] {
  const [rounds, setRounds] = useState<UpcomingRound[]>([])
  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      try {
        const res = await fetch(`${API_URL}/upcoming`)
        if (!res.ok) return
        const body = (await res.json()) as { rounds: UpcomingRound[] }
        if (!cancelled) setRounds(body.rounds)
      } catch {
        // Keep whatever we showed last.
      }
    }
    void load()
    const timer = setInterval(() => void load(), 5 * 60_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])
  return rounds
}

// "Today 15:45", "Tomorrow 09:00", "Fri 18:30" in the viewer's time zone.
export function startLabel(startsAt: string, now: number): string {
  const start = new Date(startsAt)
  const time = start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(start) - day(new Date(now))) / 86_400_000)
  if (days <= 0) return `Today ${time}`
  if (days === 1) return `Tomorrow ${time}`
  return `${start.toLocaleDateString([], { weekday: "short" })} ${time}`
}

// "in 45m", "in 3h 20m", "in 2d".
export function countdown(startsAt: string, now: number): string {
  const minutes = Math.max(0, Math.round((Date.parse(startsAt) - now) / 60_000))
  if (minutes < 60) return `in ${minutes}m`
  if (minutes < 24 * 60) return `in ${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `in ${Math.floor(minutes / (24 * 60))}d`
}
