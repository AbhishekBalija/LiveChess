import { useEffect, useState } from "react"
import { API_URL } from "@/lib/api"
import type { GameStateResponse } from "@/types"
import {
  applyEvent,
  applyResync,
  fromSnapshot,
  parseLiveEvent,
  type GameState,
} from "./game"


function wsUrl(api: string): string {
  const url = new URL(api)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = "/"
  url.search = ""
  url.hash = ""
  return url.toString()
}

export type ConnectionStatus = "loading" | "live" | "reconnecting" | "error"

export interface UseLiveGame {
  state: GameState | null
  status: ConnectionStatus
  notFound: boolean
}

// Live game feed. Ordering avoids losing moves: the socket opens and
// subscribes FIRST, arrivals buffer while the snapshot is in flight,
// then the snapshot applies and the buffer drains through applyEvent.
// Gaps resync from the current version; closes reconnect with capped
// backoff and resubscribe plus resync. Reconnects are scheduled only
// from onclose, and resyncs serialize through one helper, so flaky
// networks can neither leak sockets nor regress state. No state
// library, plain useState.
export function useLiveGame(gameId: string): UseLiveGame {
  const [state, setState] = useState<GameState | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>("loading")
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!gameId) {
      setNotFound(true)
      setStatus("error")
      return
    }
    let cancelled = false
    let dead = false
    let socket: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    let snapshotReady = false
    let inflight: Promise<void> | null = null
    const buffer: unknown[] = []
    const current: { state: GameState | null } = { state: null }

    async function fetchState(since: number): Promise<void> {
      const res = await fetch(`${API_URL}/games/${gameId}/state?since_version=${since}`)
      if (cancelled) return
      if (res.status === 404) {
        dead = true
        setNotFound(true)
        setStatus("error")
        socket?.close()
        return
      }
      if (!res.ok) throw new Error(`resync failed with ${res.status}`)
      const body = (await res.json()) as GameStateResponse
      if (cancelled) return
      current.state =
        current.state === null ? fromSnapshot(body) : applyResync(current.state, body)
      setState(current.state)
    }

    // Returns true when the event asked for a resync.
    function step(raw: unknown): boolean {
      const ev = parseLiveEvent(gameId, raw)
      if (!ev || current.state === null) return false
      const out = applyEvent(current.state, ev)
      if ("resync" in out) return true
      if (out.state !== current.state) {
        current.state = out.state
        if (!cancelled) setState(out.state)
      }
      return false
    }

    async function drain(): Promise<void> {
      while (buffer.length > 0) {
        const pending = buffer.splice(0, buffer.length)
        let resumeAt = pending.length
        for (let i = 0; i < pending.length; i++) {
          if (step(pending[i])) {
            resumeAt = i
            break
          }
        }
        if (resumeAt < pending.length) {
          buffer.unshift(...pending.slice(resumeAt))
          snapshotReady = false
          await fetchState(current.state?.version ?? 0)
          if (cancelled) return
          snapshotReady = true
        }
      }
    }

    // The single serialized resync: concurrent callers share one flight,
    // so overlapping resyncs can never apply out of order.
    function resync(): Promise<void> {
      if (inflight) return inflight
      inflight = (async () => {
        snapshotReady = false
        try {
          await fetchState(current.state?.version ?? 0)
          if (cancelled || current.state === null) return
          attempts = 0
          await drain()
          if (cancelled) return
          snapshotReady = true
          setStatus("live")
        } finally {
          inflight = null
        }
      })()
      return inflight
    }

    // onclose is the ONLY place that schedules a reconnect.
    function scheduleReconnect(): void {
      if (cancelled || dead) return
      if (retryTimer) clearTimeout(retryTimer)
      // Always surface retrying, even before the first snapshot lands,
      // so a down server never looks like plain loading.
      setStatus("reconnecting")
      const delay = Math.min(1000 * 2 ** attempts, 10000)
      attempts += 1
      retryTimer = setTimeout(connect, delay)
    }

    function connect(): void {
      if (cancelled || dead) return
      socket?.close()
      if (current.state === null && attempts === 0) setStatus("loading")
      const ws = new WebSocket(wsUrl(API_URL))
      socket = ws
      ws.onopen = () => {
        ws.send(JSON.stringify({ subscribe: gameId }))
        void resync().catch(() => {
          ws.close()
        })
      }
      ws.onmessage = (msg) => {
        let raw: unknown
        try {
          raw = JSON.parse(String(msg.data))
        } catch {
          return
        }
        if (!snapshotReady || current.state === null) {
          buffer.push(raw)
          return
        }
        if (step(raw)) {
          buffer.unshift(raw)
          void resync().catch(() => {
            ws.close()
          })
        }
      }
      ws.onclose = () => {
        if (socket !== ws) return
        scheduleReconnect()
      }
      ws.onerror = () => {
        ws.close()
      }
    }

    // Patchy mobile data: a regained network resyncs from the version.
    function regain(): void {
      if (cancelled || dead) return
      if (socket && socket.readyState === WebSocket.OPEN && current.state !== null) {
        void resync().catch(() => {})
      } else if (!socket || socket.readyState === WebSocket.CLOSED) {
        if (retryTimer) clearTimeout(retryTimer)
        attempts = 0
        connect()
      }
    }
    function onVisible(): void {
      if (document.visibilityState === "visible") regain()
    }

    connect()
    window.addEventListener("online", regain)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      window.removeEventListener("online", regain)
      document.removeEventListener("visibilitychange", onVisible)
      socket?.close()
    }
  }, [gameId])

  return { state, status, notFound }
}
