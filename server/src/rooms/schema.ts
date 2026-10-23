import { schema, t, type SchemaType } from "@colyseus/schema";

export const Player = schema({
  x: t.number().default(0),
  y: t.number().default(0),
  color: t.string().default("#ffffff"),
});
export type Player = SchemaType<typeof Player>;

export const RaceState = schema({
  players: t.map(Player),
});
export type RaceState = SchemaType<typeof RaceState>;
