// Ruas em níveis diferentes: pontes, viadutos e túneis ("obras de arte").
//
// A física continua 2D (plano XZ), mas cada carro sabe em que nível está:
// `GROUND` (-1, no chão, altura do `heightAt`) ou o índice de uma obra em
// `STRUCTURES` (altura do tabuleiro dela). O nível fica em `CarMotion.level`
// no servidor e vai para o estado da sala (o cliente desenha o carro na altura
// certa).
//
// Cada obra é uma rua da planta (map.ts, `structure`) com o próprio perfil de
// altura: a ponte e o viaduto sobem em rampa a partir das pontas (onde estão no
// nível do chão) e o túnel segue reto por dentro do morro (a corda entre as
// bocas). Perto das pontas a obra está "no chão" (`grade`): é ali, e só ali,
// que o carro troca de nível. No meio, quem está em cima fica em cima (guarda-
// corpo dos dois lados) e quem está embaixo passa por baixo (ou bate no
// barranco da rampa, no pilar, na galeria do túnel).
import { EDGES, NODES, ROAD_WIDTH, type RoadKind, type StructureKind } from "./map.ts";
import type { CarMotion, CarState } from "./physics.ts";
import { heightAt } from "./terrain.ts";

type Point = [number, number];

export const GROUND = -1;

/** Pontos de uma curva quadrática de A até B (a cada ~4 m; reta sem ponto de controle). */
export function sampleEdge(a: Point, b: Point, curve?: Point): Point[] {
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

export const polylineLength = (points: Point[]) =>
  points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);

