import { describe, expect, it } from "vitest"
import type { GameListItem } from "@/types"
import { stableOrder } from "./useLiveGames"

const g = (id: string): GameListItem => ({
  id,
  white: "W",
  black: "B",
  result: "*",
  tournament: { id: "t", name: "T", group: null, section: null },
  lastPly: 1,
  lastSan: "e4",
  whiteClock: null,
  blackClock: null,
  fen: "",
  version: 1,
  updatedAt: "",
  evalCp: null,
  evalMate: null,
  roundId: null,
})

describe("stableOrder", () => {
  it("uses the server order on first load", () => {
    expect(stableOrder(null, [g("b"), g("a")]).map((x) => x.id)).toEqual(["b", "a"])
  })

  it("keeps first-seen order, appends new games, drops finished ones", () => {
    const prev = [g("a"), g("b"), g("c")]
    const next = [g("c"), g("d"), g("a")]
    expect(stableOrder(prev, next).map((x) => x.id)).toEqual(["a", "c", "d"])
  })
})
