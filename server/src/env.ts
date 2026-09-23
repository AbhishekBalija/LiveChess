// Numeric settings from the environment, checked once at startup. A typo
// like INGEST_INTERVAL_MS=3s used to become NaN, and setTimeout(fn, NaN)
// fires immediately: a hot loop against Lichess. Now it stops the process
// with a message saying which setting is wrong.

export function envInt(
  name: string,
  fallback: number,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {},
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name}=${JSON.stringify(raw)} is invalid: expected a whole number from ${min} to ${max}`);
  }
  return value;
}
