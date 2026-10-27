// Pilotos controlados pelo servidor. Cada bot olha um ponto à frente na pista,
// freia antes das curvas, às vezes desvia para pegar comida e se desatola
// sozinho quando bate ou sai da pista. Eles "apertam os mesmos botões" que um
// jogador: a saída é um DriveInput, e a física é a mesma de todo mundo.
import {
  RIVALS,
  cachedTopSpeed,
  cornerSpeed,
  nearestSample,
  pointOnTrack,
  type CarSpec,
  type CarState,
  type Difficulty,
  type DriveInput,
  type Track,
} from "@nfbmc/shared";

/** Nomes dos bots: os rivais da Lista Gorda (lista no shared, que o menu também mostra). */
export const BOT_NAMES: string[] = RIVALS.map((r) => r.name);

/**
 * Por dificuldade: quanto da velocidade máxima o bot usa e quanto ele vai atrás
 * de comida (comida dá turbo e calorias, então gula também é habilidade).
 */
const SKILL: Record<Difficulty, number> = { facil: 0.78, medio: 0.87, dificil: 0.95 };
const GREED: Record<Difficulty, [number, number]> = { facil: [0.1, 0.3], medio: [0.35, 0.6], dificil: [0.65, 0.9] };

export interface FoodSpot {
  dist: number;
  side: number;
  active: boolean;
}

export interface Brain {
  skill: number;
  /** 0 a 1: chance de ir atrás de comida que aparece pela frente. */
  greed: number;
  /** Faixa preferida (metros do centro) e quanto ela oscila com o tempo. */
  lane: number;
  sway: number;
  /** Erros de volante (bots fáceis erram mais). */
  wobble: number;
  time: number;
  stuckFor: number;
  reverseFor: number;
  /** Comida que o bot decidiu buscar, pela distância na pista. */
  chasing: number | null;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

export function createBrain(difficulty: Difficulty, random: () => number = Math.random): Brain {
  return {
    skill: SKILL[difficulty] * (0.96 + random() * 0.06),
    greed: GREED[difficulty][0] + random() * (GREED[difficulty][1] - GREED[difficulty][0]),
    lane: (random() - 0.5) * 6,
    sway: 1 + random() * 2.5,
    wobble: difficulty === "facil" ? 0.25 : difficulty === "medio" ? 0.1 : 0.03,
    time: random() * 100,
    stuckFor: 0,
    reverseFor: 0,
    chasing: null,
  };
}

/** Raio da curva (m) em cada ponto da pista, calculado uma vez por pista. */
const radiusCache = new WeakMap<Track, Float32Array>();
function trackRadii(track: Track) {
  let radii = radiusCache.get(track);
  if (radii) return radii;
  const samples = track.samples;
  const n = samples.length;
  const spacing = track.length / n;
  const span = 4; // ±4 amostras ≈ ±6,4 m
  radii = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = samples[(i - span + n) % n];
    const b = samples[(i + span) % n];
    const turn = Math.abs(Math.atan2(a.tx * b.tz - a.tz * b.tx, a.tx * b.tx + a.tz * b.tz));
    radii[i] = turn < 1e-3 ? 9999 : (span * 2 * spacing) / turn;
  }
  radiusCache.set(track, radii);
  return radii;
}

/**
 * Velocidade alvo agora: o mínimo entre a final do carro e, para cada trecho à
 * frente, a velocidade de curva dele mais o que dá para frear até lá.
 */
function plannedSpeed(track: Track, fromIndex: number, spec: CarSpec, speed: number, skill: number) {
  const radii = trackRadii(track);
  const spacing = track.length / track.samples.length;
  const brake = spec.brake * 0.75;
  const look = Math.max(30, (speed * speed) / (2 * brake) + 25);
  let desired = cachedTopSpeed(spec) * skill;
  for (let d = 0; d <= look; d += 5) {
    const radius = radii[(fromIndex + Math.round(d / spacing)) % radii.length];
    const corner = cornerSpeed(spec, radius) * skill;
    desired = Math.min(desired, Math.sqrt(corner * corner + 2 * brake * d));
  }
  return desired;
}

