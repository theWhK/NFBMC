// Porto Gordo gerada a partir da planta (map.ts). Tudo aqui é determinístico
// (mesma semente), para servidor e clientes enxergarem exatamente a mesma cidade:
// ruas, prédios e casas (com colisão), árvores, comida, corridas e o grafo de
// ruas que as viaturas usam para navegar.
import {
  DISTRICTS,
  EDGES,
  LAKE,
  NODES,
  QUAY_Z,
  ROAD_WIDTH,
  type DistrictId,
  type EdgeSpec,
  type RoadKind,
} from "./map.ts";
import { CAR, type CarMotion, type CarState } from "./physics.ts";
import { buildTrack, nearestSample, splinePath, type Track } from "./track.ts";

export { DISTRICTS, LAKE, QUAY_Z, type DistrictId } from "./map.ts";

/** Limites do mapa: muro invisível nas bordas e o cais ao sul. */
export const WORLD_BOUNDS = { minX: -1740, maxX: 1740, minZ: QUAY_Z, maxZ: 2640 } as const;

/** Gerador pseudoaleatório com semente. */
export function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

type Point = [number, number];

// --- Bairros -----------------------------------------------------------------

function insidePolygon(polygon: Point[], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function districtAt(x: number, z: number): DistrictId {
  return DISTRICTS.find((d) => insidePolygon(d.polygon, x, z))?.id ?? "vila";
}

// --- Ruas --------------------------------------------------------------------

export interface Road {
  a: string;
  b: string;
  kind: RoadKind;
  width: number;
  /** Pontos ao longo da rua, de A para B, a cada ~4 m. */
  points: Point[];
  length: number;
}

function sampleEdge(a: Point, b: Point, curve?: Point): Point[] {
  const control = curve ?? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const approx = Math.hypot(control[0] - a[0], control[1] - a[1]) + Math.hypot(b[0] - control[0], b[1] - control[1]);
  const steps = Math.max(2, Math.ceil(approx / 4));
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    points.push([
      u * u * a[0] + 2 * u * t * control[0] + t * t * b[0],
      u * u * a[1] + 2 * u * t * control[1] + t * t * b[1],
    ]);
  }
  return points;
}

const polylineLength = (points: Point[]) =>
  points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);

// --- Cidade densa: cruzamentos novos e ruas de ligação geradas ---------------
//
// A planta à mão (map.ts) tem as ruas principais. Para a cidade ter muito mais
// ruas sem desenhar centenas à mão, ela é "adensada" aqui, sempre igual (semente fixa):
// 1. ruas compridas ganham cruzamentos no meio (a cada ~100 m na cidade);
// 2. ruas de ligação novas unem esses cruzamentos por dentro dos quarteirões,
//    com curvas (vielas sinuosas no morro e na vila), sem cruzar outra rua e sem
//    passar por lago, autódromo, aeroporto ou cais. Não sobram becos sem saída.

/** Bairros sem ruas de ligação (natureza, pista, parque) e o passo dos cruzamentos novos por bairro. */
const NO_CONNECTORS = new Set<DistrictId>(["aeroporto", "autodromo", "parque"]);
const SPLIT_STEP: Partial<Record<DistrictId, number>> = { serra: 260, roca: 280, aeroporto: Infinity, autodromo: Infinity, parque: 300 };
/** Bairros de ruas tortas: ladeiras, vielas e estradas de terra. */
const WINDING = new Set<DistrictId>(["morro", "vila", "jardim", "picanha", "praia", "serra", "roca"]);
/** Na roça e na serra as ligações são estradas compridas, longe umas das outras. */
const RURAL = new Set<DistrictId>(["serra", "roca"]);

/** Ponto e "tangente/2" de uma curva quadrática (para cortar em pedaços sem mudar o desenho). */
function bezier(a: Point, c: Point, b: Point, t: number): { p: Point; d: Point } {
  const u = 1 - t;
  return {
    p: [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]],
    d: [u * (c[0] - a[0]) + t * (b[0] - c[0]), u * (c[1] - a[1]) + t * (b[1] - c[1])],
  };
}

function blocked(x: number, z: number) {
  const { minX, maxX, minZ, maxZ } = WORLD_BOUNDS;
  if (x < minX + 25 || x > maxX - 25 || z < minZ + 40 || z > maxZ - 25) return true;
  if (((x - LAKE.x) / (LAKE.rx + 25)) ** 2 + ((z - LAKE.z) / (LAKE.rz + 25)) ** 2 < 1) return true;
  if (Math.hypot(x - 400, z - 405) < 190) return true; // autódromo
  if (x > 690 && x < 1430 && z > 690 && z < 1560) return true; // aeroporto
  return false;
}

