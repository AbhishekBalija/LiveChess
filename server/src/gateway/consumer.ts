import { STREAM } from "../publisher/publisher";
import { Router, type LiveEvent } from "./router";

// Minimal stream-consumer surface. Real Redis (XREADGROUP) in index.ts,
// canned entries in tests.
export interface StreamPort {
  readGroup(group: string, consumer: string, stream: string): Promise<
    Array<{ id: string; fields: Record<string, string> }>
  >;
  ack(stream: string, group: string, id: string): Promise<unknown>;
}

export const GROUP = "gateway";

export function entryToEvent(fields: Record<string, string>): LiveEvent {
  return {
    type: fields["type"] ?? "",
    gameId: fields["gameId"] ?? "",
    ply: fields["ply"] ?? "",
    san: fields["san"] ?? "",
    fen: fields["fen"] ?? "",
    version: fields["version"] ?? "",
  };
}

// One consumer cycle: read new entries for this group, fan each out
// once to current subscribers, ack each. No redelivery handling here:
// unacked entries stay pending for the next cycle, and any client gap
// is closed by resync, not by gateway replay.
export async function consumeOnce(
  stream: StreamPort,
  router: Router,
  consumer: string,
  send: (conn: object, message: string) => void,
): Promise<number> {
  const entries = await stream.readGroup(GROUP, consumer, STREAM);
  for (const entry of entries) {
    router.fanout(entryToEvent(entry.fields), send);
    await stream.ack(STREAM, GROUP, entry.id);
  }
  return entries.length;
}
