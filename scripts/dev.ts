// One command for the whole local stack: gateway, publisher, client and
// ingestion.
//
//   bun run dev                 # ...plus the supervisor: follows whatever is live on Lichess
//   bun run dev <roundId>       # ...plus one broadcast round instead
//   bun run dev --no-ingest     # gateway + publisher + client only
//
// The eval worker also starts when Stockfish is installed (ADR 0006).
//
// Each process's output is prefixed with its name. Ctrl+C stops all of
// them, and if one crashes the rest are stopped too.

// import.meta.dir is a plain path (URL pathnames escape spaces, and this
// repo lives under "Web Projects"). process.execPath is the running bun.
const root = `${import.meta.dir}/../`;
const bun = process.execPath;
const arg = process.argv[2];

const services: Array<{ name: string; color: number; cwd: string; cmd: string[] }> = [
  { name: "gateway", color: 36, cwd: "server", cmd: [bun, "run", "gateway"] },
  { name: "publisher", color: 35, cwd: "server", cmd: [bun, "run", "publisher"] },
  { name: "client", color: 32, cwd: "client", cmd: [bun, "run", "dev"] },
];
if (Bun.which(process.env["STOCKFISH_PATH"] || "stockfish")) {
  services.push({ name: "eval", color: 34, cwd: "server", cmd: [bun, "run", "eval"] });
} else {
  console.log("Stockfish not found, starting without eval (brew install stockfish to enable it)");
}
if (arg === undefined) {
  services.push({ name: "supervisor", color: 33, cwd: "server", cmd: [bun, "run", "supervisor"] });
} else if (arg !== "--no-ingest") {
  services.push({ name: "ingest", color: 33, cwd: "server", cmd: [bun, "run", "ingest", arg] });
}

const width = Math.max(...services.map((s) => s.name.length));

// Copy a stream to stdout line by line with a colored name prefix.
async function pipe(stream: ReadableStream<Uint8Array>, prefix: string): Promise<void> {
  let rest = "";
  for await (const chunk of stream.pipeThrough(new TextDecoderStream())) {
    const lines = (rest + chunk).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) console.log(`${prefix} ${line}`);
  }
  if (rest) console.log(`${prefix} ${rest}`);
}

const procs = services.map((s) => {
  const proc = Bun.spawn(s.cmd, { cwd: `${root}${s.cwd}`, stdout: "pipe", stderr: "pipe" });
  const prefix = `\x1b[${s.color}m${s.name.padEnd(width)} |\x1b[0m`;
  void pipe(proc.stdout, prefix);
  void pipe(proc.stderr, prefix);
  return { ...s, proc };
});

let stopping = false;
function stopAll(code: number): void {
  if (stopping) return;
  stopping = true;
  for (const { proc } of procs) proc.kill();
  setTimeout(() => process.exit(code), 500);
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

for (const { name, proc } of procs) {
  void proc.exited.then((code) => {
    if (stopping) return;
    // The ingest worker exits 0 on its own when the round finishes;
    // that is not a reason to stop everything else.
    if (name === "ingest" && code === 0) {
      console.log(`ingest finished, the rest keeps running`);
      return;
    }
    console.error(`${name} exited with code ${code}, stopping everything`);
    stopAll(code || 1);
  });
}