function densify() {
  const random = seeded(4242);
  const nodes: Record<string, Point> = { ...NODES };
  const edges: EdgeSpec[] = [];
  /** Original "a|b" → sequência de nós depois de cortar (as corridas seguem por ela). */
  const chains = new Map<string, string[]>();

  // 1. Cruzamentos novos no meio das ruas compridas (a rodovia e a pista ficam inteiras).
  for (const e of EDGES) {
    const a = NODES[e.a];
    const b = NODES[e.b];
    const c: Point = e.curve ?? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const length = polylineLength(sampleEdge(a, b, e.curve));
    const district = districtAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    const step = e.kind === "rodovia" || e.kind === "pista" ? Infinity : SPLIT_STEP[district] ?? 100;
    const parts = Number.isFinite(step) ? Math.max(1, Math.round(length / step)) : 1;
    const chain = [e.a];
    for (let i = 0; i < parts; i++) {
      const t0 = i / parts;
      const t1 = (i + 1) / parts;
      const from = chain[chain.length - 1];
      const to = i === parts - 1 ? e.b : `${e.a}~${e.b}~${i + 1}`;
      if (to !== e.b) nodes[to] = bezier(a, c, b, t1).p;
      const start = bezier(a, c, b, t0);
      const curve: Point | undefined = e.curve ? [start.p[0] + (t1 - t0) * start.d[0], start.p[1] + (t1 - t0) * start.d[1]] : undefined;
      edges.push({ a: from, b: to, kind: e.kind, curve });
      chain.push(to);
    }
    chains.set(`${e.a}|${e.b}`, chain);
  }

  // Grade com os pedaços de todas as ruas, para checar se uma rua nova encosta em outra.
  type Piece = { ax: number; az: number; bx: number; bz: number; half: number };
  const grid = new Map<string, Piece[]>();
  const G = 60;
  const addPieces = (points: Point[], half: number) => {
    for (let i = 1; i < points.length; i++) {
      const piece = { ax: points[i - 1][0], az: points[i - 1][1], bx: points[i][0], bz: points[i][1], half };
      const keys = new Set([`${Math.floor(piece.ax / G)},${Math.floor(piece.az / G)}`, `${Math.floor(piece.bx / G)},${Math.floor(piece.bz / G)}`]);
      for (const key of keys) {
        const list = grid.get(key);
        if (list) list.push(piece);
        else grid.set(key, [piece]);
      }
    }
  };
  const clearance = (x: number, z: number) => {
    let best = Infinity;
    const gx = Math.floor(x / G);
    const gz = Math.floor(z / G);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const s of grid.get(`${gx + i},${gz + j}`) ?? []) {
          const dx = s.bx - s.ax;
          const dz = s.bz - s.az;
          const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1)));
          best = Math.min(best, Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t)) - s.half);
        }
      }
    }
    return best;
  };
  const degree = new Map<string, number>();
  const linked = new Set<string>();
  const directions = new Map<string, number[]>();
  const link = (e: EdgeSpec, points: Point[]) => {
    for (const id of [e.a, e.b]) degree.set(id, (degree.get(id) ?? 0) + 1);
    linked.add(`${e.a}|${e.b}`);
    linked.add(`${e.b}|${e.a}`);
    const start = points[Math.min(3, points.length - 1)];
    const end = points[Math.max(0, points.length - 4)];
    const [ax, az] = nodes[e.a];
    const [bx, bz] = nodes[e.b];
    directions.set(e.a, [...(directions.get(e.a) ?? []), Math.atan2(start[0] - ax, start[1] - az)]);
    directions.set(e.b, [...(directions.get(e.b) ?? []), Math.atan2(end[0] - bx, end[1] - bz)]);
    addPieces(points, ROAD_WIDTH[e.kind] / 2);
  };
  for (const e of edges) link(e, sampleEdge(nodes[e.a], nodes[e.b], e.curve));

  // 2. Ruas de ligação: pares de cruzamentos próximos, das ligações mais curtas para as mais longas.
  const ids = Object.keys(nodes).filter((id) => !blocked(...nodes[id]) && !NO_CONNECTORS.has(districtAt(...nodes[id])));
  const pairs: [string, string, number][] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const d = Math.hypot(nodes[ids[i]][0] - nodes[ids[j]][0], nodes[ids[i]][1] - nodes[ids[j]][1]);
      if (d > 60 && d < 380) pairs.push([ids[i], ids[j], d + random() * 40]);
    }
  }
  pairs.sort((p, q) => p[2] - q[2]);
  const angleGap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  for (const [ia, ib] of pairs) {
    if (linked.has(`${ia}|${ib}`) || (degree.get(ia) ?? 0) >= 4 || (degree.get(ib) ?? 0) >= 4) continue;
    const a = nodes[ia];
    const b = nodes[ib];
    const district = districtAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    if (NO_CONNECTORS.has(district)) continue;
    // Na cidade, ligação curta (quarteirão); na roça e na serra, estrada comprida.
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (RURAL.has(district) ? span < 150 : span > 240) continue;
    const winding = WINDING.has(district);
    const kind: RoadKind = winding && random() < 0.6 ? "viela" : "rua";
    // Curva: um pouco para um lado (bem mais nos bairros de ladeira).
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const bend = (random() - 0.5) * (winding ? 0.6 : 0.2) * len;
    const curve: Point = [(a[0] + b[0]) / 2 + ((b[1] - a[1]) / len) * bend, (a[1] + b[1]) / 2 - ((b[0] - a[0]) / len) * bend];
    const points = sampleEdge(a, b, curve);
    const half = ROAD_WIDTH[kind] / 2;
    // Não pode encostar em outra rua (fora as pontas), nem passar por cima de outro cruzamento.
    let ok = true;
    for (const [x, z] of points) {
      const nearEnd = Math.min(Math.hypot(x - a[0], z - a[1]), Math.hypot(x - b[0], z - b[1]));
      if (blocked(x, z) || (nearEnd > 32 && clearance(x, z) < half + (RURAL.has(district) ? 40 : 9))) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    // Chega nas ruas que já existem com um ângulo de esquina (nada de "rabo de peixe").
    const startDir = Math.atan2(points[3][0] - a[0], points[3][1] - a[1]);
    const endDir = Math.atan2(points[points.length - 4][0] - b[0], points[points.length - 4][1] - b[1]);
    if ((directions.get(ia) ?? []).some((d) => angleGap(d, startDir) < 0.5)) continue;
    if ((directions.get(ib) ?? []).some((d) => angleGap(d, endDir) < 0.5)) continue;
    const edge: EdgeSpec = { a: ia, b: ib, kind, curve };
    edges.push(edge);
    link(edge, points);
  }

  // 3. Ruas em "U": saem de uma rua, entram no quarteirão fazendo curva e voltam
  // para a mesma rua mais adiante (enchem o miolo dos quarteirões sem beco sem saída).
  const tryEdge = (ia: string, ib: string, kind: RoadKind, curve: Point, district: DistrictId) => {
    if (linked.has(`${ia}|${ib}`) || (degree.get(ia) ?? 0) >= 4 || (degree.get(ib) ?? 0) >= 4) return false;
    const a = nodes[ia];
    const b = nodes[ib];
    const points = sampleEdge(a, b, curve);
    const half = ROAD_WIDTH[kind] / 2;
    for (const [x, z] of points) {
      const nearEnd = Math.min(Math.hypot(x - a[0], z - a[1]), Math.hypot(x - b[0], z - b[1]));
      // Perto das pontas a rua ainda está saindo da rua-mãe: ali não conta.
      if (blocked(x, z) || districtAt(x, z) !== district || (nearEnd > 45 && clearance(x, z) < half + 9)) return false;
    }
    const startDir = Math.atan2(points[3][0] - a[0], points[3][1] - a[1]);
    const endDir = Math.atan2(points[points.length - 4][0] - b[0], points[points.length - 4][1] - b[1]);
    if ((directions.get(ia) ?? []).some((d) => angleGap(d, startDir) < 0.5)) return false;
    if ((directions.get(ib) ?? []).some((d) => angleGap(d, endDir) < 0.5)) return false;
    const edge: EdgeSpec = { a: ia, b: ib, kind, curve };
    edges.push(edge);
    link(edge, points);
    return true;
  };
  for (const chain of chains.values()) {
    for (let i = 0; i + 2 < chain.length; i++) {
      const a = nodes[chain[i]];
      const b = nodes[chain[i + 2]];
      const district = districtAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      if (NO_CONNECTORS.has(district) || RURAL.has(district)) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 120) continue;
      for (const side of random() < 0.5 ? [1, -1] : [-1, 1]) {
        // O ponto de controle fica a 2× a profundidade desejada (a curva chega até a metade dele).
        const depth = 55 + random() * 45;
        const curve: Point = [
          (a[0] + b[0]) / 2 + ((b[1] - a[1]) / len) * depth * 2 * side,
          (a[1] + b[1]) / 2 - ((b[0] - a[0]) / len) * depth * 2 * side,
        ];
        const kind: RoadKind = WINDING.has(district) ? "viela" : "rua";
        if (tryEdge(chain[i], chain[i + 2], kind, curve, district)) break;
      }
    }
  }
  return { nodes, edges, chains };
}

