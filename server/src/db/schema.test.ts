import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { games, moves, outboxEvents, tournaments } from "./schema";

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((c) => c.name);
}

describe("slice 1 schema", () => {
  it("tournaments and games both carry source mapping", () => {
    for (const table of [tournaments, games]) {
      const names = columnNames(table);
      expect(names).toContain("source");
      expect(names).toContain("source_id");
    }
  });

  it("moves identity is (game_id, ply, source), never move_number", () => {
    const config = getTableConfig(moves);
    const names = columnNames(moves);
    expect(names).toContain("ply");
    expect(names).toContain("clock");
    expect(names).not.toContain("move_number");
    const indexCols = config.indexes.flatMap((idx) =>
      idx.config.columns.map((c) => (c as { name?: string }).name ?? ""),
    );
    expect(indexCols).toEqual(
      expect.arrayContaining(["game_id", "ply", "source"]),
    );
  });

  it("outbox id is monotonic bigint, not uuid", () => {
    const names = columnNames(outboxEvents);
    const config = getTableConfig(outboxEvents);
    const id = config.columns.find((c) => c.name === "id");
    expect(id?.columnType).toMatch(/^PgBigInt/);
    expect(names).toEqual(
      expect.arrayContaining(["id", "event_type", "payload", "published"]),
    );
  });

  it("games checkpoint defaults to version zero", () => {
    const config = getTableConfig(games);
    const version = config.columns.find((c) => c.name === "version");
    const lastPly = config.columns.find((c) => c.name === "last_ply");
    expect(version?.default).toBe(0);
    expect(lastPly?.default).toBe(0);
  });
});
