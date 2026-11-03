// Ruas de Porto Gordo: pavimento, meio-fio, sarjeta, calçadas, sinalização no
// chão e os detalhes miúdos (bueiros, remendos, manchas, tachas). O traçado
// (pontos e largura de cada rua, cruzamentos) vem do shared/world.ts; aqui é
// só o desenho (a física usa o `isOnRoad`).
//
// Cada rua ganha um "estilo" pelo tipo e pelo bairro: avenida de asfalto novo
// e escuro, rua de asfalto gasto com remendos, rodovia com acostamento e
// tachas, viela de paralelepípedo ou concreto, estrada de terra na serra e na
// roça, a pista do aeroporto de concreto com as marcações de pista. As
// calçadas mudam com o bairro: pedra portuguesa em ondas na praia, petit-pavé
// no centro, ladrilho hidráulico na Liberdade, faixa de grama nos bairros de
// casa e placas de concreto no resto.
//
// Cruzamentos: as ruas param na "boca" do cruzamento e um leque fecha o miolo,
// com a esquina arredondada (o meio-fio faz a curva). Assim o meio-fio e a
// calçada contornam a esquina em vez de atravessar a outra rua.
//
// Camadas no chão (a câmera vê de longe, com pouca precisão de profundidade):
// chão do bairro a −0,25, pavimento e sarjeta a +0,05, decalques a +0,068,
// tinta a +0,085, calçada e topo do meio-fio a +0,20 (15 cm acima do
// asfalto). Nada fica em cima de outra coisa na mesma altura, e o que fica por
// cima ainda tem polygonOffset.
//
// Desempenho: tudo é escrito direto em arrays, uma malha por material em cada
// bloco de 400 m (`addChunk`). O miúdo (decalques e tachas) fica em blocos de
// 200 m com nível de detalhe (`addLodChunk`), montados só quando a câmera chega
// perto.
import * as THREE from "three";
import { DISTRICTS, NAV, ROADS, STRUCTURES, districtAt, heightAt, type DistrictId, type Road } from "@nfbmc/shared";

import { DETAIL_TILE, TILE, addChunk, addLodChunk } from "./chunks.ts";
import { surface } from "./look.ts";
import {
  asphaltMaps, cobbleMaps, curbMaps, decalMaps, decalRect, dirtMaps, grassMaps, ladrilhoMaps, paintMaps, petitMaps,
  roadConcreteMaps, sidewalkConcreteMaps, wavesMaps, type DecalName, type SurfaceMaps,
} from "./street-textures.ts";

// --- Alturas (acima do relevo) e medidas -----------------------------------------

const Y_ROAD = 0.05;
const Y_DECAL = 0.068;
const Y_PAINT = 0.085;
const Y_WALK = 0.2;
const Y_WALK_DECAL = 0.214;
/** Pé da calçada e do barranco (o chão do bairro está a −0,25). */
const Y_FOOT = -0.34;
/** Sarjeta: faixa de concreto junto do meio-fio, dentro da largura da rua. */
const GUTTER = 0.45;
/** Largura do topo do meio-fio. */
const CURB_TOP = 0.15;

// --- Utilidades ---------------------------------------------------------------------

