// Enfeites sólidos da cidade, fora da planta: arquibancadas, muro dos boxes,
// prédio dos boxes e caminhões das equipes no autódromo, placas de patrocínio
// nas curvas, caminhões-baú das equipes perto das garagens e no distrito
// industrial, e os pés dos guindastes de pórtico do cais.
//
// Tudo é posicionado lendo os dados do mapa (o traçado do autódromo, as ruas,
// as garagens, o cais e o bairro do porto), nunca por coordenada fixa, e entra
// na colisão pelo `addObstacles` do world.ts. Mesma semente no servidor e no
// cliente: o cliente desenha exatamente onde o servidor bate (client/src/paddock.ts
// e client/src/harbor.ts).
import { nearestSample } from "./track.ts";
import {
  DISTRICTS,
  GARAGES,
  QUAY_Z,
  RACES,
  ROADS,
  TREES,
  WORLD_BOUNDS,
  addObstacles,
  addPaved,
  clearTrees,
  districtAt,
  insideBuilding,
  isOnRoad,
  seeded,
  type Box,
} from "./world.ts";

export type SolidKind =
  /** Arquibancada coberta (sobe para longe da pista). */
  | "arquibancada"
  /** Muro baixo entre a pista e a pista dos boxes. */
  | "muro"
  /** Prédio dos boxes (cada caixa tem duas portas de equipe). */
  | "boxes"
  /** Caminhão-baú de equipe. */
  | "caminhao"
  /** Placa baixa de patrocínio na beira das curvas. */
  | "placa"
  /** Pé de guindaste de pórtico do cais. */
  | "guindaste";

/**
 * Caixa girada como os prédios do world.ts: o eixo local "w" aponta para
 * (cos angle, −sin angle) e o "d" para (sin angle, cos angle). No Three.js,
 * `rotation.y = angle` deixa o x local no "w" e o z local no "d".
 */
export interface SolidProp extends Box {
  kind: SolidKind;
  height: number;
  /** Escolhe a equipe (o cliente faz `% equipes.length`). */
  team: number;
  /**
   * Para onde fica a frente (a pista, a rua): +1 = sentido do eixo "d", −1 =
   * contrário. No caminhão é o lado da cabine, no eixo "w".
   */
  front: number;
}

/** Guindaste de pórtico: x ao longo do cais e os quatro pés. */
export interface GantrySpot {
  x: number;
  /** z dos pés do lado do mar e do lado de terra. */
  seaZ: number;
  landZ: number;
  /** Meia distância entre os pés ao longo do cais. */
  halfSpan: number;
}

const solids: SolidProp[] = [];
const random = seeded(5550);

// --- Conferência de espaço livre ----------------------------------------------

const TREE_CELL = 25;
const treeGrid = new Map<string, { x: number; z: number; size: number }[]>();
function gridTrees() {
  treeGrid.clear();
  for (const tree of TREES) {
    const key = `${Math.floor(tree.x / TREE_CELL)},${Math.floor(tree.z / TREE_CELL)}`;
    const list = treeGrid.get(key);
    if (list) list.push(tree);
    else treeGrid.set(key, [tree]);
  }
}
gridTrees();
function nearTree(x: number, z: number, margin: number) {
  const cx = Math.floor(x / TREE_CELL);
  const cz = Math.floor(z / TREE_CELL);
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (const t of treeGrid.get(`${cx + i},${cz + j}`) ?? []) if (Math.hypot(t.x - x, t.z - z) < 0.7 * t.size + margin) return true;
    }
  }
  return false;
}

/** Pontos da caixa (cantos, meio dos lados, uma grade por dentro). */
function boxPoints(b: Box, step = 4) {
  const ux = Math.cos(b.angle);
  const uz = -Math.sin(b.angle);
  const vx = Math.sin(b.angle);
  const vz = Math.cos(b.angle);
  const points: [number, number][] = [];
  const nu = Math.max(1, Math.ceil(b.w / step));
  const nv = Math.max(1, Math.ceil(b.d / step));
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      const u = (i / nu - 0.5) * b.w;
      const v = (j / nv - 0.5) * b.d;
      points.push([b.x + ux * u + vx * v, b.z + uz * u + vz * v]);
    }
  }
  return points;
}

const autodromo = RACES.autodromo?.track;

/** Distância até a beira da pista do autódromo (Infinity sem autódromo). */
function trackClearance(x: number, z: number) {
  if (!autodromo) return Infinity;
  return nearestSample(autodromo, x, z).distance - autodromo.width / 2;
}