const PLAN = densify();
/** Todos os cruzamentos (os da planta e os gerados ao adensar a cidade). */
export const PLAN_NODES = PLAN.nodes;

export const ROADS: Road[] = PLAN.edges.map((e) => {
  const points = sampleEdge(PLAN.nodes[e.a], PLAN.nodes[e.b], e.curve);
  return { a: e.a, b: e.b, kind: e.kind, width: ROAD_WIDTH[e.kind], points, length: polylineLength(points) };
});

/** Grade espacial: para cada célula de 25 m, os pedaços de rua que passam perto. */
const CELL = 25;
const cellKey = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;

interface Segment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  half: number;
  /** Rua e trecho (índice do ponto inicial) a que o segmento pertence. */
  road: number;
  index: number;
}

const roadGrid = new Map<string, Segment[]>();
for (const [r, road] of ROADS.entries()) {
  for (let i = 1; i < road.points.length; i++) {
    const [ax, az] = road.points[i - 1];
    const [bx, bz] = road.points[i];
    const segment = { ax, az, bx, bz, half: road.width / 2, road: r, index: i - 1 };
    const reach = road.width / 2 + 4;
    for (let x = Math.min(ax, bx) - reach; x <= Math.max(ax, bx) + reach + CELL; x += CELL) {
      for (let z = Math.min(az, bz) - reach; z <= Math.max(az, bz) + reach + CELL; z += CELL) {
        const key = cellKey(x, z);
        const list = roadGrid.get(key);
        if (list) list.push(segment);
        else roadGrid.set(key, [segment]);
      }
    }
  }
}

function distanceToSegment(px: number, pz: number, s: Segment) {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - s.ax) * dx + (pz - s.az) * dz) / len2));
  return Math.hypot(px - (s.ax + dx * t), pz - (s.az + dz * t));
}

/** Distância até a borda da rua mais próxima (negativa = em cima da rua). */
function roadClearance(x: number, z: number) {
  let best = Infinity;
  for (const s of roadGrid.get(cellKey(x, z)) ?? []) best = Math.min(best, distanceToSegment(x, z, s) - s.half);
  return best;
}

const AUTODROMO_CENTER: Point = [400, 405];
const AUTODROMO_POINTS: Point[] = [
  [0, -90], [70, -100], [125, -70], [135, -10], [100, 30], [45, 20], [15, 55],
  [40, 100], [-20, 130], [-90, 110], [-125, 45], [-100, -20], [-70, -75],
].map(([x, z]) => [x + AUTODROMO_CENTER[0], z + AUTODROMO_CENTER[1]]);
const AUTODROMO_TRACK = buildTrack(splinePath(AUTODROMO_POINTS), 16);

/** Distância até a pista do autódromo (negativa = em cima dela). */
function autodromoClearance(x: number, z: number) {
  if (x < 230 || z < 260) return Infinity;
  return nearestSample(AUTODROMO_TRACK, x, z).distance - AUTODROMO_TRACK.width / 2;
}

/** O carro está numa rua ou na pista do autódromo? Fora disso é calçada/grama (mais lento). */
export function isOnRoad(x: number, z: number) {
  return roadClearance(x, z) <= 1 || autodromoClearance(x, z) <= 1;
}

const insideLake = (x: number, z: number, margin = 0) =>
  ((x - LAKE.x) / (LAKE.rx + margin)) ** 2 + ((z - LAKE.z) / (LAKE.rz + margin)) ** 2 < 1;

// --- Prédios, casas, galpões e contêineres ----------------------------------

export type BuildingKind = "tower" | "office" | "shop" | "house" | "warehouse" | "container";

/** Caixa girada no chão: centro, tamanho (w ao longo da rua, d para dentro), ângulo e altura. */
export interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  angle: number;
  height: number;
  kind: BuildingKind;
  /** Índice de cor (o cliente escolhe a paleta pelo tipo). */
  tint: number;
  /** Lado da caixa virado para a rua: +1 = sentido do eixo "d", -1 = contrário. */
  front: number;
}

export interface Tree {
  x: number;
  z: number;
  size: number;
}

/** Cantos de uma caixa girada (o eixo local "w" aponta para (cos, -sin)). */
function corners(b: { x: number; z: number; w: number; d: number; angle: number }): Point[] {
  const ux = Math.cos(b.angle);
  const uz = -Math.sin(b.angle);
  const vx = Math.sin(b.angle);
  const vz = Math.cos(b.angle);
  const hw = b.w / 2;
  const hd = b.d / 2;
  return [
    [b.x + ux * hw + vx * hd, b.z + uz * hw + vz * hd],
    [b.x - ux * hw + vx * hd, b.z - uz * hw + vz * hd],
    [b.x - ux * hw - vx * hd, b.z - uz * hw - vz * hd],
    [b.x + ux * hw - vx * hd, b.z + uz * hw - vz * hd],
  ];
}

