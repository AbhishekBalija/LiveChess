import { describe, expect, it } from "vitest"
import type { LiveMove, MoveEval } from "./game"
import { classifyMove } from "./classify"

// Evals are from White's side. Ply 1, 3, 5... are White's moves.
const cp = (value: number): MoveEval => ({ cp: value, mate: null })
const mate = (n: number): MoveEval => ({ cp: null, mate: n })

function movesWith(evals: Array<MoveEval | undefined>): Map<number, LiveMove> {
  const moves = new Map<number, LiveMove>()
  evals.forEach((e, i) => {
    const ply = i + 1
    moves.set(ply, { ply, san: "x", fen: "", clock: null, version: 1, eval: e })
  })
  return moves
}

// Label of the last ply in the list.
const labelOf = (evals: Array<MoveEval | undefined>) => classifyMove(movesWith(evals), evals.length)

describe("classifyMove: win% drop (Lichess thresholds)", () => {
  // White moves at ply 3, from +0.00 to a worse eval for White.
  it("labels 5, 10 and 15 point drops as inaccuracy, mistake, blunder", () => {
    expect(labelOf([cp(0), cp(0), cp(-30)])).toBeNull() // about 2.8 points
    expect(labelOf([cp(0), cp(0), cp(-60)])).toBe("inaccuracy") // about 5.5
    expect(labelOf([cp(0), cp(0), cp(-120)])).toBe("mistake") // about 11
    expect(labelOf([cp(0), cp(0), cp(-180)])).toBe("blunder") // about 16
  })

  it("judges from the mover's side, so Black losing ground is flagged too", () => {
    // Black moves at ply 2: White's eval going up is Black's loss.
    expect(labelOf([cp(0), cp(180)])).toBe("blunder")
    // A White move that makes White's eval go up is fine.
    expect(labelOf([cp(0), cp(0), cp(180)])).toBeNull()
  })

  it("ignores small changes in a position that is already decided", () => {
    expect(labelOf([cp(0), cp(-800), cp(-1200)])).toBeNull()
  })

  it("never flags keeping a tablebase win", () => {
    expect(labelOf([cp(0), cp(0), cp(20_000)])).toBeNull()
    expect(labelOf([cp(0), cp(20_000), cp(20_000)])).toBeNull()
  })

  it("gives no label without both evals, or for the first move", () => {
    expect(labelOf([cp(0), undefined, cp(-500)])).toBeNull()
    expect(labelOf([cp(0), cp(0), undefined])).toBeNull()
    expect(labelOf([cp(-500)])).toBeNull()
  })
})

describe("classifyMove: mates (Lichess mate table)", () => {
  it("allowing a forced mate depends on how bad things already were", () => {
    expect(labelOf([cp(0), cp(0), mate(-3)])).toBe("blunder")
    expect(labelOf([cp(0), cp(-700), mate(-3)])).toBe("blunder")
    expect(labelOf([cp(0), cp(-800), mate(-3)])).toBe("mistake")
    expect(labelOf([cp(0), cp(-1200), mate(-3)])).toBe("inaccuracy")
  })

  it("losing your own forced mate depends on what is left", () => {
    expect(labelOf([mate(3), mate(2), cp(1500)])).toBe("inaccuracy")
    expect(labelOf([mate(3), mate(2), cp(800)])).toBe("mistake")
    expect(labelOf([mate(3), mate(2), cp(300)])).toBe("blunder")
    expect(labelOf([mate(3), mate(2), mate(-4)])).toBe("blunder")
  })

  it("does not flag delivering checkmate", () => {
    expect(labelOf([cp(0), mate(1), mate(0)])).toBeNull()
  })

  it("does not flag a slower mate or a tablebase win after a mate", () => {
    expect(labelOf([mate(3), mate(2), mate(5)])).toBeNull()
    expect(labelOf([mate(3), mate(2), cp(20_000)])).toBeNull()
  })

  it("does not flag moves in a position where the opponent already mates", () => {
    expect(labelOf([cp(0), mate(-3), mate(-2)])).toBeNull()
    expect(labelOf([cp(0), mate(-3), cp(-300)])).toBeNull()
  })

  it("mirrors all of it for Black", () => {
    // Black moves at ply 2 and allows White a mate.
    expect(labelOf([cp(0), mate(3)])).toBe("blunder")
  })
})

describe("classifyMove: miss", () => {
  it("a mistake or blunder right after the opponent's mistake or blunder is a miss", () => {
    // Black blunders at ply 2 (0 -> +3), White throws it back at ply 3.
    expect(labelOf([cp(0), cp(300), cp(0)])).toBe("miss")
    expect(labelOf([cp(0), cp(300), cp(160)])).toBe("miss")
  })

  it("an inaccuracy after the opponent's error stays an inaccuracy", () => {
    expect(labelOf([cp(0), cp(300), cp(220)])).toBe("inaccuracy")
  })

  it("a blunder after a normal move stays a blunder", () => {
    expect(labelOf([cp(0), cp(10), cp(-300)])).toBe("blunder")
  })
})

describe("classifyMove: best", () => {
  // Ply 2 plays `san`; ply 1's position had `best` as the engine's reply.
  function withBest(best: string | undefined, san: string, after: MoveEval = cp(0)) {
    const moves = new Map<number, LiveMove>()
    moves.set(1, { ply: 1, san: "e4", fen: "", clock: null, version: 1, eval: cp(0), bestReply: best })
    moves.set(2, { ply: 2, san, fen: "", clock: null, version: 1, eval: after })
    return classifyMove(moves, 2)
  }

  it("labels the engine's best reply as best", () => {
    expect(withBest("e5", "e5")).toBe("best")
    expect(withBest("e5", "c5")).toBeNull()
  })

  it("gives no best label without a stored best reply", () => {
    expect(withBest(undefined, "e5")).toBeNull()
  })

  it("lets a bad label win if the engine's move still lost ground", () => {
    expect(withBest("e5", "e5", cp(300))).toBe("blunder")
  })
})