type Rgb = [number, number, number];
const tmp = new THREE.Color();
/** Cor "#rrggbb" (sRGB) para a cor linear dos vértices. */
const lin = (hex: string): Rgb => {
  tmp.set(hex);
  return [tmp.r, tmp.g, tmp.b];
};
const scale = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Sorteio com semente (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, z: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Ruído de valor no plano (0–1). */
function wnoise(x: number, z: number) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  let fx = x - ix;
  let fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Variação lenta de tom pelo mundo (~0,86–1,07): o mesmo asfalto não fica igual em toda a cidade. */
const macro = (x: number, z: number) => 0.86 + 0.16 * wnoise(x / 41 + 11, z / 41 + 5) + 0.05 * wnoise(x / 17 + 3, z / 17 + 17);

/** Normal do relevo no ponto. */
function groundNormal(x: number, z: number): Rgb {
  const gx = (heightAt(x + 1, z) - heightAt(x - 1, z)) / 2;
  const gz = (heightAt(x, z + 1) - heightAt(x, z - 1)) / 2;
  const len = Math.hypot(gx, 1, gz);
  return [-gx / len, 1 / len, -gz / len];
}

// --- Construtor de malhas (arrays) ------------------------------------------------

/** Vértices e triângulos de um material num bloco (as obras de arte, em structures.ts, usam também). */
export class Bucket {
  pos = new Float32Array(3 * 256);
  nor = new Float32Array(3 * 256);
  uv = new Float32Array(2 * 256);
  col = new Uint8Array(3 * 256);
  idx = new Uint32Array(768);
  nv = 0;
  ni = 0;

  vertex(x: number, y: number, z: number, n: Rgb, u: number, v: number, c: Rgb) {
    if (this.nv * 3 + 3 > this.pos.length) {
      const grow = <T extends Float32Array | Uint8Array>(old: T, make: (n: number) => T) => {
        const next = make(old.length * 2);
        next.set(old);
        return next;
      };
      this.pos = grow(this.pos, (n) => new Float32Array(n));
      this.nor = grow(this.nor, (n) => new Float32Array(n));
      this.uv = grow(this.uv, (n) => new Float32Array(n));
      this.col = grow(this.col, (n) => new Uint8Array(n));
    }
    const i = this.nv;
    const p = i * 3;
    this.pos[p] = x;
    this.pos[p + 1] = y;
    this.pos[p + 2] = z;
    this.nor[p] = n[0];
    this.nor[p + 1] = n[1];
    this.nor[p + 2] = n[2];
    this.uv[i * 2] = u;
    this.uv[i * 2 + 1] = v;
    this.col[p] = clamp(c[0], 0, 1) * 255 + 0.5;
    this.col[p + 1] = clamp(c[1], 0, 1) * 255 + 0.5;
    this.col[p + 2] = clamp(c[2], 0, 1) * 255 + 0.5;
    this.nv++;
    return i;
  }

  private push(a: number, b: number, c: number) {
    if (this.ni + 3 > this.idx.length) {
      const next = new Uint32Array(this.idx.length * 2);
      next.set(this.idx);
      this.idx = next;
    }
    this.idx[this.ni++] = a;
    this.idx[this.ni++] = b;
    this.idx[this.ni++] = c;
  }

  /** Triângulo virado para o lado da normal do primeiro vértice (não importa a ordem). */
  tri(a: number, b: number, c: number) {
    const p = this.pos;
    const ux = p[b * 3] - p[a * 3];
    const uy = p[b * 3 + 1] - p[a * 3 + 1];
    const uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3];
    const vy = p[c * 3 + 1] - p[a * 3 + 1];
    const vz = p[c * 3 + 2] - p[a * 3 + 2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const n = this.nor;
    if (cx * n[a * 3] + cy * n[a * 3 + 1] + cz * n[a * 3 + 2] < 0) this.push(a, c, b);
    else this.push(a, b, c);
  }

  /** Quadrilátero a-b-c-d (em volta). */
  quad(a: number, b: number, c: number, d: number) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  get empty() {
    return this.ni === 0;
  }

  mesh(material: THREE.Material) {
    const geometry = new THREE.BufferGeometry();
    const n = this.nv;
    geometry.setAttribute("position", new THREE.BufferAttribute(this.pos.slice(0, n * 3), 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(this.nor.slice(0, n * 3), 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(this.uv.slice(0, n * 2), 2));
    geometry.setAttribute("color", new THREE.BufferAttribute(this.col.slice(0, n * 3), 3, true));
    const idx = this.idx.subarray(0, this.ni);
    geometry.setIndex(new THREE.BufferAttribute(n > 65535 ? idx.slice() : Uint16Array.from(idx), 1));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

// --- Materiais (um de cada, compartilhados por todos os blocos) -----------------

type Pave = "asfalto" | "paralelepipedo" | "concreto" | "terra";
type Walk = "calcada" | "petit" | "ondas" | "ladrilho" | "grama";
type MaterialKey = Pave | Walk | "meiofio" | "tinta" | "decal" | "tacha";

let cachedMaterials: Record<MaterialKey, THREE.Material> | null = null;

function materials() {
  if (cachedMaterials) return cachedMaterials;
  const offset = (f: number, u: number) => ({ polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: u });
  const make = (maps: SurfaceMaps, normalScale: number, extra: THREE.MeshLambertMaterialParameters = {}) =>
    surface(new THREE.MeshLambertMaterial({ color: "#ffffff", map: maps.map, vertexColors: true, ...extra }), {
      roughness: 1,
      normalMap: maps.normalMap,
      normalScale,
      roughnessMap: maps.roughnessMap,
    });
  const road = offset(-1, -1);
  const decals = decalMaps();
  cachedMaterials = {
    asfalto: make(asphaltMaps(), 1, road),
    paralelepipedo: make(cobbleMaps(), 1.2, road),
    concreto: make(roadConcreteMaps(), 1, road),
    terra: make(dirtMaps(), 1, road),
    meiofio: make(curbMaps(), 1),
    calcada: make(sidewalkConcreteMaps(), 1),
    petit: make(petitMaps(), 1),
    ondas: make(wavesMaps(), 1),
    ladrilho: make(ladrilhoMaps(), 1),
    grama: make(grassMaps(), 1),
    tinta: make(paintMaps(), 0.6, offset(-3, -6)),
    decal: make(decals, 1, { transparent: true, depthWrite: false, ...offset(-2, -4) }),
    tacha: surface(new THREE.MeshLambertMaterial({ color: "#ffffff", vertexColors: true }), { roughness: 0.35 }),
  };
  for (const [key, material] of Object.entries(cachedMaterials)) material.name = `rua-${key}`;
  return cachedMaterials;
}

// --- Estilo de cada rua ----------------------------------------------------------

type Marks = "avenida" | "rua" | "rodovia" | "pista" | "taxiway" | null;

interface Style {
  pave: Pave;
  /** Cor dos vértices do pavimento (multiplica a textura). */
  tone: Rgb;
  /** 0 = novo, 1 = gasto (remendos, rachaduras, piche). */
  wear: number;
  curb: boolean;
  walk: Walk | null;
  /** Largura da calçada (m, a partir da beira da rua, com o meio-fio). */
  walkWidth: number;
  /** Barranco de terra/brita (m) quando não há meio-fio. */
  verge: number;
  vergeTone: Rgb;
  marks: Marks;
  edgeLines: boolean;
  /** Probabilidade de faixa de pedestre nos cruzamentos. */
  zebra: number;
  /** Centro das faixas de rolamento de um lado (m do eixo). */
  lanes: number[];
  curbPaint: "branco" | "amarelo" | null;
  /** Quem manda no piso do cruzamento (e quem para no PARE). */
  priority: number;
  /** Escala do UV do piso (menor = placas maiores). */
  uvScale: number;
}

const ZEBRA: Partial<Record<DistrictId, number>> = {
  centro: 0.9, liberdade: 0.85, praia: 0.8, vila: 0.55, jardim: 0.6, porto: 0.5, parque: 0.6, picanha: 0.35, industrial: 0.3, aeroporto: 0.4, morro: 0.2,
};

const TONES = {
  novo: lin("#5a5a5e"),
  gasto: lin("#9a9893"),
  morro: lin("#a29c94"),
  rodovia: lin("#7b7a7c"),
  paralelepipedo: lin("#d8d4cc"),
  concreto: lin("#e2dfd8"),
  pista: lin("#8e8c87"),
  serra: lin("#cf8f68"),
  roca: lin("#c9a27a"),
};

function styleOf(road: Road, index: number, district: DistrictId): Style {
  const random = rng(index * 7919 + 101);
  const style: Style = {
    pave: "asfalto", tone: TONES.gasto, wear: 0.6, curb: true, walk: "calcada", walkWidth: 3, verge: 0, vergeTone: lin("#8f7b62"),
    marks: null, edgeLines: false, zebra: ZEBRA[district] ?? 0, lanes: [3.4], curbPaint: null, priority: 3, uvScale: 1,
  };
  // Calçada pelo bairro.
  const walkBy: Partial<Record<DistrictId, Walk>> = { praia: "ondas", centro: "petit", liberdade: "ladrilho", jardim: "grama", picanha: "grama" };
  style.walk = walkBy[district] ?? "calcada";
  if (district === "morro") style.walkWidth = 1.8;
  else if (district === "vila") style.walkWidth = 2.3;
  else if (district === "industrial") style.walkWidth = 2.6;
  if (district === "vila" || district === "morro") style.curbPaint = random() < 0.45 ? "branco" : null;
  else if (district === "centro" || district === "porto") style.curbPaint = random() < 0.25 ? "amarelo" : null;

  const rural = district === "serra" || district === "roca";
  switch (road.kind) {
    case "pista":
      Object.assign(style, { pave: "concreto", tone: TONES.pista, wear: 0, curb: false, walk: null, verge: 4, vergeTone: lin("#7f8a4c"), marks: "pista", zebra: 0, lanes: [], priority: 6, uvScale: 0.5 });
      break;
    case "taxiway":
      // Pista de táxi: o mesmo concreto da pista de pouso, sem meio-fio nem
      // calçada, com a linha amarela no eixo e as bordas amarelas.
      Object.assign(style, { pave: "concreto", tone: scale(TONES.pista, 1.04), wear: 0, curb: false, walk: null, verge: 3, vergeTone: lin("#7f8a4c"), marks: "taxiway", zebra: 0, lanes: [], priority: 5.5, uvScale: 0.5 });
      break;
    case "rodovia":
      Object.assign(style, {
        pave: district === "serra" ? "concreto" : "asfalto", tone: district === "serra" ? TONES.concreto : TONES.rodovia, wear: 0.3,
        curb: false, walk: null, verge: 3, vergeTone: lin("#8b8478"), marks: "rodovia", edgeLines: true, zebra: 0, lanes: [1.73, 5.2, 8.67], curbPaint: null, priority: 5,
      });
      break;
    case "avenida":
      Object.assign(style, { tone: scale(TONES.novo, 0.95 + random() * 0.1), wear: 0.15 + random() * 0.2, marks: "avenida", edgeLines: true, lanes: [1.75, 5.25, 8.6], priority: 4 });
      if (rural) Object.assign(style, { curb: false, walk: null, verge: 2.5, zebra: 0 });
      break;
    case "rua":
      if (rural) {
        Object.assign(style, { pave: "terra", tone: district === "serra" ? TONES.serra : TONES.roca, wear: 0, curb: false, walk: null, verge: 1.6, vergeTone: district === "serra" ? TONES.serra : TONES.roca, zebra: 0, lanes: [2.6], curbPaint: null, priority: 1 });
      } else if ((district === "porto" && random() < 0.4) || (district === "vila" && random() < 0.3)) {
        Object.assign(style, { pave: "paralelepipedo", tone: TONES.paralelepipedo, wear: 0.3, zebra: style.zebra * 0.5, priority: 2.5 });
      } else if (district === "industrial" && random() < 0.3) {
        Object.assign(style, { pave: "concreto", tone: TONES.concreto, wear: 0.4, marks: "rua", priority: 3 });
      } else {
        const worn = district === "morro" ? 1 : 0.45 + random() * 0.5;
        Object.assign(style, { tone: district === "morro" ? TONES.morro : scale(TONES.gasto, 0.9 + random() * 0.15), wear: worn, marks: "rua" });
        style.edgeLines = ["jardim", "picanha", "liberdade", "praia", "parque", "aeroporto"].includes(district) && random() < 0.7;
      }
      break;
    case "viela":
      if (rural) {
        Object.assign(style, { pave: "terra", tone: district === "serra" ? TONES.serra : TONES.roca, wear: 0, curb: false, walk: null, verge: 1.4, vergeTone: district === "serra" ? TONES.serra : TONES.roca, zebra: 0, lanes: [2.4], curbPaint: null, priority: 1 });
      } else if (district === "morro" && random() < 0.5) {
        Object.assign(style, { pave: "concreto", tone: scale(TONES.concreto, 0.85 + random() * 0.15), wear: 0.7, zebra: 0, walkWidth: 1.4, priority: 2 });
      } else {
        Object.assign(style, { pave: "paralelepipedo", tone: scale(TONES.paralelepipedo, 0.9 + random() * 0.15), wear: 0.4, zebra: 0, priority: 2 });
        if (district === "morro") style.walkWidth = 1.4;
      }
      break;
  }
  return style;
}

// --- Traçado: cada rua com o comprimento acumulado e as tangentes --------------

interface End {
  /** Até onde o cruzamento vai (m a partir do nó): a rua começa aqui. */
  trim: number;
  degree: number;
  /** Nó de passagem (duas ruas seguindo reto): as faixas continuam. */
  through: boolean;
  zebra: boolean;
  stop: boolean;
  pare: boolean;
}

interface Lay {
  road: Road;
  index: number;
  style: Style;
  district: DistrictId;
  half: number;
  /** Meia largura do pavimento (sem a sarjeta). */
  inner: number;
  len: number;
  s: number[];
  tx: number[];
  tz: number[];
  ends: [End, End];
}

const LAYS: Lay[] = [];

function layout(road: Road, index: number): Lay {
  const pts = road.points;
  const s: number[] = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const tx: number[] = [];
  const tz: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [px, pz] = pts[Math.max(0, i - 1)];
    const [nx, nz] = pts[Math.min(pts.length - 1, i + 1)];
    const l = Math.hypot(nx - px, nz - pz) || 1;
    tx.push((nx - px) / l);
    tz.push((nz - pz) / l);
  }
  const [mx, mz] = pts[Math.floor(pts.length / 2)];
  const district = districtAt(mx, mz);
  const style = styleOf(road, index, district);
  const half = road.width / 2;
  const end = (): End => ({ trim: 0.6, degree: 1, through: false, zebra: false, stop: false, pare: false });
  return { road, index, style, district, half, inner: style.curb ? half - GUTTER : half, len: s[s.length - 1], s, tx, tz, ends: [end(), end()] };
}

/** Ponto e tangente da rua a `s` metros do começo. */
const P = { x: 0, z: 0, dx: 0, dz: 0 };
function sample(lay: Lay, s: number) {
  const { s: acc, road } = lay;
  s = clamp(s, 0, lay.len);
  let lo = 0;
  let hi = acc.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (acc[m] <= s) lo = m;
    else hi = m;
  }
  const t = (s - acc[lo]) / (acc[hi] - acc[lo] || 1);
  const [ax, az] = road.points[lo];
  const [bx, bz] = road.points[hi];
  P.x = ax + (bx - ax) * t;
  P.z = az + (bz - az) * t;
  const dx = lay.tx[lo] + (lay.tx[hi] - lay.tx[lo]) * t;
  const dz = lay.tz[lo] + (lay.tz[hi] - lay.tz[lo]) * t;
  const l = Math.hypot(dx, dz) || 1;
  P.dx = dx / l;
  P.dz = dz / l;
  return P;
}

/** Distância (s) a partir do começo da rua de um ponto a `t` metros do nó da ponta `end`. */
const sOf = (lay: Lay, end: 0 | 1, t: number) => (end === 0 ? t : lay.len - t);

/** Estação: um corte transversal da rua em `s` (posição, lado esquerdo, alturas e normal). */
interface Station {
  s: number;
  x: number;
  z: number;
  dx: number;
  dz: number;
  /** Vetor para o lado "esquerdo" (u positivo). */
  lx: number;
  lz: number;
  /** Alturas do relevo em u = −outer, −half, 0, half, outer. */
  knots: number[];
  outer: number;
  half: number;
  n: Rgb;
}

function station(lay: Lay, s: number, outer: number): Station {
  const p = sample(lay, s);
  const lx = p.dz;
  const lz = -p.dx;
  const h = lay.half;
  const at = (u: number) => heightAt(p.x + lx * u, p.z + lz * u);
  const knots = [at(-outer), at(-h), heightAt(p.x, p.z), at(h), at(outer)];
  // Normal: inclinação ao longo (relevo) e de través (das bordas).
  const ga = (heightAt(p.x + p.dx, p.z + p.dz) - heightAt(p.x - p.dx, p.z - p.dz)) / 2;
  const gc = (knots[3] - knots[1]) / (2 * h);
  const gx = ga * p.dx + gc * lx;
  const gz = ga * p.dz + gc * lz;
  const len = Math.hypot(gx, 1, gz);
  return { s, x: p.x, z: p.z, dx: p.dx, dz: p.dz, lx, lz, knots, outer, half: h, n: [-gx / len, 1 / len, -gz / len] };
}

/** Altura do relevo na estação, a `u` metros do eixo (interpolada entre os nós). */
function heightIn(st: Station, u: number) {
  const k = st.knots;
  const h = st.half;
  const o = st.outer;
  if (u <= -h) return k[0] + (k[1] - k[0]) * ((u + o) / (o - h || 1));
  if (u <= 0) return k[1] + (k[2] - k[1]) * ((u + h) / h);
  if (u <= h) return k[2] + (k[3] - k[2]) * (u / h);
  return k[3] + (k[4] - k[3]) * ((u - h) / (o - h || 1));
}

// --- Corte transversal do pavimento ----------------------------------------------

interface Profile {
  us: number[];
  /** Brilho de cada coluna (mancha de óleo no meio da faixa, trilha dos pneus mais clara). */
  fac: number[];
  /** Desnível de cada coluna (sulcos da estrada de terra). */
  dh: number[];
  /** Quanto puxa para o verde do mato (terra: o meio e as beiras). */
  green: number[];
}

function profileOf(lay: Lay): Profile {
  const a = lay.inner;
  const cols = new Map<number, [number, number, number]>();
  const put = (u: number, fac: number, dh = 0, green = 0) => {
    if (Math.abs(u) > a + 1e-6) return;
    cols.set(Math.round(u * 1000) / 1000, [fac, dh, green]);
  };
  const { pave, lanes } = lay.style;
  if (pave === "terra") {
    put(-a, 0.95, 0, 0.75);
    put(a, 0.95, 0, 0.75);
    put(0, 1, 0.01, 0.55);
    for (const side of [-1, 1]) {
      for (const c of lanes) {
        put(side * (c - 0.85), 0.72, -0.05);
        put(side * (c + 0.85), 0.72, -0.05);
        put(side * c, 1.05, 0, 0.2);
        put(side * (c - 1.45), 1.02, 0, 0.3);
        put(side * (c + 1.5), 1, 0, 0.4);
      }
    }
  } else if (pave === "asfalto") {
    put(-a, 0.88);
    put(a, 0.88);
    put(0, 1);
    for (const side of [-1, 1]) {
      put(side * (a - 0.7), 0.98);
      for (const c of lanes) {
        put(side * c, 0.86);
        put(side * (c - 0.85), 1.06);
        put(side * (c + 0.85), 1.06);
      }
    }
  } else {
    put(-a, 0.9);
    put(a, 0.9);
    const step = a > 12 ? 5 : a / 2;
    for (let u = -a + step; u < a - 0.1; u += step) put(u, 1);
    put(0, 1);
  }
  const us = [...cols.keys()].sort((x, y) => x - y);
  return { us, fac: us.map((u) => cols.get(u)![0]), dh: us.map((u) => cols.get(u)![1]), green: us.map((u) => cols.get(u)![2]) };
}

const GRASS: Rgb = lin("#7d8a45");

/** Trechos recapeados (asfalto mais novo de lado a lado, com a emenda reta). */
function resurfacing(lay: Lay): [number, number][] {
  const { style } = lay;
  if (style.pave !== "asfalto" || style.wear < 0.3) return [];
  const random = rng(lay.index * 31 + 7);
  const spans: [number, number][] = [];
  const n = Math.floor(random() * 3);
  for (let k = 0; k < n; k++) {
    const length = 14 + random() * 50;
    const start = random() * Math.max(1, lay.len - length);
    if (!spans.some(([a, b]) => start < b + 4 && start + length > a - 4)) spans.push([start, start + length]);
  }
  return spans;
}

/** Cor do pavimento de uma rua num ponto (coluna `k` do corte, `fresh` = recapeado). */
function paveColor(style: Style, prof: Profile | null, k: number, x: number, z: number, fresh: boolean, weight = 1): Rgb {
  let c = scale(style.tone, macro(x, z));
  if (fresh) c = scale(mix(c, TONES.novo, 0.75), 0.92);
  if (prof) {
    c = scale(c, 1 + (prof.fac[k] - 1) * weight);
    if (prof.green[k] > 0) c = mix(c, GRASS, prof.green[k] * weight);
  }
  return c;
}

// --- Espaço livre ao lado (para a calçada não invadir a rua vizinha) -------------

const GRID = 30;
const gridKey = (gx: number, gz: number) => (gx + 2000) * 8192 + gz + 2000;
const segGrid = new Map<number, number[]>();
/** Pares de ruas que saem do mesmo cruzamento em ângulo fechado (sem esquina): uma corre do lado da outra. */
const SHARP = new Set<number>();
const pairKey = (a: number, b: number) => Math.min(a, b) * 100000 + Math.max(a, b);
/** Segmentos de todas as ruas: ax, az, bx, bz, rua. */
const segs: number[] = [];

function indexSegments() {
  for (const lay of LAYS) {
    const pts = lay.road.points;
    const st = lay.road.structure >= 0 ? STRUCTURES[lay.road.structure] : null;
    for (let i = 1; i < pts.length; i++) {
      // Trecho de obra de arte fora do chão (viaduto lá em cima, túnel lá
      // embaixo): a calçada das ruas do chão não desvia dele.
      if (st && offGround(st, pts[i - 1]) && offGround(st, pts[i])) continue;
      const id = segs.length / 5;
      segs.push(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], lay.index);
      const reach = lay.half + 8;
      const x0 = Math.floor((Math.min(pts[i - 1][0], pts[i][0]) - reach) / GRID);
      const x1 = Math.floor((Math.max(pts[i - 1][0], pts[i][0]) + reach) / GRID);
      const z0 = Math.floor((Math.min(pts[i - 1][1], pts[i][1]) - reach) / GRID);
      const z1 = Math.floor((Math.max(pts[i - 1][1], pts[i][1]) + reach) / GRID);
      for (let gx = x0; gx <= x1; gx++) {
        for (let gz = z0; gz <= z1; gz++) {
          const key = gridKey(gx, gz);
          const list = segGrid.get(key);
          if (list) list.push(id);
          else segGrid.set(key, [id]);
        }
      }
    }
  }
}

/** O ponto da obra está fora do chão (mais de 30 cm acima ou abaixo)? */
function offGround(st: (typeof STRUCTURES)[number], p: [number, number]) {
  let best = 0;
  let bd = Infinity;
  for (let k = 0; k < st.points.length; k++) {
    const d = (st.points[k][0] - p[0]) ** 2 + (st.points[k][1] - p[1]) ** 2;
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return Math.abs(st.y[best] - st.ground[best]) > 0.3;
}

const NODE_POS = new Map(NAV.map((n) => [n.id, [n.x, n.z] as [number, number]]));

/**
 * Quanto de calçada cabe a partir do ponto (x, z) da beira da rua `self`, sem
 * entrar no asfalto (ou na calçada) de outra rua. As ruas que saem do mesmo
 * cruzamento são ignoradas perto dele (a esquina cuida delas).
 */
function roomBeside(self: Lay, x: number, z: number, want: number) {
  let room = want;
  const list = segGrid.get(gridKey(Math.floor(x / GRID), Math.floor(z / GRID)));
  if (!list) return room;
  const { a, b } = self.road;
  for (const id of list) {
    const k = segs[id * 5 + 4];
    if (k === self.index) continue;
    const other = LAYS[k];
    const ax = segs[id * 5];
    const az = segs[id * 5 + 1];
    const bx = segs[id * 5 + 2];
    const bz = segs[id * 5 + 3];
    const shared = other.road.a === a || other.road.a === b ? other.road.a : other.road.b === a || other.road.b === b ? other.road.b : null;
    const sharp = shared !== null && SHARP.has(pairKey(k, self.index));
    if (shared && !sharp) {
      const [nx, nz] = NODE_POS.get(shared)!;
      if (Math.hypot((ax + bx) / 2 - nx, (az + bz) / 2 - nz) < 40) continue;
    }
    const dx = bx - ax;
    const dz = bz - az;
    const raw = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1);
    // Rua do lado (ângulo fechado): só conta onde ela corre ao lado deste ponto.
    if (sharp && (raw < 0 || raw > 1)) continue;
    const t = clamp(raw, 0, 1);
    const gap = Math.hypot(x - ax - dx * t, z - az - dz * t) - other.half;
    const fits = other.style.walk ? gap / 2 : gap - 0.3;
    if (fits < room) room = fits;
  }
  return room;
}

// --- Blocos ---------------------------------------------------------------------

interface TileOut {
  center: [number, number];
  reach: number;
  buckets: Map<MaterialKey, Bucket>;
}
const tiles = new Map<string, TileOut>();

function tileAt(x: number, z: number) {
  const tx = Math.floor(x / TILE);
  const tz = Math.floor(z / TILE);
  const key = `${tx},${tz}`;
  let tile = tiles.get(key);
  if (!tile) tiles.set(key, (tile = { center: [(tx + 0.5) * TILE, (tz + 0.5) * TILE], reach: 0, buckets: new Map() }));
  return tile;
}

/** Baldes do bloco de (x, z); `extent` = até onde a peça vai a partir desse ponto. */
function bucketsAt(x: number, z: number, extent: number) {
  const tile = tileAt(x, z);
  tile.reach = Math.max(tile.reach, Math.hypot(x - tile.center[0], z - tile.center[1]) + extent);
  return (key: MaterialKey) => {
    let b = tile.buckets.get(key);
    if (!b) tile.buckets.set(key, (b = new Bucket()));
    return b;
  };
}
type Buckets = ReturnType<typeof bucketsAt>;

// --- Beira: sarjeta, meio-fio, calçada e o pé dela (ou o barranco) -------------

/** Ponto da beira da rua (linha do meio-fio). */
interface EdgePt {
  x: number;
  z: number;
  /** Altura do relevo na linha do meio-fio. */
  h: number;
  /** Para fora da rua (horizontal, unitário). */
  ox: number;
  oz: number;
  /** Ponto (e altura) onde o pavimento termina e começa a sarjeta. */
  ix: number;
  iz: number;
  ih: number;
  /** Largura da calçada (ou do barranco) e altura do relevo na beira de fora. */
  w: number;
  hOut: number;
  n: Rgb;
  along: number;
  /** Sem meio-fio nem calçada aqui (o asfalto de outra rua encosta). */
  hidden?: boolean;
  /** false: sem espaço para o barranquinho atrás da calçada. */
  bank?: boolean;
}

interface EdgeKind {
  curb: boolean;
  walk: Walk | null;
  verge: number;
  vergeTone: Rgb;
  /** Cor do meio-fio em cada trecho (entre o ponto k e o k+1). */
  paint: (k: number) => Rgb;
  /** Bairro (cor do barranquinho atrás da calçada). */
  district: DistrictId;
}

const CONCRETE: Rgb = lin("#8f8b84");
/** Barranquinho atrás da calçada: terra na cor do chão de cada bairro (a textura de terra é avermelhada). */
const BANK = new Map<DistrictId, Rgb>(DISTRICTS.map((d) => [d.id, mix(lin(d.ground), [0.5, 0.5, 0.5], 0.25)]));
const GUTTER_TONE: Rgb = lin("#a7a39b");
const WALK_TONE: Record<Walk, Rgb> = {
  calcada: lin("#d9d5cd"),
  petit: lin("#f2efe8"),
  ondas: lin("#f4f1ea"),
  ladrilho: lin("#eae6e0"),
  grama: lin("#e8f0dd"),
};
/** Faixas da calçada (frações da largura depois do meio-fio) e o piso de cada uma. */
function walkBands(walk: Walk): [number, number, Walk][] {
  if (walk === "grama") return [[0, 0.32, "grama"], [0.32, 0.78, "calcada"], [0.78, 1, "grama"]];
  return [[0, 1, walk]];
}

const UP: Rgb = [0, 1, 0];

function buildEdge(pts: EdgePt[], kind: EdgeKind, B: Buckets) {
  if (pts.length < 2) return;
  if (kind.curb) {
    // Sarjeta (concreto, no nível do asfalto).
    const gutter = B("meiofio");
    let prev = -1;
    pts.forEach((p, k) => {
      const tone = scale(GUTTER_TONE, macro(p.x, p.z) * 0.95);
      const a = gutter.vertex(p.ix, p.ih + Y_ROAD, p.iz, p.n, p.along, 0, scale(tone, 0.9));
      gutter.vertex(p.x, p.h + Y_ROAD, p.z, p.n, p.along, GUTTER, scale(tone, 0.75));
      if (k > 0) gutter.quad(prev, prev + 1, a + 1, a);
      prev = a;
    });
    // Meio-fio: face de pé e o topo, trecho a trecho (cada um pode ter uma pintura).
    const curb = B("meiofio");
    for (let k = 0; k + 1 < pts.length; k++) {
      const p = pts[k];
      const q = pts[k + 1];
      const c = kind.paint(k);
      const face = (e: EdgePt): Rgb => [-e.ox, 0, -e.oz];
      if (p.hidden || q.hidden) continue;
      const f0 = curb.vertex(p.x, p.h + Y_ROAD - 0.02, p.z, face(p), p.along, 0, scale(c, 0.8));
      curb.vertex(p.x, p.h + Y_WALK, p.z, face(p), p.along, 0.17, c);
      curb.vertex(q.x, q.h + Y_WALK, q.z, face(q), q.along, 0.17, c);
      curb.vertex(q.x, q.h + Y_ROAD - 0.02, q.z, face(q), q.along, 0, scale(c, 0.8));
      curb.quad(f0, f0 + 1, f0 + 2, f0 + 3);
      const top = (e: EdgePt) => e.h + (e.hOut - e.h) * (CURB_TOP / Math.max(e.w, CURB_TOP)) + Y_WALK;
      const t0 = curb.vertex(p.x, p.h + Y_WALK, p.z, p.n, p.along, 0.17, c);
      curb.vertex(p.x + p.ox * CURB_TOP, top(p), p.z + p.oz * CURB_TOP, p.n, p.along, 0.32, c);
      curb.vertex(q.x + q.ox * CURB_TOP, top(q), q.z + q.oz * CURB_TOP, q.n, q.along, 0.32, c);
      curb.vertex(q.x, q.h + Y_WALK, q.z, q.n, q.along, 0.17, c);
      curb.quad(t0, t0 + 1, t0 + 2, t0 + 3);
    }
    if (kind.walk) {
      // Calçada em faixas (cada faixa com o seu piso); u = metros a partir do meio-fio.
      for (const [f0, f1, walk] of walkBands(kind.walk)) {
        const b = B(walk);
        let prevW = -1;
        pts.forEach((p, k) => {
          const span = Math.max(0, p.w - CURB_TOP);
          const d0 = CURB_TOP + span * f0;
          const d1 = CURB_TOP + span * f1;
          const y = (d: number) => p.h + (p.hOut - p.h) * (d / Math.max(p.w, 0.01)) + Y_WALK;
          const near = scale(WALK_TONE[walk], macro(p.x * 1.7, p.z * 1.7) * (walk === "grama" ? 1 : 0.97));
          const a = b.vertex(p.x + p.ox * d0, y(d0), p.z + p.oz * d0, p.n, d0, p.along, f0 === 0 ? scale(near, 0.9) : near);
          b.vertex(p.x + p.ox * d1, y(d1), p.z + p.oz * d1, p.n, d1, p.along, near);
          if (k > 0 && !p.hidden && !pts[k - 1].hidden) b.quad(prevW, prevW + 1, a + 1, a);
          prevW = a;
        });
      }
    }
    // Pé da calçada: a borda da placa (8 cm) e um barranquinho de grama até o
    // chão, para a calçada não ficar parecendo um degrau solto no gramado.
    const foot = B("meiofio");
    const bank = B("terra");
    const bankTone = BANK.get(kind.district) ?? CONCRETE;
    let prevF = -1;
    let prevB = -1;
    pts.forEach((p, k) => {
      const w = kind.walk ? Math.max(p.w, CURB_TOP) : CURB_TOP;
      const top = p.h + (p.hOut - p.h) * (w / Math.max(p.w, w)) + Y_WALK;
      const x = p.x + p.ox * w;
      const z = p.z + p.oz * w;
      const n: Rgb = [p.ox, 0, p.oz];
      const a = foot.vertex(x, top, z, n, p.along, 0, scale(CONCRETE, 0.8));
      foot.vertex(x, top - 0.08, z, n, p.along, 0.08, scale(CONCRETE, 0.6));
      const slope: Rgb = [p.ox * 0.45, 0.89, p.oz * 0.45];
      const reach = p.bank === false ? 0.05 : 0.9;
      const g = bank.vertex(x, top - 0.08, z, slope, 0, p.along, scale(bankTone, 0.85));
      bank.vertex(x + p.ox * reach, p.hOut + Y_FOOT, z + p.oz * reach, slope, reach, p.along, bankTone);
      const shown = k > 0 && !p.hidden && !pts[k - 1].hidden;
      if (shown) foot.quad(prevF, prevF + 1, a + 1, a);
      if (shown) bank.quad(prevB, prevB + 1, g + 1, g);
      prevF = a;
      prevB = g;
    });
  } else if (kind.verge > 0) {
    // Barranco de terra (ou brita) da beira do pavimento até o chão.
    const b = B("terra");
    let prev = -1;
    pts.forEach((p, k) => {
      const tone = scale(kind.vergeTone, macro(p.x, p.z));
      const x = p.x + p.ox * p.w;
      const z = p.z + p.oz * p.w;
      const a = b.vertex(p.x, p.h + Y_ROAD, p.z, p.n, 0, p.along, tone);
      b.vertex(x, p.hOut + Y_FOOT, z, p.n, p.w, p.along, mix(tone, GRASS, 0.7));
      if (k > 0) b.quad(prev, prev + 1, a + 1, a);
      prev = a;
    });
  }
}

const CURB_COLORS = {
  natural: lin("#7d7a74"),
  branco: lin("#e6e4de"),
  amarelo: lin("#e2a91c"),
};

// --- Cruzamentos -------------------------------------------------------------------

interface Arm {
  lay: Lay;
  end: 0 | 1;
  /** Direção saindo do nó (unitária) e ângulo dela. */
  dx: number;
  dz: number;
  angle: number;
  cap: number;
  mouth: number;
}

/** Ponto do braço a `t` m do nó e `u` m para o lado anti-horário (u negativo = horário), e o "para fora" desse lado. */
function armPoint(arm: Arm, t: number, u: number) {
  const p = sample(arm.lay, sOf(arm.lay, arm.end, t));
  // Lado anti-horário (olhando de cima, ângulo de atan2(z, x)) da direção que sai do nó.
  const sign = arm.end === 0 ? -1 : 1;
  const cx = p.dz * sign;
  const cz = -p.dx * sign;
  const side = u >= 0 ? 1 : -1;
  return { x: p.x + cx * u, z: p.z + cz * u, ox: cx * side, oz: cz * side };
}

/** Lado da rua (u da estrada, positivo = esquerda) que fica no lado anti-horário do braço. */
const ccwSign = (arm: Arm) => (arm.end === 0 ? -1 : 1);

type CornerType = "fillet" | "outer" | "straight" | "sharp";
interface Corner {
  type: CornerType;
  ti: number;
  tj: number;
  r: number;
  cx: number;
  cz: number;
}

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function cornerRadius(a: Style, b: Style) {
  const kinds = [a, b].map((s) => (s.marks === "pista" ? 15 : s.marks === "taxiway" ? 12 : s.marks === "rodovia" ? 9 : s.pave === "terra" ? 6 : s.priority >= 4 ? 6 : s.priority >= 3 ? 4.5 : 3.2));
  let r = Math.max(...kinds);
  if (a.curb && b.curb && a.walk && b.walk) r = Math.max(r, Math.max(a.walkWidth, b.walkWidth) + 1);
  return r;
}

/** Esquina entre o braço i (lado anti-horário) e o seguinte j (lado horário). */
function corner(nx: number, nz: number, i: Arm, j: Arm, gap: number): Corner {
  const hi = i.lay.half;
  const hj = j.lay.half;
  if (gap > Math.PI + 0.08) return { type: "outer", ti: 0, tj: 0, r: 0, cx: nx, cz: nz };
  if (gap > Math.PI - 0.08) {
    const t = Math.abs(hi - hj) * 2;
    return { type: "straight", ti: clamp(t, 0.6, i.cap), tj: clamp(t, 0.6, j.cap), r: 0, cx: nx, cz: nz };
  }
  // Arredondamento tangente às duas beiras: centro a (h + r) de cada uma.
  const qix = -i.dz;
  const qiz = i.dx;
  const qjx = j.dz;
  const qjz = -j.dx;
  for (const r of [cornerRadius(i.lay.style, j.lay.style), 1]) {
    const rx = qjx * (hj + r) - qix * (hi + r);
    const rz = qjz * (hj + r) - qiz * (hi + r);
    const det = -i.dx * j.dz + j.dx * i.dz;
    if (Math.abs(det) < 1e-6) break;
    const ti = (-rx * j.dz + j.dx * rz) / det;
    const tj = (i.dx * rz - i.dz * rx) / det;
    if (ti < 0 || tj < 0) break;
    if (ti <= i.cap && tj <= j.cap) {
      return { type: "fillet", ti, tj, r, cx: nx + i.dx * ti + qix * (hi + r), cz: nz + i.dz * ti + qiz * (hi + r) };
    }
  }
  return { type: "sharp", ti: i.cap, tj: j.cap, r: 0, cx: nx, cz: nz };
}

/** Linha da beira (sem as pontas, que vêm das estações) de uma esquina, com o "para fora". */
function cornerPath(nx: number, nz: number, i: Arm, j: Arm, c: Corner) {
  const hi = i.lay.half;
  const hj = j.lay.half;
  const out: { x: number; z: number; ox: number; oz: number }[] = [];
  const alongEdge = (arm: Arm, from: number, to: number, u: number) => {
    const n = Math.ceil(Math.abs(to - from) / 3);
    for (let k = 1; k < n; k++) out.push(armPoint(arm, from + ((to - from) * k) / n, u));
    if (n >= 1 && Math.abs(to - from) > 0.05) out.push(armPoint(arm, to, u));
  };
  const arc = (a: { x: number; z: number }, b: { x: number; z: number }, cx: number, cz: number, sweepHint: number | null, inward: boolean) => {
    const a0 = Math.atan2(a.z - cz, a.x - cx);
    const a1 = Math.atan2(b.z - cz, b.x - cx);
    const r0 = Math.hypot(a.x - cx, a.z - cz);
    const r1 = Math.hypot(b.x - cx, b.z - cz);
    let sweep = wrapPi(a1 - a0);
    if (sweepHint !== null) sweep = sweepHint + wrapPi(a1 - a0 - sweepHint);
    const n = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 14)));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const ang = a0 + sweep * t;
      const r = r0 + (r1 - r0) * t;
      const ox = Math.cos(ang) * (inward ? -1 : 1);
      const oz = Math.sin(ang) * (inward ? -1 : 1);
      out.push({ x: cx + Math.cos(ang) * r, z: cz + Math.sin(ang) * r, ox, oz });
    }
  };
  if (c.type === "fillet") {
    alongEdge(i, i.mouth, c.ti, hi);
    const ti = out.length ? out[out.length - 1] : armPoint(i, c.ti, hi);
    const tj = armPoint(j, c.tj, -hj);
    arc(ti, tj, c.cx, c.cz, null, true);
    out.push(tj);
    const back: typeof out = [];
    const n = Math.ceil(Math.abs(j.mouth - c.tj) / 3);
    for (let k = 1; k < n; k++) back.push(armPoint(j, c.tj + ((j.mouth - c.tj) * k) / n, -hj));
    out.push(...back);
  } else if (c.type === "outer") {
    alongEdge(i, i.mouth, 0, hi);
    const a = armPoint(i, 0, hi);
    if (!out.length) out.push(a);
    const b = armPoint(j, 0, -hj);
    const gap = wrapPi(j.angle - i.angle);
    arc(a, b, nx, nz, (gap <= 0 ? gap + Math.PI * 2 : gap) - Math.PI, false);
    out.push(b);
    const n = Math.ceil(j.mouth / 3);
    for (let k = 1; k < n; k++) out.push(armPoint(j, (j.mouth * k) / n, -hj));
  } else {
    // Reta (ou aguda): liga as duas pontas direto.
    const a = armPoint(i, i.mouth, hi);
    const b = armPoint(j, j.mouth, -hj);
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 3);
    let ox = -(b.z - a.z);
    let oz = b.x - a.x;
    const l = Math.hypot(ox, oz) || 1;
    ox /= l;
    oz /= l;
    if (ox * ((a.x + b.x) / 2 - nx) + oz * ((a.z + b.z) / 2 - nz) < 0) {
      ox = -ox;
      oz = -oz;
    }
    for (let k = 1; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n, ox, oz });
  }
  // Tira pontos repetidos (ou quase).
  return out.filter((p, k) => k === 0 || Math.hypot(p.x - out[k - 1].x, p.z - out[k - 1].z) > 0.05);
}

