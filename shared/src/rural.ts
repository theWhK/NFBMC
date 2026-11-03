// O campo de Porto Gordo (Roça do Milho e Serra do Açúcar): fazendas com casa,
// celeiro, silos, caixa-d'água, curral, chiqueiro e galinheiro; lavouras em
// fileiras (milho, cana, girassol, terra arada), pastos cercados com bichos e
// cercas de madeira ou arame na beira das estradas de terra.
//
// Nada aqui tem coordenada fixa: as fazendas são postas por semente na beira
// das estradas de terra que existirem no mapa (ROADS), nos bairros rurais, e
// tudo que é sólido (casa, celeiro, silo, cercas, cerca viva) entra na colisão
// por `addSolids` (world.ts). Os bichos são só enfeite (o cliente anima),
// sempre dentro dos cercados, longe da rua.
import { heightAt } from "./terrain.ts";
import { addSolids, districtAt, ROADS, seeded, type Building, type Road, type Tree } from "./world.ts";
import {
  boxesOverlap,
  frameBox,
  frameSolid,
  hitsLandmark,
  insideWorld,
  isDirtRoad,
  roadClearance,
  toWorld,
  type Box,
  type Frame,
  type Point,
} from "./lots.ts";

export type CropKind = "milho" | "cana" | "girassol" | "arado";
export type AnimalKind = "vaca" | "boi" | "cavalo" | "porco" | "ovelha" | "galinha";
/** Cerca de tábuas (madeira), de arame farpado ou cerca viva (arbustos). */
export type FenceStyle = "madeira" | "arame" | "viva";

/** Lavoura: as fileiras correm ao longo do eixo "w" da caixa. */
export interface Field extends Box {
  crop: CropKind;
  /** Retângulo no referencial da fazenda: [u0, u1, n0, n1]. */
  local: [number, number, number, number];
}

/** Cercado com bichos dentro. */
export interface Pen extends Box {
  animal: AnimalKind;
  count: number;
  /** Retângulo no referencial da fazenda: [u0, u1, n0, n1]. */
  local: [number, number, number, number];
}

export interface FenceLine {
  points: Point[];
  style: FenceStyle;
}

export interface Farm {
  id: number;
  name: string;
  /** Referencial: origem na cerca da beira da estrada (no portão), u ao longo da estrada, n para dentro. */
  frame: Frame;
  width: number;
  depth: number;
  footprint: Box;
  /** Rumo de quem sai da casa para a estrada. */
  house: Building;
  barn: Building;
  silos: { x: number; z: number; r: number; h: number }[];
  /** Caixa-d'água na torre de madeira. */
  tank: { x: number; z: number; angle: number };
  /** Terreiro de terra batida (casa, celeiro, curral). */
  yard: Box;
  /** Porteira (na cerca da beira da estrada) e a placa com o nome. */
  gate: { x: number; z: number; angle: number };
  fields: Field[];
  pens: Pen[];
}

const RURAL = new Set(["roca", "serra"]);
const ruralAt = (x: number, z: number) => RURAL.has(districtAt(x, z));

const FARM_NAMES = [
  "Fazenda Bacon Feliz", "Sítio Pé de Torresmo", "Rancho Picanha Dourada", "Fazenda Milho Gorduroso",
  "Haras Pastel de Vento", "Sítio Coxinha Alegre", "Fazenda Leite Condensado", "Granja Ovo Frito",
  "Sítio da Pamonha", "Fazenda Cana Caiana", "Rancho do Toucinho", "Sítio Banha de Porco",
  "Fazenda Pururuca", "Estância Costela Gorda", "Sítio Curau", "Fazenda Doce de Leite",
  "Rancho Linguiça Mineira", "Sítio Polenta Frita", "Fazenda Queijo Coalho", "Chácara do Torresmo",
];

const pick = <T>(random: () => number, weights: [T, number][]): T => {
  let r = random() * weights.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of weights) if ((r -= w) <= 0) return v;
  return weights[weights.length - 1][0];
};

/** Ponto e direção da rua no índice `i` (tangente pelos vizinhos). */
function roadAt(road: Road, i: number) {
  const p = road.points;
  const a = p[Math.max(0, i - 1)];
  const b = p[Math.min(p.length - 1, i + 1)];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { x: p[i][0], z: p[i][1], tx: (b[0] - a[0]) / len, tz: (b[1] - a[1]) / len };
}

/** Frame de um lote na beira da rua: `side` = +1 à esquerda de quem anda de A para B, −1 à direita. */
function lotFrame(road: Road, i: number, side: number, offset: number): Frame {
  const { x, z, tx, tz } = roadAt(road, i);
  // Normal para o lado: esquerda = (tz, −tx).
  const nx = tz * side;
  const nz = -tx * side;
  // u tal que (u, n) é uma base com a mesma orientação sempre (u = n girado).
  return { x: x + nx * offset, z: z + nz * offset, ux: -nz, uz: nx, nx, nz };
}

