// Arrancada: direção automática (cada carro segue reto na sua faixa) e o piloto
// bot, que larga e troca de marcha com um erro controlado pela dificuldade.
import {
  dragDistance,
  dragPoint,
  launchZone,
  shiftPoint,
  type CarSpec,
  type CarState,
  type Difficulty,
  type DriveState,
  type Track,
} from "@nfbmc/shared";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Estado da arrancada de cada carro (só no servidor). */
export interface DragCar {
  /** Deslocamento lateral da faixa (m). */
  lane: number;
  launched: boolean;
  /** Segundos desde que soltou a embreagem. */
  since: number;
  /** Força perdida na largada (patinou/morreu) e em quanto tempo ela volta. */
  penalty: number;
  recover: number;
  /** Tempo batendo no limitador na marcha atual (troca tarde). */
  limiterFor: number;
}

export const createDragCar = (lane: number): DragCar => ({ lane, launched: false, since: 0, penalty: 0, recover: 0, limiterFor: 0 });

/** Fração da força do motor que chega no chão agora (a penalidade da largada some aos poucos). */
export function dragTraction(car: DragCar) {
  if (car.penalty <= 0 || car.recover <= 0) return 1;
  return 1 - car.penalty * Math.max(0, 1 - car.since / car.recover);
}

/** Volante automático: mira um ponto à frente no meio da faixa. */
export function dragSteer(track: Track, car: CarState, lane: number) {
  const along = dragDistance(track, car.x, car.z);
  const target = dragPoint(track, along + 10 + Math.max(0, car.speed) * 0.4, lane);
  const want = wrap(Math.atan2(target.x - car.x, target.z - car.z) - car.heading);
  return clamp(-want * 3, -1, 1);
}

/** Erros do bot por dificuldade: reação (s), giro da largada e troca (fração da faixa vermelha). */
const DRAG_SKILL: Record<Difficulty, { reaction: number; reactionSpread: number; launch: number; shiftBias: number; shiftSpread: number; jump: number }> = {
  facil: { reaction: 0.42, reactionSpread: 0.12, launch: 0.16, shiftBias: -0.06, shiftSpread: 0.06, jump: 0.04 },
  medio: { reaction: 0.3, reactionSpread: 0.08, launch: 0.08, shiftBias: -0.03, shiftSpread: 0.035, jump: 0.02 },
  dificil: { reaction: 0.2, reactionSpread: 0.05, launch: 0.03, shiftBias: -0.01, shiftSpread: 0.015, jump: 0.01 },
};

export interface DragBrain {
  difficulty: Difficulty;
  /** Quando larga depois do verde (s). Queimando: quantos segundos antes do verde. */
  reaction: number;
  jump: number | null;
  /** Giro que ele tenta segurar na contagem. */
  launchRpm: number;
  /** Erro da próxima troca (rpm, somado ao ideal). */
  shiftError: number;
  random: () => number;
}

/** Normal aproximada (soma de uniformes), média 0 e desvio 1. */
const gaussian = (random: () => number) => (random() + random() + random() + random() - 2) * Math.sqrt(3);

export function createDragBrain(difficulty: Difficulty, spec: CarSpec, random: () => number = Math.random): DragBrain {
  const skill = DRAG_SKILL[difficulty];
  const [lo, hi] = launchZone(spec);
  const brain: DragBrain = {
    difficulty,
    reaction: Math.max(0.12, skill.reaction + gaussian(random) * skill.reactionSpread),
    jump: random() < skill.jump ? 0.05 + random() * 0.25 : null,
    launchRpm: (lo + hi) / 2 + gaussian(random) * skill.launch * spec.peakRpm,
    shiftError: 0,
    random,
  };
  nextShiftError(brain, spec);
  return brain;
}

function nextShiftError(brain: DragBrain, spec: CarSpec) {
  const skill = DRAG_SKILL[brain.difficulty];
  brain.shiftError = (skill.shiftBias + gaussian(brain.random) * skill.shiftSpread) * spec.redline;
}

/** Acelerador do bot parado na linha: segura o giro perto do que ele quer. */
export function dragBotRev(brain: DragBrain, drive: DriveState) {
  const error = brain.launchRpm - drive.rpm;
  return error > 150 ? 1 : error < -150 ? 0 : 0.5;
}

/** O bot quer subir de marcha agora? (O erro muda a cada troca.) */
export function dragBotShift(brain: DragBrain, drive: DriveState, spec: CarSpec, car: DragCar) {
  if (drive.shiftTimer > 0 || drive.gear >= spec.gears.length) return false;
  // Nunca mira acima do limitador (ficaria preso nele); bateu muito, troca.
  const target = Math.min(spec.redline - 300, shiftPoint(spec, drive.gear) + brain.shiftError);
  if (drive.rpm < target && car.limiterFor < 0.4) return false;
  nextShiftError(brain, spec);
  return true;
}