/** Mais forte primeiro: quem decide o piso do cruzamento. */
const dominant = (arms: Arm[]) => arms.reduce((best, a) => (a.lay.style.priority > best.lay.style.priority || (a.lay.style.priority === best.lay.style.priority && a.lay.half > best.lay.half) ? a : best));

interface Junction {
  node: (typeof NAV)[number];
  arms: Arm[];
  corners: Corner[];
}

function planJunction(node: (typeof NAV)[number]): Junction | null {
  if (!node.links.length) return null;
  const arms: Arm[] = node.links.map((link) => {
    const lay = LAYS[link.road];
    const end: 0 | 1 = link.reversed ? 1 : 0;
    const p = sample(lay, sOf(lay, end, Math.min(6, lay.len * 0.3)));
    const dx = p.x - node.x;
    const dz = p.z - node.z;
    const l = Math.hypot(dx, dz) || 1;
    return { lay, end, dx: dx / l, dz: dz / l, angle: Math.atan2(dz, dx), cap: Math.min(32, lay.len * 0.4), mouth: 0.6 };
  });
  arms.sort((a, b) => a.angle - b.angle);
  const n = arms.length;
  const corners: Corner[] = [];
  for (let k = 0; k < n; k++) {
    const i = arms[k];
    const j = arms[(k + 1) % n];
    let gap = n === 1 ? Math.PI * 2 : j.angle - i.angle;
    if (gap <= 0) gap += Math.PI * 2;
    corners.push(corner(node.x, node.z, i, j, gap));
  }
  corners.forEach((c, k) => {
    if (c.type === "sharp") SHARP.add(pairKey(arms[k].lay.index, arms[(k + 1) % n].lay.index));
  });
  for (let k = 0; k < n; k++) {
    const before = corners[(k - 1 + n) % n];
    const after = corners[k];
    arms[k].mouth = clamp(Math.max(0.6, before.tj, after.ti), 0.6, arms[k].cap);
  }
  // Pontas das ruas: até onde vai o cruzamento e o que pintar perto dele.
  const top = dominant(arms);
  for (const [k, arm] of arms.entries()) {
    const end = arm.lay.ends[arm.end];
    end.trim = arm.mouth;
    end.degree = n;
    end.through = n === 2 && corners.every((c) => c.type === "straight" || c.type === "outer") && Math.abs(wrapPi(arms[1].angle - arms[0].angle)) > Math.PI - 0.5;
    const style = arm.lay.style;
    const random = rng(arm.lay.index * 13 + arm.end * 7 + 3 + k);
    const markable = (style.marks === "rua" || style.marks === "avenida") && n >= 3 && arm.lay.len > 2 * (arm.mouth + 12);
    end.zebra = markable && random() < style.zebra;
    const minor = top.lay.style.priority > style.priority;
    end.pare = markable && (minor ? random() < 0.8 : random() < 0.2) && style.zebra > 0.15;
    end.stop = end.zebra || end.pare;
  }
  return { node, arms, corners };
}

