import { STREAM } from "../publisher/publisher";
import { Router, type LiveEvent } from "./router";

// Minimal stream-consumer surface. Real Redis (XREADGROUP) in index.ts,
// canned entries in tests.
export interface StreamPort {
  readGroup(group: string, consumer: string, stream: string): Promise<
    Array<{ id: string; fields: Record<string, string> }>
  >;
  ack(stream: string, group: string, id: string): Promise<unknown>;
  // XGROUP CREATE ... $ MKSTREAM; must not fail if the group already exists.
  createGroup(stream: string, group: string): Promise<unknown>;
}

export const GROUP = "gateway";

export function entryToEvent(fields: Record<string, string>): LiveEvent {
  return {
    type: fields["type"] ?? "",
    gameId: fields["gameId"] ?? "",
    ply: fields["ply"] ?? "",
    san: fields["san"] ?? "",
    fen: fields["fen"] ?? "",
    clock: fields["clock"] ?? "",
    version: fields["version"] ?? "",
    result: fields["result"] ?? "",
    evalCp: fields["evalCp"] ?? "",
    evalMate: fields["evalMate"] ?? "",
    bestReply: fields["bestReply"] ?? "",
    sacrifice: fields["sacrifice"] ?? "",
    secondCp: fields["secondCp"] ?? "",
    secondMate: fields["secondMate"] ?? "",
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
  let entries: Awaited<ReturnType<StreamPort["readGroup"]>>;
  try {
    entries = await stream.readGroup(GROUP, consumer, STREAM);
  } catch (err) {
    // Redis came back without its data (restart without persistence,
    // flush, eviction), so the group is gone (#65). Re-create it from
    // "now"; clients close any gap with resync.
    if (!String(err).includes("NOGROUP")) throw err;
    await stream.createGroup(STREAM, GROUP);
    return 0;
  }
  for (const entry of entries) {
    router.fanout(entryToEvent(entry.fields), send);
    await stream.ack(STREAM, GROUP, entry.id);
  }
  return entries.length;
}
