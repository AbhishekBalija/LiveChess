import { z } from "zod";

// Normalized domain events. The adapter emits these, the Move Handler consumes them.
// Ply is the half-move index. Move number and side are derived, never keyed.
export const gameStartedSchema = z.object({
  type: z.literal("GameStarted"),
  gameId: z.string().uuid(),
  tournamentId: z.string().uuid(),
  white: z.string().min(1),
  black: z.string().min(1),
});

export const moveReceivedSchema = z.object({
  type: z.literal("MoveReceived"),
  gameId: z.string().uuid(),
  ply: z.number().int().positive(),
  san: z.string().min(1),
  fen: z.string().min(1),
  clock: z.string().nullable(),
  version: z.number().int().nonnegative(),
});

export const gameCorrectedSchema = z.object({
  type: z.literal("GameCorrected"),
  gameId: z.string().uuid(),
  ply: z.number().int().positive(),
  oldSan: z.string().min(1),
  newSan: z.string().min(1),
  version: z.number().int().nonnegative(),
});

export type GameStarted = z.infer<typeof gameStartedSchema>;
export type MoveReceived = z.infer<typeof moveReceivedSchema>;
export type GameCorrected = z.infer<typeof gameCorrectedSchema>;
export type DomainEvent = GameStarted | MoveReceived | GameCorrected;