/** Duas caixas giradas se sobrepõem? (Teorema dos eixos separadores.) */
function overlaps(a: Building, b: Building, margin: number) {
  if (Math.hypot(a.x - b.x, a.z - b.z) > (Math.hypot(a.w, a.d) + Math.hypot(b.w, b.d)) / 2 + margin) return false;
  const ca = corners({ ...a, w: a.w + margin, d: a.d + margin });
  const cb = corners(b);
  for (const box of [a, b]) {
    for (const [ax, az] of [[Math.cos(box.angle), -Math.sin(box.angle)], [Math.sin(box.angle), Math.cos(box.angle)]]) {
      const pa = ca.map(([x, z]) => x * ax + z * az);
      const pb = cb.map(([x, z]) => x * ax + z * az);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}

interface LotStyle {
  kind: (random: () => number, distFromCenter: number) => BuildingKind;
  width: [number, number];
  depth: [number, number];
  height: (kind: BuildingKind, random: () => number, distFromCenter: number) => number;
  gap: [number, number];
  setback: number;
  /** Segunda fileira (miolo do quarteirão). */
  rows: number;
  tints: number;
  /** Centro do bairro (prédios mais altos perto dele); padrão: o centro velho. */
  center?: Point;
}

const between = (random: () => number, [min, max]: [number, number]) => min + random() * (max - min);

const STYLES: Partial<Record<DistrictId, LotStyle>> = {
  centro: {
    kind: (r, dist) => (dist < 160 && r() < 0.75 ? "tower" : r() < 0.3 ? "shop" : "office"),
    width: [16, 30],
    depth: [16, 28],
    height: (kind, r, dist) => (kind === "tower" ? 45 + r() ** 1.4 * 90 * (1 - dist / 400) : kind === "shop" ? 7 + r() * 4 : 16 + r() * 30),
    gap: [3, 7],
    setback: 5,
    rows: 2,
    tints: 4,
  },
  porto: {
    kind: () => "warehouse",
    width: [28, 46],
    depth: [18, 28],
    height: (_k, r) => 8 + r() * 6,
    gap: [6, 14],
    setback: 6,
    rows: 2,
    tints: 4,
  },
  vila: {
    kind: (r) => (r() < 0.1 ? "shop" : "house"),
    width: [8, 11],
    depth: [8, 10],
    height: (kind, r) => (kind === "shop" ? 5 + r() * 2 : 4 + r() * 2),
    gap: [3, 7],
    setback: 6,
    rows: 1,
    tints: 6,
  },
  jardim: {
    kind: () => "house",
    width: [10, 14],
    depth: [10, 12],
    height: (_k, r) => 4.5 + r() * 2.5,
    gap: [7, 13],
    setback: 9,
    rows: 1,
    tints: 6,
  },
  // Quiosques de batata frita na beira-mar, bem espaçados.
  praia: {
    kind: () => "shop",
    width: [7, 10],
    depth: [5, 7],
    height: (_k, r) => 3.5 + r(),
    gap: [18, 40],
    setback: 6,
    rows: 1,
    tints: 4,
  },
  // Morro: casinhas coladas umas nas outras, de vários andares.
  morro: {
    kind: (r) => (r() < 0.08 ? "shop" : "house"),
    width: [6, 9],
    depth: [6, 8],
    height: (_k, r) => 3.5 + Math.floor(r() * 3) * 2.8,
    gap: [1, 3],
    setback: 3,
    rows: 2,
    tints: 6,
  },
  industrial: {
    kind: () => "warehouse",
    width: [36, 60],
    depth: [24, 38],
    height: (_k, r) => 9 + r() * 8,
    gap: [8, 18],
    setback: 8,
    rows: 2,
    tints: 4,
  },
  // Mansões com jardim na frente.
  picanha: {
    kind: () => "house",
    width: [16, 24],
    depth: [14, 20],
    height: (_k, r) => 6.5 + r() * 3,
    gap: [18, 34],
    setback: 14,
    rows: 1,
    tints: 6,
  },
  liberdade: {
    kind: (r, dist) => (dist < 260 && r() < 0.7 ? "tower" : r() < 0.35 ? "shop" : "office"),
    width: [16, 30],
    depth: [16, 28],
    height: (kind, r, dist) => (kind === "tower" ? 40 + r() ** 1.3 * 110 * Math.max(0.2, 1 - dist / 600) : kind === "shop" ? 7 + r() * 4 : 16 + r() * 34),
    gap: [3, 8],
    setback: 5,
    rows: 2,
    tints: 4,
    center: [0, 1100],
  },
  // Hangares longe da pista.
  aeroporto: {
    kind: () => "warehouse",
    width: [44, 64],
    depth: [30, 40],
    height: (_k, r) => 13 + r() * 5,
    gap: [40, 90],
    setback: 18,
    rows: 1,
    tints: 4,
  },
  // Sítios: casa e celeiro, bem longe um do outro.
  roca: {
    kind: (r) => (r() < 0.4 ? "warehouse" : "house"),
    width: [10, 16],
    depth: [9, 13],
    height: (kind, r) => (kind === "warehouse" ? 7 + r() * 3 : 4.5 + r() * 2),
    gap: [70, 150],
    setback: 16,
    rows: 1,
    tints: 6,
  },
};

const insideWorld = (x: number, z: number, margin: number) =>
  x > WORLD_BOUNDS.minX + margin && x < WORLD_BOUNDS.maxX - margin && z > WORLD_BOUNDS.minZ + margin && z < WORLD_BOUNDS.maxZ - margin;

function generateCity() {
  const random = seeded(2005);
  const buildings: Building[] = [];
  const trees: Tree[] = [];
  const buildingGrid = new Map<string, Building[]>();

  const nearby = (x: number, z: number) => {
    const out: Building[] = [];
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) out.push(...(buildingGrid.get(cellKey(x + i * CELL, z + j * CELL)) ?? []));
    return out;
  };
  const free = (b: Building, roadMargin: number) => {
    const points = [...corners(b), [b.x, b.z] as Point];
    // Pontos no meio de cada lado também, para caixas compridas não montarem na rua.
    const c = corners(b);
    for (let i = 0; i < 4; i++) points.push([(c[i][0] + c[(i + 1) % 4][0]) / 2, (c[i][1] + c[(i + 1) % 4][1]) / 2]);
    for (const [x, z] of points) {
      if (!insideWorld(x, z, 4) || roadClearance(x, z) < roadMargin || autodromoClearance(x, z) < 10 || insideLake(x, z, 6)) return false;
    }
    return !nearby(b.x, b.z).some((other) => overlaps(b, other, 2));
  };
  const add = (b: Building) => {
    buildings.push(b);
    const key = cellKey(b.x, b.z);
    const list = buildingGrid.get(key);
    if (list) list.push(b);
    else buildingGrid.set(key, [b]);
  };

  // Lotes ao longo das ruas, dos dois lados, de frente para a rua.
  for (const road of ROADS) {
    const total = road.length;
    for (const side of [-1, 1]) {
      for (let row = 0; row < 2; row++) {
        let s = 14;
        let walked = 0;
        let index = 0;
        while (s < total - 14) {
          // Ponto da rua a "s" metros do começo, e a direção dela ali.
          while (index < road.points.length - 2 && walked + Math.hypot(road.points[index + 1][0] - road.points[index][0], road.points[index + 1][1] - road.points[index][1]) < s) {
            walked += Math.hypot(road.points[index + 1][0] - road.points[index][0], road.points[index + 1][1] - road.points[index][1]);
            index++;
          }
          const [ax, az] = road.points[index];
          const [bx, bz] = road.points[index + 1];
          const len = Math.hypot(bx - ax, bz - az) || 1;
          const tx = (bx - ax) / len;
          const tz = (bz - az) / len;
          const t = Math.min(1, (s - walked) / len);
          const px = ax + (bx - ax) * t;
          const pz = az + (bz - az) * t;
          // Normal para o lado escolhido.
          const nx = tz * side;
          const nz = -tx * side;
          const probeX = px + nx * (road.width / 2 + 12);
          const probeZ = pz + nz * (road.width / 2 + 12);
          const style = road.kind === "pista" ? undefined : STYLES[districtAt(probeX, probeZ)];
          if (!style || row >= style.rows) {
            s += 12;
            continue;
          }
          const [cx, cz] = style.center ?? [-40, -40];
          const distFromCenter = Math.hypot(px - cx, pz - cz);
          const kind = style.kind(random, distFromCenter);
          const w = between(random, style.width);
          const d = between(random, style.depth);
          const offset = road.width / 2 + style.setback + d / 2 + row * (style.depth[1] + 8);
          const b: Building = {
            x: px + nx * offset,
            z: pz + nz * offset,
            w,
            d,
            angle: Math.atan2(tx, tz) + Math.PI / 2,
            height: style.height(kind, random, distFromCenter),
            kind,
            tint: Math.floor(random() * style.tints),
            front: -side,
          };
          if (free(b, style.setback - 1)) {
            add(b);
            // Casas ganham uma árvore no quintal, às vezes.
            if (kind === "house" && random() < 0.6) {
              const back = d / 2 + 4;
              const tx2 = b.x + nx * back + (random() - 0.5) * w;
              const tz2 = b.z + nz * back;
              if (roadClearance(tx2, tz2) > 3 && !nearby(tx2, tz2).some((o) => Math.hypot(o.x - tx2, o.z - tz2) < Math.max(o.w, o.d) / 2 + 2)) {
                trees.push({ x: tx2, z: tz2, size: 0.8 + random() * 0.6 });
              }
            }
          }
          s += w + between(random, style.gap);
        }
      }
    }
  }

  // Pátio de contêineres no porto: pilhas coloridas onde sobrou espaço.
  for (let k = 0; k < 900; k++) {
    const x = -560 + random() * 1120;
    const z = QUAY_Z + 10 + random() * 160;
    if (districtAt(x, z) !== "porto") continue;
    const angle = random() < 0.5 ? 0 : Math.PI / 2;
    const b: Building = { x, z, w: 12, d: 2.6, angle, height: 2.6 * (1 + Math.floor(random() * 3)), kind: "container", tint: Math.floor(random() * 6), front: 1 };
    if (free(b, 3)) add(b);
  }

  // Árvores: muitas no parque e na serra, algumas nas praças e calçadas dos bairros.
  // Uma grade só delas evita comparar cada árvore nova com todas as outras.
  const treeCells = new Map<string, Tree[]>();
  const treeTries: [DistrictId, number][] = [
    ["parque", 1400], ["autodromo", 500], ["jardim", 500], ["vila", 250],
    ["serra", 6000], ["picanha", 1800], ["roca", 1500], ["morro", 500], ["praia", 300], ["aeroporto", 500], ["liberdade", 300],
  ];
  for (const [district, tries] of treeTries) {
    const box = DISTRICTS.find((d) => d.id === district)!.polygon;
    const minX = Math.max(WORLD_BOUNDS.minX, Math.min(...box.map((p) => p[0])));
    const maxX = Math.min(WORLD_BOUNDS.maxX, Math.max(...box.map((p) => p[0])));
    const minZ = Math.max(WORLD_BOUNDS.minZ, Math.min(...box.map((p) => p[1])));
    const maxZ = Math.min(WORLD_BOUNDS.maxZ, Math.max(...box.map((p) => p[1])));
    for (let k = 0; k < tries; k++) {
      const x = minX + random() * (maxX - minX);
      const z = minZ + random() * (maxZ - minZ);
      if (districtAt(x, z) !== district || !insideWorld(x, z, 6)) continue;
      if (roadClearance(x, z) < 4 || autodromoClearance(x, z) < 8 || insideLake(x, z, 4)) continue;
      if (nearby(x, z).some((o) => Math.hypot(o.x - x, o.z - z) < Math.max(o.w, o.d) / 2 + 3)) continue;
      if ((treeCells.get(cellKey(x, z)) ?? []).some((t) => Math.abs(t.x - x) < 5 && Math.abs(t.z - z) < 5)) continue;
      const tree = { x, z, size: 0.8 + random() * 0.9 };
      trees.push(tree);
      // Guarda nas células vizinhas também (a checagem de 5 m pode cruzar a borda da célula).
      for (const [dx, dz] of [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5]]) {
        const key = cellKey(x + dx, z + dz);
        const list = treeCells.get(key);
        if (!list) treeCells.set(key, [tree]);
        else if (!list.includes(tree)) list.push(tree);
      }
    }
  }
  return { buildings, trees, buildingGrid };
}

