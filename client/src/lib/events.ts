import { splitTournamentName } from "@/lib/names"
import type { GameListItem } from "@/types"

// Live games grouped for the Events page (#47): one card per event, where
// an event Lichess splits into several tours (the Olympiad's Open and Women
// match groups, the "C9" / "C11" sections of a qualifier) shows each tour
// as a row inside it.

export interface EventTour {
  tournamentId: string
  // "Open · Matches 1-12", "C11", or "All boards" for a one-tour event.
  label: string
  count: number
}

export interface EventCard {
  key: string
  title: string
  total: number
  tours: EventTour[]
}

export function eventCards(games: GameListItem[]): EventCard[] {
  // A tour stored before its group was known joins the card of the group
  // whose name its own name starts with ("Olympiad | Open | Matches 88+").
  const groups = new Set(games.flatMap((g) => (g.tournament.group ? [g.tournament.group] : [])))
  const cards = new Map<string, EventCard>()
  for (const g of games) {
    const t = g.tournament
    const split = splitTournamentName(t.name)
    const group = t.group ?? (groups.has(split.title) ? split.title : null)
    const key = group ?? t.id
    const card = cards.get(key) ?? { key, title: group ?? split.title, total: 0, tours: [] }
    card.total += 1
    let tour = card.tours.find((x) => x.tournamentId === t.id)
    if (!tour) {
      const label = t.section?.replaceAll(" | ", " · ") ?? split.subtitle ?? "All boards"
      tour = { tournamentId: t.id, label, count: 0 }
      card.tours.push(tour)
    }
    tour.count += 1
    cards.set(key, card)
  }
  const byLabel = (a: EventTour, b: EventTour) => a.label.localeCompare(b.label, undefined, { numeric: true })
  return [...cards.values()]
    .map((c) => ({ ...c, tours: [...c.tours].sort(byLabel) }))
    .sort((a, b) => b.total - a.total)
}

// Short labels ("C9", "D11") read best as a row of chips.
export function showAsChips(card: EventCard): boolean {
  return card.tours.length > 1 && card.tours.every((t) => t.label.length <= 5)
}