/** Pontos do pavimento na boca da rua (as mesmas colunas da primeira linha da rua). */
function mouthRow(arm: Arm, prof: Profile, st: Station) {
  const sign = ccwSign(arm);
  // Do lado horário para o anti-horário (u da estrada vai de −sign·a até +sign·a).
  const us = sign > 0 ? prof.us : [...prof.us].reverse();
  return us.map((u) => ({ u, k: prof.us.indexOf(u), x: st.x + st.lx * u, z: st.z + st.lz * u, y: heightIn(st, u) + Y_ROAD + prof.dh[prof.us.indexOf(u)] }));
}

/** Estação de uma ponta da rua (a mesma que a rua usa para a primeira/última linha). */
const endStation = (lay: Lay, end: 0 | 1) => station(lay, sOf(lay, end, lay.ends[end].trim), lay.half + Math.max(lay.style.walkWidth, lay.style.verge));

function buildJunction(j: Junction, profiles: Profile[]) {
  const { node, arms, corners } = j;
  const n = arms.length;
  const top = dominant(arms);
  const style = top.lay.style;
  const B = bucketsAt(node.x, node.z, Math.max(...arms.map((a) => a.mouth + a.lay.half + 6)));
  const pave = B(style.pave);
  const hn = heightAt(node.x, node.z);
  const k0 = style.uvScale;
  const center = pave.vertex(node.x, hn + Y_ROAD, node.z, groundNormal(node.x, node.z), node.x * k0, node.z * k0, paveColor(style, null, 0, node.x, node.z, false));
  const ring: number[] = [];
  const stations = arms.map((arm) => endStation(arm.lay, arm.end));
  for (let k = 0; k < n; k++) {
    const arm = arms[k];
    const next = arms[(k + 1) % n];
    const prof = profiles[arm.lay.index];
    const st = stations[k];
    // Boca da rua.
    for (const p of mouthRow(arm, prof, st)) {
      const c = paveColor(arm.lay.style.pave === style.pave ? arm.lay.style : style, prof, p.k, p.x, p.z, false, 0);
      ring.push(pave.vertex(p.x, p.y, p.z, st.n, p.x * k0, p.z * k0, c));
    }
    // Esquina até a próxima rua.
    const c = corners[k];
    const path = cornerPath(node.x, node.z, arm, next, c);
    const curbed = c.type !== "sharp" && arm.lay.style.curb && next.lay.style.curb;
    const inset = curbed ? GUTTER : 0;
    const walk = curbed && arm.lay.style.walk && next.lay.style.walk ? (arm.lay.style.priority >= next.lay.style.priority ? arm.lay.style.walk : next.lay.style.walk) : null;
    const verge = curbed || c.type === "sharp" ? 0 : Math.max(arm.lay.style.verge, next.lay.style.verge, 1.2);
    const vergeTone = arm.lay.style.verge >= next.lay.style.verge ? arm.lay.style.vergeTone : next.lay.style.vergeTone;
    // Pontos da beira: as pontas vêm das estações das duas ruas (sem fresta).
    const nextSt = stations[(k + 1) % n];
    const edge: EdgePt[] = [];
    const fromStation = (arm2: Arm, st2: Station, side: number, w: number): EdgePt => {
      const u = ccwSign(arm2) * side;
      const s2 = u > 0 ? 1 : -1;
      const a = arm2.lay.inner * s2;
      return {
        x: st2.x + st2.lx * st2.half * s2, z: st2.z + st2.lz * st2.half * s2, h: heightIn(st2, st2.half * s2),
        ox: st2.lx * s2, oz: st2.lz * s2,
        ix: st2.x + st2.lx * a, iz: st2.z + st2.lz * a, ih: heightIn(st2, a),
        w, hOut: heightIn(st2, (st2.half + w) * s2), n: st2.n, along: 0,
      };
    };
    const wi = walk ? arm.lay.style.walkWidth : verge;
    const wj = walk ? next.lay.style.walkWidth : verge;
    edge.push(fromStation(arm, st, 1, wi));
    const total = path.length + 1;
    path.forEach((p, m) => {
      const t = (m + 1) / total;
      const w = wi + (wj - wi) * t;
      const ix = p.x - p.ox * inset;
      const iz = p.z - p.oz * inset;
      edge.push({ x: p.x, z: p.z, h: heightAt(p.x, p.z), ox: p.ox, oz: p.oz, ix, iz, ih: heightAt(ix, iz), w, hOut: heightAt(p.x + p.ox * w, p.z + p.oz * w), n: groundNormal(p.x, p.z), along: 0 });
    });
    edge.push(fromStation(next, nextSt, -1, wj));
    // Sem pontos repetidos (a esquina pode começar exatamente na ponta da rua).
    for (let m = edge.length - 2; m >= 1; m--) {
      if (Math.hypot(edge[m].x - edge[m - 1].x, edge[m].z - edge[m - 1].z) < 0.05 || Math.hypot(edge[m].x - edge[m + 1].x, edge[m].z - edge[m + 1].z) < 0.05) edge.splice(m, 1);
    }
    for (let m = 1; m < edge.length; m++) edge[m].along = edge[m - 1].along + Math.hypot(edge[m].x - edge[m - 1].x, edge[m].z - edge[m - 1].z);
    // Miolo: os pontos de dentro da esquina (as pontas já entraram com as bocas).
    for (let m = 1; m < edge.length - 1; m++) {
      const e = edge[m];
      const x = curbed ? e.ix : e.x;
      const z = curbed ? e.iz : e.z;
      ring.push(pave.vertex(x, (curbed ? e.ih : e.h) + Y_ROAD, z, e.n, x * k0, z * k0, paveColor(style, null, 0, x, z, false)));
    }
    if (c.type === "sharp") continue;
    const paint = top.lay.style.curbPaint === "amarelo" || arm.lay.style.curbPaint === "amarelo" ? CURB_COLORS.amarelo : arm.lay.style.curbPaint === "branco" && next.lay.style.curbPaint === "branco" ? CURB_COLORS.branco : CURB_COLORS.natural;
    buildEdge(edge, { curb: curbed, walk, verge, vergeTone, paint: () => paint, district: top.lay.district }, B);
  }
  for (let k = 0; k < ring.length; k++) pave.tri(center, ring[k], ring[(k + 1) % ring.length]);
}

