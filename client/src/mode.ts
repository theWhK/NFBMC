// O que os modos de jogo (mundo aberto e corrida) recebem do main.
import type { InputMessage } from "@nfbmc/shared";

import type { Sound } from "./audio.ts";
import type { MinimapView, TachoData } from "./hud.ts";
import type { CarView, GameScene } from "./scene.ts";

export interface ModeContext {
  scene: GameScene | null;
  sound: Sound;
  /** O que o jogador está apertando agora. */
  input: () => InputMessage;
  drawTacho: (data: TachoData) => void;
  drawMinimap: (view: MinimapView) => void;
  /** Motores dos outros carros, com volume pela distância e lado pelo ângulo. */
  updateOtherEngines: (cars: Map<string, CarView>, myId: string, me: { x: number; z: number; heading: number }) => void;
  /** Toca o som de batida se o carro perdeu velocidade de repente sem frear. */
  detectBump: (previous: { speed: number; bumpAt: number }, speed: number) => void;
}

/** Estado de um carro como os testes e2e enxergam (via window.__nfbmc). */
export interface PlayerSnapshot {
  name: string;
  car: string;
  gear: number;
  rpm: number;
  bot: boolean;
  x: number;
  z: number;
  speed: number;
  racing: boolean;
  lap: number;
  place: number;
  calories: number;
  finished: boolean;
}
