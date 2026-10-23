// Constantes e tipos usados tanto pelo servidor quanto pelo cliente.

export * from "./track.ts";
export * from "./physics.ts";

export const ROOM_NAME = "race";

export const MAX_PLAYERS = 8;
export const NAME_MAX_LENGTH = 16;

export const TOTAL_LAPS = 3;
export const COUNTDOWN_SECONDS = 3;
/** Depois que o primeiro cruza a chegada, quanto tempo os outros têm para terminar. */
export const FINISH_GRACE_SECONDS = 45;
/** Quanto tempo a tela de resultado fica antes de voltar para o lobby. */
export const RESULTS_SECONDS = 15;

/** Bônus de calorias pela colocação (1º, 2º, 3º...). Ganha quem somar mais calorias. */
export const PLACE_BONUS = [1000, 600, 300, 150, 100, 50, 50, 50] as const;

export type Phase = "lobby" | "countdown" | "racing" | "results";

export type FoodKind = "burger" | "fries" | "soda";

export const FOOD: Record<FoodKind, { calories: number; boostSeconds: number; label: string }> = {
  burger: { calories: 500, boostSeconds: 0.5, label: "Hambúrguer" },
  fries: { calories: 300, boostSeconds: 1, label: "Batata frita" },
  soda: { calories: 150, boostSeconds: 2.5, label: "Refri" },
};

export const FOOD_PICKUP_RADIUS = 3;
export const FOOD_RESPAWN_SECONDS = 8;

/** Intenção do jogador; o servidor é quem move o carro. */
export interface InputMessage {
  throttle: number;
  steer: number;
}

export interface JoinOptions {
  name?: string;
}

export const PLAYER_COLORS = [
  "#e63946", // ketchup
  "#f4a261", // batata frita
  "#2a9d8f", // alface
  "#e9c46a", // queijo
  "#8d5524", // hambúrguer
  "#9b5de5", // refri de uva
  "#4cc9f0", // milk-shake de menta
  "#ff70a6", // sorvete de morango
] as const;