// --- Trecho de rua -------------------------------------------------------------------

function buildRoad(lay: Lay, prof: Profile) {
  // Pontes, viadutos e túneis: o tabuleiro é desenhado em structures.ts (só os cruzamentos das pontas ficam aqui).
  if (lay.road.structure >= 0) return;
  const { style } = lay;
  const s0 = lay.ends[0].trim;
  const s1 = lay.len - lay.ends[1].trim;
  if (s1 - s0 < 0.3) return;
  const [mx, mz] = lay.road.points[Math.floor(lay.road.points.length / 2)];
  const B = bucketsAt(mx, mz, lay.len / 2 + lay.half + 8);
  const outerFull = lay.half + Math.max(style.walkWidth, style.verge);

  // Estações: os pontos da rua, mais as emendas dos recapeamentos (duas linhas no mesmo lugar).
  const spans = resurfacing(lay);
  const marks: { s: number; fresh: boolean }[] = [];
  const freshAt = (s: number) => spans.some(([a, b]) => s > a && s < b);
  marks.push({ s: s0, fresh: freshAt(s0 + 0.01) });
  for (const s of lay.s) if (s > s0 + 0.2 && s < s1 - 0.2) marks.push({ s, fresh: freshAt(s) });
  for (const [a, b] of spans) {
    for (const e of [a, b]) {
      if (e > s0 + 0.2 && e < s1 - 0.2) marks.push({ s: e, fresh: freshAt(e - 0.01) }, { s: e + 1e-3, fresh: freshAt(e + 0.01) });
    }
  }
  marks.push({ s: s1, fresh: freshAt(s1 - 0.01) });
  marks.sort((a, b) => a.s - b.s);

  // A primeira e a última estação são as mesmas das bocas dos cruzamentos.
  const stations = marks.map((m, k) => (k === 0 ? endStation(lay, 0) : k === marks.length - 1 ? endStation(lay, 1) : station(lay, m.s, outerFull)));

  // Pavimento.
  const pave = B(style.pave);
  let prev = -1;
  stations.forEach((st, k) => {
    const first = pave.nv;
    prof.us.forEach((u, c) => {
      const x = st.x + st.lx * u;
      const z = st.z + st.lz * u;
      // As faixas do corte somem nos últimos metros: a boca casa com o miolo do cruzamento.
      const weight = clamp(Math.min(st.s - s0, s1 - st.s) / 8, 0, 1);
      pave.vertex(x, heightIn(st, u) + Y_ROAD + prof.dh[c], z, st.n, u * style.uvScale, st.s * style.uvScale, paveColor(style, prof, c, x, z, marks[k].fresh, weight));
    });
    if (k > 0 && st.s - stations[k - 1].s > 2e-3) {
      for (let c = 0; c + 1 < prof.us.length; c++) pave.quad(prev + c, prev + c + 1, first + c + 1, first + c);
    }
    prev = first;
  });

  // Beiras dos dois lados.
  const random = rng(lay.index * 977 + 5);
  const solid = stations.filter((st, k) => k === 0 || st.s - stations[k - 1].s > 2e-3);
  const curbRuns = solid.map(() => random());
  for (const side of [-1, 1]) {
    const pts: EdgePt[] = solid.map((st) => {
      const x = st.x + st.lx * st.half * side;
      const z = st.z + st.lz * st.half * side;
      let w = style.curb && style.walk ? style.walkWidth : style.verge;
      let hidden = false;
      let bank = true;
      if (style.curb && style.walk) {
        const room = roomBeside(lay, x, z, w);
        hidden = room < 0.2;
        bank = room > w + 1;
        w = Math.max(CURB_TOP + 0.05, Math.min(w, room));
      }
      const a = lay.inner * side;
      return {
        hidden,
        bank,
        x, z, h: heightIn(st, st.half * side), ox: st.lx * side, oz: st.lz * side,
        ix: st.x + st.lx * a, iz: st.z + st.lz * a, ih: heightIn(st, a),
        w, hOut: heightIn(st, (st.half + w) * side), n: st.n, along: st.s,
      };
    });
    const paint = (k: number): Rgb => {
      const s = solid[k].s;
      const nearEnd = s - s0 < 9 || s1 - s < 9;
      if (style.curbPaint === "amarelo" && (nearEnd || curbRuns[k] < 0.3)) return CURB_COLORS.amarelo;
      if (style.curbPaint === "branco") return scale(CURB_COLORS.branco, 0.85 + curbRuns[k] * 0.15);
      return scale(CURB_COLORS.natural, 0.9 + curbRuns[k] * 0.15);
    };
    buildEdge(pts, { curb: style.curb, walk: style.walk, verge: style.verge, vergeTone: style.vergeTone, paint, district: lay.district }, B);
  }

  buildMarkings(lay, B);
}

