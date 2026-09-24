import { describe, expect, it } from "vitest"
import type { GameListItem } from "@/types"
import { eventCards, showAsChips } from "./events"

const game = (id: string, tournament: GameListItem["tournament"]) => ({ id, tournament }) as GameListItem

const OPEN_1 = { id: "o1", name: "Olympiad | Open | Matches 1-12", group: "Olympiad", section: "Open | Matches 1-12" }
const OPEN_2 = { id: "o2", name: "Olympiad | Open | Matches 63-87", group: "Olympiad", section: "Open | Matches 63-87" }
const C11 = { id: "c11", name: "Eliminacje MA-WM C11", group: "Eliminacje MA-WM", section: "C11" }
const C9 = { id: "c9", name: "Eliminacje MA-WM C9", group: "Eliminacje MA-WM", section: "C9" }
const SOLO = { id: "s", name: "Club Open", group: null, section: null }

describe("eventCards", () => {
  it("puts split tours under one card, biggest event first, tours in natural order", () => {
    const cards = eventCards([
      game("a", C11),
      game("b", OPEN_2),
      game("c", OPEN_1),
      game("d", OPEN_2),
      game("e", C9),
      game("f", SOLO),
    ])
    expect(cards.map((c) => [c.title, c.total])).toEqual([
      ["Olympiad", 3],
      ["Eliminacje MA-WM", 2],
      ["Club Open", 1],
    ])
    expect(cards[0]!.tours).toEqual([
      { tournamentId: "o1", label: "Open · Matches 1-12", count: 1 },
      { tournamentId: "o2", label: "Open · Matches 63-87", count: 2 },
    ])
    expect(cards[1]!.tours.map((t) => t.label)).toEqual(["C9", "C11"])
    expect(cards[2]!.tours[0]!.label).toBe("All boards")
  })

  it("adds a tour without a stored group to the group its name starts with", () => {
    const old = { id: "o3", name: "Olympiad | Open | Matches 88+", group: null, section: null }
    const [card] = eventCards([game("a", OPEN_1), game("b", old)])
    expect(card!.tours.map((t) => t.label)).toEqual(["Open · Matches 1-12", "Open · Matches 88+"])
  })

  it("shows short section names as chips", () => {
    const [olympiad, qualifier] = eventCards([game("a", OPEN_1), game("b", OPEN_2), game("c", C9), game("d", C11)])
    expect(showAsChips(olympiad!)).toBe(false)
    expect(showAsChips(qualifier!)).toBe(true)
  })
})