/** O retângulo local [u0,u1]×[n0,n1] cabe ali (longe de outras ruas, no campo, dentro do mapa)? */
function fits(f: Frame, u0: number, u1: number, n0: number, n1: number) {
  for (let u = u0; u <= u1 + 0.01; u += (u1 - u0) / Math.ceil((u1 - u0) / 9)) {
    for (let n = n0; n <= n1 + 0.01; n += (n1 - n0) / Math.ceil((n1 - n0) / 9)) {
      const [x, z] = toWorld(f, u, n);
      if (!insideWorld(x, z, 30) || !ruralAt(x, z)) return false;
      // Na frente (beira da estrada) a rua está a ~3 m; mais para dentro, nenhuma rua perto.
      if (roadClearance(x, z) < (n < 8 ? 1.6 : 5)) return false;
    }
  }
  return true;
}

function generate() {
  const random = seeded(31337);
  const farms: Farm[] = [];
  const fences: FenceLine[] = [];
  const solids: Building[] = [];
  const trees: Tree[] = [];
  const clear: Box[] = [];
  const dirt = ROADS.filter((r) => isDirtRoad(r, ruralAt) && r.length > 120);
  const quota: Record<string, number> = { roca: 18, serra: 6 };

  // --- Fazendas ---------------------------------------------------------------------
  // Percorre as estradas de terra (numa ordem sorteada) procurando lotes livres dos dois lados.
  const order = dirt.map((r) => ({ r, k: random() })).sort((a, b) => a.k - b.k).map((o) => o.r);
  for (const road of order) {
    const step = Math.max(1, Math.round(road.length / (road.points.length - 1)));
    for (const side of random() < 0.5 ? [1, -1] : [-1, 1]) {
      let s = 70 + random() * 40;
      while (s < road.length - 70) {
        const i = Math.round(s / step);
        const [mx, mz] = road.points[i];
        const district = districtAt(mx, mz);
        if ((quota[district] ?? 0) <= 0) break;
        const serra = district === "serra";
        const width = Math.round(serra ? 110 + random() * 30 : 135 + random() * 60);
        const depth = Math.round(serra ? 95 + random() * 30 : 115 + random() * 60);
        const f = lotFrame(road, i, side, road.width / 2 + 3);
        const footprint = frameBox(f, -width / 2, width / 2, 0, depth);
        const ok =
          fits(f, -width / 2, width / 2, 0, depth) &&
          !farms.some((o) => boxesOverlap(o.footprint, footprint, 18)) &&
          !hitsLandmark(footprint, 10);
        if (!ok) {
          s += 25;
          continue;
        }
        // O terreiro precisa ser mais ou menos plano (casa e celeiro).
        const hs = [[-30, 6], [30, 6], [-30, 50], [30, 50], [0, 28]].map(([u, n]) => heightAt(...toWorld(f, u, n)));
        if (Math.max(...hs) - Math.min(...hs) > 5) {
          s += 25;
          continue;
        }
        quota[district]--;
        farms.push(layoutFarm(farms.length, f, width, depth, serra, random));
        s += width + 40;
      }
    }
  }

  for (const farm of farms) {
    clear.push(farm.footprint);
    solids.push(farm.house, farm.barn);
    for (const silo of farm.silos) solids.push({ x: silo.x, z: silo.z, w: silo.r * 2, d: silo.r * 2, angle: farm.house.angle, height: silo.h, kind: "warehouse", tint: 0, front: 1 });
    solids.push({ x: farm.tank.x, z: farm.tank.z, w: 3, d: 3, angle: farm.tank.angle, height: 9, kind: "warehouse", tint: 0, front: 1 });
    const f = farm.frame;
    // Cercas dos pastos e currais (o lado da estrada já tem a cerca da beira).
    for (const pen of farm.pens) {
      const [u0, u1, n0, n1] = pen.local;
      const style: FenceStyle = pen.animal === "cavalo" || pen.animal === "boi" || pen.animal === "porco" ? "madeira" : "arame";
      const corners: Point[] = [[u0, n0], [u1, n0], [u1, n1], [u0, n1]];
      for (let k = 0; k < 4; k++) {
        const a = corners[k];
        const b = corners[(k + 1) % 4];
        if (a[1] < 3 && b[1] < 3) continue; // lado da estrada
        fences.push({ points: [toWorld(f, a[0], a[1]), toWorld(f, b[0], b[1])], style });
      }
    }
    // Cerca viva em alguns lados das lavouras (nunca no lado da estrada).
    for (const field of farm.fields) {
      const [u0, u1, n0, n1] = field.local;
      const corners: Point[] = [[u0 - 0.8, n0 - 0.8], [u1 + 0.8, n0 - 0.8], [u1 + 0.8, n1 + 0.8], [u0 - 0.8, n1 + 0.8]];
      for (let k = 0; k < 4; k++) {
        const a = corners[k];
        const b = corners[(k + 1) % 4];
        if ((a[1] < 3 && b[1] < 3) || random() > 0.35) continue;
        fences.push({ points: [toWorld(f, a[0], a[1]), toWorld(f, b[0], b[1])], style: "viva" });
      }
    }
    // Quebra-vento de árvores no fundo e uma árvore de sombra no terreiro.
    for (let u = -farm.width / 2 + 4; u <= farm.width / 2 - 4; u += 8 + random() * 3) {
      if (random() < 0.75) {
        const [x, z] = toWorld(f, u + (random() - 0.5) * 2, farm.depth + 4 + random() * 2);
        if (roadClearance(x, z) > 4 && ruralAt(x, z)) trees.push({ x, z, size: 1.1 + random() * 0.5 });
      }
    }
    const [sx, sz] = toWorld(f, 4 + random() * 3, 9 + random() * 3);
    trees.push({ x: sx, z: sz, size: 1.5 + random() * 0.3 });
  }

  // --- Cercas na beira das estradas de terra ------------------------------------------
  const gates = farms.map((farm) => farm.gate);
  for (const road of dirt) {
    const step = road.length / (road.points.length - 1);
    for (const side of [1, -1]) {
      const offset = road.width / 2 + 3;
      let run: Point[] = [];
      let style: FenceStyle = "arame";
      let present = true;
      let nextBreak = 60 + random() * 140;
      const flush = () => {
        if (run.length >= 3) fences.push({ points: run, style });
        run = [];
      };
      for (let i = 0; i < road.points.length; i++) {
        const s = i * step;
        const { x, z, tx, tz } = roadAt(road, i);
        const px = x + tz * side * offset;
        const pz = z - tx * side * offset;
        const district = districtAt(px, pz);
        const frontage = farms.some((farm) => pointInFootprint(farm, px, pz));
        // Uma porteira aberta (ou mata-burro) de vez em quando.
        if (s > nextBreak && !frontage) {
          nextBreak = s + 80 + random() * 180;
          flush();
          present = district === "serra" ? random() < 0.45 : random() < 0.85;
          style = district === "serra" ? (random() < 0.8 ? "arame" : "madeira") : random() < 0.45 ? "madeira" : "arame";
          i += 2;
          continue;
        }
        const ok =
          (present || frontage) &&
          s > 20 && s < road.length - 20 &&
          RURAL.has(district) &&
          roadClearance(px, pz) > 2.2 &&
          !gates.some((g) => Math.hypot(g.x - px, g.z - pz) < 5);
        if (ok) run.push([px, pz]);
        else flush();
      }
      flush();
    }
  }
  // Colisão das cercas: um pedaço reto a cada ~12 m.
  for (const line of fences) {
    const thick = line.style === "viva" ? 1.6 : 0.4;
    const height = line.style === "viva" ? 2 : 1.4;
    for (let i = 0; i < line.points.length - 1; ) {
      const a = line.points[i];
      let j = i + 1;
      while (j < line.points.length - 1 && Math.hypot(line.points[j + 1][0] - a[0], line.points[j + 1][1] - a[1]) < 12) j++;
      const b = line.points[j];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > 0.5) {
        // Pedaços longos (lados dos pastos) viram vários de até 20 m.
        const pieces = Math.ceil(len / 20);
        for (let k = 0; k < pieces; k++) {
          const t0 = k / pieces;
          const t1 = (k + 1) / pieces;
          const x = a[0] + (b[0] - a[0]) * (t0 + t1) / 2;
          const z = a[1] + (b[1] - a[1]) * (t0 + t1) / 2;
          solids.push({ x, z, w: len / pieces, d: thick, angle: Math.atan2(-(b[1] - a[1]), b[0] - a[0]), height, kind: "warehouse", tint: 0, front: 1 });
        }
      }
      i = j;
    }
  }

  // Mais árvores soltas no campo (fora das fazendas e das ruas).
  for (let k = 0; k < 2500; k++) {
    const x = 600 + random() * 1150;
    const z = 1500 + random() * 1150;
    if (districtAt(x, z) !== "roca" || !insideWorld(x, z, 8) || roadClearance(x, z) < 6) continue;
    if (farms.some((farm) => pointInFootprint(farm, x, z, 6))) continue;
    if (trees.some((t) => Math.abs(t.x - x) < 6 && Math.abs(t.z - z) < 6)) continue;
    // Em grupos (capões de mato): mais chance perto de outra árvore.
    if (random() < 0.6 && !trees.some((t) => Math.abs(t.x - x) < 30 && Math.abs(t.z - z) < 30)) continue;
    trees.push({ x, z, size: 0.8 + random() * 0.8 });
  }

  addSolids({ solids, clear, trees });
  return { farms, fences };
}

