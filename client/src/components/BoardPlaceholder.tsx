// Square board placeholder. A plain 8x8 CSS grid is enough for the
// shell; #8 will swap in a real chess board library.

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"]

export function BoardPlaceholder() {
  return (
    <div
      role="img"
      aria-label="Chess board placeholder"
      className="grid aspect-square w-full grid-cols-8 overflow-hidden rounded-lg border border-border"
    >
      {Array.from({ length: 64 }, (_, i) => {
        const rank = 8 - Math.floor(i / 8)
        const file = FILES[i % 8]
        const light = (Math.floor(i / 8) + i) % 2 === 0
        return (
          <div
            key={`${file}${rank}`}
            className={light ? "bg-muted" : "bg-secondary"}
          />
        )
      })}
    </div>
  )
}