const city = generateCity();
export const BUILDINGS = city.buildings;
export const TREES = city.trees;

const treeGrid = new Map<string, Tree[]>();
for (const tree of TREES) {
  const key = cellKey(tree.x, tree.z);
  const list = treeGrid.get(key);
  if (list) list.push(tree);
  else treeGrid.set(key, [tree]);
}

function nearbyBuildings(x: number, z: number) {
  const out: Building[] = [];
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) out.push(...(city.buildingGrid.get(cellKey(x + i * CELL, z + j * CELL)) ?? []));
  return out;
}

/** O ponto está dentro de algum prédio? (Usado para ver se há linha de visão.) */
export function insideBuilding(x: number, z: number) {
  return nearbyBuildings(x, z).some((b) => {
    const dx = x - b.x;
    const dz = z - b.z;
    const lw = dx * Math.cos(b.angle) - dz * Math.sin(b.angle);
    const ld = dx * Math.sin(b.angle) + dz * Math.cos(b.angle);
    return Math.abs(lw) < b.w / 2 && Math.abs(ld) < b.d / 2;
  });
}

// --- Colisão -----------------------------------------------------------------

/** Quanto um círculo (cx, cz, raio r) precisa andar para sair de prédios e árvores; null se está livre. */
function circlePush(cx: number, cz: number, r: number): [number, number] | null {
  let px = 0;
  let pz = 0;
  for (const b of nearbyBuildings(cx, cz)) {
    // Leva o círculo para o "espaço" da caixa (sem giro), resolve como retângulo e volta.
    const cos = Math.cos(b.angle);
    const sin = Math.sin(b.angle);
    const dx = cx + px - b.x;
    const dz = cz + pz - b.z;
    const lw = dx * cos - dz * sin;
    const ld = dx * sin + dz * cos;
    const hw = b.w / 2;
    const hd = b.d / 2;
    if (Math.abs(lw) > hw + r || Math.abs(ld) > hd + r) continue;
    const cw = Math.max(-hw, Math.min(lw, hw));
    const cd = Math.max(-hd, Math.min(ld, hd));
    const dist = Math.hypot(lw - cw, ld - cd);
    if (dist >= r) continue;
    let nw: number;
    let nd: number;
    if (dist === 0) {
      // Centro dentro da caixa: sai pelo lado mais próximo.
      const exits = [hw - lw, lw + hw, hd - ld, ld + hd];
      const k = exits.indexOf(Math.min(...exits));
      nw = k === 0 ? hw + r : k === 1 ? -hw - r : lw;
      nd = k === 2 ? hd + r : k === 3 ? -hd - r : ld;
    } else {
      nw = cw + ((lw - cw) / dist) * r;
      nd = cd + ((ld - cd) / dist) * r;
    }
    px = b.x + nw * cos + nd * sin - cx;
    pz = b.z - nw * sin + nd * cos - cz;
  }
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (const tree of treeGrid.get(cellKey(cx + i * CELL, cz + j * CELL)) ?? []) {
        const dx = cx + px - tree.x;
        const dz = cz + pz - tree.z;
        const dist = Math.hypot(dx, dz);
        const min = r + 0.7 * tree.size;
        if (dist >= min || dist === 0) continue;
        px += (dx / dist) * (min - dist);
        pz += (dz / dist) * (min - dist);
      }
    }
  }
  return px || pz ? [px, pz] : null;
}