/**
 * A caixa cabe ali? Fora das ruas, dos prédios, das árvores, da pista e dos
 * outros enfeites (menos os do tipo `strip`: os pedaços de uma mesma faixa
 * encostam um no outro).
 */
function fits(b: Box, trackGap: number, treeMargin = 1, strip?: SolidKind) {
  if (solids.some((o) => o.kind !== strip && Math.hypot(o.x - b.x, o.z - b.z) < (Math.hypot(o.w, o.d) + Math.hypot(b.w, b.d)) / 2 && overlapsLoose(o, b))) return false;
  for (const [x, z] of boxPoints(b)) {
    if (x < WORLD_BOUNDS.minX + 4 || x > WORLD_BOUNDS.maxX - 4 || z < WORLD_BOUNDS.minZ + 1 || z > WORLD_BOUNDS.maxZ - 4) return false;
    if (isOnRoad(x, z) || insideBuilding(x, z) || nearTree(x, z, treeMargin)) return false;
    if (trackClearance(x, z) < trackGap) return false;
  }
  return true;
}

/** Sobreposição aproximada (pontos de uma caixa dentro da outra, com folga). */
function overlapsLoose(a: Box, b: Box) {
  const inside = (box: Box, x: number, z: number) => {
    const dx = x - box.x;
    const dz = z - box.z;
    const lw = dx * Math.cos(box.angle) - dz * Math.sin(box.angle);
    const ld = dx * Math.sin(box.angle) + dz * Math.cos(box.angle);
    return Math.abs(lw) <= box.w / 2 + 0.6 && Math.abs(ld) <= box.d / 2 + 0.6;
  };
  return boxPoints(a, 2).some(([x, z]) => inside(b, x, z)) || boxPoints(b, 2).some(([x, z]) => inside(a, x, z));
}

// --- Autódromo: reta dos boxes ------------------------------------------------

/** Trecho da reta de largada (amostras, com volta) e o lado de dentro da pista. */
export interface PitStraight {
  /** Índices das amostras do começo e do fim (o fim pode passar de n: dá a volta). */
  from: number;
  to: number;
  /** +1: o lado de dentro (boxes) é a esquerda de quem corre; −1: a direita. */
  inside: 1 | -1;
}

export let PIT_STRAIGHT: PitStraight | null = null;

/** Ponto a `side` metros da amostra `i` (positivo = esquerda de quem corre) e o rumo da pista ali. */
function along(i: number, side: number) {
  const samples = autodromo!.samples;
  const n = samples.length;
  const s = samples[((i % n) + n) % n];
  return { x: s.x + s.tz * side, z: s.z - s.tx * side, heading: Math.atan2(s.tx, s.tz) };
}

/**
 * Faixa de caixas ao longo da reta, do lado `sign` (+1 = esquerda de quem
 * corre), de `inner` a `outer` metros do centro, em pedaços de `segment` amostras.
 */
function strip(p: PitStraight, sign: number, inner: number, outer: number, segment: number, each: (box: Box & { mid: number }) => void) {
  for (let i = p.from; i + segment <= p.to; i += segment) {
    const side = (sign * (inner + outer)) / 2;
    const a = along(i, side);
    const b = along(i + segment, side);
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const heading = Math.atan2(b.x - a.x, b.z - a.z);
    each({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, w: length + 0.15, d: outer - inner, angle: heading - Math.PI / 2, mid: i + segment / 2 });
  }
}

