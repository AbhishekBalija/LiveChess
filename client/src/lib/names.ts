// Display helpers for names coming from PGN headers.

// Lichess names look like "46th FIDE Chess Olympiad 2026 | Open | Matches 1-12".
// First part is the title, the rest reads better as a quiet subtitle.
export function splitTournamentName(name: string): { title: string; subtitle: string | null } {
  const [title = name, ...rest] = name.split("|").map((part) => part.trim()).filter(Boolean)
  return { title, subtitle: rest.length > 0 ? rest.join(" · ") : null }
}

// "Abdusattorov, Nodirbek" -> "Abdusattorov"; names without a comma stay whole.
export function surname(name: string): string {
  return name.split(",")[0]?.trim() || name
}

// Result line for a finished game, e.g. "Cheng won · 0-1" or "Draw · ½-½".
export function resultLine(result: string, white: string, black: string): string {
  if (result === "1-0") return `${surname(white)} won · 1-0`
  if (result === "0-1") return `${surname(black)} won · 0-1`
  if (result === "1/2-1/2") return "Draw · ½-½"
  return result
}
