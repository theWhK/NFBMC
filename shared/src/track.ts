// Pista: um circuito fechado no plano XZ (Y é "para cima", como no Three.js).
// O servidor usa as amostras para saber se o carro saiu da pista e quanto ele
// já andou; o cliente usa as mesmas amostras para desenhar o traçado.
//
// Há dois jeitos de montar um traçado: uma curva suave pelos pontos de
// controle (o autódromo) ou retas com esquinas arredondadas (corridas de rua).

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

type Point = [number, number];

/** Distância entre amostras, em metros. */
const SAMPLE_SPACING = 1.6;

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Curva fechada e suave passando pelos pontos (bom com pontos bem distribuídos). */
export function splinePath(control: Point[]): Point[] {
  const n = control.length;
  const points: Point[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = control[(i - 1 + n) % n];
    const p1 = control[i];
    const p2 = control[(i + 1) % n];
    const p3 = control[(i + 2) % n];
    for (let s = 0; s < 40; s++) {
      const t = s / 40;
      points.push([catmullRom(p0[0], p1[0], p2[0], p3[0], t), catmullRom(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  return points;
}

/**
 * Circuito de rua: retas entre as esquinas, com cada esquina arredondada
 * (`radius` metros antes e depois dela). O primeiro ponto é a largada e deve
 * estar no meio de uma reta.
 */
export function streetPath(corners: Point[], radius: number): Point[] {
  const n = corners.length;
  const points: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = corners[(i - 1 + n) % n];
    const corner = corners[i];
    const next = corners[(i + 1) % n];
    const inLength = Math.hypot(corner[0] - prev[0], corner[1] - prev[1]);
    const outLength = Math.hypot(next[0] - corner[0], next[1] - corner[1]);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    const start: Point = [corner[0] - ((corner[0] - prev[0]) / inLength) * r, corner[1] - ((corner[1] - prev[1]) / inLength) * r];
    const end: Point = [corner[0] + ((next[0] - corner[0]) / outLength) * r, corner[1] + ((next[1] - corner[1]) / outLength) * r];
    // Curva de Bézier quadrática com a esquina como ponto de controle.
    for (let s = 0; s < 12; s++) {
      const t = s / 12;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      points.push([a * start[0] + b * corner[0] + c * end[0], a * start[1] + b * corner[1] + c * end[1]]);
    }
    points.push(end);
  }
  return points;
}

/** Transforma um caminho fechado em amostras igualmente espaçadas. */
export function buildTrack(path: Point[], width: number): Track {
  // Comprimento acumulado do caminho original.
  const cumulative = [0];
  for (let i = 1; i <= path.length; i++) {
    const a = path[i - 1];
    const b = path[i % path.length];
    cumulative.push(cumulative[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = cumulative[path.length];
  const count = Math.round(length / SAMPLE_SPACING);

  const positions: Point[] = [];
  let segment = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * length;
    while (cumulative[segment + 1] < target) segment++;
    const a = path[segment];
    const b = path[(segment + 1) % path.length];
    const span = cumulative[segment + 1] - cumulative[segment] || 1;
    const t = (target - cumulative[segment]) / span;
    positions.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }

  const samples: TrackSample[] = positions.map(([x, z], i) => {
    const prev = positions[(i - 1 + count) % count];
    const next = positions[(i + 1) % count];
    const dx = next[0] - prev[0];
    const dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    return { x, z, tx: dx / len, tz: dz / len, dist: (i / count) * length };
  });

  return { samples, length, width };
}

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
  const i = Math.min(track.samples.length - 1, Math.floor((target / track.length) * track.samples.length));
  const s = track.samples[i];
  // Esquerda de quem olha para (tx, tz), com Y para cima.
  return {
    x: s.x + s.tz * side,
    z: s.z - s.tx * side,
    heading: Math.atan2(s.tx, s.tz),
  };
}