// --- Sinalização pintada ---------------------------------------------------------

const WHITE: Rgb = lin("#f2f1ec");
const YELLOW: Rgb = lin("#f0b419");

/** Normal do relevo no ponto da rua mais perto de `s` (guardada: a tinta pede muitas vezes). */
const normals = new Map<Lay, Rgb[]>();
function pointNormal(lay: Lay, s: number): Rgb {
  let list = normals.get(lay);
  if (!list) normals.set(lay, (list = lay.road.points.map(([x, z]) => groundNormal(x, z))));
  let lo = 0;
  let hi = lay.s.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (lay.s[m] <= s) lo = m;
    else hi = m;
  }
  return list[s - lay.s[lo] < lay.s[hi] - s ? lo : hi];
}

/** Faixa pintada de s0 a s1 (ao longo da rua), de u0 a u1 (de través). */
function paintBand(lay: Lay, B: Buckets, s0: number, s1: number, u0: number, u1: number, color: Rgb) {
  if (s1 < s0) [s0, s1] = [s1, s0];
  if (s1 - s0 < 0.05) return;
  const b = B("tinta");
  const rows = [s0];
  for (const s of lay.s) if (s > s0 + 0.5 && s < s1 - 0.5) rows.push(s);
  rows.push(s1);
  const cols = Math.max(1, Math.ceil(Math.abs(u1 - u0) / 2.5));
  let prev = -1;
  for (const s of rows) {
    const p = sample(lay, s);
    const lx = p.dz;
    const lz = -p.dx;
    const n = pointNormal(lay, s);
    const first = b.nv;
    for (let c = 0; c <= cols; c++) {
      const u = u0 + ((u1 - u0) * c) / cols;
      const x = p.x + lx * u;
      const z = p.z + lz * u;
      b.vertex(x, heightAt(x, z) + Y_PAINT, z, n, u, s, color);
    }
    if (prev >= 0) for (let c = 0; c < cols; c++) b.quad(prev + c, prev + c + 1, first + c + 1, first + c);
    prev = first;
  }
}

/** Linha contínua (centro em u, largura w). */
const line = (lay: Lay, B: Buckets, s0: number, s1: number, u: number, w: number, color: Rgb) => paintBand(lay, B, s0, s1, u - w / 2, u + w / 2, color);

/** Linha tracejada: `dash` pintado, `gap` sem pintar. */
function dashed(lay: Lay, B: Buckets, s0: number, s1: number, u: number, w: number, dash: number, gap: number, color: Rgb) {
  const length = s1 - s0;
  if (length < dash) return;
  const count = Math.floor((length + gap) / (dash + gap));
  const start = s0 + (length - (count * (dash + gap) - gap)) / 2;
  for (let k = 0; k < count; k++) line(lay, B, start + k * (dash + gap), start + k * (dash + gap) + dash, u, w, color);
}

/** Onde as linhas param perto da ponta (m a partir do nó). */
function clearance(lay: Lay, end: 0 | 1) {
  const e = lay.ends[end];
  if (e.through) return 0;
  return e.trim + (e.zebra ? 7.6 : e.stop ? 2.6 : 1.5);
}

