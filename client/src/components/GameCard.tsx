import { Link } from "react-router"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { PlaceholderGame } from "@/data/mock"

export function GameCard({ game }: { game: PlaceholderGame }) {
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground">
      <div className="flex items-center justify-between">
        <Badge variant="destructive">
          <span className="size-1.5 rounded-full bg-current" aria-hidden />
          Live
        </Badge>
        <span className="text-xs text-muted-foreground">{game.event}</span>
      </div>
      <div className="text-sm font-medium">
        {game.white} <span className="text-muted-foreground">vs</span> {game.black}
      </div>
      <Button asChild variant="outline" size="sm" className="self-start">
        <Link to={`/games/${game.id}`}>View board</Link>
      </Button>
    </article>
  )
}
