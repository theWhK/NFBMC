// Porto Gordo gerada a partir da planta (map.ts). Tudo aqui é determinístico
// (mesma semente), para servidor e clientes enxergarem exatamente a mesma cidade:
// ruas, prédios e casas (com colisão), árvores, comida, corridas e o grafo de
// ruas que as viaturas usam para navegar.
import {
  AIRPORT,
  BOUNDS,
  DISTRICTS,
  EDGES,
  LAKE,
  NODES,
  QUAY_Z,
  RIVER,
  ROAD_WIDTH,
  ROUNDABOUTS,
  type DistrictId,
  type EdgeSpec,
  type RoadKind,
} from "./map.ts";
import { CAR, type CarMotion, type CarState } from "./physics.ts";
import { buildTrack, nearestSample, splinePath, type Track } from "./track.ts";
import { gradeAt, inRiver } from "./terrain.ts";
import {
  GROUND,
  STRUCTURES,
  UNDER_CLEARANCE,
  collideLevel,
  locate,
  nextLevel,
  pathLevels,
  polylineLength,
  sampleEdge,
  structureOf,
  surfaceGrade,
} from "./levels.ts";

export { AIRPORT, DISTRICTS, LAKE, QUAY_Z, RIVER, ROUNDABOUTS, type DistrictId } from "./map.ts";

/** Limites do mapa: muro invisível nas bordas e o cais ao sul. */
export const WORLD_BOUNDS = { minX: BOUNDS.minX + 10, maxX: BOUNDS.maxX - 10, minZ: QUAY_Z, maxZ: BOUNDS.maxZ - 10 } as const;

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
  /** Obra de arte (índice em STRUCTURES) ou GROUND (-1): rua comum, no chão. */
  structure: number;
}

/** Dentro da área cercada do aeroporto (sem prédios gerados nem ruas de ligação). */
export const insideAirport = (x: number, z: number, margin = 0) =>
  x > AIRPORT.area.minX - margin && x < AIRPORT.area.maxX + margin && z > AIRPORT.area.minZ - margin && z < AIRPORT.area.maxZ + margin;

/** No pátio dos aviões (asfalto: conta como rua). */
export const onAirportApron = (x: number, z: number) =>
  x > AIRPORT.apron.minX && x < AIRPORT.apron.maxX && z > AIRPORT.apron.minZ && z < AIRPORT.apron.maxZ;

/** Ilha no meio de uma rotatória (jardim com estátua: nada de prédio nem de rua). */
export function roundaboutIsland(x: number, z: number, margin = 0) {
  for (const ra of ROUNDABOUTS) {
    const island = ra.r - ROAD_WIDTH[ra.kind] / 2 - 1.5;
    if (Math.hypot(x - ra.x, z - ra.z) < island + margin) return ra;
  }
  return null;
}

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
const SPLIT_STEP: Partial<Record<DistrictId, number>> = { centro: 70, serra: 260, roca: 280, aeroporto: Infinity, autodromo: Infinity, parque: 300 };
/** Bairros de ruas tortas: ladeiras, vielas e estradas de terra. */
const WINDING = new Set<DistrictId>(["morro", "vila", "jardim", "picanha", "praia", "serra", "roca", "centro", "liberdade"]);
/** Na roça e na serra as ligações são estradas compridas, longe umas das outras. */
const RURAL = new Set<DistrictId>(["serra", "roca"]);
/** Comprimento máximo das ligações (m) por bairro (o padrão é 240). */
const MAX_LINK: Partial<Record<DistrictId, number>> = { centro: 150, liberdade: 200 };

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
  if (insideAirport(x, z, 20)) return true;
  if (inRiver(x, z, 22)) return true;
  if (roundaboutIsland(x, z, 10)) return true;
  return false;
}

/**
 * Cruzamentos que o desenho não marcou: onde duas ruas comuns da planta se
 * cruzam, as duas ganham um nó ali (a planta pode ter avenidas cortando o
 * bairro em qualquer ângulo). Uma ponta que cai no meio de outra rua vira
 * esquina em "T". As obras de arte ficam de fora (passam por cima ou por baixo).
 * Devolve, para cada aresta da planta, os cortes (parâmetro t da curva e o nó).
 */