/** O ponto está no terreno da fazenda? */
export function pointInFootprint(farm: Farm, x: number, z: number, margin = 0) {
  const dx = x - farm.frame.x;
  const dz = z - farm.frame.z;
  const u = dx * farm.frame.ux + dz * farm.frame.uz;
  const n = dx * farm.frame.nx + dz * farm.frame.nz;
  return Math.abs(u) <= farm.width / 2 + margin && n >= -margin && n <= farm.depth + margin;
}

/** Desenha a planta de uma fazenda no referencial dela. */
function layoutFarm(id: number, f: Frame, width: number, depth: number, serra: boolean, random: () => number): Farm {
  const angle = Math.atan2(-f.uz, f.ux);
  const house = frameSolid(f, -24.5, -11.5, 9, 19, 5 + random() * 1.5, "house");
  // Frente da casa para a estrada (−n).
  house.front = -1;
  const barn = frameSolid(f, 8, 20, 22, 38, 8 + random() * 2, "warehouse");
  barn.front = -1;
  const silos = (serra ? [[28, 26]] : [[28, 22], [28, 30.5]]).map(([u, n]) => {
    const [x, z] = toWorld(f, u, n);
    return { x, z, r: 2.3 + random() * 0.4, h: 10 + random() * 4 };
  });
  const [tx, tz] = toWorld(f, -30, 44);
  const [gx, gz] = toWorld(f, 0, 0);
  const pens: Pen[] = [];
  const fields: Field[] = [];
  const pen = (u0: number, u1: number, n0: number, n1: number, animal: AnimalKind, count: number) =>
    pens.push({ ...frameBox(f, u0, u1, n0, n1), animal, count, local: [u0, u1, n0, n1] });
  // Curral, chiqueiro e galinheiro no terreiro.
  pen(-26, -2, 36, 54, random() < 0.5 ? "boi" : "vaca", 3 + Math.floor(random() * 2));
  pen(17, 32, 42, 54, "porco", 3 + Math.floor(random() * 2));
  pen(-35, -27, 23, 33, "galinha", 6 + Math.floor(random() * 4));

  // Parcelas: dos lados do terreiro e no fundo.
  const parcels: [number, number, number, number][] = [];
  const half = width / 2;
  for (const s of [-1, 1]) {
    const ua = s < 0 ? -half : 38;
    const ub = s < 0 ? -38 : half;
    if (depth > 120) parcels.push([ua, ub, 0, depth / 2 - 1.5], [ua, ub, depth / 2 + 1.5, depth]);
    else parcels.push([ua, ub, 0, depth]);
  }
  if (depth - 60 > 28) parcels.push([-36, 36, 60, depth]);
  let pastures = 0;
  parcels.forEach(([u0, u1, n0, n1], k) => {
    // Recuo de 1,5 m das divisas (carreadores entre as parcelas).
    const local: [number, number, number, number] = [u0 + 1.5, u1 - 1.5, n0 === 0 ? 0.4 : n0 + 1.5, n1 - 1.5];
    const area = (local[1] - local[0]) * (local[3] - local[2]);
    const last = k === parcels.length - 1;
    if (random() < (serra ? 0.7 : 0.45) || (last && pastures === 0)) {
      pastures++;
      const animal = pick<AnimalKind>(random, serra ? [["vaca", 3.5], ["cavalo", 3], ["ovelha", 3.5]] : [["vaca", 3], ["boi", 3], ["cavalo", 2], ["ovelha", 2]]);
      const density = animal === "ovelha" ? 160 : animal === "cavalo" ? 380 : 300;
      pen(local[0], local[1], local[2], local[3], animal, Math.max(3, Math.min(animal === "ovelha" ? 16 : 11, Math.round(area / density))));
    } else {
      const crop = pick<CropKind>(random, [["milho", 4.5], ["cana", 3], ["girassol", 1.2], ["arado", 1.3]]);
      fields.push({ ...frameBox(f, local[0], local[1], local[2], local[3]), crop, local });
    }
  });

  return {
    id,
    name: FARM_NAMES[id % FARM_NAMES.length],
    frame: f,
    width,
    depth,
    footprint: frameBox(f, -width / 2, width / 2, 0, depth),
    house,
    barn,
    silos,
    tank: { x: tx, z: tz, angle },
    yard: frameBox(f, -36, 36, 2, 58),
    gate: { x: gx, z: gz, angle },
    fields,
    pens,
  };
}

const generated = generate();
/** Fazendas do campo (com casa, celeiro e silos na colisão). */
export const FARMS: Farm[] = generated.farms;
/** Cercas do campo (todas com colisão): beira das estradas de terra, pastos, currais e cercas vivas. */
export const FENCES: FenceLine[] = generated.fences;
