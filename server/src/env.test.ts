import { describe, expect, it } from "vitest";
import { envInt } from "./env";

describe("envInt", () => {
  it("uses the fallback when unset or blank", () => {
    expect(envInt("X", 500, {}, {})).toBe(500);
    expect(envInt("X", 500, {}, { X: " " })).toBe(500);
  });

  it("parses whole numbers in range", () => {
    expect(envInt("X", 500, { min: 100 }, { X: "3000" })).toBe(3000);
  });

  it("stops on typos and out-of-range values instead of returning NaN", () => {
    expect(() => envInt("INGEST_INTERVAL_MS", 3000, {}, { INGEST_INTERVAL_MS: "3s" })).toThrow(/INGEST_INTERVAL_MS="3s" is invalid/);
    expect(() => envInt("X", 1, {}, { X: "1.5" })).toThrow();
    expect(() => envInt("X", 500, { min: 100 }, { X: "0" })).toThrow();
    expect(() => envInt("PORT", 3001, { min: 1, max: 65535 }, { PORT: "70000" })).toThrow();
  });
});