describe("classifyMove: brilliant", () => {
  // White plays the engine's best move at ply 3, from `before` to `after`
  // (White-side evals), with the server's sacrifice flag.
  function brilliantCase(sacrifice: boolean | undefined, before: MoveEval, after: MoveEval) {
    const moves = new Map<number, LiveMove>()
    moves.set(1, { ply: 1, san: "e4", fen: "", clock: null, version: 1, eval: cp(0) })
    moves.set(2, { ply: 2, san: "e5", fen: "", clock: null, version: 1, eval: before, bestReply: "Bxh7+" })
    moves.set(3, { ply: 3, san: "Bxh7+", fen: "", clock: null, version: 1, eval: after, sacrifice })
    return classifyMove(moves, 3)
  }

  it("a best move that sacrifices material is brilliant", () => {
    expect(brilliantCase(true, cp(50), cp(60))).toBe("brilliant")
    expect(brilliantCase(false, cp(50), cp(60))).toBe("best")
    expect(brilliantCase(undefined, cp(50), cp(60))).toBe("best")
  })

  it("not when the mover is worse than 50% after it", () => {
    expect(brilliantCase(true, cp(-150), cp(-100))).toBe("best")
    expect(brilliantCase(true, cp(-150), cp(0))).toBe("brilliant")
  })

  it("not when the mover was already at 90% or more", () => {
    // +6 pawns is about 90% on the curve.
    expect(brilliantCase(true, cp(700), cp(700))).toBe("best")
    expect(brilliantCase(true, cp(500), cp(500))).toBe("brilliant")
    expect(brilliantCase(true, mate(4), mate(3))).toBe("best")
  })

  it("mirrors the guards for Black", () => {
    const moves = new Map<number, LiveMove>()
    moves.set(1, { ply: 1, san: "e4", fen: "", clock: null, version: 1, eval: cp(0), bestReply: "Bxh2+" })
    moves.set(2, { ply: 2, san: "Bxh2+", fen: "", clock: null, version: 1, eval: cp(-40), sacrifice: true })
    expect(classifyMove(moves, 2)).toBe("brilliant")
    moves.set(2, { ply: 2, san: "Bxh2+", fen: "", clock: null, version: 1, eval: cp(150), sacrifice: true })
    // Worse than 50% for Black after it is not brilliant, and the drop
    // from 0 to +1.5 is a mistake anyway, which wins over any good label.
    expect(classifyMove(moves, 2)).toBe("mistake")
  })
})

describe("classifyMove: great", () => {
  // White plays the engine's best move at ply 3. `before` is the eval of
  // the position before it, `second` the best of the other moves there.
  function greatCase(
    before: MoveEval,
    second: MoveEval | undefined,
    { sacrifice = false, after = before, prevSan = "e5", san = "Rd8" } = {},
  ) {
    const moves = new Map<number, LiveMove>()
    moves.set(1, { ply: 1, san: "e4", fen: "", clock: null, version: 1, eval: cp(0) })
    moves.set(2, { ply: 2, san: prevSan, fen: "", clock: null, version: 1, eval: before, bestReply: san, second })
    moves.set(3, { ply: 3, san, fen: "", clock: null, version: 1, eval: after, sacrifice })
    return classifyMove(moves, 3)
  }

  it("the only good move is great", () => {
    // 0.00 vs -1.20: the other moves cost about 11 points.
    expect(greatCase(cp(0), cp(-120))).toBe("great")
    // 0.00 vs -1.00: about 9 points, just best.
    expect(greatCase(cp(0), cp(-100))).toBe("best")
  })

  it("finding the only move out of a forced mate counts", () => {
    expect(greatCase(cp(0), mate(-4))).toBe("great")
  })

  it("not when another move wins just as well", () => {
    expect(greatCase(mate(3), mate(5))).toBe("best")
    expect(greatCase(cp(20_000), cp(20_000))).toBe("best")
  })

  it("stays best without a searched second score", () => {
    expect(greatCase(cp(0), undefined)).toBe("best")
  })

  it("brilliant wins over great", () => {
    expect(greatCase(cp(0), cp(-300), { sacrifice: true })).toBe("brilliant")
  })

  it("taking material back right after the opponent took some is not great", () => {
    expect(greatCase(cp(0), cp(-900), { prevSan: "Bxc3+", san: "bxc3" })).toBe("best")
    // A capture after a quiet move can still be great.
    expect(greatCase(cp(0), cp(-300), { san: "Bxh7+" })).toBe("great")
  })

  it("not when the mover is still worse after the only move", () => {
    expect(greatCase(cp(-150), mate(-3), { after: cp(-150) })).toBe("best")
    // Holding an equal position with the only move counts.
    expect(greatCase(cp(0), cp(-300), { after: cp(0) })).toBe("great")
  })

  it("mirrors it for Black", () => {
    const moves = new Map<number, LiveMove>()
    moves.set(1, { ply: 1, san: "e4", fen: "", clock: null, version: 1, eval: cp(0), bestReply: "d5", second: cp(150) })
    moves.set(2, { ply: 2, san: "d5", fen: "", clock: null, version: 1, eval: cp(0) })
    expect(classifyMove(moves, 2)).toBe("great")
    // Black worse than 50% after it: just best.
    moves.set(2, { ply: 2, san: "d5", fen: "", clock: null, version: 1, eval: cp(40) })
    expect(classifyMove(moves, 2)).toBe("best")
  })
})