function buildMarkings(lay: Lay, B: Buckets) {
  const { style } = lay;
  const a = lay.inner;
  const c0 = clearance(lay, 0);
  const c1 = clearance(lay, 1);
  const s0 = c0;
  const s1 = lay.len - c1;
  if (style.marks && s1 - s0 > 3) {
    switch (style.marks) {
      case "rua":
        dashed(lay, B, s0, s1, 0, 0.12, 3, 5, WHITE);
        if (style.edgeLines) for (const side of [-1, 1]) line(lay, B, s0, s1, side * (a - 0.3), 0.12, WHITE);
        break;
      case "avenida":
        for (const side of [-1, 1]) {
          line(lay, B, s0, s1, side * 0.13, 0.12, YELLOW);
          dashed(lay, B, s0 + 1, s1 - 1, side * 3.5, 0.12, 4, 6, WHITE);
          dashed(lay, B, s0 + 1, s1 - 1, side * 7, 0.12, 4, 6, WHITE);
          line(lay, B, s0, s1, side * (a - 0.3), 0.12, WHITE);
        }
        break;
      case "rodovia":
        for (const side of [-1, 1]) {
          line(lay, B, s0, s1, side * 0.16, 0.15, YELLOW);
          dashed(lay, B, s0, s1, side * 3.47, 0.15, 4, 8, WHITE);
          dashed(lay, B, s0, s1, side * 6.93, 0.15, 4, 8, WHITE);
          line(lay, B, s0, s1, side * 10.4, 0.2, WHITE);
        }
        break;
      case "pista":
        buildRunway(lay, B);
        break;
      case "taxiway":
        // Eixo amarelo e as bordas em linha dupla amarela.
        line(lay, B, s0, s1, 0, 0.3, YELLOW);
        for (const side of [-1, 1]) {
          line(lay, B, s0, s1, side * (a - 0.5), 0.15, YELLOW);
          line(lay, B, s0, s1, side * (a - 0.85), 0.15, YELLOW);
        }
        break;
    }
  }
  // Perto dos cruzamentos: faixa de pedestre, linha de retenção e PARE.
  for (const end of [0, 1] as const) {
    const e = lay.ends[end];
    if (!e.stop && !e.zebra) continue;
    const at = (t: number) => sOf(lay, end, t);
    // A mão de quem chega no cruzamento: lado esquerdo (u > 0) da rua na ponta A, direito na ponta B.
    const inSide = end === 0 ? 1 : -1;
    let t = e.trim + 1;
    if (e.zebra) {
      for (let u = -a + 0.5; u <= a - 0.5 + 1e-6; u += 1) line(lay, B, at(t), at(t + 4), u, 0.5, WHITE);
      t += 5.2;
    }
    if (e.stop) {
      const from = style.marks === "avenida" ? 0.3 : 0.12;
      paintBand(lay, B, at(t), at(t + 0.4), inSide * from, inSide * (a - 0.15), WHITE);
    }
  }
}

/** Pista do aeroporto: eixo tracejado, bordas, cabeceiras (piano), números e marcas de toque. */
function buildRunway(lay: Lay, B: Buckets) {
  const a = lay.inner;
  for (const side of [-1, 1]) line(lay, B, 2, lay.len - 2, side * (a - 1.2), 0.9, WHITE);
  dashed(lay, B, 75, lay.len - 75, 0, 0.9, 12, 8, WHITE);
  for (const end of [0, 1] as const) {
    const at = (t: number) => sOf(lay, end, t);
    for (const side of [-1, 1]) {
      for (let k = 0; k < 6; k++) line(lay, B, at(6), at(36), side * (2.5 + k * 2.6), 1.8, WHITE);
      // Ponto de visada e zona de toque.
      line(lay, B, at(150), at(195), side * 7, 6, WHITE);
      for (let k = 0; k < 3; k++) line(lay, B, at(90), at(112), side * (4.5 + k * 2.7), 1.8, WHITE);
      for (let k = 0; k < 2; k++) line(lay, B, at(240), at(262), side * (4.5 + k * 2.7), 1.8, WHITE);
    }
  }
}

// --- Decalques e tachas (de perto) -------------------------------------------------

interface Decal {
  name: DecalName;
  x: number;
  z: number;
  /** Direção do u da textura (unitária) e tamanho nela; v é a outra direção. */
  ux: number;
  uz: number;
  w: number;
  vx: number;
  vz: number;
  l: number;
  y: number;
  tint: Rgb;
}

interface Stud {
  x: number;
  z: number;
  dx: number;
  dz: number;
  color: Rgb;
}

const DECAL_LIST: Decal[] = [];
const STUDS: Stud[] = [];
const NO_TINT: Rgb = [1, 1, 1];

/**
 * Decalque na rua: centro a `s` (ao longo) e `u` (de través), `w` de través e
 * `l` ao longo; `flip` vira a frente (v 0) para o fim da rua.
 */
function roadDecal(lay: Lay, name: DecalName, s: number, u: number, w: number, l: number, opts: { y?: number; tint?: Rgb; rotate?: number; toEnd?: boolean } = {}) {
  const p = sample(lay, s);
  const lx = p.dz;
  const lz = -p.dx;
  // v ao longo: para o começo (frente em direção ao nó A) ou para o fim.
  const dir = opts.toEnd ? -1 : 1;
  let vx = p.dx * dir;
  let vz = p.dz * dir;
  // u: o lado direito de quem anda contra v (para a escrita sair certa).
  let ux = vz;
  let uz = -vx;
  if (opts.rotate) {
    const c = Math.cos(opts.rotate);
    const sn = Math.sin(opts.rotate);
    [ux, uz] = [ux * c - uz * sn, ux * sn + uz * c];
    [vx, vz] = [vx * c - vz * sn, vx * sn + vz * c];
  }
  DECAL_LIST.push({ name, x: p.x + lx * u, z: p.z + lz * u, ux, uz, w, vx, vz, l, y: opts.y ?? Y_DECAL, tint: opts.tint ?? NO_TINT });
}

function planDecals(lay: Lay) {
  if (lay.road.structure >= 0) return;
  const { style } = lay;
  const random = rng(lay.index * 4099 + 23);
  const a = lay.inner;
  const s0 = lay.ends[0].trim + 2;
  const s1 = lay.len - lay.ends[1].trim - 2;
  if (s1 <= s0) return;
  const pick = (min: number, max: number) => min + random() * (max - min);
  const lanes = style.lanes.length ? style.lanes : [a / 2];
  const lane = () => (random() < 0.5 ? -1 : 1) * lanes[Math.floor(random() * lanes.length)];
  /** Espalha decalques a cada `every` m (em média) com probabilidade `p`. */
  const scatter = (every: number, p: number, fn: (s: number) => void) => {
    for (let s = s0 + random() * every; s < s1; s += every * (0.5 + random())) if (random() < p) fn(s);
  };
  const paved = style.pave !== "terra";
  const asphalt = style.pave === "asfalto";
  const wear = style.wear;

  if (style.marks === "taxiway") {
    scatter(40, 0.5, (s) => roadDecal(lay, "borracha", s, (random() - 0.5) * 4, pick(1.5, 3), pick(6, 14), { rotate: (random() - 0.5) * 0.05 }));
    scatter(50, 0.4, (s) => roadDecal(lay, "oleo", s, (random() - 0.5) * a, pick(1, 2), pick(1.5, 3), { rotate: random() * Math.PI }));
    return;
  }
  if (style.marks === "pista") {
    for (const end of [0, 1] as const) {
      for (let k = 0; k < 26; k++) {
        roadDecal(lay, "borracha", sOf(lay, end, pick(80, 330)), (random() - 0.5) * 9, pick(3, 6), pick(15, 40), { rotate: (random() - 0.5) * 0.02 });
      }
      // Números da cabeceira (lidos por quem pousa: a frente para o lado de dentro).
      roadDecal(lay, end === 0 ? "n09" : "n27", sOf(lay, end, 54), 0, 10, 18, { toEnd: end === 0 });
    }
    return;
  }
  if (!paved) {
    scatter(60, 0.4, (s) => roadDecal(lay, "umidade", s, (random() - 0.5) * a, pick(1.5, 3), pick(1.5, 3.5), { tint: lin("#6b4a35") }));
    return;
  }

  // Bueiros e caixas no meio da rua.
  scatter(55, 0.7, (s) => roadDecal(lay, random() < 0.75 ? "bueiro" : "caixa", s, random() < 0.3 ? 0 : lane() * 0.9, 0.9, 0.9, { rotate: random() * Math.PI }));
  if (style.curb) {
    // Boca de lobo junto do meio-fio (perto das esquinas e no meio da quadra).
    for (const side of [-1, 1]) {
      for (const s of [s0 + 1.5, s1 - 1.5]) if (random() < 0.6) roadDecal(lay, "grelha", s, side * (lay.half - 0.35), 1.1, 1.1, { rotate: Math.PI / 2 });
      scatter(45, 0.4, (s) => roadDecal(lay, "grelha", s, side * (lay.half - 0.35), 1.1, 1.1, { rotate: Math.PI / 2 }));
      // Areia e folhas na sarjeta; umidade.
      scatter(18, 0.45, (s) => {
        const w = pick(0.7, 1.2);
        // u 0 da textura (o lado mais sujo) encostado no meio-fio.
        roadDecal(lay, "areia", s, side * (lay.half - w / 2), w, pick(2, 5), { rotate: side > 0 ? Math.PI : 0 });
      });
      scatter(70, 0.3, (s) => roadDecal(lay, "umidade", s, side * (lay.half - 1.2), pick(1.5, 2.5), pick(2, 4)));
      // Calçada: tampas, registros e sujeira.
      if (style.walk) {
        const wcenter = lay.half + style.walkWidth * 0.55;
        scatter(40, 0.45, (s) => roadDecal(lay, random() < 0.6 ? "caixa" : "registro", s, side * wcenter, 0.6, 0.6, { y: Y_WALK_DECAL, rotate: random() < 0.5 ? 0 : Math.PI / 2 }));
        const dirty = lay.district === "centro" || lay.district === "porto" || lay.district === "vila" || lay.district === "industrial" ? 0.6 : 0.2;
        scatter(14, dirty, (s) => roadDecal(lay, "lixo", s, side * (lay.half + pick(0.6, style.walkWidth - 0.4)), pick(0.8, 1.4), pick(0.8, 1.4), { y: Y_WALK_DECAL, rotate: random() * Math.PI * 2 }));
      }
    }
  }
  if (asphalt) {
    // Remendos, couro de jacaré, piche e trincas: mais nas ruas gastas.
    scatter(30, 0.25 + wear * 0.6, (s) => {
      const fresh = random() < 0.6;
      roadDecal(lay, fresh ? "remendo" : "remendoVelho", s, (random() - 0.5) * (a * 1.6), pick(1.2, 3.8), pick(1, 4.5), { rotate: (random() - 0.5) * 0.12 });
    });
    if (wear > 0.4) scatter(55, wear * 0.6, (s) => roadDecal(lay, "jacare", s, lane() + (random() - 0.5), pick(2, 3.5), pick(2.5, 5), { rotate: random() * Math.PI }));
    scatter(45, 0.15 + wear * 0.5, (s) => roadDecal(lay, "piche", s, (random() - 0.5) * a * 1.4, pick(2, 4), pick(4, 9), { rotate: (random() - 0.5) * 0.6 }));
    scatter(50, wear * 0.5, (s) => roadDecal(lay, "trinca", s, lane() + (random() < 0.5 ? -1 : 1) * 1.2, 0.8, pick(4, 10)));
    // Óleo no meio das faixas, marcas de pneu.
    scatter(28, 0.5, (s) => roadDecal(lay, random() < 0.5 ? "oleo" : "pingos", s, lane(), pick(0.9, 1.6), pick(1.2, 3.5), { rotate: (random() - 0.5) * 0.3 }));
    if (style.priority >= 4) scatter(110, 0.35, (s) => roadDecal(lay, "pneu", s, lane(), 3.2, pick(8, 22), { rotate: (random() - 0.5) * 0.25 }));
  } else {
    scatter(40, 0.35, (s) => roadDecal(lay, "oleo", s, lane(), pick(0.9, 1.5), pick(1.2, 2.5), { rotate: random() * Math.PI }));
    scatter(35, 0.3, (s) => roadDecal(lay, "umidade", s, (random() - 0.5) * a, pick(1.5, 3), pick(2, 4)));
  }

  // Na chegada dos cruzamentos: PARE, setas e óleo de quem espera o sinal.
  for (const end of [0, 1] as const) {
    const e = lay.ends[end];
    if (!e.stop) continue;
    const inSide = end === 0 ? 1 : -1;
    const stopT = e.trim + 1 + (e.zebra ? 5.2 : 0);
    const laneU = inSide * lanes[0];
    const toEnd = end === 1;
    if (e.pare) roadDecal(lay, "pare", sOf(lay, end, stopT + 2.6), laneU, 2.6, 3.4, { toEnd });
    if (style.marks === "avenida") {
      for (const c of lanes.slice(0, 2)) if (random() < 0.6) roadDecal(lay, "seta", sOf(lay, end, stopT + 9), inSide * c, 1.3, 5, { toEnd });
    }
    for (let k = 0; k < 3; k++) {
      if (random() < 0.7) roadDecal(lay, random() < 0.5 ? "oleo" : "pingos", sOf(lay, end, stopT + pick(1.5, 22)), laneU + (random() - 0.5) * 0.5, pick(0.9, 1.4), pick(1.2, 3));
    }
  }

  // Tachas: rodovia (eixo amarelo, divisórias e bordas) e o eixo das avenidas.
  if (style.marks === "rodovia" || style.marks === "avenida") {
    const c0 = clearance(lay, 0);
    const c1 = lay.len - clearance(lay, 1);
    const studs = style.marks === "rodovia"
      ? ([[0, 8, YELLOW], [3.47, 16, WHITE], [-3.47, 16, WHITE], [6.93, 16, WHITE], [-6.93, 16, WHITE], [10.4, 16, WHITE], [-10.4, 16, WHITE]] as const)
      : ([[0, 12, YELLOW]] as const);
    for (const [u, every, color] of studs) {
      for (let s = c0 + 2; s < c1 - 2; s += every) {
        const p = sample(lay, s);
        STUDS.push({ x: p.x + p.dz * u, z: p.z - p.dx * u, dx: p.dx, dz: p.dz, color });
      }
    }
  }
}