export interface Structure {
  id: number;
  kind: StructureKind;
  name: string;
  /** Nós das pontas (os da planta). */
  a: string;
  b: string;
  roadKind: RoadKind;
  width: number;
  half: number;
  points: Point[];
  /** Distância acumulada, tangente, altura do tabuleiro e do chão em cada ponto. */
  s: number[];
  tx: number[];
  tz: number[];
  y: number[];
  ground: number[];
  length: number;
  /** Trecho fora do chão: [sIn, sOut]. */
  sIn: number;
  sOut: number;
  /** Pilares (centro e raio), preenchidos pelo world.ts (precisa saber onde estão as ruas de baixo). */
  pillars: { x: number; z: number; r: number }[];
  /** Caixa (para descartar rápido). */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Altura livre debaixo da ponte/viaduto a partir da qual se passa por baixo (m). */
export const UNDER_CLEARANCE = 5;
/** Cobertura acima do teto do túnel a partir da qual o morro em cima é "chão" de verdade (m). */
export const TUNNEL_COVER = 8.5;
/** Altura interna do túnel (até o teto). */
export const TUNNEL_HEIGHT = 6.8;
/** Diferença de altura até onde a obra ainda conta como "no chão" (troca de nível). */
const AT_GRADE = 0.35;
/** Quanto antes do começo/depois do fim do trecho elevado ainda se troca de nível (m). */
const SWITCH_REACH = 14;
/** Trecho plano nas pontas antes da rampa (o cruzamento). */
const END_RUN = 18;

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function buildStructure(id: number, e: (typeof EDGES)[number]): Structure {
  const points = sampleEdge(NODES[e.a], NODES[e.b], e.curve);
  const s: number[] = [0];
  for (let i = 1; i < points.length; i++) s.push(s[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const length = s[s.length - 1];
  const tx: number[] = [];
  const tz: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const [px, pz] = points[Math.max(0, i - 1)];
    const [nx, nz] = points[Math.min(points.length - 1, i + 1)];
    const l = Math.hypot(nx - px, nz - pz) || 1;
    tx.push((nx - px) / l);
    tz.push((nz - pz) / l);
  }
  const ground = points.map(([x, z]) => heightAt(x, z));
  const g0 = ground[0];
  const g1 = ground[ground.length - 1];
  const kind = e.structure!;
  let y: number[];
  if (kind === "tunel") {
    // Reto por dentro do morro: a corda entre as bocas (nunca acima do chão). Nos
    // primeiros e últimos metros a rua ainda está no chão (o cruzamento de fora).
    const i0 = s.findIndex((d) => d >= END_RUN);
    let i1 = s.length - 1;
    while (i1 > 0 && s[i1] > length - END_RUN) i1--;
    const h0 = ground[i0];
    const h1 = ground[i1];
    y = s.map((d, i) => (i <= i0 || i >= i1 ? ground[i] : Math.min(ground[i], h0 + ((h1 - h0) * (d - s[i0])) / (s[i1] - s[i0]))));
  } else {
    const lift = e.lift ?? 7;
    const ramp = e.ramp ?? 120;
    // Ponte: linha reta entre as pontas (atravessa o vale por cima). Viaduto:
    // acompanha o relevo de longe (média de ±60 m), presa nas pontas.
    let base: number[];
    if (kind === "ponte") base = s.map((d) => g0 + ((g1 - g0) * d) / length);
    else {
      const window = 15;
      const avg = ground.map((_, i) => {
        let sum = 0;
        let n = 0;
        for (let k = Math.max(0, i - window); k <= Math.min(ground.length - 1, i + window); k++) {
          sum += ground[k];
          n++;
        }
        return sum / n;
      });
      const e0 = g0 - avg[0];
      const e1 = g1 - avg[avg.length - 1];
      base = avg.map((h, i) => h + e0 + ((e1 - e0) * s[i]) / length);
    }
    // A ponte só sobe o que falta: se a linha entre as margens já passa alta
    // sobre o vale, o tabuleiro fica quase reto (um arco suave).
    const bumps = s.map((d) => smooth((d - END_RUN) / ramp) * smooth((length - END_RUN - d) / ramp));
    let clear = Infinity;
    for (let i = 0; i < s.length; i++) if (bumps[i] > 0.98) clear = Math.min(clear, base[i] - ground[i]);
    const need = kind === "ponte" && Number.isFinite(clear) ? Math.max(Math.min(1.5, lift), lift - Math.max(0, clear)) : lift;
    y = s.map((_, i) => Math.max(ground[i], base[i] + need * bumps[i]));
  }
  // Pontas exatamente no chão (casam com o cruzamento). O túnel já sai do chão nas bocas.
  for (let i = 0; i < y.length && kind !== "tunel"; i++) {
    const w = smooth(Math.min(s[i], length - s[i]) / END_RUN);
    y[i] = ground[i] + (y[i] - ground[i]) * w;
  }
  let sIn = length / 2;
  let sOut = length / 2;
  for (let i = 0; i < y.length; i++) {
    if (Math.abs(y[i] - ground[i]) > 0.05) {
      sIn = Math.min(sIn, s[i]);
      sOut = Math.max(sOut, s[i]);
    }
  }
  const width = ROAD_WIDTH[e.kind];
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  const pad = width / 2 + 12;
  return {
    id, kind, name: e.name ?? "", a: e.a, b: e.b, roadKind: e.kind, width, half: width / 2,
    points, s, tx, tz, y, ground, length, sIn, sOut, pillars: [],
    minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minZ: Math.min(...zs) - pad, maxZ: Math.max(...zs) + pad,
  };
}

/** Todas as obras de arte (o índice é o nível). */
export const STRUCTURES: Structure[] = EDGES.filter((e) => e.structure).map((e, i) => buildStructure(i, e));

/** Obra de uma rua da planta (pelas pontas), ou GROUND. */
export function structureOf(a: string, b: string) {
  return STRUCTURES.find((st) => (st.a === a && st.b === b) || (st.a === b && st.b === a))?.id ?? GROUND;
}

interface Loc {
  /** Distância ao longo da obra e afastamento do eixo (positivo = esquerda de quem vai de A para B). */
  s: number;
  u: number;
  /** Altura do tabuleiro e do chão ali. */
  y: number;
  ground: number;
  /** Tangente. */
  tx: number;
  tz: number;
  /** Rampa ao longo da obra (m por m, de A para B). */
  slope: number;
}

const LOC: Loc = { s: 0, u: 0, y: 0, ground: 0, tx: 0, tz: 1, slope: 0 };

/** Onde o ponto cai na obra (projeção no eixo); null se está longe dela. Reaproveita o mesmo objeto. */
export function locate(st: Structure, x: number, z: number, reach = 12): Loc | null {
  if (x < st.minX || x > st.maxX || z < st.minZ || z > st.maxZ) return null;
  const p = st.points;
  let best = Infinity;
  let bi = 0;
  let bt = 0;
  // Busca grossa (a cada 4 pontos) e depois fina em volta.
  for (let i = 0; i < p.length - 1; i += 4) {
    const d = (p[i][0] - x) ** 2 + (p[i][1] - z) ** 2;
    if (d < best) {
      best = d;
      bi = i;
    }
  }
  best = Infinity;
  const from = Math.max(0, bi - 5);
  const to = Math.min(p.length - 2, bi + 5);
  let bd = 0;
  for (let i = from; i <= to; i++) {
    const [ax, az] = p[i];
    const [bx, bz] = p[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) {
      best = d;
      bi = i;
      bt = t;
      bd = d;
    }
  }
  if (bd > st.half + reach) return null;
  const i = bi;
  const t = bt;
  const [ax, az] = p[i];
  const [bx, bz] = p[i + 1];
  const segLen = Math.hypot(bx - ax, bz - az) || 1;
  const ux = (bx - ax) / segLen;
  const uz = (bz - az) / segLen;
  // Esquerda de quem vai de A para B: (uz, −ux).
  const side = (x - ax) * uz - (z - az) * ux;
  LOC.s = st.s[i] + segLen * t;
  LOC.u = side >= 0 ? bd : -bd;
  LOC.y = st.y[i] + (st.y[i + 1] - st.y[i]) * t;
  LOC.ground = st.ground[i] + (st.ground[i + 1] - st.ground[i]) * t;
  LOC.tx = ux;
  LOC.tz = uz;
  LOC.slope = (st.y[i + 1] - st.y[i]) / segLen;
  return LOC;
}

/** Altura do tabuleiro a `s` metros da ponta A. */
export function deckAt(st: Structure, s: number) {
  const k = st.s;
  if (s <= 0) return st.y[0];
  if (s >= st.length) return st.y[st.y.length - 1];
  let lo = 0;
  let hi = k.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (k[m] <= s) lo = m;
    else hi = m;
  }
  const t = (s - k[lo]) / (k[hi] - k[lo] || 1);
  return st.y[lo] + (st.y[hi] - st.y[lo]) * t;
}

/** Altura da superfície em que o carro anda (chão ou tabuleiro). */
export function surfaceY(x: number, z: number, level: number) {
  if (level >= 0) {
    const loc = locate(STRUCTURES[level], x, z, 60);
    if (loc) return loc.y;
  }
  return heightAt(x, z);
}

/** Rampa na direção do carro (m por m; positivo = subida), no nível dele. */
export function surfaceGrade(x: number, z: number, heading: number, level: number, groundGrade: () => number) {
  if (level >= 0) {
    const loc = locate(STRUCTURES[level], x, z, 60);
    if (loc) return loc.slope * (Math.sin(heading) * loc.tx + Math.cos(heading) * loc.tz);
  }
  return groundGrade();
}

/** Inclinação da superfície em +X e +Z (para inclinar o carro no cliente); null = a do chão. */
export function surfaceSlope(x: number, z: number, level: number): [number, number] | null {
  if (level < 0) return null;
  const loc = locate(STRUCTURES[level], x, z, 60);
  if (!loc) return null;
  return [loc.slope * loc.tx, loc.slope * loc.tz];
}

/** Diferença entre o tabuleiro e o chão (positiva = em cima; no túnel, a cobertura). */
const gap = (st: Structure, loc: Loc) => (st.kind === "tunel" ? loc.ground - loc.y : loc.y - loc.ground);

/**
 * Nível do carro depois de andar até (x, z). Só troca perto das pontas das
 * obras, onde o tabuleiro está no nível do chão.
 */
export function nextLevel(x: number, z: number, level: number): number {
  if (level >= 0) {
    const st = STRUCTURES[level];
    const loc = locate(st, x, z, 40);
    if (!loc) return GROUND;
    if (loc.s < st.sIn - SWITCH_REACH || loc.s > st.sOut + SWITCH_REACH) return GROUND;
    if (Math.abs(loc.u) > st.half + 1.5 && gap(st, loc) <= AT_GRADE) return GROUND;
    return level;
  }
  for (const st of STRUCTURES) {
    const loc = locate(st, x, z, 0);
    if (!loc || Math.abs(loc.u) > st.half) continue;
    if (loc.s < st.sIn - SWITCH_REACH || loc.s > st.sOut + SWITCH_REACH) continue;
    if (gap(st, loc) <= AT_GRADE) return st.id;
  }
  return GROUND;
}

/**
 * Nível de quem aparece do nada em (x, z) (nascimento, "voltar para a rua",
 * carro do trânsito): em cima da obra se a rua escolhida é ela, senão no chão.
 */
export function levelOnRoad(structure: number, x: number, z: number) {
  if (structure < 0) return GROUND;
  const loc = locate(STRUCTURES[structure], x, z, 30);
  return loc ? structure : GROUND;
}

/** Bate na parede: empurra (px, pz), perde velocidade conforme o quanto foi de frente e para o empurrão lateral. */
function bump(car: CarState, motion: CarMotion | undefined, px: number, pz: number) {
  car.x += px;
  car.z += pz;
  const len = Math.hypot(px, pz) || 1;
  const nx = px / len;
  const nz = pz / len;
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const headOn = Math.abs(fx * nx + fz * nz);
  car.speed *= 1 - 0.6 * headOn;
  if (motion) {
    const into = motion.vx * nx + motion.vz * nz;
    if (into < 0) {
      motion.vx -= nx * into;
      motion.vz -= nz * into;
    }
  }
  // Escorrega junto da parede (gira um pouco para correr paralelo a ela).
  if (headOn < 0.7) {
    const along = Math.atan2(-nz, nx);
    const options = [along, along + Math.PI];
    const pick = options.reduce((a, b) => (Math.abs(Math.atan2(Math.sin(b - car.heading), Math.cos(b - car.heading))) < Math.abs(Math.atan2(Math.sin(a - car.heading), Math.cos(a - car.heading))) ? b : a));
    const diff = Math.atan2(Math.sin(pick - car.heading), Math.cos(pick - car.heading));
    car.heading += diff * 0.25;
  }
}

/**
 * Paredes das obras: guarda-corpo (quem está em cima não cai), barranco da
 * rampa e galeria do túnel (quem está no chão não entra por baixo onde não
 * cabe um carro) e os pilares. Retorna true se bateu.
 */
export function collideLevel(car: CarState, level: number, halfLength: number, halfWidth: number, motion?: CarMotion): boolean {
  let hit = false;
  if (level >= 0) {
    const st = STRUCTURES[level];
    const loc = locate(st, car.x, car.z, 40);
    if (!loc || gap(st, loc) <= AT_GRADE) return false;
    const limit = st.half - halfWidth - 0.4;
    const over = Math.abs(loc.u) - limit;
    if (over > 0) {
      // Volta para dentro (a esquerda de A→B é (tz, −tx)).
      const sign = loc.u > 0 ? -1 : 1;
      bump(car, motion, loc.tz * over * sign, -loc.tx * over * sign);
      hit = true;
    }
    return hit;
  }
  for (const st of STRUCTURES) {
    const loc = locate(st, car.x, car.z, halfLength + 2);
    if (!loc) continue;
    const g = gap(st, loc);
    if (g <= AT_GRADE) continue;
    const solid = st.kind === "tunel" ? g < TUNNEL_COVER : g < UNDER_CLEARANCE;
    if (solid) {
      // Ocupa a largura da obra (mais a mureta): sai pelo lado mais perto.
      const outer = st.half + (st.kind === "tunel" ? 1.2 : 0.6) + halfWidth;
      const over = outer - Math.abs(loc.u);
      if (over > 0) {
        const sign = loc.u >= 0 ? 1 : -1;
        bump(car, motion, loc.tz * over * sign, -loc.tx * over * sign);
        hit = true;
      }
    }
  }
  // Pilares (só para quem está no chão, passando por baixo).
  for (const st of STRUCTURES) {
    if (car.x < st.minX - 10 || car.x > st.maxX + 10 || car.z < st.minZ - 10 || car.z > st.maxZ + 10) continue;
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    const reach = Math.max(0, halfLength - halfWidth);
    for (const pillar of st.pillars) {
      if (Math.abs(pillar.x - car.x) > halfLength + pillar.r + 1 || Math.abs(pillar.z - car.z) > halfLength + pillar.r + 1) continue;
      for (const offset of [reach, 0, -reach]) {
        const cx = car.x + fx * offset;
        const cz = car.z + fz * offset;
        const dx = cx - pillar.x;
        const dz = cz - pillar.z;
        const d = Math.hypot(dx, dz);
        const min = pillar.r + halfWidth;
        if (d >= min || d === 0) continue;
        bump(car, motion, (dx / d) * (min - d), (dz / d) * (min - d));
        hit = true;
      }
    }
  }
  return hit;
}

/**
 * Nível em cada amostra de um traçado (corrida, rota do GPS), andando por ele
 * como um carro (duas voltas se fecha, para o começo já sair certo). `start`:
 * o nível no primeiro ponto (o do carro, para a rota do GPS).
 */
export function pathLevels(points: { x: number; z: number }[], closed = true, start = GROUND): Int8Array {
  const n = points.length;
  const levels = new Int8Array(n).fill(GROUND);
  let level = start;
  const rounds = closed ? 2 : 1;
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < n; i++) {
      level = nextLevel(points[i].x, points[i].z, level);
      levels[i] = level;
    }
  }
  return levels;
}
