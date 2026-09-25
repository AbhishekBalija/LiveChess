// Stockfish over UCI (ADR 0006). The binary runs as its own process and we
// only talk to it through stdin/stdout, which keeps its GPL-3.0 license
// separate from this Apache-2.0 code. Install it on the machine
// (`brew install stockfish`, `apt install stockfish`); it is not bundled.

// Eval from White's point of view. Exactly one of cp/mate is set.
// mate: +N White mates in N, -N Black mates in N, 0 the side to move is
// checkmated.
export interface Eval {
  cp: number | null;
  mate: number | null;
}

// Score from one UCI "info" line, from the side to move's point of view.
// Bound lines (lowerbound/upperbound) are not final scores and are skipped.
export function parseScore(line: string): Eval | null {
  if (!line.startsWith("info ") || / (lower|upper)bound/.test(line)) return null;
  const match = / score (cp|mate) (-?\d+)/.exec(line);
  if (!match) return null;
  const value = Number(match[2]);
  return match[1] === "cp" ? { cp: value, mate: null } : { cp: null, mate: value };
}

// UCI scores are for the side to move; stored evals are for White.
export function whitePov(score: Eval, fen: string): Eval {
  const blackToMove = fen.split(" ")[1] === "b";
  if (!blackToMove) return score;
  return { cp: flip(score.cp), mate: flip(score.mate) };
}

// Negate, but keep 0 as 0 (not -0): mate 0 has no side to flip to.
function flip(value: number | null): number | null {
  if (value === null || value === 0) return value;
  return -value;
}

// The engine's `bestmove` line: the best move in UCI ("e2e4", "e7e8q"),
// or null when the side to move has none (checkmate or stalemate).
export function parseBestMove(line: string): string | null {
  const move = line.split(" ")[1];
  return move && move !== "(none)" ? move : null;
}

// One search: the eval and the move Stockfish would play (UCI).
export interface Search {
  eval: Eval;
  bestMove: string | null;
}

export interface EnginePort {
  evaluate(fen: string, nodes: number): Promise<Search>;
}

// One long-lived Stockfish process, one search at a time.
export class Stockfish implements EnginePort {
  private proc: ReturnType<typeof Bun.spawn<"pipe", "pipe", "inherit">>;
  private lines: AsyncIterator<string>;

  constructor(path: string, threads = 1) {
    this.proc = Bun.spawn([path], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
    this.lines = readLines(this.proc.stdout)[Symbol.asyncIterator]();
    this.send("uci");
    this.send(`setoption name Threads value ${threads}`);
  }

  private send(command: string): void {
    this.proc.stdin.write(`${command}\n`);
  }

  private async until(prefix: string, onLine?: (line: string) => void): Promise<string> {
    for (;;) {
      const next = await this.lines.next();
      if (next.done) throw new Error("stockfish exited");
      onLine?.(next.value);
      if (next.value.startsWith(prefix)) return next.value;
    }
  }

  async ready(): Promise<void> {
    this.send("isready");
    await this.until("readyok");
  }

  // Fixed node count, so the same position always gets the same eval
  // whatever the server load is (ADR 0006).
  async evaluate(fen: string, nodes: number): Promise<Search> {
    let last: Eval | null = null;
    this.send(`position fen ${fen}`);
    this.send(`go nodes ${nodes}`);
    const bestLine = await this.until("bestmove", (line) => {
      last = parseScore(line) ?? last;
    });
    if (last === null) throw new Error(`stockfish gave no score for ${fen}`);
    return { eval: whitePov(last, fen), bestMove: parseBestMove(bestLine) };
  }

  // Resolves with the exit code if the Stockfish process dies.
  get exited(): Promise<number> {
    return this.proc.exited;
  }

  stop(): void {
    this.send("quit");
  }
}

async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let rest = "";
  for await (const chunk of stream) {
    const parts = (rest + decoder.decode(chunk, { stream: true })).split("\n");
    rest = parts.pop() ?? "";
    for (const part of parts) yield part.trim();
  }
  if (rest) yield rest.trim();
}
