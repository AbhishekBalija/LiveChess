import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { BOARD_PALETTES, type BoardPalette } from "@/lib/boardPalette"
import { fenToBoard } from "@/lib/fen"
import { slidesBetween, type Slide } from "@/lib/moveAnimation"

// The chess board. Without a FEN it renders an empty grid (loading);
// with one it draws the position with the Chessnut SVG pieces. Colors come from the game's palette
// (lib/boardPalette), so every game has its own board. Pieces and
// coordinates size off the board width (container query units), so the
// same markup works as a 110px thumbnail and a 640px main board. Rows
// are 8 fixed tracks: auto rows let empty ranks collapse in endgames.

const FILES = "abcdefgh"

export function ChessBoard({
  fen,
  highlight,
  palette = BOARD_PALETTES[0],
  coords = true,
  className = "",
}: {
  fen?: string
  highlight?: Set<string>
  palette?: BoardPalette
  // Thumbnails turn coordinates off; they are noise at that size.
  coords?: boolean
  className?: string
}) {
  const board = fen ? fenToBoard(fen) : null
  const slides = useMoveSlides(fen)
  return (
    <div
      role="img"
      aria-label={fen ? "Chess board" : "Chess board loading"}
      className={`@container grid aspect-square w-full grid-cols-8 grid-rows-8 overflow-hidden rounded-[3%] ${className}`}
    >
      {Array.from({ length: 64 }, (_, i) => {
        const row = Math.floor(i / 8)
        const fileIndex = i % 8
        const square = `${FILES[fileIndex]}${8 - row}`
        const light = (row + fileIndex) % 2 === 0
        const piece = board?.[row]?.[fileIndex] ?? null
        const lit = highlight?.has(square) ?? false
        const background = lit
          ? light ? palette.lightHighlight : palette.darkHighlight
          : light ? palette.light : palette.dark
        // Coordinates take the opposite square color so they read on both.
        const coordColor = light ? palette.dark : palette.light
        return (
          <div
            key={square}
            className="relative flex min-h-0 min-w-0 items-center justify-center"
            style={{ background }}
          >
            {coords && fileIndex === 0 && (
              <Coord className="top-[0.5cqw] left-[0.7cqw]" color={coordColor}>
                {8 - row}
              </Coord>
            )}
            {coords && row === 7 && (
              <Coord className="right-[0.7cqw] bottom-[0.3cqw]" color={coordColor}>
                {FILES[fileIndex]}
              </Coord>
            )}
            {piece && <Piece piece={piece} slide={slides.get(square)} />}
          </div>
        )
      })}
    </div>
  )
}

function Coord({ children, className, color }: { children: ReactNode; className: string; color: string }) {
  const style: CSSProperties = { color }
  return (
    <span
      aria-hidden
      style={style}
      className={`absolute font-display text-[2.4cqw] leading-none font-bold select-none ${className}`}
    >
      {children}
    </span>
  )
}

// Chessnut SVG set (Apache-2.0, see assets/pieces/README.md), keyed by
// "wK", "bN" and so on. Bundled as URLs, so each file is fetched once and cached.
const PIECE_URLS = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("../assets/pieces/*.svg", { eager: true, query: "?url", import: "default" }),
  ).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1, -4), url]),
)

// A piece fills its square; while a move animates it starts translated
// back onto its origin square (in whole squares) and glides home.
function Piece({ piece, slide }: { piece: string; slide?: SlideState }) {
  const color = piece === piece.toUpperCase() ? "w" : "b"
  const src = PIECE_URLS[`${color}${piece.toUpperCase()}`]
  if (!src) return null
  const style: CSSProperties | undefined = slide
    ? slide.moving
      ? { transform: "translate(0, 0)", transition: "transform 200ms ease-out", zIndex: 1 }
      : { transform: `translate(${slide.dx * 100}%, ${slide.dy * 100}%)`, zIndex: 1 }
    : undefined
  return (
    <span className="absolute inset-0 flex items-center justify-center" style={style}>
      <img src={src} alt="" draggable={false} className="size-[90%] select-none" />
    </span>
  )
}

interface SlideState extends Slide {
  moving: boolean
}

// When the position changes by one move, slide the moved piece(s) from
// their old square: first paint them at the origin, then on the next
// frames let the transition carry them to the destination. Skipped for
// big jumps (see slidesBetween) and for people who ask for less motion.
function useMoveSlides(fen: string | undefined): Map<string, SlideState> {
  const previous = useRef(fen)
  const [slides, setSlides] = useState<Map<string, SlideState>>(new Map())
  useLayoutEffect(() => {
    const before = previous.current
    previous.current = fen
    if (!before || !fen || before === fen) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const found = slidesBetween(before, fen)
    if (found.size === 0) return
    const at = (moving: boolean) => new Map([...found].map(([sq, s]) => [sq, { ...s, moving }]))
    setSlides(at(false))
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setSlides(at(true)))
    })
    const done = setTimeout(() => setSlides(new Map()), 260)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(done)
    }
  }, [fen])
  return slides
}