/**
 * Decide acelerar/virar neste tick. `pace` ajusta a velocidade pela posição
 * (um pouco mais devagar quando está muito na frente dos humanos, um pouco mais
 * rápido quando está muito atrás), para a corrida ficar disputada.
 */
export function botInput(
  brain: Brain,
  track: Track,
  car: CarState,
  spec: CarSpec,
  dt: number,
  foods: FoodSpot[],
  others: CarState[],
  pace = 1,
): DriveInput {
  brain.time += dt;
  const near = nearestSample(track, car.x, car.z);
  const here = track.samples[near.index].dist;
  const speed = car.speed;

  // Desatolar: parado (bateu, rodou ou ficou preso) → dá ré virando por um tempo.
  if (brain.reverseFor > 0) {
    brain.reverseFor -= dt;
    const target = pointOnTrack(track, here + 15, 0);
    const want = wrap(Math.atan2(target.x - car.x, target.z - car.z) - car.heading);
    return { throttle: -1, steer: want > 0 ? 1 : -1 };
  }
  brain.stuckFor = Math.abs(speed) < 2 ? brain.stuckFor + dt : 0;
  if (brain.stuckFor > 1.2) {
    brain.stuckFor = 0;
    brain.reverseFor = 1;
  }

  // Comida pela frente, perto o bastante da faixa atual: vale o desvio?
  if (brain.chasing === null || !foods.some((f) => f.active && f.dist === brain.chasing)) {
    brain.chasing = null;
    for (const food of foods) {
      const ahead = (food.dist - here + track.length) % track.length;
      if (!food.active || ahead < 12 || ahead > 45) continue;
      // Decide uma vez por comida (a semente é a própria distância, para não ficar indeciso).
      const roll = (Math.sin(food.dist * 12.9898 + brain.lane * 78.233) * 43758.5453) % 1;
      if (Math.abs(roll) < brain.greed) brain.chasing = food.dist;
      break;
    }
  }
  const chased = brain.chasing !== null ? foods.find((f) => f.dist === brain.chasing) : undefined;
  const chasedAhead = chased ? (chased.dist - here + track.length) % track.length : Infinity;
  if (chased && chasedAhead > track.length / 2) brain.chasing = null; // já passou

  const lookahead = 9 + Math.max(0, speed) * 0.42;
  const edge = track.width / 2 - 2.5;
  let lane = chased && chasedAhead < 45
    ? chased.side
    : clamp(brain.lane + Math.sin(brain.time / brain.sway) * 2, -edge, edge);

  // Carro logo à frente na mesma faixa: muda de faixa para ultrapassar e,
  // se estiver muito perto, alivia o pé para não bater na traseira.
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  let blocked = false;
  for (const other of others) {
    const dx = other.x - car.x;
    const dz = other.z - car.z;
    const ahead = dx * fx + dz * fz;
    // Lado positivo = esquerda de quem dirige: (cos, -sin).
    const side = dx * fz - dz * fx;
    if (ahead < 0 || ahead > 14 || Math.abs(side) > 3.2 || other.speed > speed + 2) continue;
    const myLane = lane;
    lane = clamp(side > 0 ? myLane - 4.5 : myLane + 4.5, -edge, edge);
    if (Math.abs(lane - myLane) < 2) lane = clamp(myLane + (side > 0 ? 4.5 : -4.5), -edge, edge);
    if (ahead < 6) blocked = true;
    break;
  }
  const target = pointOnTrack(track, here + lookahead, lane);

  const want = wrap(Math.atan2(target.x - car.x, target.z - car.z) - car.heading);
  const wobble = Math.sin(brain.time * 2.3) * brain.wobble;
  const steer = clamp(-want * 3 + wobble, -1, 1);

  // Velocidade alvo pela física do carro (curvas à frente e espaço para frear).
  const offTrack = near.distance > track.width / 2 + 1;
  let desired = plannedSpeed(track, near.index, spec, speed, brain.skill) * pace;
  if (offTrack) desired = Math.min(desired, 18);

  let throttle = 0.35;
  if (blocked) throttle = 0;
  else if (speed < desired - 1) throttle = 1;
  else if (speed > desired + 1.5) throttle = -1;
  // Mirando muito torto (rodou): alivia para conseguir virar.
  if (Math.abs(want) > 1.2 && speed > 10) throttle = 0;

  return { throttle, steer };
}
