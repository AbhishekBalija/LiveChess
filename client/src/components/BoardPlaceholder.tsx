import { fenToBoard, pieceGlyph } from "@/lib/fen"

// Board shell. Without a FEN it renders the empty 8x8 placeholder grid;
// with one it draws each square's piece as a Unicode glyph.
// (A real chess library arrives only if the shell outgrows glyphs.)

export function BoardPlaceholder({ fen }: { fen?: string }) {
  const board = fen ? fenToBoard(fen) : null
  return (
    <div
      role="img"
      aria-label={fen ? "Live chess board" : "Chess board placeholder"}
      className="grid aspect-square w-full grid-cols-8 overflow-hidden rounded-lg border border-border"
    >
      {Array.from({ length: 64 }, (_, i) => {
        const rank = 8 - Math.floor(i / 8)
        const fileIndex = i % 8
        const file = "abcdefgh"[fileIndex] ?? "a"
        const light = (Math.floor(i / 8) + i) % 2 === 0
        const piece = board?.[8 - rank]?.[fileIndex] ?? null
        return (
          <div
            key={`${file}${rank}`}
            className={`flex items-center justify-center ${
              light ? "bg-[#f0d9b5]" : "bg-[#b58863]"
            }`}
          >
            {piece && <PieceGlyph piece={piece} />}
          </div>
        )
      })}
    </div>
  )
}

function PieceGlyph({ piece }: { piece: string }) {
  const { glyph, side } = pieceGlyph(piece)
  return (
    <span
      aria-hidden
      className={`text-2xl leading-none sm:text-3xl ${
        side === "white"
          ? "text-stone-100 drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]"
          : "text-stone-900"
      }`}
    >
      {glyph}
    </span>
  )
}