/**
 * Empurra o carro para fora de prédios, árvores, do lago e dos limites do mapa.
 * O carro é uma cápsula (três círculos ao longo do comprimento, da largura
 * dele): o bico não atravessa a parede e a lateral não para longe dela.
 * Batendo de frente o carro para; de raspão, escorrega pela parede.
 * Retorna true se bateu.
 */
export function collideWorld(car: CarState, halfLength: number = CAR.halfLength, halfWidth: number = CAR.halfWidth, motion?: CarMotion): boolean {
  let hit = false;
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const reach = Math.max(0, halfLength - halfWidth);
  for (const offset of [reach, 0, -reach]) {
    const push = circlePush(car.x + fx * offset, car.z + fz * offset, halfWidth);
    if (!push) continue;
    car.x += push[0];
    car.z += push[1];
    const len = Math.hypot(push[0], push[1]);
    const nx = push[0] / len;
    const nz = push[1] / len;
    // Perde velocidade conforme o quanto bateu de frente (0 = raspão, 1 = de frente).
    const headOn = Math.abs(fx * nx + fz * nz);
    car.speed *= 1 - 0.7 * headOn;
    if (motion) {
      // O empurrão lateral não continua para dentro da parede.
      const into = motion.vx * nx + motion.vz * nz;
      if (into < 0) {
        motion.vx -= nx * into;
        motion.vz -= nz * into;
      }
    }
    hit = true;
  }

  if (insideLake(car.x, car.z)) {
    // Empurra para a margem do lago, na direção do centro para fora.
    const angle = Math.atan2((car.z - LAKE.z) / LAKE.rz, (car.x - LAKE.x) / LAKE.rx);
    car.x = LAKE.x + Math.cos(angle) * (LAKE.rx + 0.5);
    car.z = LAKE.z + Math.sin(angle) * (LAKE.rz + 0.5);
    car.speed *= 0.3;
    hit = true;
  }

  const { minX, maxX, minZ, maxZ } = WORLD_BOUNDS;
  if (car.x < minX || car.x > maxX || car.z < minZ || car.z > maxZ) {
    car.x = Math.max(minX, Math.min(maxX, car.x));
    car.z = Math.max(minZ, Math.min(maxZ, car.z));
    car.speed *= -0.3;
    hit = true;
  }
  return hit;
}

// --- Grafo de ruas (navegação das viaturas e do trânsito) --------------------

export interface NavNode {
  id: string;
  x: number;
  z: number;
  /** Ligações: para qual nó, por qual rua, e se a rua é percorrida de trás para frente. */
  links: { to: number; road: number; reversed: boolean }[];
}

export const NAV: NavNode[] = Object.entries(PLAN.nodes).map(([id, [x, z]]) => ({ id, x, z, links: [] }));
const navIndex = new Map(NAV.map((n, i) => [n.id, i]));
ROADS.forEach((road, i) => {
  const a = navIndex.get(road.a)!;
  const b = navIndex.get(road.b)!;
  NAV[a].links.push({ to: b, road: i, reversed: false });
  NAV[b].links.push({ to: a, road: i, reversed: true });
});

