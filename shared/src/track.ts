// Pista: um circuito fechado no plano XZ (Y é "para cima", como no Three.js).
// O traçado é uma Catmull-Rom fechada passando pelos pontos de controle; o
// servidor usa as amostras para saber se o carro saiu da pista e quanto ele já
// andou, e o cliente usa as mesmas amostras para desenhar o asfalto.

export interface TrackSample {
  x: number;
  z: number;
  /** Direção da pista neste ponto (vetor unitário). */
  tx: number;
  tz: number;
  /** Distância percorrida desde a linha de chegada. */
  dist: number;
}

export interface Track {
  samples: TrackSample[];
  length: number;
  width: number;
}

/** Pontos de controle do circuito "Avenida do Colesterol", no sentido da corrida. */
const CONTROL_POINTS: [number, number][] = [
  [0, -90],
  [70, -100],
  [125, -70],
  [135, -10],
  [100, 30],
  [45, 20],
  [15, 55],
  [40, 100],
  [-20, 130],
  [-90, 110],
  [-125, 45],
  [-100, -20],
  [-70, -75],
];

export const TRACK_WIDTH = 16;
const SAMPLES_PER_SEGMENT = 40;

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function buildTrack(): Track {
  const n = CONTROL_POINTS.length;
  const points: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = CONTROL_POINTS[(i - 1 + n) % n];
    const p1 = CONTROL_POINTS[i];
    const p2 = CONTROL_POINTS[(i + 1) % n];
    const p3 = CONTROL_POINTS[(i + 2) % n];
    for (let s = 0; s < SAMPLES_PER_SEGMENT; s++) {
      const t = s / SAMPLES_PER_SEGMENT;
      points.push([catmullRom(p0[0], p1[0], p2[0], p3[0], t), catmullRom(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }

  const samples: TrackSample[] = [];
  let dist = 0;
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i];
    const prev = points[(i - 1 + points.length) % points.length];
    const next = points[(i + 1) % points.length];
    const dx = next[0] - prev[0];
    const dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz);
    if (i > 0) dist += Math.hypot(x - points[i - 1][0], z - points[i - 1][1]);
    samples.push({ x, z, tx: dx / len, tz: dz / len, dist });
  }
  const [lx, lz] = points[points.length - 1];
  const length = dist + Math.hypot(points[0][0] - lx, points[0][1] - lz);

  return { samples, length, width: TRACK_WIDTH };
}

export const TRACK = buildTrack();

/** Índice da amostra da pista mais próxima de (x, z), e a distância até ela. */
export function nearestSample(track: Track, x: number, z: number) {
  let best = 0;
  let bestDistSq = Infinity;
  for (let i = 0; i < track.samples.length; i++) {
    const s = track.samples[i];
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bestDistSq) {
      bestDistSq = d;
      best = i;
    }
  }
  return { index: best, distance: Math.sqrt(bestDistSq) };
}

/**
 * Ponto a `distAlong` metros da linha de chegada (pode ser negativo, para o
 * grid de largada) e `side` metros para o lado (positivo = esquerda de quem corre).
 */
export function pointOnTrack(track: Track, distAlong: number, side: number) {
  const target = ((distAlong % track.length) + track.length) % track.length;
  let i = 0;
  while (i < track.samples.length - 1 && track.samples[i + 1].dist <= target) i++;
  const s = track.samples[i];
  // Esquerda de quem olha para (tx, tz), com Y para cima.
  return {
    x: s.x + s.tz * side,
    z: s.z - s.tx * side,
    heading: Math.atan2(s.tx, s.tz),
  };
}
