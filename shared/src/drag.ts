// Arrancada (drag): as contas que o servidor e o HUD dividem.
//
// - Faixa verde da largada: do giro em que o motor já entrega ~90% do torque
//   máximo até um pouco acima do pico (mais alto com pneu melhor). Abaixo, o
//   carro "morre" na saída; acima, patina.
// - Ponto de troca: para cada marcha, o giro em que a marcha seguinte passa a
//   empurrar mais que a atual (cruzamento das curvas de força nas rodas), ou o
//   limitador, se a atual empurra mais até o fim.
import type { CarSpec } from "./cars.ts";
import { gearForce, wheelRpm, type DriveState } from "./physics.ts";
import type { Track } from "./track.ts";

/** Metros de cada lado do meio da pista onde fica a faixa de cada carro. */
export const DRAG_LANE = 4.5;
/** Quem não larga até este tempo depois do verde larga sozinho (com a reação ruim). */
export const DRAG_AUTO_LAUNCH = 2.5;
/** Depois que o primeiro chega, quanto o outro tem para chegar (a prova toda leva 7 a 17 s). */
export const DRAG_GRACE_SECONDS = 20;

export type LaunchGrade = "perfeita" | "boa" | "fraca" | "patinou" | "morreu" | "queimou";
export type ShiftGrade = "perfeita" | "boa" | "cedo" | "tarde";

export const LAUNCH_LABELS: Record<LaunchGrade, string> = {
  perfeita: "Largada perfeita!", boa: "Boa largada", fraca: "Largada fraca", patinou: "Patinou na largada!", morreu: "O motor morreu na saída!", queimou: "Queimou a largada!",
};
export const SHIFT_LABELS: Record<ShiftGrade, string> = {
  perfeita: "Troca perfeita!", boa: "Boa troca", cedo: "Trocou cedo", tarde: "Trocou tarde",
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Faixa verde do conta-giros para largar (rpm). */
export function launchZone(spec: CarSpec): [number, number] {
  // Torque abaixo do pico: 0,62 + 0,38·t (physics.ts). 90% do pico em t ≈ 0,74.
  const lo = spec.idleRpm + 0.74 * (spec.peakRpm - spec.idleRpm);
  const hi = Math.min(spec.redline * 0.92, spec.peakRpm * (1.05 + ((spec.grip ?? 1) - 1) * 0.6));
  return [Math.round(lo), Math.round(Math.max(lo + 300, hi))];
}

/**
 * Como a largada saiu, pelo giro na hora de soltar a embreagem, e quanto da
 * força chega no chão no começo (`penalty`, some em `recover` segundos).
 */
export function gradeLaunch(spec: CarSpec, rpm: number): { grade: LaunchGrade; penalty: number; recover: number } {
  const [lo, hi] = launchZone(spec);
  const margin = (hi - lo) * 0.35;
  if (rpm >= lo && rpm <= hi) return { grade: "perfeita", penalty: 0, recover: 0 };
  if (rpm >= lo - margin && rpm <= hi + margin) return { grade: "boa", penalty: 0.15, recover: 0.6 };
  if (rpm > hi) {
    // Quanto mais giro, mais patina.
    const over = clamp((rpm - hi) / (spec.redline - hi || 1), 0, 1);
    return { grade: "patinou", penalty: 0.25 + 0.25 * over, recover: 0.8 + over * 0.6 };
  }
  return rpm < lo - margin * 3
    ? { grade: "morreu", penalty: 0.6, recover: 2 }
    : { grade: "fraca", penalty: 0.3, recover: 1 };
}

/** Giro ideal para subir da marcha `gear` (rpm). */
const shiftCache = new WeakMap<CarSpec, number[]>();
export function shiftPoint(spec: CarSpec, gear: number) {
  let points = shiftCache.get(spec);
  if (!points) {
    points = spec.gears.map((_, i) => {
      const g = i + 1;
      const cap = spec.redline * 0.985;
      if (g >= spec.gears.length) return cap;
      for (let v = 1; v < 160; v += 0.1) {
        const rpm = wheelRpm(spec, v, g);
        if (rpm >= cap) return cap;
        if (rpm > spec.peakRpm && gearForce(spec, v, g + 1) >= gearForce(spec, v, g)) return rpm;
      }
      return cap;
    });
    shiftCache.set(spec, points);
  }
  return points[clamp(gear, 1, points.length) - 1];
}

/** Nota da troca para cima, pelo giro na hora e quanto tempo ficou batendo no limitador. */
export function gradeShift(spec: CarSpec, gear: number, rpm: number, limiterFor: number): ShiftGrade {
  const d = (rpm - shiftPoint(spec, gear)) / spec.redline;
  if (limiterFor > 0.25 || d > 0.03) return "tarde";
  if (d >= -0.04) return "perfeita";
  if (d >= -0.1) return "boa";
  return "cedo";
}

/**
 * Motor em ponto morto (embreagem apertada, carro parado): o giro sobe e desce
 * com o acelerador, bate no limitador no fundo. Devagar o bastante para dar
 * para segurar o ponteiro na faixa verde "dosando" o pé.
 */
export function freeRev(drive: DriveState, spec: CarSpec, gas: number, dt: number) {
  drive.pedal += clamp(gas - drive.pedal, -8 * dt, 4 * dt);
  const target = spec.idleRpm + drive.pedal * (spec.redline * 1.05 - spec.idleRpm);
  const rate = target > drive.rpm ? 2.4 : 1.6;
  drive.rpm += (target - drive.rpm) * Math.min(1, rate * dt);
  drive.limiter = drive.rpm >= spec.redline;
  if (drive.limiter) drive.rpm = spec.redline - Math.random() * 300;
}

/**
 * Ponto do traçado aberto da arrancada a `dist` metros do começo, `side` metros
 * para o lado (positivo = esquerda).
 */
export function dragPoint(track: Track, dist: number, side: number) {
  const n = track.samples.length;
  const i = clamp(Math.round((dist / track.length) * (n - 1)), 0, n - 1);
  const s = track.samples[i];
  const extra = dist - s.dist;
  const x = s.x + s.tx * extra;
  const z = s.z + s.tz * extra;
  return { x: x + s.tz * side, z: z - s.tx * side, heading: Math.atan2(s.tx, s.tz) };
}

/** Quantos metros do começo do traçado aberto (projeção na amostra mais perto). */
export function dragDistance(track: Track, x: number, z: number) {
  let best = track.samples[0];
  let bestD = Infinity;
  for (const s of track.samples) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best.dist + (x - best.x) * best.tx + (z - best.z) * best.tz;
}
