import { fenToBoard, pieceGlyph } from "@/lib/fen"

// Board shell. Without a FEN it renders the empty 8x8 placeholder grid;
// with one it draws each square's piece as a Unicode glyph.
// (A real chess library arrives only if the shell outgrows glyphs.)
// Glyphs size off the board width (container query units), so the same
// markup reads on a phone and on a capped desktop board.

const FILES = "abcdefgh"

export function BoardPlaceholder({
  fen,
  highlight,
  coords = true,
}: {
  fen?: string
  highlight?: Set<string>
  // Thumbnails turn coordinates off; they are noise at that size.
  coords?: boolean
}) {
  const board = fen ? fenToBoard(fen) : null
  return (
    <div
      role="img"
      aria-label={fen ? "Live chess board" : "Chess board placeholder"}
      className="@container grid aspect-square w-full grid-cols-8 overflow-hidden rounded-md shadow-lg shadow-black/40 ring-1 ring-white/10"
    >
      {Array.from({ length: 64 }, (_, i) => {
        const row = Math.floor(i / 8)
        const fileIndex = i % 8
        const square = `${FILES[fileIndex]}${8 - row}`
        const light = (row + fileIndex) % 2 === 0
        const piece = board?.[row]?.[fileIndex] ?? null
        const lit = highlight?.has(square) ?? false
        return (
          <div
            key={square}
            className={`relative flex items-center justify-center ${
              light ? "bg-[#ebd7b5]" : "bg-[#b0896a]"
            }`}
          >
            {lit && <span aria-hidden className="absolute inset-0 bg-yellow-300/45" />}
            {coords && fileIndex === 0 && (
              <Coord className="top-[0.4cqw] left-[0.6cqw]" light={light}>
                {8 - row}
              </Coord>
            )}
            {coords && row === 7 && (
              <Coord className="right-[0.6cqw] bottom-[0.2cqw]" light={light}>
                {FILES[fileIndex]}
              </Coord>
            )}
            {piece && <PieceGlyph piece={piece} />}
          </div>
        )
      })}
    </div>
  )
}

function Coord({
  children,
  className,
  light,
}: {
  children: React.ReactNode
  className: string
  light: boolean
}) {
  return (
    <span
      aria-hidden
      className={`absolute text-[2.2cqw] leading-none font-semibold select-none ${className} ${
        light ? "text-[#b0896a]" : "text-[#ebd7b5]"
      }`}
    >
      {children}
    </span>
  )
}

// Filled glyphs for both sides, colored in CSS: the outline set
// vanished on light squares. VS15 (U+FE0E) keeps iOS from swapping
// the pawn for an emoji.
function PieceGlyph({ piece }: { piece: string }) {
  const { glyph, side } = pieceGlyph(piece)
  return (
    <span
      aria-hidden
      className={`relative font-[Segoe_UI_Symbol,DejaVu_Sans,Noto_Sans_Symbols_2,sans-serif] text-[9.5cqw] leading-none select-none ${
        side === "white"
          ? "text-white [text-shadow:0_0_1px_#000,0_0_1px_#000,0_0_1px_#000,0_2px_3px_rgb(0_0_0/0.45)]"
          : "text-stone-900 [text-shadow:0_0_1px_rgb(255_255_255/0.35),0_2px_3px_rgb(0_0_0/0.35)]"
      }`}
    >
      {glyph}
      {"︎"}
    </span>
  )
}
