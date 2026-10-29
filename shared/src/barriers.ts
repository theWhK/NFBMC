// Barreiras das corridas, como no Need for Speed: o traçado vira um corredor
// do tamanho da rua (medido de cada lado, amostra por amostra) e o carro não
// sai dele. No cliente, as saídas para as ruas laterais e o lado de fora das
// curvas ganham painéis translúcidos com setas; no resto a parede é invisível
// (os prédios já fecham a rua). Servidor e cliente usam as mesmas contas.
import type { CarMotion, CarState } from "./physics.ts";
import { nearestSample, type Track } from "./track.ts";
import { isOnRoad } from "./world.ts";

export interface Corridor {
  /** Meia largura do corredor em cada amostra, à esquerda e à direita de quem corre (m). */
  left: Float32Array;
  right: Float32Array;
  /** Trechos com painel visível: lado (+1 esquerda, −1 direita) e amostras [from, to], na ordem da pista. */
  panels: { side: 1 | -1; from: number; to: number }[];
}

/** Até onde se procura a beira da rua, de cada lado (m). */
const MAX_REACH = 26;
/** Janela da mediana (amostras para cada lado, ~32 m): ignora as ruas que saem do traçado. */
const MEDIAN_WINDOW = 20;
/** Folga além da beira da rua (m): o `isOnRoad` já conta 1 m de calçada. */
const SLACK = 0;

/** Quantos metros de rua (ou da pista do autódromo) há saindo da amostra para o lado `side`. */
function reach(x: number, z: number, nx: number, nz: number) {
  let d = 0;
  while (d < MAX_REACH && isOnRoad(x + nx * (d + 1), z + nz * (d + 1))) d += 1;
  return d;
}

function median(values: Float32Array, i: number, n: number) {
  const window: number[] = [];
  for (let k = -MEDIAN_WINDOW; k <= MEDIAN_WINDOW; k++) window.push(values[(i + k + n) % n]);
  window.sort((a, b) => a - b);
  return window[MEDIAN_WINDOW];
}

const cache = new WeakMap<Track, Corridor>();

/** Corredor de um traçado (calculado uma vez por pista). */
export function trackCorridor(track: Track): Corridor {
  const cached = cache.get(track);
  if (cached) return cached;
  const samples = track.samples;
  const n = samples.length;
  const raw = { left: new Float32Array(n), right: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    // Esquerda de quem corre: (tz, −tx).
    raw.left[i] = reach(s.x, s.z, s.tz, -s.tx);
    raw.right[i] = reach(s.x, s.z, -s.tz, s.tx);
  }
  const min = track.width / 2;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = Math.max(min, median(raw.left, i, n)) + SLACK;
    right[i] = Math.max(min, median(raw.right, i, n)) + SLACK;
  }

  // Painéis: onde a rua continua além da parede (saída) ou no lado de fora das curvas.
  const flagged = { left: new Uint8Array(n), right: new Uint8Array(n) };
  const span = 8;
  for (let i = 0; i < n; i++) {
    if (raw.left[i] > left[i] + 3) flagged.left[i] = 1;
    if (raw.right[i] > right[i] + 3) flagged.right[i] = 1;
    const a = samples[(i - span + n) % n];
    const b = samples[(i + span) % n];
    // Seno da virada em ~25 m: positivo vira para a esquerda (o lado de fora é a direita).
    const turn = b.tx * a.tz - b.tz * a.tx;
    if (turn > 0.34) flagged.right[i] = 1;
    if (turn < -0.34) flagged.left[i] = 1;
  }
  const panels: Corridor["panels"] = [];
  for (const [side, marks] of [[1, flagged.left], [-1, flagged.right]] as const) {
    // Alarga cada trecho um pouco (a parede cobre a boca da rua inteira) e junta os vizinhos.
    const grown = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (marks[i]) for (let k = -3; k <= 3; k++) grown[(i + k + n) % n] = 1;
    if (grown.every((v) => v === 1)) {
      panels.push({ side, from: 0, to: n });
      continue;
    }
    // Começa num ponto sem painel, para não partir um trecho na linha de chegada.
    const start = grown.indexOf(0);
    let from = -1;
    for (let k = 1; k <= n; k++) {
      const i = start + k;
      const on = grown[i % n] === 1;
      if (on && from < 0) from = i;
      if (!on && from >= 0) {
        if (i - from >= 5) panels.push({ side, from, to: i - 1 });
        from = -1;
      }
    }
  }
  const corridor = { left, right, panels };
  cache.set(track, corridor);
  return corridor;
}

/**
 * Segura o carro dentro do corredor da corrida: passou da parede, volta para
 * ela, perde velocidade conforme bateu de frente e o empurrão lateral para.
 * Retorna true se encostou.
 */
export function keepInCorridor(car: CarState, track: Track, halfWidth: number, motion?: CarMotion): boolean {
  const corridor = trackCorridor(track);
  const { index } = nearestSample(track, car.x, car.z);
  const s = track.samples[index];
  // Normal para a esquerda de quem corre.
  const nx = s.tz;
  const nz = -s.tx;
  const lateral = (car.x - s.x) * nx + (car.z - s.z) * nz;
  const limit = lateral > 0 ? corridor.left[index] - halfWidth : corridor.right[index] - halfWidth;
  const excess = Math.abs(lateral) - Math.max(0.5, limit);
  if (excess <= 0) return false;
  // Normal da parede, apontando para dentro do corredor.
  const sign = lateral > 0 ? -1 : 1;
  const wx = nx * sign;
  const wz = nz * sign;
  car.x += wx * excess;
  car.z += wz * excess;
  // Raspão escorrega pela parede; de frente, perde bem mais.
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const into = Math.max(0, -(fx * wx + fz * wz) * Math.sign(car.speed || 1));
  car.speed *= 1 - 0.6 * into * into;
  // Como no NFS, a barreira desvia: o carro gira um pouco para correr junto dela.
  if (into > 0) {
    const along = fx * s.tx + fz * s.tz >= 0 ? 1 : -1;
    const target = Math.atan2(s.tx * along, s.tz * along);
    const turn = Math.atan2(Math.sin(target - car.heading), Math.cos(target - car.heading));
    car.heading += turn * (0.2 + into * 0.3);
  }
  if (motion) {
    const push = motion.vx * wx + motion.vz * wz;
    if (push < 0) {
      motion.vx -= wx * push;
      motion.vz -= wz * push;
    }
  }
  return true;
}
