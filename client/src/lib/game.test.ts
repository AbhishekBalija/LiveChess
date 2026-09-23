import { describe, expect, it } from "vitest"
import type { GameStateResponse } from "@/types"
import {
  applyEvent,
  applyResync,
  fromSnapshot,
  parseLiveEvent,
  type GameState,
  type LiveEvent,
} from "./game"

const GID = "123e4567-e89b-12d3-a456-426614174000"

function snapshot(overrides: Partial<GameStateResponse> = {}): GameStateResponse {
  return {
    gameId: GID,
    version: 2,
    fen: "fen-2",
    lastMove: { ply: 2, san: "e5" },
    missedMoves: [
      { ply: 1, san: "e4", fen: "fen-1", version: 1 },
      { ply: 2, san: "e5", fen: "fen-2", version: 2 },
    ],
    ...overrides,
  }
}

function event(overrides: Partial<LiveEvent> = {}): LiveEvent {
  return { type: "MoveReceived", gameId: GID, ply: 1, san: "e4", fen: "fen-1", version: 1, ...overrides }
}

describe("parseLiveEvent", () => {
  it("parses string ply/version to numbers", () => {
    expect(
      parseLiveEvent(GID, { type: "MoveReceived", gameId: GID, ply: "3", san: "Bb5", fen: "fen-3", version: "3" }),
    ).toEqual({ type: "MoveReceived", gameId: GID, ply: 3, san: "Bb5", fen: "fen-3", version: 3 })
  })

  it("rejects other games, non-integers, and missing fields", () => {
    const base = { type: "MoveReceived", gameId: GID, ply: "1", san: "e4", fen: "fen-1", version: "1" }
    expect(parseLiveEvent("other", base)).toBeNull()
    expect(parseLiveEvent(GID, { ...base, ply: "1.5" })).toBeNull()
    expect(parseLiveEvent(GID, { ...base, version: "0" })).toBeNull()
    expect(parseLiveEvent(GID, { ...base, san: undefined })).toBeNull()
    expect(parseLiveEvent(GID, null)).toBeNull()
    expect(parseLiveEvent(GID, "e4")).toBeNull()
  })
})

describe("fromSnapshot", () => {
  it("builds state keyed by ply", () => {
    const state = fromSnapshot(snapshot())
    expect(state.version).toBe(2)
    expect(state.fen).toBe("fen-2")
    expect(state.lastPly).toBe(2)
    expect(state.moves.get(1)?.san).toBe("e4")
    expect(state.moves.get(2)?.san).toBe("e5")
  })

  it("handles an empty game", () => {
    const state = fromSnapshot(snapshot({ version: 0, fen: "", lastMove: null, missedMoves: [] }))
    expect(state.lastPly).toBe(0)
    expect(state.moves.size).toBe(0)
  })
})

describe("applyResync", () => {
  it("merges by ply with later versions winning", () => {
    const state = fromSnapshot(snapshot())
    const next = applyResync(
      state,
      snapshot({
        version: 3,
        fen: "fen-2",
        lastMove: { ply: 2, san: "e5" },
        missedMoves: [{ ply: 1, san: "d4", fen: "fen-1b", version: 3 }],
      }),
    )
    expect(next.version).toBe(3)
    expect(next.moves.get(1)?.san).toBe("d4")
    expect(next.moves.get(2)?.san).toBe("e5")
  })

  it("ignores a stale row at the same ply", () => {
    const state = fromSnapshot(snapshot())
    const next = applyResync(
      state,
      snapshot({ missedMoves: [{ ply: 1, san: "a3", fen: "fen-x", version: 1 }] }),
    )
    expect(next.moves.get(1)?.san).toBe("e4")
  })
})

describe("applyEvent", () => {
  function twoPlyState(): GameState {
    return fromSnapshot(snapshot())
  }

  it("keeps White and Black at the same move number as distinct plies", () => {
    let state: GameState = { version: 0, fen: "", lastPly: 0, moves: new Map() }
    for (const ev of [event({ ply: 1, san: "e4", fen: "fen-1", version: 1 }), event({ ply: 2, san: "e5", fen: "fen-2", version: 2 })]) {
      const out = applyEvent(state, ev)
      if (!("state" in out)) throw new Error("unexpected gap")
      state = out.state
    }
    expect(state.moves.get(1)?.san).toBe("e4")
    expect(state.moves.get(2)?.san).toBe("e5")
    expect(state.lastPly).toBe(2)
    expect(state.fen).toBe("fen-2")
  })

  it("replaces the SAN on correction without losing other plies", () => {
    const out = applyEvent(
      twoPlyState(),
      event({ type: "GameCorrected", ply: 1, san: "d4", fen: "fen-1b", version: 3 }),
    )
    if (!("state" in out)) throw new Error("unexpected gap")
    expect(out.state.version).toBe(3)
    expect(out.state.moves.get(1)?.san).toBe("d4")
    expect(out.state.moves.get(2)?.san).toBe("e5")
    expect(out.state.moves.size).toBe(2)
  })

  it("does not move the board on an old-ply correction", () => {
    const out = applyEvent(
      twoPlyState(),
      event({ type: "GameCorrected", ply: 1, san: "d4", fen: "fen-1b", version: 3 }),
    )
    if (!("state" in out)) throw new Error("unexpected gap")
    expect(out.state.fen).toBe("fen-2")
    expect(out.state.lastPly).toBe(2)
  })

  it("advances the board when the ply reaches past lastPly", () => {
    const out = applyEvent(twoPlyState(), event({ ply: 3, san: "Bb5", fen: "fen-3", version: 3 }))
    if (!("state" in out)) throw new Error("unexpected gap")
    expect(out.state.fen).toBe("fen-3")
    expect(out.state.lastPly).toBe(3)
  })

  it("ignores duplicates, returning the same reference", () => {
    const state = twoPlyState()
    const out = applyEvent(state, event({ ply: 2, san: "e5", fen: "fen-2", version: 2 }))
    if (!("state" in out)) throw new Error("unexpected gap")
    expect(out.state).toBe(state)
  })

  it("requests resync on a gap without touching state", () => {
    const state = twoPlyState()
    const out = applyEvent(state, event({ ply: 5, san: "x", fen: "fen-5", version: 5 }))
    expect(out).toEqual({ resync: true })
    expect(state.version).toBe(2)
    expect(state.moves.size).toBe(2)
  })
})