function buildAutodromo() {
  if (!autodromo) return;
  const samples = autodromo.samples;
  const n = samples.length;
  const half = autodromo.width / 2;
  // A reta de largada: anda das duas pontas da largada enquanto o rumo não muda muito.
  const heading0 = Math.atan2(samples[0].tx, samples[0].tz);
  const turn = (i: number) => {
    const s = samples[((i % n) + n) % n];
    const d = Math.atan2(s.tx, s.tz) - heading0;
    return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
  };
  const LIMIT = 0.24;
  let from = 0;
  while (from > -n / 4 && turn(from - 1) < LIMIT) from--;
  let to = 0;
  while (to < n / 4 && turn(to + 1) < LIMIT) to++;
  // Lado de dentro: o que aponta para o meio do traçado.
  let cx = 0;
  let cz = 0;
  for (const s of samples) {
    cx += s.x / n;
    cz += s.z / n;
  }
  const s0 = samples[0];
  const inside: 1 | -1 = (cx - s0.x) * s0.tz + (cz - s0.z) * -s0.tx > 0 ? 1 : -1;
  const pit: PitStraight = { from, to, inside };
  PIT_STRAIGHT = pit;
  // Com angle = rumo − 90°, o eixo "d" aponta para a direita de quem corre: uma
  // caixa do lado `sign` tem a pista no sentido `sign` do eixo "d" (é o `front`).

  // A área toda (boxes, paddock e arquibancadas) é limpa: sem árvore no meio.
  const zones: Box[] = [];
  strip(pit, inside, half + 2.5, half + 62, 10, (b) => zones.push(b));
  strip(pit, -inside, half + 8, half + 27, 10, (b) => zones.push(b));
  clearTrees(zones);
  gridTrees();

  // Muro dos boxes (fora do corredor da corrida: o asfalto acaba a 1 m da zebra).
  strip(pit, inside, half + 3.0, half + 3.6, 10, (b) => {
    if (fits(b, 2.5, 0.2, "muro")) solids.push({ ...b, kind: "muro", height: 1.15, team: Math.floor(b.mid), front: inside });
  });
  // Pista dos boxes (asfalto) entre o muro e o prédio.
  const paved: Box[] = [];
  strip(pit, inside, half + 4.4, half + 15, 10, (b) => {
    if (fits(b, 3.5, 0)) paved.push(b);
  });
  // Prédio dos boxes: caixas de 16 m (duas portas de equipe cada).
  let team = 0;
  strip(pit, inside, half + 16, half + 29, 10, (b) => {
    if (fits(b, 6, 1, "boxes")) solids.push({ ...b, kind: "boxes", height: 9.5, team: team++, front: inside });
  });
  // Caminhões das equipes no paddock, atrás do prédio, em duas filas.
  for (const [inner, offset] of [[half + 34, 0], [half + 45, 5]] as const) {
    for (let i = pit.from + 3 + offset; i + 12 <= pit.to; i += 14) {
      const a = along(i, pit.inside * (inner + 1.3));
      const b = along(i + 11, pit.inside * (inner + 1.3));
      const box: Box = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, w: 16.5, d: 2.6, angle: Math.atan2(b.x - a.x, b.z - a.z) - Math.PI / 2 };
      if (fits(box, 6, 0.5)) solids.push({ ...box, kind: "caminhao", height: 4, team: Math.floor(random() * 1000), front: random() < 0.5 ? 1 : -1 });
    }
  }
  // Arquibancadas do lado de fora da reta (sobem para longe da pista).
  strip(pit, -inside, half + 9, half + 25, 10, (b) => {
    if (fits(b, 5, 0.5, "arquibancada")) solids.push({ ...b, kind: "arquibancada", height: 13, team: Math.floor(b.mid), front: -inside });
  });
  // Placas de patrocínio no lado de fora das curvas mais fechadas.
  for (let i = 0; i < n; i += 9) {
    const a = samples[i];
    const b = samples[(i + 8) % n];
    const cross = a.tx * b.tz - a.tz * b.tx;
    if (Math.abs(cross) < 0.12) continue;
    // Curva para a esquerda (cross < 0 no plano XZ com Y para cima): o lado de fora é a direita.
    const outside = cross < 0 ? -1 : 1;
    const side = outside * (half + 7.5);
    const p = along(i, side);
    const q = along(i + 8, side);
    const box: Box = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2, w: Math.hypot(q.x - p.x, q.z - p.z), d: 0.35, angle: Math.atan2(q.x - p.x, q.z - p.z) - Math.PI / 2 };
    if (fits(box, 5, 0.3, "placa")) solids.push({ ...box, kind: "placa", height: 1.2, team: i, front: outside > 0 ? 1 : -1 });
  }
  addPaved(paved);
  PIT_LANE.push(...paved);
}

/** Asfalto da pista dos boxes (o cliente desenha). */
export const PIT_LANE: Box[] = [];

// --- Caminhões das equipes pela cidade ---------------------------------------