function planarize(nodes: Record<string, Point>) {
  const cuts: { t: number; id: string }[][] = EDGES.map(() => []);
  const samples = EDGES.map((e) => sampleEdge(nodes[e.a], nodes[e.b], e.curve));
  const near = (p: Point, q: Point, d: number) => Math.hypot(p[0] - q[0], p[1] - q[1]) < d;
  let count = 0;
  /** Corta a aresta `i` no ponto mais perto de `p` (parâmetro t), com o nó `id`. */
  const cutAt = (i: number, p: Point, id: string) => {
    const pts = samples[i];
    let best = Infinity;
    let bt = 0;
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k];
      const [bx, bz] = pts[k + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const f = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(p[0] - ax - dx * f, p[1] - az - dz * f);
      if (d < best) {
        best = d;
        bt = (k + f) / (pts.length - 1);
      }
    }
    if (bt < 0.002 || bt > 0.998) return;
    if (cuts[i].some((c) => c.id === id)) return;
    cuts[i].push({ t: bt, id });
  };
  // Grade com os trechos de todas as ruas comuns (as obras de arte não cruzam ninguém).
  const G = 50;
  const grid = new Map<string, [number, number][]>();
  samples.forEach((pts, i) => {
    if (EDGES[i].structure) return;
    for (let k = 0; k < pts.length - 1; k++) {
      const keys = new Set<string>();
      for (const [x, z] of [pts[k], pts[k + 1]]) keys.add(`${Math.floor(x / G)},${Math.floor(z / G)}`);
      for (const key of keys) {
        const list = grid.get(key);
        if (list) list.push([i, k]);
        else grid.set(key, [[i, k]]);
      }
    }
  });
  // Ponta de uma rua no meio da outra: esquina em "T".
  EDGES.forEach((e, i) => {
    if (e.structure) return;
    for (const end of [e.a, e.b]) {
      const q = nodes[end];
      const gx = Math.floor(q[0] / G);
      const gz = Math.floor(q[1] / G);
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          for (const [j, k] of grid.get(`${gx + di},${gz + dj}`) ?? []) {
            if (j === i) continue;
            const other = EDGES[j];
            if (end === other.a || end === other.b) continue;
            const [ax, az] = samples[j][k];
            const [bx, bz] = samples[j][k + 1];
            const dx = bx - ax;
            const dz = bz - az;
            const f = Math.max(0, Math.min(1, ((q[0] - ax) * dx + (q[1] - az) * dz) / (dx * dx + dz * dz || 1)));
            if (Math.hypot(q[0] - ax - dx * f, q[1] - az - dz * f) < 9) cutAt(j, q, end);
          }
        }
      }
    }
  });
  // Cruzamento de verdade: duas ruas se cortam longe das pontas.
  const seen = new Set<string>();
  const found: { i: number; j: number; p: Point }[] = [];
  for (const list of grid.values()) {
    for (let m = 0; m < list.length; m++) {
      for (let n = m + 1; n < list.length; n++) {
        let [i, a] = list[m];
        let [j, b] = list[n];
        if (i === j) continue;
        if (i > j) [i, a, j, b] = [j, b, i, a];
        const key = `${i}:${a}:${j}:${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const [p0x, p0z] = samples[i][a];
        const [p1x, p1z] = samples[i][a + 1];
        const [q0x, q0z] = samples[j][b];
        const [q1x, q1z] = samples[j][b + 1];
        const rx = p1x - p0x;
        const rz = p1z - p0z;
        const sx = q1x - q0x;
        const sz = q1z - q0z;
        const den = rx * sz - rz * sx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((q0x - p0x) * sz - (q0z - p0z) * sx) / den;
        const u = ((q0x - p0x) * rz - (q0z - p0z) * rx) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const hit: Point = [p0x + rx * t, p0z + rz * t];
        const ei = EDGES[i];
        const ej = EDGES[j];
        if ([nodes[ei.a], nodes[ei.b], nodes[ej.a], nodes[ej.b]].some((e) => near(e, hit, 9))) continue;
        if (found.some((f) => f.i === i && f.j === j && near(f.p, hit, 10))) continue;
        found.push({ i, j, p: hit });
      }
    }
  }
  // Ordem fixa (a mesma no servidor e no cliente): pelas arestas e pela posição.
  found.sort((p, q) => p.i - q.i || p.j - q.j || p.p[0] - q.p[0] || p.p[1] - q.p[1]);
  for (const { i, j, p } of found) {
    const id = `x${count++}`;
    nodes[id] = p;
    cutAt(i, p, id);
    cutAt(j, p, id);
  }
  for (const list of cuts) list.sort((p, q) => p.t - q.t);
  return cuts;
}

function densify() {
  const random = seeded(4242);
  const nodes: Record<string, Point> = { ...NODES };
  const edges: EdgeSpec[] = [];
  /** Original "a|b" → sequência de nós depois de cortar (as corridas seguem por ela). */
  const chains = new Map<string, string[]>();
  const crossings = planarize(nodes);

  // 1. Cruzamentos novos no meio das ruas compridas (a rodovia, a pista e as obras ficam inteiras).
  EDGES.forEach((e, index) => {
    const a = NODES[e.a];
    const b = NODES[e.b];
    const c: Point = e.curve ?? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const district = districtAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    const whole = e.kind === "rodovia" || e.kind === "pista" || e.kind === "taxiway" || !!e.structure;
    const step = whole ? Infinity : SPLIT_STEP[district] ?? 100;
    // Pedaços entre os cruzamentos achados (e as pontas); cada um se corta de novo a cada `step`.
    const stops = [{ t: 0, id: e.a }, ...crossings[index], { t: 1, id: e.b }];
    const params: { t: number; id: string }[] = [stops[0]];
    for (let k = 0; k < stops.length - 1; k++) {
      const t0 = stops[k].t;
      const t1 = stops[k + 1].t;
      const length = polylineLength(sampleEdge(bezier(a, c, b, t0).p, bezier(a, c, b, t1).p, [
        bezier(a, c, b, t0).p[0] + (t1 - t0) * bezier(a, c, b, t0).d[0],
        bezier(a, c, b, t0).p[1] + (t1 - t0) * bezier(a, c, b, t0).d[1],
      ]));
      const parts = Number.isFinite(step) ? Math.max(1, Math.round(length / step)) : 1;
      for (let i = 1; i < parts; i++) {
        const t = t0 + ((t1 - t0) * i) / parts;
        const id = `${e.a}~${e.b}~${params.length}`;
        nodes[id] = bezier(a, c, b, t).p;
        params.push({ t, id });
      }
      params.push(stops[k + 1]);
    }
    const chain = [e.a];
    for (let i = 1; i < params.length; i++) {
      const t0 = params[i - 1].t;
      const t1 = params[i].t;
      const start = bezier(a, c, b, t0);
      const curve: Point | undefined = e.curve ? [start.p[0] + (t1 - t0) * start.d[0], start.p[1] + (t1 - t0) * start.d[1]] : undefined;
      edges.push({ ...e, a: params[i - 1].id, b: params[i].id, curve });
      chain.push(params[i].id);
    }
    chains.set(`${e.a}|${e.b}`, chain);
  });

  // Grade com os pedaços de todas as ruas, para checar se uma rua nova encosta em outra.
  type Piece = { ax: number; az: number; bx: number; bz: number; half: number; a: string; b: string };
  const grid = new Map<string, Piece[]>();
  const G = 60;
  const addPieces = (points: Point[], half: number, a: string, b: string) => {
    for (let i = 1; i < points.length; i++) {
      const piece = { ax: points[i - 1][0], az: points[i - 1][1], bx: points[i][0], bz: points[i][1], half, a, b };
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
    addPieces(points, ROAD_WIDTH[e.kind] / 2, e.a, e.b);
  };
  /** A rua nova (pontos de A até B) corta alguma rua que não sai de A nem de B? */
  const cuts = (points: Point[], ia: string, ib: string) => {
    for (let k = 1; k < points.length; k++) {
      const [p0x, p0z] = points[k - 1];
      const [p1x, p1z] = points[k];
      const seen = new Set<Piece>();
      for (const [x, z] of [points[k - 1], points[k]]) {
        for (const piece of grid.get(`${Math.floor(x / G)},${Math.floor(z / G)}`) ?? []) {
          if (seen.has(piece) || piece.a === ia || piece.b === ia || piece.a === ib || piece.b === ib) continue;
          seen.add(piece);
          const rx = p1x - p0x;
          const rz = p1z - p0z;
          const sx = piece.bx - piece.ax;
          const sz = piece.bz - piece.az;
          const den = rx * sz - rz * sx;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((piece.ax - p0x) * sz - (piece.az - p0z) * sx) / den;
          const u = ((piece.ax - p0x) * rz - (piece.az - p0z) * rx) / den;
          if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
        }
      }
    }
    return false;
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
    if (RURAL.has(district) ? span < 150 : span > (MAX_LINK[district] ?? 240)) continue;
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
    if (!ok || cuts(points, ia, ib)) continue;
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
    if (cuts(points, ia, ib)) return false;
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
  const structure = e.structure ? structureOf(e.a, e.b) : GROUND;
  return { a: e.a, b: e.b, kind: e.kind, width: ROAD_WIDTH[e.kind], points, length: polylineLength(points), structure };
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
  /** Nível do trecho: GROUND, ou a obra de arte (onde ela está fora do chão). */
  level: number;
}

const roadGrid = new Map<string, Segment[]>();
for (const [r, road] of ROADS.entries()) {
  for (let i = 1; i < road.points.length; i++) {
    const [ax, az] = road.points[i - 1];
    const [bx, bz] = road.points[i];
    let level = GROUND;
    if (road.structure >= 0) {
      const st = STRUCTURES[road.structure];
      const off = (k: number) => Math.abs(st.y[k] - st.ground[k]) > 0.3;
      if (off(i - 1) || off(i)) level = road.structure;
    }
    const segment = { ax, az, bx, bz, half: road.width / 2, road: r, index: i - 1, level };
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

/**
 * Distância até a borda da rua mais próxima (negativa = em cima da rua). Com
 * `level`, só as ruas daquele nível (GROUND: as do chão, sem os trechos
 * elevados das obras); sem ele, todas (para os prédios não ficarem embaixo
 * de um viaduto nem em cima de um túnel).
 */
function roadClearance(x: number, z: number, level?: number) {
  let best = Infinity;
  for (const s of roadGrid.get(cellKey(x, z)) ?? []) {
    if (level !== undefined && s.level !== level) continue;
    best = Math.min(best, distanceToSegment(x, z, s) - s.half);
  }
  return best;
}

// Pilares das pontes e dos viadutos: um a cada ~30 m onde dá para passar por
// baixo, fora das ruas de baixo (o vão fica livre para quem passa).
for (const st of STRUCTURES) {
  if (st.kind === "tunel") continue;
  let last = -Infinity;
  for (let i = 0; i < st.points.length; i++) {
    const gapHere = st.y[i] - st.ground[i];
    if (st.s[i] < st.sIn || st.s[i] > st.sOut || gapHere < UNDER_CLEARANCE || st.s[i] - last < 30) continue;
    const [x, z] = st.points[i];
    if (roadClearance(x, z, GROUND) < 2.5) continue;
    st.pillars.push({ x, z, r: st.width > 18 ? 1.6 : 1.1 });
    last = st.s[i];
  }
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

/**
 * O carro está numa rua ou na pista do autódromo? Fora disso é calçada/grama
 * (mais lento). Em cima de uma obra de arte é sempre rua (o guarda-corpo segura).
 */
export function isOnRoad(x: number, z: number, level: number = GROUND) {
  if (level >= 0) return true;
  return roadClearance(x, z, GROUND) <= 1 || autodromoClearance(x, z) <= 1 || onApron(x, z) || onAirportApron(x, z) || onPaved(x, z);
}

/** Chão asfaltado que vem de outros arquivos (a pista dos boxes do autódromo, em props.ts). */
const paved: Box[] = [];
const onPaved = (x: number, z: number) =>
  paved.some((b) => Math.abs(b.x - x) < b.w + b.d && Math.abs(b.z - z) < b.w + b.d && insideBox(b, x, z, 0.5));

/** Soma chão asfaltado (conta como rua no `isOnRoad`). Chamar ao carregar o módulo, igual no servidor e no cliente. */
export function addPaved(boxes: Box[]) {
  paved.push(...boxes);
}

const insideLake = (x: number, z: number, margin = 0) =>
  ((x - LAKE.x) / (LAKE.rx + margin)) ** 2 + ((z - LAKE.z) / (LAKE.rz + margin)) ** 2 < 1;

/** Lago, rio ou mar. */
export const insideWater = (x: number, z: number, margin = 0) => insideLake(x, z, margin) || inRiver(x, z, margin) || z < QUAY_Z + margin;

// --- Prédios, casas, galpões e contêineres ----------------------------------

/** "landmark": lanchonete ou garagem (o cliente desenha cada uma; ver LANDMARKS). */
export type BuildingKind = "tower" | "office" | "shop" | "house" | "warehouse" | "container" | "landmark";

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
  // Centro: quarteirões cheios, torres altas perto da Rotatória do Hambúrguer.
  centro: {
    kind: (r, dist) => (dist < 230 && r() < 0.8 ? "tower" : r() < 0.25 ? "shop" : "office"),
    width: [12, 24],
    depth: [12, 22],
    height: (kind, r, dist) => (kind === "tower" ? 50 + r() ** 1.3 * 130 * Math.max(0.25, 1 - dist / 420) : kind === "shop" ? 8 + r() * 5 : 20 + r() * 38),
    gap: [1, 3],
    setback: 3,
    rows: 3,
    tints: 4,
    center: [-20, -20],
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
    center: [0, 1180],
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

// --- Lanchonetes e garagens ----------------------------------------------------

/**
 * Lugares especiais na beira das ruas: as lanchonetes (paródias das redes de
 * fast-food, com drive-thru: é ali que se come no mundo aberto) e as garagens
 * (esconderijos: parar no pátio abre a oficina e, despistando a Vigilância,
 * entrar numa garagem encerra a perseguição).
 */
export type LandmarkKind = "garagem" | "mcgordos" | "burgerkilo" | "subgordo" | "outbacon";

export const LANDMARK_NAMES: Record<LandmarkKind, string> = {
  garagem: "Garagem",
  mcgordos: "McGordo's",
  burgerkilo: "Burger Kilo",
  subgordo: "Subgordo",
  outbacon: "Outbacon Steakhouse",
};

export type Box = { x: number; z: number; w: number; d: number; angle: number };

export interface Landmark extends Box {
  id: string;
  kind: LandmarkKind;
  name: string;
  /** Lado da caixa virado para a rua (como em Building). */
  front: number;
  /** Pátio asfaltado entre a rua e a fachada (estacionamento, drive-thru, porta da garagem). */
  apron: Box;
  /** Rumo de quem olha da fachada para a rua. */
  facing: number;
}

/** Medidas de cada tipo: largura ao longo da rua, fundo e o pátio na frente. */
const LANDMARK_SIZE: Record<LandmarkKind, { w: number; d: number; apron: number }> = {
  garagem: { w: 16, d: 14, apron: 12 },
  mcgordos: { w: 22, d: 16, apron: 13 },
  burgerkilo: { w: 22, d: 16, apron: 13 },
  subgordo: { w: 16, d: 13, apron: 11 },
  outbacon: { w: 26, d: 18, apron: 13 },
};

/** Onde cada um tenta ficar (tipo, bairro, nome). */
const LANDMARK_WISHES: [LandmarkKind, DistrictId, string?][] = [
  ["garagem", "centro", "Garagem do Centro"],
  ["garagem", "vila", "Garagem da Vila"],
  ["garagem", "industrial", "Oficina da Gordura Trans"],
  ["garagem", "praia", "Garagem da Praia"],
  ["garagem", "liberdade", "Garagem da Liberdade"],
  ["garagem", "picanha", "Garagem do Alto"],
  ["garagem", "porto", "Galpão do Porto"],
  ["mcgordos", "centro"], ["mcgordos", "praia"], ["mcgordos", "jardim"], ["mcgordos", "liberdade"],
  ["burgerkilo", "vila"], ["burgerkilo", "industrial"], ["burgerkilo", "praia"],
  ["subgordo", "centro"], ["subgordo", "morro"], ["subgordo", "picanha"],
  ["outbacon", "jardim"], ["outbacon", "porto"], ["outbacon", "liberdade"],
];

/** O ponto está dentro da caixa (com folga)? */
function insideBox(b: Box, x: number, z: number, margin = 0) {
  const dx = x - b.x;
  const dz = z - b.z;
  const lw = dx * Math.cos(b.angle) - dz * Math.sin(b.angle);
  const ld = dx * Math.sin(b.angle) + dz * Math.cos(b.angle);
  return Math.abs(lw) <= b.w / 2 + margin && Math.abs(ld) <= b.d / 2 + margin;
}

const insideWorld = (x: number, z: number, margin: number) =>
  x > WORLD_BOUNDS.minX + margin && x < WORLD_BOUNDS.maxX - margin && z > WORLD_BOUNDS.minZ + margin && z < WORLD_BOUNDS.maxZ - margin;

function generateCity() {
  const random = seeded(2005);
  const buildings: Building[] = [];
  const trees: Tree[] = [];
  const buildingGrid = new Map<string, Building[]>();
  const landmarks: Landmark[] = [];
  /** Lotes das lanchonetes e garagens (prédio + pátio): nada de prédio nem árvore em cima. */
  const reserved: Box[] = [];

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
      if (!insideWorld(x, z, 4) || roadClearance(x, z) < roadMargin || autodromoClearance(x, z) < 10 || insideWater(x, z, 6)) return false;
      if (insideAirport(x, z, 4) || roundaboutIsland(x, z, 4)) return false;
    }
    return !nearby(b.x, b.z).some((other) => overlaps(b, other, 2)) && !reserved.some((r) => overlaps(b as Building, r as Building, 2));
  };
  const add = (b: Building) => {
    buildings.push(b);
    const key = cellKey(b.x, b.z);
    const list = buildingGrid.get(key);
    if (list) list.push(b);
    else buildingGrid.set(key, [b]);
  };

  // Lanchonetes e garagens primeiro (elas escolhem o lugar; os lotes comuns desviam).
  const spotRandom = seeded(4242);
  const candidates = ROADS.filter((r) => (r.kind === "avenida" || r.kind === "rua") && r.length > 90 && r.structure < 0);
  for (const [kind, district, name] of LANDMARK_WISHES) {
    const size = LANDMARK_SIZE[kind];
    const roads = candidates.filter((r) => districtAt(...r.points[Math.floor(r.points.length / 2)]) === district);
    let placed: Landmark | null = null;
    for (let attempt = 0; attempt < 60 && roads.length && !placed; attempt++) {
      const road = roads[Math.floor(spotRandom() * roads.length)];
      // Longe das pontas (cruzamentos): um ponto no meio da quadra.
      const k = Math.floor((0.3 + spotRandom() * 0.4) * (road.points.length - 1));
      const [ax, az] = road.points[k];
      const [bx, bz] = road.points[Math.min(road.points.length - 1, k + 1)];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const tx = (bx - ax) / len;
      const tz = (bz - az) / len;
      const side = spotRandom() < 0.5 ? -1 : 1;
      const nx = tz * side;
      const nz = -tx * side;
      const angle = Math.atan2(tx, tz) + Math.PI / 2;
      const offset = road.width / 2 + size.apron + size.d / 2;
      const b: Building = {
        x: ax + nx * offset, z: az + nz * offset, w: size.w, d: size.d, angle,
        height: kind === "garagem" ? 7 : 6, kind: "landmark", tint: 0, front: -side,
      };
      const apronOffset = road.width / 2 + size.apron / 2;
      const apron: Box = { x: ax + nx * apronOffset, z: az + nz * apronOffset, w: size.w + 4, d: size.apron, angle };
      const lot: Box = { x: (b.x + apron.x) / 2, z: (b.z + apron.z) / 2, w: size.w + 6, d: size.d + size.apron, angle };
      if (districtAt(b.x, b.z) !== district || !free(b, 6)) continue;
      // O pátio não pode encostar em outra rua (só na da frente) nem em prédio.
      const apronPoints: Point[] = [-1, 0, 1].flatMap((u) => [-0.3, 0.45].map((v) => [
        apron.x + Math.cos(angle) * u * (apron.w / 2) + Math.sin(angle) * v * apron.d * side,
        apron.z - Math.sin(angle) * u * (apron.w / 2) + Math.cos(angle) * v * apron.d * side,
      ] as Point));
      if (apronPoints.some(([x, z]) => roadClearance(x, z) < -1 && Math.abs(distanceAlong(road, x, z)) > road.width / 2 + 1)) continue;
      if (nearby(apron.x, apron.z).some((o) => overlaps(apron as Building, o, 1))) continue;
      if (landmarks.some((l) => Math.hypot(l.x - b.x, l.z - b.z) < (l.kind === kind ? 400 : 90))) continue;
      placed = {
        ...b, id: `${kind}-${landmarks.length}`, kind, name: name ?? LANDMARK_NAMES[kind], apron,
        facing: Math.atan2(-nx, -nz),
      };
      add(b);
      reserved.push(lot);
    }
    if (placed) landmarks.push(placed);
  }

  // Lotes ao longo das ruas, dos dois lados, de frente para a rua.
  for (const road of ROADS) {
    const total = road.length;
    for (const side of [-1, 1]) {
      for (let row = 0; row < 3; row++) {
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
          const tunnel = road.structure >= 0 && STRUCTURES[road.structure].kind === "tunel";
          const style = road.kind === "pista" || road.kind === "taxiway" || tunnel ? undefined : STYLES[districtAt(probeX, probeZ)];
          if (!style || row >= style.rows) {
            s += 12;
            continue;
          }
          const [cx, cz] = style.center ?? [-40, -40];
          const distFromCenter = Math.hypot(px - cx, pz - cz);
          const kind = style.kind(random, distFromCenter);
          const w = between(random, style.width);
          const d = between(random, style.depth);
          const offset = road.width / 2 + style.setback + d / 2 + row * (style.depth[1] + (style.rows > 2 ? 4 : 8));
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
              if (roadClearance(tx2, tz2) > 3 && !reserved.some((r) => insideBox(r, tx2, tz2, 3)) && !nearby(tx2, tz2).some((o) => Math.hypot(o.x - tx2, o.z - tz2) < Math.max(o.w, o.d) / 2 + 2)) {
                trees.push({ x: tx2, z: tz2, size: 0.8 + random() * 0.6 });
              }
            }
          }
          s += w + between(random, style.gap);
        }
      }
    }
  }

  // Miolo dos quarteirões do centro e da Liberdade: prédios onde sobrou espaço,
  // alinhados com a rua mais perto (o quarteirão fica cheio, sem terreno baldio).
  for (const [district, tries] of [["centro", 9000], ["liberdade", 9000]] as [DistrictId, number][]) {
    const style = STYLES[district]!;
    const box = DISTRICTS.find((d) => d.id === district)!.polygon;
    const minX = Math.min(...box.map((p) => p[0]));
    const maxX = Math.max(...box.map((p) => p[0]));
    const minZ = Math.min(...box.map((p) => p[1]));
    const maxZ = Math.max(...box.map((p) => p[1]));
    const [cx, cz] = style.center ?? [-40, -40];
    for (let k = 0; k < tries; k++) {
      const x = minX + random() * (maxX - minX);
      const z = minZ + random() * (maxZ - minZ);
      if (districtAt(x, z) !== district) continue;
      const dist = Math.hypot(x - cx, z - cz);
      // Na Liberdade, o miolo cheio é só perto da praça (longe dela os quarteirões são mais abertos).
      if (district === "liberdade" && dist > 330 + random() * 120) continue;
      const near = roadGrid.get(cellKey(x, z));
      let angle = random() * Math.PI;
      if (near?.length) {
        const seg = near[0];
        angle = Math.atan2(seg.bx - seg.ax, seg.bz - seg.az) + Math.PI / 2;
      }
      const kind = style.kind(random, dist);
      const b: Building = {
        x, z, w: between(random, style.width), d: between(random, style.depth), angle,
        height: style.height(kind, random, dist), kind, tint: Math.floor(random() * style.tints), front: 1,
      };
      if (free(b, style.setback)) add(b);
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
      if (roadClearance(x, z) < 4 || autodromoClearance(x, z) < 8 || insideWater(x, z, 4) || insideAirport(x, z) || roundaboutIsland(x, z, 2)) continue;
      if (reserved.some((r) => insideBox(r, x, z, 3))) continue;
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
  return { buildings, trees, buildingGrid, landmarks };
}

/** Distância (com sinal) de um ponto até o eixo da rua, medida no trecho mais perto. */
function distanceAlong(road: Road, x: number, z: number) {
  let best = Infinity;
  for (let i = 1; i < road.points.length; i++) {
    const [ax, az] = road.points[i - 1];
    const [bx, bz] = road.points[i];
    best = Math.min(best, distanceToSegment(x, z, { ax, az, bx, bz, half: 0, road: 0, index: 0, level: GROUND }));
  }
  return best;
}

const city = generateCity();
export const BUILDINGS = city.buildings;
export const TREES = city.trees;
/** Lanchonetes e garagens da cidade (com o prédio já na colisão, como kind "landmark"). */
export const LANDMARKS = city.landmarks;
export const GARAGES = LANDMARKS.filter((l) => l.kind === "garagem");

/** Garagem cujo pátio contém o ponto (para entrar nela parado). */
export function garageAt(x: number, z: number) {
  return GARAGES.find((g) => insideBox(g.apron, x, z, 1)) ?? null;
}

/** O ponto está no pátio asfaltado de alguma lanchonete ou garagem? */
const onApron = (x: number, z: number) =>
  LANDMARKS.some((l) => Math.abs(l.apron.x - x) < 25 && Math.abs(l.apron.z - z) < 25 && insideBox(l.apron, x, z, 0.5));

const treeGrid = new Map<string, Tree[]>();
for (const tree of TREES) {
  const key = cellKey(tree.x, tree.z);
  const list = treeGrid.get(key);
  if (list) list.push(tree);
  else treeGrid.set(key, [tree]);
}

/**
 * Tira as árvores de dentro das caixas (com folga), para outros arquivos
 * abrirem espaço (a área dos boxes do autódromo, em props.ts). Chamar ao
 * carregar o módulo, antes de o cliente desenhar as árvores.
 */
export function clearTrees(boxes: Box[], margin = 2) {
  const doomed = new Set(TREES.filter((t) => boxes.some((b) => insideBox(b, t.x, t.z, margin + 0.7 * t.size))));
  if (!doomed.size) return;
  const kept = TREES.filter((t) => !doomed.has(t));
  TREES.length = 0;
  TREES.push(...kept);
  for (const [key, list] of treeGrid) treeGrid.set(key, list.filter((t) => !doomed.has(t)));
}

function nearbyBuildings(x: number, z: number) {
  const out: Building[] = [];
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) out.push(...(city.buildingGrid.get(cellKey(x + i * CELL, z + j * CELL)) ?? []));
  return out;
}

/**
 * Caixas sólidas que vêm de outros arquivos (arquibancadas, caminhões das
 * equipes, pés dos guindastes do cais: shared/src/props.ts). Entram na colisão
 * e na linha de visão, mas não no desenho dos prédios (BUILDINGS).
 */
export function addObstacles(boxes: (Box & { height: number })[]) {
  for (const box of boxes) {
    const b: Building = { ...box, kind: "landmark", tint: 0, front: 1 };
    const key = cellKey(b.x, b.z);
    const list = city.buildingGrid.get(key);
    if (list) list.push(b);
    else city.buildingGrid.set(key, [b]);
  }
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
 * Com `motion`, também acompanha o nível do carro (`motion.level`) e bate nas
 * obras de arte (ver levels.ts); passe sempre o `motion` de cada carro.
 * Retorna true se bateu.
 */
export function collideWorld(car: CarState, halfLength: number = CAR.halfLength, halfWidth: number = CAR.halfWidth, motion?: CarMotion): boolean {
  let hit = false;
  // Nível (chão, ponte, viaduto, túnel): troca só nas pontas das obras. Sem
  // `motion` não dá para saber o nível (quem chama não guarda): aí as paredes
  // das obras (guarda-corpo, rampa, galeria do túnel) ficam de fora, senão um
  // carro entrando no túnel bateria na boca como se estivesse no chão.
  const level = motion ? (motion.level = nextLevel(car.x, car.z, motion.level ?? GROUND)) : GROUND;
  if (motion && collideLevel(car, level, halfLength, halfWidth, motion)) hit = true;
  if (level >= 0) {
    // Em cima da ponte (ou dentro do túnel) não há prédio, árvore nem água para bater.
    return clampBounds(car) || hit;
  }
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
  if (inRiver(car.x, car.z)) {
    // Para a margem mais perto.
    const [cx, cz, half] = riverNearest(car.x, car.z);
    const dx = car.x - cx;
    const dz = car.z - cz;
    const d = Math.hypot(dx, dz) || 1;
    car.x = cx + (dx / d) * (half + 0.5);
    car.z = cz + (dz / d) * (half + 0.5);
    car.speed *= 0.3;
    hit = true;
  }
  // Ilha da rotatória (jardim com a estátua): dá a volta nela.
  const island = roundaboutIsland(car.x, car.z, halfWidth);
  if (island) {
    const r = island.r - ROAD_WIDTH[island.kind] / 2 - 1.5 + halfWidth;
    const dx = car.x - island.x;
    const dz = car.z - island.z;
    const d = Math.hypot(dx, dz) || 1;
    const nx = dx / d;
    const nz = dz / d;
    car.x = island.x + nx * r;
    car.z = island.z + nz * r;
    car.speed *= 1 - 0.6 * Math.abs(Math.sin(car.heading) * nx + Math.cos(car.heading) * nz);
    hit = true;
  }
  return clampBounds(car) || hit;
}

/** Ponto do eixo do rio mais perto e a meia largura ali. */
function riverNearest(x: number, z: number): [number, number, number] {
  let best = Infinity;
  let out: [number, number, number] = [x, z, 0];
  const pts = RIVER.points;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d;
      out = [px, pz, (RIVER.width[i - 1] + (RIVER.width[i] - RIVER.width[i - 1]) * t) / 2];
    }
  }
  return out;
}

/** Muro invisível nas bordas do mapa. */
function clampBounds(car: CarState) {
  const { minX, maxX, minZ, maxZ } = WORLD_BOUNDS;
  if (car.x < minX || car.x > maxX || car.z < minZ || car.z > maxZ) {
    car.x = Math.max(minX, Math.min(maxX, car.x));
    car.z = Math.max(minZ, Math.min(maxZ, car.z));
    car.speed *= -0.3;
    return true;
  }
  return false;
}

/** Rampa na direção do carro, no nível dele (chão ou obra de arte). */
export function carGrade(car: CarState, motion?: CarMotion) {
  return surfaceGrade(car.x, car.z, car.heading, motion?.level ?? GROUND, () => gradeAt(car.x, car.z, car.heading));
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

/**
 * Rua mais próxima de um ponto e em que trecho dela (índice do ponto). Com
 * `level`, só as ruas daquele nível (em cima de uma ponte, a própria ponte;
 * no chão, as do chão), se houver alguma perto.
 */
export function nearestRoad(x: number, z: number, level?: number) {
  let best: Segment | null = null;
  let bestDist = Infinity;
  const candidates = roadGrid.get(cellKey(x, z));
  let pool = candidates && candidates.length ? candidates : [...roadGrid.values()].flat();
  if (level !== undefined) {
    const own = pool.filter((s) => (level >= 0 ? ROADS[s.road].structure === level : s.level === GROUND));
    if (own.length) pool = own;
  }
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
 * `fromLevel`: o nível de quem sai de A (ver `nearestRoad`).
 */
export function routeBetween(ax: number, az: number, bx: number, bz: number, fromLevel?: number): Point[] {
  // Saindo de cima de uma ponte, a rua de partida é a própria ponte (não a de baixo).
  const from = nearestRoad(ax, az, fromLevel);
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
  | "praia" | "picanha" | "yakisoba" | "aeroporto" | "serra" | "gordura" | "roca" | "morro" | "rodoanel" | "serpentina"
  | "elevado" | "foz" | "tunel-torresmo" | "cebola" | "acucar" | "lago" | "pontes" | "terminal"
  | "radar-porto" | "radar-yakisoba" | "radar-rodoanel"
  | "arrancada";

/** Arrancada: onde fica a linha de largada no traçado, a distância e as faixas. */
export interface DragInfo {
  /** Metros do começo do traçado até a linha de largada. */
  start: number;
  /** Distância da prova (402 m, o quarto de milha, se couber na pista). */
  distance: number;
  /** Deslocamento lateral (m) de cada faixa (positivo = esquerda). */
  lanes: number[];
}

export interface RaceInfo {
  id: RaceId;
  name: string;
  laps: number;
  track: Track;
  /**
   * Circuito (vence quem chega primeiro), radar (speedtrap: desafio solo com
   * metas de velocidade somada nos radares) ou drag (arrancada em linha reta,
   * câmbio manual, dois carros lado a lado).
   */
  kind?: "circuito" | "radar" | "drag";
  /** Radares: distância (m) de cada um desde a largada, numa volta. */
  radars?: number[];
  /** Arrancada: largada, distância e faixas (o traçado é aberto, uma reta). */
  drag?: DragInfo;
}

/**
 * Onde ficam os radares de um speedtrap: a pista é dividida em `count` trechos
 * e, em cada um, o radar vai no ponto mais reto (onde dá para passar voando).
 */
function radarSpots(track: Track, count: number) {
  const samples = track.samples;
  const n = samples.length;
  const span = 6;
  const straightness = (i: number) => {
    const a = samples[(i - span + n) % n];
    const b = samples[(i + span) % n];
    return a.tx * b.tx + a.tz * b.tz;
  };
  const spots: number[] = [];
  // Não põe radar logo na largada nem colado na chegada.
  const first = Math.floor(n * 0.08);
  const usable = n - first * 2;
  for (let k = 0; k < count; k++) {
    // Só no miolo de cada trecho, para dois radares não ficarem colados na divisa.
    const from = first + Math.floor((usable * (k + 0.2)) / count);
    const to = first + Math.floor((usable * (k + 0.8)) / count);
    let best = from;
    for (let i = from; i < to; i++) {
      // Mais reto e olhando também o trecho de frente (para chegar embalado).
      if (straightness(i) + straightness(i - 20) > straightness(best) + straightness(best - 20)) best = i;
    }
    spots.push(samples[best].dist);
  }
  return spots;
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
  const track = buildTrack(smooth, width);
  // Nível de cada amostra (em cima de uma ponte, dentro de um túnel...).
  track.levels = pathLevels(track.samples);
  return track;
}

// As corridas de radar entram logo abaixo (speedtrap), por isso o "as".
const PORTO_ROUTE = ["P2", "P3", "P4", "R1", "SE1", "RT2", "RT3", "C1"];
const YAKISOBA_ROUTE = ["O0", "O1", "O2", "O3", "O4", "O5", "O6", "O7", "O8", "O9", "O10", "O11"];
const RODOANEL_ROUTE = [
  "HW1", "HW2", "HW3", "HW4", "HN0", "HN1", "HNm", "HN2", "HN3", "HN4", "HE4", "HE3", "AEE", "HE2", "HE1",
  "PE2", "PE1", "PE0", "P5", "P4", "P3", "P2", "P1", "BM4", "BM3", "BM2", "BM1", "BM0",
];

export const RACES = {
  autodromo: { id: "autodromo", name: "Autódromo do Colesterol", laps: 3, track: AUTODROMO_TRACK },
  centro: { id: "centro", name: "Circuito do Centro", laps: 2, track: routeTrack(["RT1", "E1", "R2", "D3", "NE1", "C3", "RT0"], 16) },
  porto: { id: "porto", name: "Volta do Porto", laps: 2, track: routeTrack(PORTO_ROUTE, 18) },
  pastel: { id: "pastel", name: "Rota do Pastel", laps: 2, track: routeTrack(["W0", "V3", "V2", "V1", "V0"], 15) },
  parque: { id: "parque", name: "Volta do Lago", laps: 2, track: routeTrack(["Q0", "Q1", "QS", "Q2", "Q3", "Q4", "QN", "Q5"], 15) },
  // Bairros em volta: corridas mais largas e com curvas abertas.
  praia: { id: "praia", name: "Volta da Praia", laps: 2, track: routeTrack(["BM0", "BM1", "BM2", "BM3", "PR3", "PR2", "PR1", "PR0"], 20) },
  morro: { id: "morro", name: "Ladeira do Torresmo", laps: 2, track: routeTrack(["MB0", "ME", "MI", "MJ", "MF", "MA"], 15) },
  picanha: { id: "picanha", name: "Alto da Picanha", laps: 2, track: routeTrack(["AP0", "AP1", "AP2", "AP5", "AP4", "AP3"], 15) },
  yakisoba: { id: "yakisoba", name: "Circuito do Yakisoba", laps: 1, track: routeTrack(YAKISOBA_ROUTE, 18) },
  aeroporto: { id: "aeroporto", name: "Pista do Aeroporto", laps: 2, track: routeTrack(["AE5", "AE4", "TW1", "TW0"], 24) },
  serra: { id: "serra", name: "Subida da Serra", laps: 2, track: routeTrack(["SA", "SB", "SC", "SD", "SF", "SE"], 15) },
  gordura: { id: "gordura", name: "Circuito da Gordura Trans", laps: 2, track: routeTrack(["I00", "I10", "I20", "I21", "I22", "I12", "I02", "I01"], 18) },
  roca: { id: "roca", name: "Estrada da Roça", laps: 2, track: routeTrack(["RO0", "RO1", "RO2", "RO3"], 15) },
  serpentina: { id: "serpentina", name: "Serpentina do Açúcar", laps: 2, track: routeTrack(["SC", "SZ1", "SZ2", "SZ3", "HN0", "HN1", "SD"], 15) },
  // O anel inteiro da rodovia (e a beira-mar): uma volta só, de ~13 km, com o Viaduto da Cebola e a Ponte da Foz.
  rodoanel: { id: "rodoanel", name: "Rodoanel de Cebola", laps: 1, track: routeTrack(RODOANEL_ROUTE, 24) },
  // --- Obras de arte: pontes, viadutos e túneis ---
  // Por cima do centro no Elevado Costelão e de volta pela beira-mar.
  elevado: { id: "elevado", name: "Elevado Costelão", laps: 2, track: routeTrack(["EL0", "EL1", "PA5", "PA4", "P3", "P2", "P1", "V0", "V4"], 20) },
  // As duas pontes da foz do Rio Banha: a da beira-mar e a do Torresmo.
  foz: { id: "foz", name: "Travessia da Foz", laps: 2, track: routeTrack(["BM3", "BM4", "PA0", "V1", "V2", "MB0", "PR3"], 18) },
  // Por dentro do morro e de volta pelas ladeiras.
  "tunel-torresmo": { id: "tunel-torresmo", name: "Túnel do Torresmo", laps: 2, track: routeTrack(["TT0", "TT1", "MJ", "MI", "ME", "MB0", "MA"], 18) },
  // O Rodoanel por cima do Distrito e de volta pela Avenida da Gordura.
  cebola: { id: "cebola", name: "Viaduto da Cebola", laps: 2, track: routeTrack(["HE1", "PE2", "I30", "I31", "I41"], 22) },
  // A Estrada da Serra por dentro do Pico do Açúcar, um pedaço do Rodoanel e a volta pela serra.
  acucar: { id: "acucar", name: "Túnel do Açúcar", laps: 2, track: routeTrack(["SA", "TS0", "TS1", "HNm", "HN2", "SF", "SE"], 18) },
  // Curtinha: atravessa o lago pela ponte e dá a volta pela alameda.
  lago: { id: "lago", name: "Ponte do Lago", laps: 3, track: routeTrack(["QS", "QN", "Q5", "Q0", "Q1"], 15) },
  // A Ponte Norte e a da Picanha, de um lado e do outro do rio.
  pontes: { id: "pontes", name: "Pontes do Rio Banha", laps: 2, track: routeTrack(["MC", "N0", "J7", "K0", "AP0", "MD"], 18) },
  // Em volta do aeroporto: embarque, Rodoanel e a rua do perímetro.
  terminal: { id: "terminal", name: "Volta do Terminal", laps: 1, track: routeTrack(["AT0", "AT1", "AT2", "AT3", "HE3", "AEE", "AE2", "AE1", "AE0", "AW"], 20) },
} as Record<RaceId, RaceInfo>;

// Speedtraps: as mesmas ruas de algumas corridas, no sentido contrário (o ponto de
// encontro fica do outro lado da largada), com radares nos trechos mais retos.
function speedtrap(id: RaceId, name: string, ids: string[], width: number, laps: number, radars: number) {
  const track = routeTrack([...ids].reverse(), width);
  RACES[id] = { id, name, laps, track, kind: "radar", radars: radarSpots(track, radars) };
}
speedtrap("radar-porto", "Radar do Porto", PORTO_ROUTE, 18, 1, 4);
speedtrap("radar-yakisoba", "Radar da Liberdade", YAKISOBA_ROUTE, 18, 1, 4);
speedtrap("radar-rodoanel", "Radar do Rodoanel", RODOANEL_ROUTE, 24, 1, 6);

// Arrancada: a reta de tipo "pista" da planta (a do Aeroporto do Pastel). Tudo
// sai da rua (nós e pontos), sem coordenada fixa: se a pista mudar de lugar ou
// de tamanho, a arrancada vai junto.
/** Espaço depois da chegada para frear (m). */
const DRAG_RUNOFF = 170;
function dragStrip(): { track: Track; drag: DragInfo } {
  const strip = ROADS.filter((r) => r.kind === "pista").sort((a, b) => b.length - a.length)[0];
  if (!strip) throw new Error("Arrancada: não há rua de tipo pista na planta");
  // Larga depois do cruzamento da ponta (a rua mais larga que chega nela) e do tamanho do carro.
  const crossing = Math.max(0, ...ROADS.filter((r) => r !== strip && (r.a === strip.a || r.b === strip.a)).map((r) => r.width / 2));
  const start = crossing + 12;
  const room = strip.length - start - DRAG_RUNOFF;
  const distance = room >= 402 ? 402 : room >= 201 ? 201 : Math.max(100, Math.floor(room / 10) * 10);
  // Amostras a cada ~1,6 m ao longo da rua (aberta: sem fechar o circuito).
  const cumulative = [0];
  for (let i = 1; i < strip.points.length; i++) {
    const [ax, az] = strip.points[i - 1];
    const [bx, bz] = strip.points[i];
    cumulative.push(cumulative[i - 1] + Math.hypot(bx - ax, bz - az));
  }
  const length = cumulative[cumulative.length - 1];
  const count = Math.max(2, Math.round(length / 1.6));
  const positions: Point[] = [];
  let seg = 0;
  for (let k = 0; k <= count; k++) {
    const target = (k / count) * length;
    while (seg < cumulative.length - 2 && cumulative[seg + 1] < target) seg++;
    const [ax, az] = strip.points[seg];
    const [bx, bz] = strip.points[seg + 1];
    const t = (target - cumulative[seg]) / (cumulative[seg + 1] - cumulative[seg] || 1);
    positions.push([ax + (bx - ax) * t, az + (bz - az) * t]);
  }
  const samples = positions.map(([x, z], i) => {
    const [px, pz] = positions[Math.max(0, i - 1)];
    const [nx, nz] = positions[Math.min(positions.length - 1, i + 1)];
    const len = Math.hypot(nx - px, nz - pz) || 1;
    return { x, z, tx: (nx - px) / len, tz: (nz - pz) / len, dist: (i / count) * length };
  });
  const lane = Math.min(4.5, strip.width / 4);
  return { track: { samples, length, width: strip.width }, drag: { start, distance, lanes: [lane, -lane] } };
}
{
  const { track, drag } = dragStrip();
  RACES.arrancada = { id: "arrancada", name: "Arrancada do Aeroporto", laps: 1, track, kind: "drag", drag };
}

export const RACE_IDS = Object.keys(RACES) as RaceId[];

/** Nome da corrida com a preposição certa: "no Circuito do Centro", "na Volta do Lago". */
export const atRace = (id: RaceId) => `${/^(Volta|Rota|Ladeira|Subida|Pista|Estrada|Rodovia|Serpentina|Travessia|Ponte|Pontes|Arrancada)\b/.test(RACES[id].name) ? "na" : "no"} ${RACES[id].name}`;

export const isRaceId = (value: unknown): value is RaceId =>
  typeof value === "string" && value in RACES;

/** Raio do ponto de encontro de cada corrida no mundo aberto. */
export const MARKER_RADIUS = 18;

/** Onde fica o ponto de encontro: um pouco antes da linha de largada. */
export function raceMarker(id: RaceId) {
  const track = RACES[id].track;
  const drag = RACES[id].drag;
  if (drag) {
    // Arrancada: do lado da linha de largada, fora das faixas (a reta é aberta).
    const i = Math.min(track.samples.length - 1, Math.round((drag.start / track.length) * (track.samples.length - 1)));
    const s = track.samples[i];
    const side = Math.min(track.width / 2 - 4, 14);
    return { x: s.x + s.tz * side, z: s.z - s.tx * side, heading: Math.atan2(s.tx, s.tz) };
  }
  const s = track.samples[track.samples.length - Math.round(30 / (track.length / track.samples.length))];
  return { x: s.x, z: s.z, heading: Math.atan2(s.tx, s.tz) };
}

// --- Nascimento e comida -----------------------------------------------------

/** Onde se nasce no mundo aberto: no meio de ruas do centro, de frente para a rua. */
export const SPAWNS = (["CB2", "CC2", "CB3", "CC3"] as const).map((id) => {
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
  /** Lanchonete do drive-thru. */
  landmark: string;
}

/** O que sai em cada drive-thru (cada rede tem o seu carro-chefe). */
const STAND_FOOD: Record<Exclude<LandmarkKind, "garagem">, StandSpot["kind"]> = {
  mcgordos: "fries", burgerkilo: "burger", subgordo: "soda", outbacon: "burger",
};

/**
 * Comida do mundo aberto: o balcão do drive-thru de cada lanchonete, no pátio,
 * na frente da janelinha (fora da rua: para comer é preciso entrar no pátio).
 */
export const STANDS: StandSpot[] = LANDMARKS.filter((l) => l.kind !== "garagem").map((l) => {
  const fx = Math.sin(l.angle) * l.front;
  const fz = Math.cos(l.angle) * l.front;
  // Janelinha perto de uma ponta da fachada; o balcão fica 3,5 m para fora dela.
  const along = l.w / 2 - 4;
  const out = l.d / 2 + 3.5;
  return {
    x: l.x + Math.cos(l.angle) * along + fx * out,
    z: l.z - Math.sin(l.angle) * along + fz * out,
    kind: STAND_FOOD[l.kind as Exclude<LandmarkKind, "garagem">],
    landmark: l.id,
  };
});
