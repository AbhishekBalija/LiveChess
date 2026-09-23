import { useEffect, useState } from "react"

// Chess clocks. Sources give each side's remaining time as of that side's
// last move ("1:29:10"). Between moves only the side to move is running,
// so we count its clock down locally from when the last move landed.

// "1:29:10" or "29:10" -> seconds. Null when it does not parse.
export function parseClock(clock: string): number | null {
  const parts = clock.split(":").map(Number)
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !Number.isFinite(p) || p < 0)) return null
  return parts.reduce((total, part) => total * 60 + part, 0)
}

// Seconds -> "1:29:10", or "9:05" under an hour.
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`
}

// The clock to show: counted down from `since` when this side is on move,
// as-is otherwise. Never below zero.
export function runningClock(clock: string | null, running: boolean, since: number | null, now: number): string | null {
  if (clock === null) return null
  const seconds = parseClock(clock)
  if (seconds === null) return clock
  const elapsed = running && since !== null ? Math.max(0, (now - since) / 1000) : 0
  return formatClock(seconds - elapsed)
}

// Current time, refreshed every intervalMs, for anything that ticks.
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