function buildCityTrucks() {
  // Do lado de cada garagem (de frente para a rua, como quem acabou de descarregar).
  for (const g of GARAGES) {
    const ux = Math.cos(g.angle);
    const uz = -Math.sin(g.angle);
    for (const side of random() < 0.5 ? [1, -1] : [-1, 1]) {
      const offset = g.w / 2 + 4.2;
      const box: Box = { x: g.x + ux * offset * side, z: g.z + uz * offset * side, w: 2.6, d: 16.5, angle: g.angle };
      if (!fits(box, 6, 0.5)) continue;
      // Cabine para o lado da rua (o da fachada). Girada 90°, o eixo "w" novo é o
      // "d" da garagem ao contrário.
      solids.push({ ...box, w: 16.5, d: 2.6, angle: g.angle + Math.PI / 2, kind: "caminhao", height: 4, team: Math.floor(random() * 1000), front: -g.front });
      break;
    }
  }
  // Estacionados no acostamento das ruas do distrito industrial e do porto.
  const roads = ROADS.filter((r) => (r.kind === "rua" || r.kind === "avenida") && r.points.length > 20 && ["industrial", "porto"].includes(districtAt(...r.points[Math.floor(r.points.length / 2)])));
  let placed = 0;
  for (let tries = 0; tries < 400 && placed < 8 && roads.length; tries++) {
    const road = roads[Math.floor(random() * roads.length)];
    const k = 5 + Math.floor(random() * (road.points.length - 10));
    const [ax, az] = road.points[k];
    const [bx, bz] = road.points[k + 1];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const tx = (bx - ax) / len;
    const tz = (bz - az) / len;
    const side = random() < 0.5 ? 1 : -1;
    const offset = road.width / 2 + 3.2;
    const box: Box = { x: ax + tz * offset * side, z: az - tx * offset * side, w: 16.5, d: 2.6, angle: Math.atan2(tx, tz) - Math.PI / 2 };
    if (!fits(box, 6, 0.5)) continue;
    solids.push({ ...box, kind: "caminhao", height: 4, team: Math.floor(random() * 1000), front: random() < 0.5 ? 1 : -1 });
    placed++;
  }
}

// --- Cais: guindastes de pórtico ---------------------------------------------

/** Cais do porto: de onde a onde vai (x) e a faixa de terra entre o mar e a primeira rua. */
export interface Quay {
  z: number;
  minX: number;
  maxX: number;
  /** Quanto de terra livre há a partir do muro, em cada x (a cada 5 m a partir de minX). */
  depth: number[];
}

export let QUAY: Quay | null = null;
export const GANTRIES: GantrySpot[] = [];

/** Metros de terra livre a partir do muro do cais (até a primeira rua ou prédio). */
export function quayDepth(x: number) {
  let d = 0.5;
  while (d < 40 && !isOnRoad(x, QUAY_Z + d) && !insideBuilding(x, QUAY_Z + d)) d += 0.5;
  return d;
}

function buildQuay() {
  const porto = DISTRICTS.find((d) => d.id === "porto");
  if (!porto) return;
  // O trecho do contorno do bairro que encosta no mar.
  const onSea = porto.polygon.filter(([, z]) => Math.abs(z - QUAY_Z) < 1).map(([x]) => x);
  if (onSea.length < 2) return;
  const minX = Math.min(...onSea);
  const maxX = Math.max(...onSea);
  const depth: number[] = [];
  for (let x = minX; x <= maxX; x += 5) depth.push(quayDepth(x));
  QUAY = { z: QUAY_Z, minX, maxX, depth };
  // O maior trecho seguido com espaço para o pórtico (11,5 m de terra).
  let best = { from: 0, to: -1 };
  for (let i = 0; i < depth.length; i++) {
    if (depth[i] < 11.5) continue;
    let j = i;
    while (j + 1 < depth.length && depth[j + 1] >= 11.5) j++;
    if (j - i > best.to - best.from) best = { from: i, to: j };
    i = j;
  }
  const x0 = minX + best.from * 5 + 12;
  const x1 = minX + best.to * 5 - 12;
  if (x1 - x0 < 60) return;
  // Três guindastes no meio do trecho (onde atraca o porta-contêiner), 42 m um do outro.
  const mid = (x0 + x1) / 2;
  const count = Math.min(3, Math.floor((x1 - x0) / 42) + 1);
  for (let k = 0; k < count; k++) {
    const x = mid + (k - (count - 1) / 2) * 42;
    const spot: GantrySpot = { x, seaZ: QUAY_Z + 1.4, landZ: QUAY_Z + 10.2, halfSpan: 8 };
    GANTRIES.push(spot);
    for (const lx of [-spot.halfSpan, spot.halfSpan]) {
      for (const lz of [spot.seaZ, spot.landZ]) {
        solids.push({ x: x + lx, z: lz, w: 1.5, d: 1.5, angle: 0, kind: "guindaste", height: 30, team: 0, front: -1 });
      }
    }
  }
}

buildAutodromo();
buildCityTrucks();
buildQuay();

/** Todos os enfeites sólidos (o cliente desenha cada um pelo `kind`). */
export const SOLID_PROPS: readonly SolidProp[] = solids;
addObstacles(solids);