export function nearestNav(x: number, z: number) {
  let best = 0;
  let bestDist = Infinity;
  NAV.forEach((n, i) => {
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < bestDist && n.links.length > 0) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

/** Pontos da rua percorrida de `from` para o vizinho por `link`. */
export function linkPoints(link: NavNode["links"][number]): Point[] {
  const points = ROADS[link.road].points;
  return link.reversed ? [...points].reverse() : points;
}

/** Rua mais próxima de um ponto e em que trecho dela (índice do ponto). */
export function nearestRoad(x: number, z: number) {
  let best: Segment | null = null;
  let bestDist = Infinity;
  const candidates = roadGrid.get(cellKey(x, z));
  const pool = candidates && candidates.length ? candidates : [...roadGrid.values()].flat();
  for (const s of pool) {
    const d = distanceToSegment(x, z, s);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return { road: best!.road, index: best!.index };
}

const routeLength = (nodes: number[]) =>
  nodes.slice(1).reduce((sum, n, i) => sum + ROADS[NAV[nodes[i]].links.find((l) => l.to === n)!.road].length, 0);

/**
 * Caminho pelas ruas de A até B, como lista de pontos. Considera a rua em que
 * cada ponta está e sai por qualquer uma das duas pontas dessa rua (sem isso,
 * o "cruzamento mais perto em linha reta" podia ficar atrás de um prédio).
 */
export function routeBetween(ax: number, az: number, bx: number, bz: number): Point[] {
  const from = nearestRoad(ax, az);
  const to = nearestRoad(bx, bz);
  const fromRoad = ROADS[from.road];
  const toRoad = ROADS[to.road];
  if (from.road === to.road) {
    const [i, j] = [from.index, to.index];
    return i <= j ? fromRoad.points.slice(i, j + 2) : fromRoad.points.slice(j, i + 1).reverse();
  }
  const segmentLength = (points: Point[]) => polylineLength(points);
  // Saídas possíveis: pela ponta A (voltando pela rua) ou pela ponta B (seguindo).
  const exits = [
    { node: navIndex.get(fromRoad.a)!, points: fromRoad.points.slice(0, from.index + 1).reverse() },
    { node: navIndex.get(fromRoad.b)!, points: fromRoad.points.slice(from.index + 1) },
  ];
  const entries = [
    { node: navIndex.get(toRoad.a)!, points: toRoad.points.slice(0, to.index + 2) },
    { node: navIndex.get(toRoad.b)!, points: toRoad.points.slice(to.index).reverse() },
  ];
  let best: Point[] = [];
  let bestCost = Infinity;
  for (const exit of exits) {
    for (const entry of entries) {
      const nodes = findRoute(exit.node, entry.node);
      const cost = segmentLength(exit.points) + routeLength(nodes) + segmentLength(entry.points);
      if (cost >= bestCost) continue;
      bestCost = cost;
      const middle: Point[] = [];
      for (let i = 0; i < nodes.length - 1; i++) {
        const link = NAV[nodes[i]].links.find((l) => l.to === nodes[i + 1])!;
        middle.push(...linkPoints(link).slice(1));
      }
      best = [...exit.points, ...middle, ...entry.points];
    }
  }
  return best;
}

/** Caminho mais curto (Dijkstra pelo comprimento das ruas) entre dois nós: lista de nós. */
export function findRoute(from: number, to: number): number[] {
  const dist = new Map<number, number>([[from, 0]]);
  const previous = new Map<number, number>();
  const open = new Set([from]);
  while (open.size) {
    let current = -1;
    let best = Infinity;
    for (const n of open) {
      const d = dist.get(n)!;
      if (d < best) {
        best = d;
        current = n;
      }
    }
    open.delete(current);
    if (current === to) break;
    for (const link of NAV[current].links) {
      const d = best + ROADS[link.road].length;
      if (d < (dist.get(link.to) ?? Infinity)) {
        dist.set(link.to, d);
        previous.set(link.to, current);
        open.add(link.to);
      }
    }
  }
  const path = [to];
  while (path[0] !== from && previous.has(path[0])) path.unshift(previous.get(path[0])!);
  return path[0] === from ? path : [from, to];
}

// --- Corridas ----------------------------------------------------------------

export type RaceId =
  | "autodromo" | "centro" | "porto" | "pastel" | "parque"
  | "praia" | "picanha" | "yakisoba" | "aeroporto" | "serra" | "gordura" | "roca" | "morro" | "rodoanel" | "serpentina";

export interface RaceInfo {
  id: RaceId;
  name: string;
  laps: number;
  track: Track;
}

/** Traçado de corrida seguindo as ruas pela sequência de cruzamentos (fechando o circuito). */
function routeTrack(ids: string[], width: number): Track {
  const points: Point[] = [];
  for (let i = 0; i < ids.length; i++) {
    const a = ids[i];
    const b = ids[(i + 1) % ids.length];
    // A rua da planta pode ter ganhado cruzamentos no meio: segue a sequência deles.
    const chain = PLAN.chains.get(`${a}|${b}`) ?? PLAN.chains.get(`${b}|${a}`)?.slice().reverse();
    if (!chain) throw new Error(`Corrida: não há rua entre ${a} e ${b}`);
    for (let k = 0; k < chain.length - 1; k++) {
      const link = NAV[navIndex.get(chain[k])!].links.find((l) => l.to === navIndex.get(chain[k + 1]));
      if (!link) throw new Error(`Corrida: não há rua entre ${chain[k]} e ${chain[k + 1]}`);
      points.push(...linkPoints(link).slice(0, -1));
    }
  }
  // Suaviza as esquinas (média móvel sobre ~±14 m), numa linha já igualmente espaçada.
  const even = buildTrack(points, width).samples.map((s): Point => [s.x, s.z]);
  const window = 9;
  const smooth = even.map((_, i) => {
    let sx = 0;
    let sz = 0;
    for (let k = -window; k <= window; k++) {
      const p = even[(i + k + even.length) % even.length];
      sx += p[0];
      sz += p[1];
    }
    return [sx / (window * 2 + 1), sz / (window * 2 + 1)] as Point;
  });
  return buildTrack(smooth, width);
}

export const RACES: Record<RaceId, RaceInfo> = {
  autodromo: { id: "autodromo", name: "Autódromo do Colesterol", laps: 3, track: AUTODROMO_TRACK },
  centro: { id: "centro", name: "Circuito do Centro", laps: 2, track: routeTrack(["C2", "D2", "M4", "M6", "M3", "C1", "D1"], 16) },
  porto: { id: "porto", name: "Volta do Porto", laps: 2, track: routeTrack(["P2", "P3", "R1", "M3", "C1", "D1", "S0", "V0", "P1"], 18) },
  pastel: { id: "pastel", name: "Rota do Pastel", laps: 2, track: routeTrack(["W0", "V3", "V2", "V1", "V0", "S0"], 15) },
  parque: { id: "parque", name: "Volta do Lago", laps: 2, track: routeTrack(["Q0", "Q1", "Q2", "Q3", "Q4", "R2"], 15) },
  // Bairros novos: corridas mais largas e com curvas abertas.
  praia: { id: "praia", name: "Volta da Praia", laps: 2, track: routeTrack(["BA0", "BA1", "HW1", "MK", "MG", "MC", "MB", "MA"], 20) },
  morro: { id: "morro", name: "Ladeira do Torresmo", laps: 2, track: routeTrack(["MA", "ME", "MI", "MJ", "MK", "MG", "MC", "MB"], 15) },
  picanha: { id: "picanha", name: "Alto da Picanha", laps: 2, track: routeTrack(["AP0", "AP1", "AP2", "AP5", "AP4", "AP7", "AP6", "AP3"], 15) },
  yakisoba: { id: "yakisoba", name: "Circuito do Yakisoba", laps: 2, track: routeTrack(["Y10", "Y20", "Y30", "Y31", "Y32", "Y33", "Y23", "Y22", "Y11"], 18) },
  aeroporto: { id: "aeroporto", name: "Pista do Aeroporto", laps: 2, track: routeTrack(["AE0", "AE1", "AE4", "AE5"], 24) },
  serra: { id: "serra", name: "Subida da Serra", laps: 2, track: routeTrack(["SA", "SB", "SC", "SD", "SF", "SE"], 15) },
  gordura: { id: "gordura", name: "Circuito da Gordura Trans", laps: 2, track: routeTrack(["I00", "I10", "I20", "I21", "I22", "I12", "I02", "I01"], 18) },
  roca: { id: "roca", name: "Estrada da Roça", laps: 2, track: routeTrack(["RO0", "RO1", "RO2", "RO3"], 15) },
  serpentina: { id: "serpentina", name: "Serpentina do Açúcar", laps: 2, track: routeTrack(["SC", "SZ1", "SZ2", "SZ3", "HN0", "HN1", "SD"], 15) },
  // O anel inteiro da rodovia (e a beira-mar): uma volta só, de ~12 km.
  rodoanel: {
    id: "rodoanel", name: "Rodoanel de Cebola", laps: 1,
    // Larga na subida do lado oeste (longe do ponto de encontro da Volta do Porto).
    track: routeTrack(["HW1", "HW2", "HW3", "HN0", "HN1", "HN2", "HN3", "HE3", "HE2", "HE1", "PE1", "PE0", "P5", "P4", "P3", "P2", "P1", "P0", "BA0", "BA1"], 24),
  },
};

export const RACE_IDS = Object.keys(RACES) as RaceId[];

/** Nome da corrida com a preposição certa: "no Circuito do Centro", "na Volta do Lago". */
export const atRace = (id: RaceId) => `${/^(Volta|Rota|Ladeira|Subida|Pista|Estrada|Rodovia|Serpentina)\b/.test(RACES[id].name) ? "na" : "no"} ${RACES[id].name}`;

export const isRaceId = (value: unknown): value is RaceId =>
  typeof value === "string" && value in RACES;

/** Raio do ponto de encontro de cada corrida no mundo aberto. */
export const MARKER_RADIUS = 18;

/** Onde fica o ponto de encontro: um pouco antes da linha de largada. */
export function raceMarker(id: RaceId) {
  const track = RACES[id].track;
  const s = track.samples[track.samples.length - Math.round(30 / (track.length / track.samples.length))];
  return { x: s.x, z: s.z, heading: Math.atan2(s.tx, s.tz) };
}

// --- Nascimento e comida -----------------------------------------------------

/** Onde se nasce no mundo aberto: no meio de ruas do centro, de frente para a rua. */
export const SPAWNS = (["C2", "M1", "M4", "C5"] as const).map((id) => {
  const node = NAV[navIndex.get(id)!];
  const link = node.links[0];
  const points = linkPoints(link);
  const [x, z] = points[Math.min(points.length - 1, 8)];
  const [nx, nz] = points[Math.min(points.length - 1, 9)];
  return { x, z, heading: Math.atan2(nx - x, nz - z) };
});

export interface StandSpot {
  x: number;
  z: number;
  kind: "burger" | "fries" | "soda";
}

/** Comida perto dos cruzamentos, em cima da rua. */
export const STANDS: StandSpot[] = (() => {
  const random = seeded(77);
  const kinds = ["burger", "fries", "soda"] as const;
  const spots: StandSpot[] = [];
  for (const node of NAV) {
    // Só nos cruzamentos da planta (os gerados ao adensar encheriam a cidade de comida).
    if (!(node.id in NODES) || node.links.length < 3 || random() < 0.35) continue;
    const link = node.links[Math.floor(random() * node.links.length)];
    const points = linkPoints(link);
    const k = Math.min(points.length - 2, 6 + Math.floor(random() * 3));
    const [x, z] = points[k];
    const [nx, nz] = points[k + 1];
    const len = Math.hypot(nx - x, nz - z) || 1;
    const side = (random() < 0.5 ? -1 : 1) * ROADS[link.road].width * 0.22;
    const spot: StandSpot = { x: x + ((nz - z) / len) * side, z: z - ((nx - x) / len) * side, kind: kinds[Math.floor(random() * 3)] };
    // Longe dos pontos de encontro: quem volta de uma corrida nasce ali, e o
    // turbo da comida mandava o carro sozinho para a parede.
    if (RACE_IDS.some((id) => Math.hypot(raceMarker(id).x - spot.x, raceMarker(id).z - spot.z) < 45)) continue;
    spots.push(spot);
  }
  return spots;
})();
