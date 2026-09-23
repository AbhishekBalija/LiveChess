import { describe, expect, it } from "vitest";
import { backoffMs, consumePgnStream, splitStreamBuffer, withIdleTimeout } from "./stream";

const g1 = '[Event "T"]\n[GameURL "https://lichess.org/broadcast/t/r/rrrrrrrr/aaaaaaaa"]\n\n1. e4 e5 *';
const g2 = '[Event "T"]\n[GameURL "https://lichess.org/broadcast/t/r/rrrrrrrr/bbbbbbbb"]\n\n1. d4 d5 1-0';

async function* chunks(...parts: string[]): AsyncIterable<string> {
  for (const p of parts) yield p;
}

describe("splitStreamBuffer", () => {
  it("returns whole games and keeps the unfinished tail", () => {
    const { games, rest } = splitStreamBuffer(`${g1}\n\n\n${g2.slice(0, 20)}`);
    expect(games).toEqual([g1]);
    expect(rest).toBe(g2.slice(0, 20));
  });

  it("ignores keepalive spaces between games", () => {
    expect(splitStreamBuffer(` \n\n\n${g1}\n\n\n \n\n\n`).games).toEqual([g1]);
  });
});

describe("consumePgnStream", () => {
  it("reassembles games split across chunk boundaries, in order", async () => {
    const all = `${g1}\n\n\n ${g2}\n\n\n`;
    const seen: string[] = [];
    await consumePgnStream(chunks(all.slice(0, 7), all.slice(7, 60), all.slice(60)), async (pgn) => {
      seen.push(pgn);
    });
    expect(seen).toEqual([g1, g2]);
  });

  it("delivers a final game that has no trailing separator", async () => {
    const seen: string[] = [];
    await consumePgnStream(chunks(g1), async (pgn) => {
      seen.push(pgn);
    });
    expect(seen).toEqual([g1]);
  });
});

describe("backoffMs", () => {
  it("grows exponentially with jitter and caps at a minute", () => {
    expect(backoffMs(0, () => 0)).toBe(500);
    expect(backoffMs(0, () => 1)).toBe(1000);
    expect(backoffMs(3, () => 1)).toBe(8000);
    expect(backoffMs(20, () => 1)).toBe(60_000);
  });
});

describe("withIdleTimeout", () => {
  it("aborts when no chunk arrives in time", async () => {
    let aborted = false;
    async function* stalls(): AsyncIterable<string> {
      yield "a";
      await new Promise((r) => setTimeout(r, 50));
      yield "b";
    }
    const out: string[] = [];
    for await (const c of withIdleTimeout(stalls(), 10, () => {
      aborted = true;
    })) out.push(c);
    expect(aborted).toBe(true);
    expect(out).toEqual(["a", "b"]);
  });
});