function planJunctionDecals(j: Junction) {
  const random = rng(j.node.id.length * 131 + Math.round(j.node.x * 7 + j.node.z * 13));
  const style = dominant(j.arms).lay.style;
  if (style.pave === "terra" || style.marks === "pista" || j.arms.length < 3) return;
  const { x, z } = j.node;
  const put = (name: DecalName, dx: number, dz: number, w: number, l: number) => {
    const ang = random() * Math.PI * 2;
    DECAL_LIST.push({ name, x: x + dx, z: z + dz, ux: Math.cos(ang), uz: Math.sin(ang), w, vx: -Math.sin(ang), vz: Math.cos(ang), l, y: Y_DECAL, tint: NO_TINT });
  };
  if (random() < 0.35) put("bueiro", (random() - 0.5) * 6, (random() - 0.5) * 6, 0.9, 0.9);
  if (random() < 0.5) put("oleo", (random() - 0.5) * 8, (random() - 0.5) * 8, 1.4, 1.8);
  if (style.pave === "asfalto" && random() < 0.3 + style.wear * 0.3) put(random() < 0.5 ? "remendo" : "piche", (random() - 0.5) * 5, (random() - 0.5) * 5, 2.5 + random() * 2, 2.5 + random() * 3);
}

/** Monta os decalques e as tachas de um bloco de detalhe. */
function buildDetail(decals: Decal[], studs: Stud[]) {
  const group = new THREE.Group();
  const m = materials();
  if (decals.length) {
    const b = new Bucket();
    for (const d of decals) {
      const [u0, v0, u1, v1] = decalRect(d.name);
      const n = groundNormal(d.x, d.z);
      const rows = Math.max(1, Math.ceil(d.l / 3));
      const cols = Math.max(1, Math.ceil(d.w / 3));
      const first = b.nv;
      for (let r = 0; r <= rows; r++) {
        const bv = r / rows;
        for (let c = 0; c <= cols; c++) {
          const au = c / cols;
          const x = d.x + d.ux * (au - 0.5) * d.w + d.vx * (bv - 0.5) * d.l;
          const z = d.z + d.uz * (au - 0.5) * d.w + d.vz * (bv - 0.5) * d.l;
          b.vertex(x, heightAt(x, z) + d.y, z, n, u0 + (u1 - u0) * au, v0 + (v1 - v0) * bv, d.tint);
        }
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const a = first + r * (cols + 1) + c;
          b.quad(a, a + 1, a + cols + 2, a + cols + 1);
        }
      }
    }
    group.add(b.mesh(m.decal));
  }
  if (studs.length) {
    // Tacha: tronco de pirâmide baixinho em cima da tinta.
    const b = new Bucket();
    for (const t of studs) {
      const y0 = heightAt(t.x, t.z) + Y_PAINT;
      const lx = t.dz;
      const lz = -t.dx;
      const corners = (half: number, y: number) =>
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, c]) => [t.x + t.dx * a * half * 0.8 + lx * c * half, y, t.z + t.dz * a * half * 0.8 + lz * c * half] as const);
      const base = corners(0.07, y0);
      const top = corners(0.045, y0 + 0.025);
      const k = b.vertex(top[0][0], top[0][1], top[0][2], UP, 0, 0, t.color);
      for (let q = 1; q < 4; q++) b.vertex(top[q][0], top[q][1], top[q][2], UP, 0, 0, t.color);
      b.quad(k, k + 1, k + 2, k + 3);
      for (let q = 0; q < 4; q++) {
        const r = (q + 1) % 4;
        const mx = (base[q][0] + base[r][0]) / 2 - t.x;
        const mz = (base[q][2] + base[r][2]) / 2 - t.z;
        const l = Math.hypot(mx, mz) || 1;
        const n: Rgb = [(mx / l) * 0.8, 0.6, (mz / l) * 0.8];
        // As faces de frente e de trás têm o refletor (mais claro); as de lado, o corpo.
        const c = q % 2 === 0 ? scale(t.color, 1.1) : scale(t.color, 0.7);
        const s = b.vertex(base[q][0], base[q][1], base[q][2], n, 0, 0, c);
        b.vertex(base[r][0], base[r][1], base[r][2], n, 0, 0, c);
        b.vertex(top[r][0], top[r][1], top[r][2], n, 0, 0, c);
        b.vertex(top[q][0], top[q][1], top[q][2], n, 0, 0, c);
        b.quad(s, s + 1, s + 2, s + 3);
      }
    }
    group.add(b.mesh(m.tacha));
  }
  return group;
}

// --- Montagem ----------------------------------------------------------------------

/**
 * Pontes, viadutos e túneis: quanto do começo (ponta A) e do fim (ponta B) da
 * obra é o cruzamento das pontas (m). O tabuleiro (structures.ts) começa e
 * termina aí, casando com a boca do cruzamento. Preenchido pelo `buildStreets`.
 */
export const STRUCTURE_ENDS = new Map<number, [number, number]>();

/** Materiais das ruas (o tabuleiro das obras usa os mesmos). */
export function streetMaterial(key: "asfalto" | "paralelepipedo" | "concreto" | "tinta" | "meiofio" | "grama") {
  return materials()[key];
}

/** Pavimento, meio-fio, calçadas e faixas de todas as ruas (e dos cruzamentos), e os detalhes de perto. */
export function buildStreets(scene: THREE.Scene) {
  const m = materials();
  LAYS.length = segs.length = DECAL_LIST.length = STUDS.length = 0;
  segGrid.clear();
  tiles.clear();
  ROADS.forEach((road, i) => LAYS.push(layout(road, i)));
  indexSegments();
  const junctions = NAV.map(planJunction).filter((j): j is Junction => j !== null);
  const profiles = LAYS.map(profileOf);
  for (const j of junctions) buildJunction(j, profiles);
  // Onde o tabuleiro de cada obra começa e termina (a boca dos cruzamentos das pontas), no sentido A→B da obra.
  STRUCTURE_ENDS.clear();
  for (const lay of LAYS) {
    if (lay.road.structure < 0) continue;
    const st = STRUCTURES[lay.road.structure];
    const [px, pz] = lay.road.points[0];
    const same = Math.hypot(px - st.points[0][0], pz - st.points[0][1]) < 1;
    STRUCTURE_ENDS.set(st.id, same ? [lay.ends[0].trim, lay.ends[1].trim] : [lay.ends[1].trim, lay.ends[0].trim]);
  }
  for (const lay of LAYS) buildRoad(lay, profiles[lay.index]);
  normals.clear();

  for (const tile of tiles.values()) {
    const group = new THREE.Group();
    for (const [key, bucket] of tile.buckets) if (!bucket.empty) group.add(bucket.mesh(m[key]));
    addChunk(scene, group, tile.center, tile.reach + 10);
  }
  tiles.clear();

  // Detalhes de perto, em blocos de 200 m.
  for (const lay of LAYS) planDecals(lay);
  for (const j of junctions) planJunctionDecals(j);
  const detail = new Map<string, { center: [number, number]; decals: Decal[]; studs: Stud[] }>();
  const slot = (x: number, z: number) => {
    const tx = Math.floor(x / DETAIL_TILE);
    const tz = Math.floor(z / DETAIL_TILE);
    const key = `${tx},${tz}`;
    let d = detail.get(key);
    if (!d) detail.set(key, (d = { center: [(tx + 0.5) * DETAIL_TILE, (tz + 0.5) * DETAIL_TILE], decals: [], studs: [] }));
    return d;
  };
  for (const d of DECAL_LIST) slot(d.x, d.z).decals.push(d);
  for (const t of STUDS) slot(t.x, t.z).studs.push(t);
  for (const d of detail.values()) {
    addLodChunk(scene, d.center, DETAIL_TILE * 0.71 + 25, null, () => buildDetail(d.decals, d.studs));
  }
}
