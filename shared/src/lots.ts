// Ajudantes para pôr coisas novas em volta das ruas sem mexer na planta (as
// fazendas de rural.ts e o aeroporto de airport.ts): distância até a rua mais
// perto, caixas giradas e um "referencial" ao longo de uma rua. Tudo lido do
// mapa já pronto (ROADS), então acompanha qualquer mudança no traçado.
import { LANDMARKS, ROADS, WORLD_BOUNDS, type Box, type Building, type Road } from "./world.ts";

export type Point = [number, number];

/**
 * Caixa girada no chão: a mesma de world.ts (o eixo local "w" aponta para
 * (cos angle, −sin angle) e o "d" para (sin angle, cos angle)).
 */
export type { Box };

/** Ângulo de uma caixa cujo eixo "w" aponta para (ux, uz). */
export const angleAlong = (ux: number, uz: number) => Math.atan2(-uz, ux);

/** Cantos de uma caixa girada (com folga `margin` de cada lado). */
export function boxCorners(b: Box, margin = 0): Point[] {
  const ux = Math.cos(b.angle);
  const uz = -Math.sin(b.angle);
  const vx = Math.sin(b.angle);
  const vz = Math.cos(b.angle);
  const hw = b.w / 2 + margin;
  const hd = b.d / 2 + margin;
  return [
    [b.x + ux * hw + vx * hd, b.z + uz * hw + vz * hd],
    [b.x - ux * hw + vx * hd, b.z - uz * hw + vz * hd],
    [b.x - ux * hw - vx * hd, b.z - uz * hw - vz * hd],
    [b.x + ux * hw - vx * hd, b.z + uz * hw - vz * hd],
  ];
}

/** O ponto está dentro da caixa (com folga)? */
export function pointInBox(b: Box, x: number, z: number, margin = 0) {
  const dx = x - b.x;
  const dz = z - b.z;
  const lw = dx * Math.cos(b.angle) - dz * Math.sin(b.angle);
  const ld = dx * Math.sin(b.angle) + dz * Math.cos(b.angle);
  return Math.abs(lw) <= b.w / 2 + margin && Math.abs(ld) <= b.d / 2 + margin;
}

/** Duas caixas giradas se sobrepõem (com folga)? Teorema dos eixos separadores. */
export function boxesOverlap(a: Box, b: Box, margin = 0) {
  if (Math.hypot(a.x - b.x, a.z - b.z) > (Math.hypot(a.w, a.d) + Math.hypot(b.w, b.d)) / 2 + margin * 2) return false;
  const ca = boxCorners(a, margin);
  const cb = boxCorners(b);
  for (const box of [a, b]) {
    for (const [ax, az] of [[Math.cos(box.angle), -Math.sin(box.angle)], [Math.sin(box.angle), Math.cos(box.angle)]]) {
      const pa = ca.map(([x, z]) => x * ax + z * az);
      const pb = cb.map(([x, z]) => x * ax + z * az);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}

// --- Distância até a rua ------------------------------------------------------

const CELL = 25;
const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
type Seg = { ax: number; az: number; bx: number; bz: number; half: number };
let grid: Map<string, Seg[]> | null = null;

/** Grade dos pedaços de rua (montada na primeira consulta). */
function roadGrid() {
  if (grid) return grid;
  grid = new Map();
  for (const road of ROADS) {
    for (let i = 1; i < road.points.length; i++) {
      const [ax, az] = road.points[i - 1];
      const [bx, bz] = road.points[i];
      const seg = { ax, az, bx, bz, half: road.width / 2 };
      // Folga: as consultas daqui enxergam até ~12 m além da beira.
      const reach = road.width / 2 + 12;
      for (let x = Math.min(ax, bx) - reach; x <= Math.max(ax, bx) + reach + CELL; x += CELL) {
        for (let z = Math.min(az, bz) - reach; z <= Math.max(az, bz) + reach + CELL; z += CELL) {
          const k = key(x, z);
          const list = grid.get(k);
          if (!list) grid.set(k, [seg]);
          else if (list[list.length - 1] !== seg) list.push(seg);
        }
      }
    }
  }
  return grid;
}

/**
 * Distância (m) até a beira da rua mais perto (negativa = em cima da rua). Só
 * enxerga até ~12 m: mais longe que isso devolve Infinity.
 */
export function roadClearance(x: number, z: number) {
  let best = Infinity;
  for (const s of roadGrid().get(key(x, z)) ?? []) {
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / len2));
    best = Math.min(best, Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t)) - s.half);
  }
  return best;
}

export const insideWorld = (x: number, z: number, margin: number) =>
  x > WORLD_BOUNDS.minX + margin && x < WORLD_BOUNDS.maxX - margin && z > WORLD_BOUNDS.minZ + margin && z < WORLD_BOUNDS.maxZ - margin;

/** A caixa encosta em alguma lanchonete ou garagem (prédio ou pátio)? */
export function hitsLandmark(b: Box, margin: number) {
  return LANDMARKS.some((l) => boxesOverlap(b, l, margin) || boxesOverlap(b, l.apron, margin));
}

// --- Referencial ao longo de uma linha -------------------------------------------

/**
 * Referencial plano: origem, eixo "u" (unitário) e "n" (perpendicular, para
 * dentro do lote). Converte coordenadas locais (u, n) para o mundo.
 */
export interface Frame {
  x: number;
  z: number;
  ux: number;
  uz: number;
  nx: number;
  nz: number;
}

export const toWorld = (f: Frame, u: number, n: number): Point => [f.x + f.ux * u + f.nx * n, f.z + f.uz * u + f.nz * n];

/** Caixa do mundo a partir de um retângulo local [u0, u1] × [n0, n1]. */
export function frameBox(f: Frame, u0: number, u1: number, n0: number, n1: number): Box {
  const [x, z] = toWorld(f, (u0 + u1) / 2, (n0 + n1) / 2);
  return { x, z, w: Math.abs(u1 - u0), d: Math.abs(n1 - n0), angle: angleAlong(f.ux, f.uz) };
}

/** Prédio (sólido) a partir de um retângulo local. */
export function frameSolid(f: Frame, u0: number, u1: number, n0: number, n1: number, height: number, kind: Building["kind"] = "warehouse"): Building {
  return { ...frameBox(f, u0, u1, n0, n1), height, kind, tint: 0, front: 1 };
}

/** Rua de terra? (Ruas e vielas da Roça do Milho e da Serra do Açúcar, como desenha o cliente.) */
export function isDirtRoad(road: Road, ruralAt: (x: number, z: number) => boolean) {
  if (road.kind !== "rua" && road.kind !== "viela") return false;
  const [x, z] = road.points[Math.floor(road.points.length / 2)];
  return ruralAt(x, z);
}
