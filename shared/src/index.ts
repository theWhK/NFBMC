// Constantes e tipos usados tanto pelo servidor quanto pelo cliente.

export const ROOM_NAME = "race";

export const WORLD = {
  width: 800,
  height: 600,
} as const;

export const PLAYER_SIZE = 32;

/** Velocidade em pixels por segundo. */
export const PLAYER_SPEED = 240;

/** Direção pedida pelo cliente; cada eixo vai de -1 a 1. O servidor é quem move. */
export interface InputMessage {
  x: number;
  y: number;
}

export const PLAYER_COLORS = [
  "#e63946", // ketchup
  "#f4a261", // batata frita
  "#2a9d8f", // alface
  "#e9c46a", // queijo
  "#8d5524", // hambúrguer
  "#9b5de5", // refri de uva
] as const;
