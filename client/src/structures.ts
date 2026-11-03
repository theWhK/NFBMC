// Obras de arte de Porto Gordo em 3D: pontes, viadutos e túneis. O traçado e o
// perfil de altura de cada obra (eixo, tabuleiro, chão, pilares) vêm do
// shared/levels.ts; aqui é só o desenho (a física já sabe onde estão as
// muretas, os barrancos das rampas, os pilares e a galeria dos túneis).
//
// Ponte e viaduto: pavimento com as faixas, mureta "New Jersey" dos dois lados,
// laje com a viga embaixo, pilares com capitel e, nas rampas onde não dá para
// passar por baixo (altura livre < 5 m), muro de arrimo maciço do tabuleiro até
// o chão. A Ponte do Lago é uma pontezinha de parque (paralelepípedo, balaústre
// branco, colunas finas na água).
//
// Túnel: tubo por dentro (calçadinha, paredes de azulejo, teto em arco, luzes),
// a boca de concreto com o nome nas duas pontas e, onde a terra em cima é rasa,
// a galeria (a casca de concreto do tubo) saindo do morro. O relevo em volta da
// galeria é recortado pelo scenery.ts (`buildTerrain`, com `tunnelCutSquares` e
// `insideTunnelCut` daqui) e a costura é coberta pelas bermas (`buildTunnelBerms`).
//
// Desempenho: cada obra é cortada em pedaços de ~120 m, uma malha por material
// em cada pedaço (`addChunk`); postes, ventiladores e placas ficam no nível de
// detalhe de perto (`addLodChunk`).
import * as THREE from "three";
import {
  STRUCTURES,
  TUNNEL_COVER,
  TUNNEL_HEIGHT,
  UNDER_CLEARANCE,
  heightAt,
  insideWater,
  locate,
  type Structure,
} from "@nfbmc/shared";

import { addChunk, addLodChunk } from "./chunks.ts";
import { surface } from "./look.ts";
import { Bucket, STRUCTURE_ENDS, streetMaterial } from "./streets.ts";
import { paintedTexture } from "./textures.ts";

type Rgb = [number, number, number];
type Pt = [number, number];

const tmp = new THREE.Color();
const lin = (hex: string): Rgb => {
  tmp.set(hex);
  return [tmp.r, tmp.g, tmp.b];
};
const scale = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// --- Medidas ---------------------------------------------------------------------

/** Mesmas alturas das ruas (streets.ts): pavimento e tinta acima do tabuleiro. */
const Y_ROAD = 0.05;
const Y_PAINT = 0.085;
/** Mureta: pé de dentro a `half − 0,3`, face de fora a `half + 0,3`, 85 cm de altura. */
const BARRIER_H = 0.85;
const EDGE_OUT = 0.3;
/** Túnel: face de dentro da parede, de fora (a física bloqueia até `half + 1,2`), nascença do arco e topo da casca. */
const WALL_IN = 0.6;
const WALL_OUT = 1.2;
const SPRING = 5.2;
const SHELL_TOP = TUNNEL_HEIGHT + 0.7;
/** Largura da berma que cobre a costura do relevo em volta da galeria. */
const BERM = 6.5;
/** Comprimento de cada pedaço (bloco) de obra. */
const PIECE = 120;

const COLORS = {
  asfalto: lin("#5d5d61"),
  paralelepipedo: lin("#d6d1c6"),
  mureta: lin("#d9d4ca"),
  face: lin("#c4bdb1"),
  laje: lin("#aaa398"),
  pilar: lin("#bab3a7"),
  arrimo: lin("#b3ab9e"),
  pedra: lin("#a99f8b"),
  balaustre: lin("#f1ece0"),
  azulejo: lin("#e9e6dd"),
  faixa: lin("#e2a91c"),
  parede: lin("#6a6660"),
  teto: lin("#4a4744"),
  calcada: lin("#9c978e"),
  casca: lin("#bdb6aa"),
  boca: lin("#cfc8bb"),
  branco: lin("#f2f1ec"),
  amarelo: lin("#f0b419"),
};

// --- Materiais ---------------------------------------------------------------------

/** Concreto aparente (4 m): manchas, as juntas das fôrmas e os furinhos dos tirantes. */
const concreteTexture = () => {
  const texture = paintedTexture(256, (ctx, size, random) => {
    ctx.fillStyle = "#ecebe6";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 70; i++) {
      const v = 205 + Math.floor(random() * 50);
      ctx.fillStyle = `rgba(${v},${v - 2},${v - 6},0.35)`;
      ctx.beginPath();
      ctx.arc(random() * size, random() * size, 6 + random() * 34, 0, Math.PI * 2);
      ctx.fill();
    }
    // Escorrido de chuva.
    for (let i = 0; i < 26; i++) {
      const x = random() * size;
      const g = ctx.createLinearGradient(0, 0, 0, size);
      g.addColorStop(0, "rgba(90,86,80,0.18)");
      g.addColorStop(1, "rgba(90,86,80,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 2 + random() * 5, size * (0.3 + random() * 0.7));
    }
    ctx.strokeStyle = "rgba(80,76,70,0.45)";
    ctx.lineWidth = 1.5;
    for (const y of [0, size * 0.3, size * 0.6, size * 0.9]) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(size, y + 0.5);
      ctx.stroke();
    }
    for (const x of [0, size / 2]) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, size);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(60,58,54,0.55)";
    for (let y = size * 0.15; y < size; y += size * 0.3) for (let x = size * 0.125; x < size; x += size * 0.25) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }, 71);
  texture.repeat.set(1 / 4, 1 / 4);
  return texture;
};

/** Azulejo do túnel (1 m): peças de 20 cm, brancas, com o rejunte cinza. */
const tileTexture = () => {
  const texture = paintedTexture(128, (ctx, size, random) => {
    ctx.fillStyle = "#9a978f";
    ctx.fillRect(0, 0, size, size);
    const n = 5;
    const cell = size / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = 236 + Math.floor(random() * 16);
        ctx.fillStyle = `rgb(${v},${v - 1},${v - 5})`;
        ctx.fillRect(i * cell + 1, j * cell + 1, cell - 2, cell - 2);
      }
    }
  }, 72);
  texture.repeat.set(1, 1);
  return texture;
};

/** Brilho redondo das luzes (sprite). */
function glowSprite() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,226,170,1)");
  g.addColorStop(0.25, "rgba(255,214,140,1)");
  g.addColorStop(1, "rgba(255,160,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

type MatKey = "asfalto" | "paralelepipedo" | "tinta" | "concreto" | "azulejo" | "metal" | "luz" | "lente" | "verde" | "laranja";

let cached: Record<MatKey, THREE.Material> | null = null;
let glowPoints: THREE.PointsMaterial | null = null;

function materials() {
  if (cached) return cached;
  cached = {
    asfalto: streetMaterial("asfalto"),
    paralelepipedo: streetMaterial("paralelepipedo"),
    tinta: streetMaterial("tinta"),
    concreto: surface(new THREE.MeshLambertMaterial({ color: "#ffffff", map: concreteTexture(), vertexColors: true }), { roughness: 0.92, envMapIntensity: 0.6 }),
    azulejo: surface(new THREE.MeshLambertMaterial({ color: "#ffffff", map: tileTexture(), vertexColors: true }), { roughness: 0.3, envMapIntensity: 0.8 }),
    metal: surface(new THREE.MeshLambertMaterial({ color: "#55565b" }), { roughness: 0.45, metalness: 0.6 }),
    luz: surface(new THREE.MeshBasicMaterial({ color: "#fff1cf" }), { glow: 2.6 }),
    lente: surface(new THREE.MeshBasicMaterial({ color: "#ffe2a8" }), { glow: 3 }),
    verde: surface(new THREE.MeshBasicMaterial({ color: "#1f9d55" }), { glow: 1.6 }),
    laranja: surface(new THREE.MeshLambertMaterial({ color: "#e8731c" }), { roughness: 0.5 }),
  };
  for (const [key, material] of Object.entries(cached)) if (!material.name) material.name = `obra-${key}`;
  return cached;
}

function pointsMaterial() {
  return (glowPoints ??= new THREE.PointsMaterial({ size: 3.5, map: glowSprite(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
}

// --- Linhas (cortes transversais) ao longo da obra -----------------------------------

interface Row {
  s: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  /** Esquerda de quem vai de A para B (u positivo). */
  lx: number;
  lz: number;
  /** Tabuleiro e chão no eixo. */
  y: number;
  g: number;
  /** Tabuleiro acima do chão (ponte, viaduto) ou cobertura de terra (túnel). */
  gap: number;
  /** 0 = o pavimento acompanha o relevo de través (no chão), 1 = reto (fora do chão). */
  w: number;
}

interface Plan {
  st: Structure;
  /** Começo e fim do tabuleiro (as bocas dos cruzamentos das pontas). */
  s0: number;
  s1: number;
  park: boolean;
  /** Profundidade da laje e da viga abaixo do tabuleiro; meia largura da viga. */
  slab: number;
  depth: number;
  girder: number;
  /** Túnel: as duas bocas e os trechos de galeria (casca aparente). */
  portals: [number, number] | null;
  shells: { s0: number; s1: number }[];
}

function frameAt(plan: Plan, s: number): Row {
  const { st } = plan;
  const k = st.s;
  s = clamp(s, 0, st.length);
  let lo = 0;
  let hi = k.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (k[m] <= s) lo = m;
    else hi = m;
  }
  const t = (s - k[lo]) / (k[hi] - k[lo] || 1);
  const lerp = (a: number[]) => a[lo] + (a[hi] - a[lo]) * t;
  const x = st.points[lo][0] + (st.points[hi][0] - st.points[lo][0]) * t;
  const z = st.points[lo][1] + (st.points[hi][1] - st.points[lo][1]) * t;
  let tx = lerp(st.tx);
  let tz = lerp(st.tz);
  const l = Math.hypot(tx, tz) || 1;
  tx /= l;
  tz /= l;
  const y = lerp(st.y);
  const g = lerp(st.ground);
  const gap = st.kind === "tunel" ? g - y : y - g;
  // (No túnel a boca já está a 30 cm abaixo do chão: lá dentro o piso é reto.)
  const w = Math.min(clamp(Math.abs(gap) / (st.kind === "tunel" ? 0.3 : 0.5), 0, 1), clamp((s - plan.s0) / 6, 0, 1), clamp((plan.s1 - s) / 6, 0, 1));
  return { s, x, z, tx, tz, lx: tz, lz: -tx, y, g, gap, w };
}

const at = (r: Row, u: number): Pt => [r.x + r.lx * u, r.z + r.lz * u];

/** Altura do pavimento a `u` do eixo (perto das pontas acompanha o relevo de través). */
function deckY(r: Row, u: number) {
  if (r.w >= 1) return r.y;
  const [x, z] = at(r, u);
  return r.y + (heightAt(x, z) - r.g) * (1 - r.w);
}

/** Chão a `u` do eixo. */
const groundAt = (r: Row, u: number) => {
  const [x, z] = at(r, u);
  return heightAt(x, z);
};

// --- Varredura: um corte (polilinha em u, y) puxado ao longo das linhas ------------

type Seg = { b: Bucket; c: Rgb } | null;

/**
 * Puxa o corte `profile` (pontos [u, y absoluto]) ao longo de `rows`. O lado
 * visível de cada trecho do corte é a esquerda de quem anda de um ponto para o
 * seguinte (no plano u–y). `seg(k)` diz o balde e a cor do trecho k.
 */
function sweep(rows: Row[], profile: (r: Row) => Pt[], seg: (k: number, r: Row) => Seg) {
  if (rows.length < 2) return;
  const cuts = rows.map(profile);
  const n = cuts[0].length;
  for (let k = 0; k + 1 < n; k++) {
    let prev = -1;
    let prevBucket: Bucket | null = null;
    rows.forEach((r, i) => {
      const s = seg(k, r);
      if (!s) {
        prev = -1;
        return;
      }
      let v0 = 0;
      for (let q = 0; q < k; q++) v0 += Math.hypot(cuts[i][q + 1][0] - cuts[i][q][0], cuts[i][q + 1][1] - cuts[i][q][1]);
      const [u0, y0] = cuts[i][k];
      const [u1, y1] = cuts[i][k + 1];
      const du = u1 - u0;
      const dy = y1 - y0;
      const l = Math.hypot(du, dy);
      const nu = l > 1e-6 ? -dy / l : 0;
      const nv = l > 1e-6 ? du / l : 1;
      const normal: Rgb = [r.lx * nu, nv, r.lz * nu];
      const [ax, az] = at(r, u0);
      const [bx, bz] = at(r, u1);
      const a = s.b.vertex(ax, y0, az, normal, r.s, v0, s.c);
      s.b.vertex(bx, y1, bz, normal, r.s, v0 + l, s.c);
      if (prev >= 0 && prevBucket === s.b && r.s - rows[i - 1].s > 1e-3) s.b.quad(prev, prev + 1, a + 1, a);
      prev = a;
      prevBucket = s.b;
    });
  }
}

/** Espelha um corte do lado direito (u > 0) para o esquerdo, mantendo o lado visível. */
const mirror = (pts: Pt[]): Pt[] => pts.map(([u, y]) => [-u, y] as Pt).reverse();

/** Trechos contínuos das linhas em que `ok(a, b)` vale para cada par vizinho. */
function runs(rows: Row[], ok: (a: Row, b: Row) => boolean): Row[][] {
  const out: Row[][] = [];
  let cur: Row[] = [];
  for (let i = 0; i + 1 < rows.length; i++) {
    if (ok(rows[i], rows[i + 1])) {
      if (!cur.length) cur.push(rows[i]);
      cur.push(rows[i + 1]);
    } else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Copia uma geometria do three (já posicionada por `matrix`) para um balde, com uma cor. */
function addGeometry(b: Bucket, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, color: Rgb) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  g.applyMatrix4(matrix);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i += 3) {
    const first = b.nv;
    for (let k = 0; k < 3; k++) {
      const j = i + k;
      b.vertex(pos.getX(j), pos.getY(j), pos.getZ(j), [nor.getX(j), nor.getY(j), nor.getZ(j)], uv ? uv.getX(j) : 0, uv ? uv.getY(j) : 0, color);
    }
    b.tri(first, first + 1, first + 2);
  }
  g.dispose();
}

/** Matriz de um objeto em (u, y) da linha `r`, com o +Z local apontando para `facing` (ângulo em torno de Y). */
function placeAt(r: Row, u: number, y: number, facing: number, sx = 1, sy = 1, sz = 1) {
  const [x, z] = at(r, u);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), facing), new THREE.Vector3(sx, sy, sz));
}

/** Ângulo (em torno de Y) que leva o +Z local para a direção (dx, dz). */
const heading = (dx: number, dz: number) => Math.atan2(dx, dz);

// --- Pedaço: os baldes de um trecho da obra ----------------------------------------

class Piece {
  buckets = new Map<MatKey, Bucket>();
  minX = Infinity;
  maxX = -Infinity;
  minZ = Infinity;
  maxZ = -Infinity;

  b(key: MatKey) {
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = new Bucket()));
    return b;
  }

  grow(rows: Row[], reach: number) {
    for (const r of rows) {
      this.minX = Math.min(this.minX, r.x - reach);
      this.maxX = Math.max(this.maxX, r.x + reach);
      this.minZ = Math.min(this.minZ, r.z - reach);
      this.maxZ = Math.max(this.maxZ, r.z + reach);
    }
  }

  get center(): Pt {
    return [(this.minX + this.maxX) / 2, (this.minZ + this.maxZ) / 2];
  }

  get radius() {
    return Math.hypot(this.maxX - this.minX, this.maxZ - this.minZ) / 2;
  }

  group(extra?: THREE.Object3D[]) {
    const m = materials();
    const group = new THREE.Group();
    for (const [key, bucket] of this.buckets) if (!bucket.empty) group.add(bucket.mesh(m[key]));
    for (const o of extra ?? []) group.add(o);
    return group;
  }
}

// --- Plano de cada obra -------------------------------------------------------------

const isPark = (st: Structure) => st.kind === "ponte" && Math.max(...st.y.map((y, i) => y - st.ground[i])) < 4.2;

/** Cobertura mínima de terra sobre o tubo nas bordas e no eixo (túnel). */
function minCover(plan: Plan, r: Row) {
  const W = plan.st.half + WALL_OUT;
  let min = Infinity;
  for (const u of [-W, -W / 2, 0, W / 2, W]) min = Math.min(min, groundAt(r, u) - r.y);
  return min;
}

function makePlan(st: Structure): Plan {
  const ends = STRUCTURE_ENDS.get(st.id) ?? [0.6, 0.6];
  const park = isPark(st);
  const plan: Plan = {
    st, s0: ends[0], s1: st.length - ends[1], park,
    slab: park ? 0.45 : 0.6,
    depth: park ? 0.45 : st.width > 18 ? 1.9 : 1.5,
    girder: park ? 0 : st.width * 0.3,
    portals: null,
    shells: [],
  };
  if (st.kind === "tunel") {
    // Bocas: onde o tabuleiro começa a afundar no morro.
    let pA = -1;
    let pB = -1;
    for (let i = 0; i < st.points.length; i++) {
      const cover = st.ground[i] - st.y[i];
      if (cover > 0.3 && st.s[i] > plan.s0 + 2 && st.s[i] < plan.s1 - 2) {
        if (pA < 0) pA = st.s[i];
        pB = st.s[i];
      }
    }
    if (pA >= 0 && pB - pA > 20) {
      plan.portals = [pA, pB];
      // Galeria: onde a terra em cima do tubo é rasa (perto das bocas, ou um vale no meio).
      const shown: { s: number; on: boolean }[] = [];
      for (let s = pA; s <= pB + 1e-6; s += 2) {
        const r = frameAt(plan, s);
        shown.push({ s, on: r.gap < TUNNEL_COVER + 0.3 || minCover(plan, r) < SHELL_TOP + 0.7 });
      }
      let start = -1;
      shown.forEach((p, k) => {
        if (p.on && start < 0) start = p.s;
        if ((!p.on || k === shown.length - 1) && start >= 0) {
          const end = p.on ? p.s : shown[k - 1].s;
          plan.shells.push({ s0: Math.max(pA, start - 4), s1: Math.min(pB, end + 4) });
          start = -1;
        }
      });
      // Junta trechos que quase se encostam.
      for (let k = plan.shells.length - 1; k > 0; k--) {
        if (plan.shells[k].s0 - plan.shells[k - 1].s1 < 12) {
          plan.shells[k - 1].s1 = plan.shells[k].s1;
          plan.shells.splice(k, 1);
        }
      }
    }
  }
  return plan;
}

let PLANS: Plan[] | null = null;
/** Os planos dependem das bocas dos cruzamentos (STRUCTURE_ENDS, do buildStreets): refeitos se elas mudarem. */
let plannedWith = -1;
const plans = () => {
  if (!PLANS || plannedWith !== STRUCTURE_ENDS.size) {
    PLANS = STRUCTURES.map(makePlan);
    plannedWith = STRUCTURE_ENDS.size;
  }
  return PLANS;
};

// --- Recorte do relevo em volta das galerias (usado pelo scenery.ts) ---------------

/** O ponto está dentro da galeria de algum túnel (com `margin` m de folga)? */
export function insideTunnelCut(x: number, z: number, margin = 0) {
  for (const plan of plans()) {
    if (!plan.shells.length) continue;
    const st = plan.st;
    const loc = locate(st, x, z, WALL_OUT + margin + 2);
    if (!loc || Math.abs(loc.u) > st.half + WALL_OUT + margin) continue;
    for (const sh of plan.shells) if (loc.s >= sh.s0 - margin && loc.s <= sh.s1 + margin) return true;
  }
  return false;
}

/**
 * Quadrados da grade do relevo (origem e passo da grade) que encostam numa
 * galeria: o scenery.ts troca esses por uma grade fina, sem as células de
 * dentro da galeria. Chave `i,j`.
 */
export function tunnelCutSquares(originX: number, originZ: number, step: number) {
  const keys = new Set<string>();
  for (const plan of plans()) {
    const W = plan.st.half + WALL_OUT + 2.5;
    for (const sh of plan.shells) {
      for (let s = sh.s0 - 3; s <= sh.s1 + 3; s += 2) {
        const r = frameAt(plan, s);
        for (let u = -W; u <= W + 1e-6; u += 2) {
          const [x, z] = at(r, u);
          keys.add(`${Math.floor((x - originX) / step)},${Math.floor((z - originZ) / step)}`);
        }
      }
    }
  }
  return keys;
}

/**
 * Bermas em volta da galeria, com o material e a cor do relevo: uma faixa de
 * terra que encosta na casca e mergulha debaixo do relevo, cobrindo a fresta
 * entre a casca e as células da grade fina que sobraram.
 */
export function buildTunnelBerms(scene: THREE.Scene, material: THREE.Material, tint: (x: number, z: number) => Rgb) {
  for (const plan of plans()) {
    if (!plan.portals) continue;
    const st = plan.st;
    const W = st.half + WALL_OUT;
    const b = new Bucket();
    const put = (x: number, z: number, dy: number) => {
      const e = 1;
      const gx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
      const gz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
      const l = Math.hypot(gx, 1, gz);
      return b.vertex(x, heightAt(x, z) + dy, z, [-gx / l, 1 / l, -gz / l], x, -z, tint(x, z));
    };
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const track = (x: number, z: number) => {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    };
    for (const sh of plan.shells) {
      // Laterais.
      for (const side of [-1, 1]) {
        let prev = -1;
        const n = Math.max(1, Math.ceil((sh.s1 - sh.s0) / 3));
        for (let q = 0; q <= n; q++) {
          const r = frameAt(plan, sh.s0 + ((sh.s1 - sh.s0) * q) / n);
          const [ix, iz] = at(r, side * W);
          const [ox, oz] = at(r, side * (W + BERM));
          const a = put(ix, iz, -0.12);
          put(ox, oz, -0.45);
          track(ox, oz);
          if (prev >= 0) b.quad(prev, prev + 1, a + 1, a);
          prev = a;
        }
      }
      // Frente das bocas (a fresta na frente da fachada), dos dois lados do tabuleiro.
      for (const [p, dir] of [[plan.portals[0], -1], [plan.portals[1], 1]] as const) {
        if (Math.abs(p - (dir < 0 ? sh.s0 : sh.s1)) > 0.5) continue;
        const near = frameAt(plan, p);
        const far = frameAt(plan, p + dir * BERM);
        for (const side of [-1, 1]) {
          const cols = [st.half + EDGE_OUT + 0.05, W, W + BERM / 2, W + BERM];
          let prev = -1;
          for (const u of cols) {
            const [nx, nz] = at(near, side * u);
            const [fx, fz] = at(far, side * u);
            const a = put(nx, nz, -0.12);
            put(fx, fz, -0.45);
            track(fx, fz);
            if (prev >= 0) b.quad(prev, prev + 1, a + 1, a);
            prev = a;
          }
        }
      }
    }
    if (b.empty) continue;
    const mesh = b.mesh(material);
    addChunk(scene, mesh, [(minX + maxX) / 2, (minZ + maxZ) / 2], Math.hypot(maxX - minX, maxZ - minZ) / 2 + 10);
  }
}

/**
 * O ponto está debaixo (ou em cima) de uma obra fora do chão, ou encostado na
 * galeria de um túnel? Para os postes e enfeites das ruas do chão não furarem
 * o viaduto nem ficarem em cima da galeria.
 */
export function nearStructure(x: number, z: number, margin = 2) {
  for (const plan of plans()) {
    const st = plan.st;
    if (st.kind === "tunel") {
      if (insideTunnelCut(x, z, margin + 4)) return true;
      continue;
    }
    const loc = locate(st, x, z, margin + 1);
    if (!loc || Math.abs(loc.u) > st.half + EDGE_OUT + margin) continue;
    if (loc.y - loc.ground > 0.3) return true;
  }
  return false;
}

// --- Montagem de cada obra ----------------------------------------------------------

/** Linhas da obra: as amostras do eixo entre as bocas, mais as emendas que precisam de linha exata. */
function rowsOf(plan: Plan): Row[] {
  const { st } = plan;
  const marks = new Set<number>([plan.s0, plan.s1]);
  for (const s of st.s) if (s > plan.s0 + 0.5 && s < plan.s1 - 0.5) marks.add(s);
  if (plan.portals) {
    for (const p of plan.portals) marks.add(p);
    for (const sh of plan.shells) marks.add(sh.s0).add(sh.s1);
  }
  return [...marks].sort((a, b) => a - b).map((s) => frameAt(plan, s));
}

/** Tipo de chão debaixo de cada linha (ponte/viaduto): vão livre (passa por baixo) ou maciço (muro de arrimo). */
function isOpen(r: Row) {
  if (r.gap >= UNDER_CLEARANCE - 0.01) return true;
  const [x, z] = [r.x, r.z];
  return r.gap > 1 && insideWater(x, z, 2);
}

/** Altura da mureta (fator 0–1): no chão vira um meio-fio de 18 cm, sobe junto com a rampa. */
const barrierK = (r: Row) => 0.21 + 0.79 * smooth(Math.abs(r.gap) / 0.35);

/** Dentro do tubo do túnel (entre as bocas)? */
const inTube = (plan: Plan, r: Row) => !!plan.portals && r.s >= plan.portals[0] - 1e-3 && r.s <= plan.portals[1] + 1e-3;

/** Pavimento e faixas pintadas. */
function buildDeck(plan: Plan, piece: Piece, rows: Row[]) {
  const { st } = plan;
  const h = st.half;
  const pave = plan.park ? "paralelepipedo" : "asfalto";
  const tone = plan.park ? COLORS.paralelepipedo : COLORS.asfalto;
  const n = Math.max(2, Math.ceil((2 * h) / 3.7));
  const cols = Array.from({ length: n + 1 }, (_, k) => -h + (2 * h * k) / n);
  const b = piece.b(pave);
  sweep(rows, (r) => cols.map((u) => [u, deckY(r, u) + Y_ROAD] as Pt), (k, r) => {
    const v = 0.92 + 0.12 * Math.sin(r.s * 0.11 + k * 1.7) * Math.sin(r.s * 0.037 + st.id);
    return { b, c: scale(tone, k === 0 || k === n - 1 ? v * 0.9 : v) };
  });
  if (plan.park) return;
  // Faixas: como as ruas do mesmo tipo.
  const lineAt = (u: number, w: number, color: Rgb, dash?: [number, number]) => {
    const from = Math.max(rows[0].s, plan.s0 + 1.5);
    const to = Math.min(rows[rows.length - 1].s, plan.s1 - 1.5);
    if (to - from < 0.5) return;
    const spans: [number, number][] = [];
    if (!dash) spans.push([from, to]);
    else {
      // Fase global (os tracejados casam entre os pedaços).
      const period = dash[0] + dash[1];
      for (let s = Math.floor((from - plan.s0) / period) * period + plan.s0; s < to; s += period) {
        const a = Math.max(from, s);
        const c = Math.min(to, s + dash[0]);
        if (c - a > 0.1) spans.push([a, c]);
      }
    }
    const t = piece.b("tinta");
    for (const [a, c] of spans) {
      const list = [a, ...rows.filter((r) => r.s > a + 0.3 && r.s < c - 0.3).map((r) => r.s), c].map((s) => frameAt(plan, s));
      sweep(list, (r) => [[u - w / 2, deckY(r, u - w / 2) + Y_PAINT], [u + w / 2, deckY(r, u + w / 2) + Y_PAINT]], () => ({ b: t, c: color }));
    }
  };
  if (st.roadKind === "rodovia") {
    for (const side of [-1, 1]) {
      lineAt(side * 0.16, 0.15, COLORS.amarelo);
      lineAt(side * 3.47, 0.15, COLORS.branco, [4, 8]);
      lineAt(side * 6.93, 0.15, COLORS.branco, [4, 8]);
      lineAt(side * (h - 0.9), 0.2, COLORS.branco);
    }
  } else if (st.roadKind === "avenida") {
    for (const side of [-1, 1]) {
      lineAt(side * 0.13, 0.12, COLORS.amarelo);
      lineAt(side * 3.5, 0.12, COLORS.branco, [4, 6]);
      lineAt(side * 7, 0.12, COLORS.branco, [4, 6]);
      lineAt(side * (h - 0.75), 0.12, COLORS.branco);
    }
  } else {
    lineAt(0, 0.12, COLORS.branco, [3, 5]);
    for (const side of [-1, 1]) lineAt(side * (h - 0.75), 0.12, COLORS.branco);
  }
}

/** Mureta (ou meio-fio, no chão) e a face de fora da laje, até o chão nas rampas e na laje nos vãos. */
function buildEdges(plan: Plan, piece: Piece, rows: Row[]) {
  const { st } = plan;
  const h = st.half;
  const conc = piece.b("concreto");
  const outside = rows.filter((r) => !inTube(plan, r) || (plan.portals && (Math.abs(r.s - plan.portals[0]) < 1e-3 || Math.abs(r.s - plan.portals[1]) < 1e-3)));
  const wallColor = plan.park ? COLORS.pedra : COLORS.arrimo;
  for (const part of runs(outside, (a, b) => !(inTube(plan, a) && inTube(plan, b)))) {
    for (const side of [-1, 1]) {
      const profile = (r: Row): Pt[] => {
        const e = deckY(r, side * h) + Y_ROAD;
        const k = plan.park ? 0.25 : barrierK(r);
        const open = st.kind !== "tunel" && isOpen(r);
        const bottom = open ? r.y - plan.slab : groundAt(r, side * (h + EDGE_OUT)) - 0.5;
        const pts: Pt[] = [
          [h - 0.3, e], [h - 0.24, e + 0.075 * k], [h - 0.06, e + 0.33 * k], [h + 0.1, e + BARRIER_H * k], [h + EDGE_OUT, e + BARRIER_H * k],
          [h + EDGE_OUT, Math.min(bottom, e + BARRIER_H * k - 0.05)],
        ];
        return side > 0 ? pts.map(([u, y]) => [u, y] as Pt) : mirror(pts);
      };
      sweep(part, profile, (k, r) => {
        // O último trecho (o lado de dentro, do espelhado, é o primeiro) é a face de fora.
        const outer = side > 0 ? k === 4 : k === 0;
        if (!outer) return { b: conc, c: plan.park ? COLORS.balaustre : COLORS.mureta };
        const open = st.kind !== "tunel" && isOpen(r);
        return { b: conc, c: open ? COLORS.face : wallColor };
      });
    }
  }
}

/** Embaixo da laje: a laje, a viga e o encontro (a parede onde o vão termina na rampa). */
function buildUnderside(plan: Plan, piece: Piece, rows: Row[]) {
  const { st } = plan;
  if (st.kind === "tunel") return;
  const h = st.half + EDGE_OUT;
  const gw = plan.girder;
  const conc = piece.b("concreto");
  for (const part of runs(rows, (a, b) => isOpen(a) || isOpen(b))) {
    sweep(part, (r) => {
      const top = r.y - plan.slab;
      const bottom = r.y - plan.depth;
      return gw > 0
        ? [[h, top], [gw, top], [gw, bottom], [-gw, bottom], [-gw, top], [-h, top]]
        : [[h, top], [-h, top]];
    }, () => ({ b: conc, c: COLORS.laje }));
  }
  // Encontros: a linha maciça do lado de um vão ganha a parede de través.
  rows.forEach((r, i) => {
    if (isOpen(r)) return;
    for (const j of [i - 1, i + 1]) {
      const o = rows[j];
      if (!o || !isOpen(o)) continue;
      const dir = j > i ? 1 : -1;
      const n = Math.max(2, Math.ceil((2 * h) / 4));
      const normal: Rgb = [r.tx * dir, 0, r.tz * dir];
      let prev = -1;
      for (let k = 0; k <= n; k++) {
        const u = -h + (2 * h * k) / n;
        const [x, z] = at(r, u);
        const a = conc.vertex(x, r.y - plan.slab + 0.01, z, normal, u, 0, COLORS.arrimo);
        conc.vertex(x, Math.min(groundAt(r, u) - 0.5, r.y - plan.slab), z, normal, u, r.y - groundAt(r, u), scale(COLORS.arrimo, 0.85));
        if (prev >= 0) conc.quad(prev, prev + 1, a + 1, a);
        prev = a;
      }
    }
  });
}

const PILLAR = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true).translate(0, 0.5, 0);
const BOX = new THREE.BoxGeometry(1, 1, 1);

/** Pilares (os da física e, na água, os de enfeite) com capitel. */
function buildPillars(plan: Plan, pieces: { piece: Piece; s0: number; s1: number }[]) {
  const { st } = plan;
  if (st.kind === "tunel") return;
  const list: { x: number; z: number; r: number; visual: boolean }[] = st.pillars.map((p) => ({ ...p, visual: false }));
  // Na água, onde a física não pôs (a altura livre é pequena): colunas de enfeite.
  let last = -Infinity;
  for (let i = 0; i < st.points.length; i++) {
    const [x, z] = st.points[i];
    const gap = st.y[i] - st.ground[i];
    if (gap >= UNDER_CLEARANCE || gap < 1.2 || !insideWater(x, z, -2) || st.s[i] - last < (plan.park ? 13 : 18)) continue;
    if (list.some((p) => Math.hypot(p.x - x, p.z - z) < 10)) continue;
    list.push({ x, z, r: plan.park ? 0.32 : st.width > 18 ? 1.6 : 1.1, visual: true });
    last = st.s[i];
  }
  for (const p of list) {
    const loc = locate(st, p.x, p.z, 4);
    if (!loc) continue;
    const s = loc.s;
    const owner = pieces.find((q) => s >= q.s0 && s <= q.s1) ?? pieces[pieces.length - 1];
    const b = owner.piece.b("concreto");
    const r = frameAt(plan, s);
    const facing = heading(r.tx, r.tz);
    const top = r.y - plan.depth;
    if (plan.park) {
      // Pontezinha: duas colunas finas e a travessa embaixo da laje.
      for (const side of [-1, 1]) {
        const u = side * (st.half - 2);
        const base = groundAt(r, u) - 0.6;
        addGeometry(b, PILLAR, placeAt(r, u, base, 0, p.r, top - base, p.r), COLORS.balaustre);
      }
      addGeometry(b, BOX, placeAt(r, 0, top - 0.25, facing, 2 * st.half - 2, 0.5, 0.6), COLORS.balaustre);
      continue;
    }
    const capH = 0.9;
    const base = heightAt(p.x, p.z) - 0.6;
    const colTop = top - capH;
    if (colTop - base < 0.5) continue;
    addGeometry(b, PILLAR, new THREE.Matrix4().compose(new THREE.Vector3(p.x, base, p.z), new THREE.Quaternion(), new THREE.Vector3(p.r, colTop - base, p.r)), COLORS.pilar);
    // Capitel: viga de través debaixo da viga do tabuleiro.
    const [cx, cz] = [p.x, p.z];
    const cap = new THREE.Matrix4().compose(
      new THREE.Vector3(cx, colTop + capH / 2, cz),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), facing),
      new THREE.Vector3(2 * plan.girder + 2.4, capH, 2 * p.r + 0.8),
    );
    addGeometry(b, BOX, cap, scale(COLORS.pilar, 0.95));
  }
}

/** Balaústre da pontezinha do lago: corrimão e os pilaretes. */
function buildBalustrade(plan: Plan, piece: Piece, rows: Row[]) {
  const { st } = plan;
  const b = piece.b("concreto");
  for (const side of [-1, 1]) {
    const u = side * (st.half + 0.05);
    for (const [y0, y1] of [[0.95, 1.08], [0.45, 0.53]]) {
      const rail = (r: Row): Pt[] => {
        const e = deckY(r, u) + Y_ROAD;
        return [[u - 0.08, e + y0], [u - 0.08, e + y1], [u + 0.08, e + y1], [u + 0.08, e + y0], [u - 0.08, e + y0]];
      };
      // Contorno fechado no sentido horário (no plano u–y): o lado visível é o de fora.
      sweep(rows, rail, () => ({ b, c: COLORS.balaustre }));
    }
    const first = Math.ceil(rows[0].s / 2.4) * 2.4;
    for (let s = first; s <= rows[rows.length - 1].s; s += 2.4) {
      const r = frameAt(plan, s);
      const e = deckY(r, u) + Y_ROAD;
      addGeometry(b, BOX, placeAt(r, u, e + 0.55, heading(r.tx, r.tz), 0.16, 1.05, 0.16), COLORS.balaustre);
    }
  }
}

/** Arco do teto do túnel: altura (acima do tabuleiro) a `u` do eixo. */
function archAt(st: Structure, u: number) {
  const win = st.half + WALL_IN;
  const t = clamp(Math.abs(u) / win, 0, 1);
  return SPRING + (TUNNEL_HEIGHT - SPRING) * Math.sqrt(1 - t * t);
}

/** Corte de dentro do túnel (lado direito, de baixo até o alto do arco). */
function tubeProfile(st: Structure, y: number): Pt[] {
  const h = st.half;
  const win = h + WALL_IN;
  const pts: Pt[] = [[h - 0.25, y + Y_ROAD], [h - 0.25, y + 0.3], [win, y + 0.3], [win, y + 2.7], [win, y + 2.95], [win, y + SPRING]];
  const n = 9;
  for (let k = 1; k <= n; k++) {
    const a = (k / n) * (Math.PI / 2);
    pts.push([win * Math.cos(a), y + SPRING + (TUNNEL_HEIGHT - SPRING) * Math.sin(a)]);
  }
  return pts;
}

/** Por dentro do túnel: calçadinha, paredes (azulejo embaixo, faixa amarela), teto em arco e as luzes. */
function buildTube(plan: Plan, piece: Piece, rows: Row[]) {
  const { st } = plan;
  const inside = rows.filter((r) => inTube(plan, r));
  if (inside.length < 2) return;
  const conc = piece.b("concreto");
  const tile = piece.b("azulejo");
  const profile = (r: Row): Pt[] => {
    const right = tubeProfile(st, r.y);
    return [...right, ...mirror(right).slice(1)];
  };
  const m = tubeProfile(st, 0).length - 1;
  sweep(inside, profile, (k) => {
    // Trechos do lado direito: 0 meio-fio, 1 calçadinha, 2 azulejo, 3 faixa, 4 parede, 5.. arco. O esquerdo é o espelho.
    const q = k < m ? k : 2 * m - 1 - k;
    if (q === 0) return { b: conc, c: COLORS.mureta };
    if (q === 1) return { b: conc, c: COLORS.calcada };
    if (q === 2) return { b: tile, c: COLORS.azulejo };
    if (q === 3) return { b: conc, c: COLORS.faixa };
    if (q === 4) return { b: conc, c: COLORS.parede };
    return { b: conc, c: COLORS.teto };
  });
  // Luminárias em duas linhas no teto.
  const light = piece.b("luz");
  const first = Math.ceil(inside[0].s / 6) * 6 + 3;
  for (let s = first; s < inside[inside.length - 1].s; s += 6) {
    const r = frameAt(plan, s);
    for (const side of [-1, 1]) {
      const u = side * st.half * 0.42;
      const v = archAt(st, u) - 0.06;
      // Inclina junto do arco.
      const du = 0.3;
      const tilt = Math.atan2(archAt(st, u + du) - archAt(st, u - du), 2 * du);
      const mtx = placeAt(r, u, r.y + v, heading(r.tx, r.tz));
      // O X local é o u (a esquerda): a rotação em Z deita a luminária junto do arco.
      mtx.multiply(new THREE.Matrix4().makeRotationZ(tilt)).multiply(new THREE.Matrix4().makeScale(0.55, 0.1, 2.4));
      addGeometry(light, BOX, mtx, [1, 1, 1]);
    }
  }
}

/** A galeria por fora: paredes, o topo (que acompanha o morro quando ele é mais alto) e a tampa do fundo. */
function buildShell(plan: Plan, piece: Piece, rows: Row[]) {
  const { st } = plan;
  const W = st.half + WALL_OUT;
  const conc = piece.b("concreto");
  const n = Math.max(4, Math.ceil((2 * W) / 3));
  const tops = (r: Row) => Array.from({ length: n + 1 }, (_, k) => -W + (2 * W * k) / n).map((u) => [u, Math.max(r.y + SHELL_TOP, groundAt(r, u) + 0.1)] as Pt);
  for (const sh of plan.shells) {
    const part = rows.filter((r) => r.s >= sh.s0 - 1e-3 && r.s <= sh.s1 + 1e-3);
    if (part.length < 2) continue;
    sweep(part, (r) => {
      const top = tops(r);
      return [[-W, groundAt(r, -W) - 0.6], ...top, [W, groundAt(r, W) - 0.6]];
    }, (k) => ({ b: conc, c: k === 0 || k === n + 1 ? COLORS.casca : scale(COLORS.casca, 0.92) }));
    // Tampas onde a galeria entra no morro (as pontas que não são boca).
    for (const [s, dir] of [[sh.s0, -1], [sh.s1, 1]] as const) {
      if (plan.portals && Math.abs(s - plan.portals[dir < 0 ? 0 : 1]) < 0.5) continue;
      if (s < part[0].s - 1e-3 || s > part[part.length - 1].s + 1e-3) continue;
      const r = frameAt(plan, s);
      const win = st.half + WALL_IN;
      // Embaixo: o tabuleiro na espessura das paredes, o arco do teto no meio.
      const arch = Array.from({ length: 11 }, (_, k) => -win + (2 * win * (k + 1)) / 12);
      const cols: Pt[] = [[-W, r.y], [-win, r.y], [-win, r.y + SPRING], ...arch.map((u) => [u, r.y + archAt(st, u)] as Pt), [win, r.y + SPRING], [win, r.y], [W, r.y]];
      const normal: Rgb = [r.tx * dir, 0, r.tz * dir];
      let prev = -1;
      cols.forEach(([u, bottom]) => {
        const [x, z] = at(r, u);
        const a = conc.vertex(x, bottom, z, normal, u, 0, COLORS.casca);
        conc.vertex(x, Math.max(r.y + SHELL_TOP, groundAt(r, u) + 0.1), z, normal, u, 3, COLORS.casca);
        if (prev >= 0) conc.quad(prev, prev + 1, a + 1, a);
        prev = a;
      });
    }
  }
}

/** Placa com o nome da obra (canvas). */
function nameTexture(name: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 96;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const draw = () => {
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#1d5a3a";
    ctx.fillRect(0, 0, 1024, 96);
    ctx.strokeStyle = "#f2f1ec";
    ctx.lineWidth = 5;
    ctx.strokeRect(8, 8, 1008, 80);
    ctx.fillStyle = "#f2f1ec";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "58px 'Russo One', sans-serif";
    ctx.fillText(name.toUpperCase(), 512, 52, 960);
    texture.needsUpdate = true;
  };
  draw();
  document.fonts?.load("58px 'Russo One'").then(draw).catch(() => {});
  return texture;
}

/** Bocas do túnel: fachada de concreto com a abertura em arco, o nome em cima. */
function buildPortals(plan: Plan, pieces: { piece: Piece; s0: number; s1: number }[], extras: Map<Piece, THREE.Object3D[]>) {
  const { st } = plan;
  if (!plan.portals) return;
  // A abertura é 6 cm maior que o tubo (as faces de dentro não brigam com as paredes do túnel).
  const win = st.half + WALL_IN + 0.06;
  const W = st.half + WALL_OUT;
  const wf = W + 4.5;
  const top = SHELL_TOP + 1.4;
  const sign = new THREE.MeshLambertMaterial({ map: nameTexture(st.name), emissive: "#ffffff", emissiveIntensity: 0.2 });
  plan.portals.forEach((p, end) => {
    const r = frameAt(plan, p);
    let low = -0.6;
    for (let u = -wf; u <= wf; u += 2) low = Math.min(low, groundAt(r, u) - r.y - 1);
    const shape = new THREE.Shape();
    shape.moveTo(-wf, low);
    shape.lineTo(-win, low);
    shape.lineTo(-win, SPRING);
    for (let k = 1; k < 16; k++) {
      const a = Math.PI - (k / 16) * Math.PI;
      shape.lineTo(win * Math.cos(a), SPRING + (TUNNEL_HEIGHT + 0.06 - SPRING) * Math.sin(a));
    }
    shape.lineTo(win, SPRING);
    shape.lineTo(win, low);
    shape.lineTo(wf, low);
    shape.lineTo(wf, top);
    shape.lineTo(-wf, top);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1.4, bevelEnabled: false });
    // Base local: X = esquerda, Y = cima, Z = para dentro do túnel (a frente, z = 0, fica para fora).
    const inward = end === 0 ? 1 : -1;
    const tx = r.tx * inward;
    const tz = r.tz * inward;
    const left = new THREE.Vector3(tz, 0, -tx);
    const basis = new THREE.Matrix4().makeBasis(left, new THREE.Vector3(0, 1, 0), new THREE.Vector3(tx, 0, tz)).setPosition(r.x, r.y, r.z);
    const owner = pieces.find((q) => p >= q.s0 - 1e-3 && p <= q.s1 + 1e-3) ?? pieces[0];
    // Uma escala menor na textura (UV da extrusão em metros).
    addGeometry(owner.piece.b("concreto"), geometry, basis, COLORS.boca);
    geometry.dispose();
    // Cornija em cima e a placa com o nome.
    addGeometry(owner.piece.b("concreto"), BOX, basis.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(0, top + 0.2, 0.3), new THREE.Quaternion(), new THREE.Vector3(2 * wf + 0.6, 0.4, 2))), scale(COLORS.boca, 0.9));
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(16, 2 * win - 2), 1.5), sign);
    plate.applyMatrix4(basis.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(0, (TUNNEL_HEIGHT + top) / 2, -0.04), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), new THREE.Vector3(1, 1, 1))));
    plate.matrixAutoUpdate = false;
    plate.updateMatrix();
    const list = extras.get(owner.piece) ?? [];
    list.push(plate);
    extras.set(owner.piece, list);
  });
}

// --- Detalhes de perto: postes, ventiladores, placas --------------------------------

/** Poste de viaduto (frente para +Z): coluna, braço sobre a pista e a luminária. */
const LAMP_POLE = (() => {
  const parts = [
    new THREE.CylinderGeometry(0.1, 0.15, 8, 8).translate(0, 4, 0),
    new THREE.CylinderGeometry(0.07, 0.07, 2.4, 6).rotateX(Math.PI / 2).translate(0, 8, 1.1),
    new THREE.BoxGeometry(0.42, 0.2, 1.0).translate(0, 8.05, 2.5),
  ];
  return parts;
})();
const LAMP_LENS = new THREE.BoxGeometry(0.32, 0.04, 0.8).translate(0, 7.94, 2.5);
/** Poste de praça (pontezinha do lago): coluna baixa e o globo. */
const PARK_POLE = new THREE.CylinderGeometry(0.06, 0.1, 3.4, 8).translate(0, 1.7, 0);
const PARK_GLOBE = new THREE.SphereGeometry(0.28, 12, 8).translate(0, 3.65, 0);
const FAN = new THREE.CylinderGeometry(0.6, 0.6, 4, 14).rotateX(Math.PI / 2);

function buildNear(plan: Plan, s0: number, s1: number) {
  const { st } = plan;
  const piece = new Piece();
  const glows: number[] = [];
  if (st.kind !== "tunel") {
    // Postes nas muretas a cada ~40 m (alternando os lados), onde já está fora do chão.
    const every = plan.park ? 28 : 40;
    let k = Math.floor(s0 / every);
    for (let s = Math.ceil(s0 / every) * every; s < s1; s += every, k++) {
      const r = frameAt(plan, s);
      if (r.gap < 1 || s < st.sIn + 8 || s > st.sOut - 8) continue;
      const side = k % 2 ? 1 : -1;
      const u = side * (st.half + 0.17);
      const base = deckY(r, u) + Y_ROAD + BARRIER_H * (plan.park ? 0.25 : barrierK(r));
      // De frente para a pista (o braço aponta para o eixo).
      const facing = heading(-side * r.lx, -side * r.lz);
      const mtx = placeAt(r, u, base, facing);
      if (plan.park) {
        addGeometry(piece.b("metal"), PARK_POLE, mtx, [1, 1, 1]);
        addGeometry(piece.b("lente"), PARK_GLOBE, mtx, [1, 1, 1]);
        const [x, z] = at(r, u);
        glows.push(x, base + 3.65, z);
      } else {
        for (const g of LAMP_POLE) addGeometry(piece.b("metal"), g, mtx, [1, 1, 1]);
        addGeometry(piece.b("lente"), LAMP_LENS, mtx, [1, 1, 1]);
        const [x, z] = at(r, u - side * 2.5);
        glows.push(x, base + 7.8, z);
      }
    }
  } else if (plan.portals) {
    // Túnel: ventiladores no teto, caixas de emergência e placas de saída nas paredes.
    const [pA, pB] = plan.portals;
    const win = st.half + WALL_IN;
    for (let s = Math.ceil(s0 / 110) * 110; s < s1; s += 110) {
      if (s < pA + 30 || s > pB - 30) continue;
      const r = frameAt(plan, s);
      for (const u of [-4.2, 4.2]) addGeometry(piece.b("metal"), FAN, placeAt(r, u, r.y + archAt(st, u) - 1.05, heading(r.tx, r.tz)), [1, 1, 1]);
    }
    for (let s = Math.ceil(s0 / 75) * 75; s < s1; s += 75) {
      if (s < pA + 10 || s > pB - 10) continue;
      const r = frameAt(plan, s);
      for (const side of [-1, 1]) {
        const facing = heading(-side * r.lx, -side * r.lz);
        addGeometry(piece.b("laranja"), BOX, placeAt(r, side * (win - 0.12), r.y + 1.4, facing, 0.9, 1.1, 0.25), [1, 1, 1]);
        addGeometry(piece.b("verde"), BOX, placeAt(r, side * (win - 0.06), r.y + 3.3, facing, 1.4, 0.45, 0.1), [1, 1, 1]);
      }
    }
  }
  const extra: THREE.Object3D[] = [];
  if (glows.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(glows, 3));
    extra.push(new THREE.Points(geometry, pointsMaterial()));
  }
  return piece.group(extra);
}

// --- Entrada ---------------------------------------------------------------------------

/** Desenha todas as pontes, viadutos e túneis (depois do `buildStreets`, que diz onde começa cada tabuleiro). */
export function buildStructures(scene: THREE.Scene) {
  for (const plan of plans()) {
    const rows = rowsOf(plan);
    if (rows.length < 2) continue;
    // Pedaços de ~120 m (as linhas das emendas ficam nos dois).
    const cuts: number[] = [0];
    for (let i = 1; i < rows.length - 1; i++) if (rows[i].s - rows[cuts[cuts.length - 1]].s >= PIECE && rows[rows.length - 1].s - rows[i].s > PIECE / 3) cuts.push(i);
    cuts.push(rows.length - 1);
    const pieces: { piece: Piece; s0: number; s1: number; rows: Row[] }[] = [];
    for (let c = 0; c + 1 < cuts.length; c++) {
      const part = rows.slice(cuts[c], cuts[c + 1] + 1);
      const piece = new Piece();
      piece.grow(part, plan.st.half + 12);
      pieces.push({ piece, s0: part[0].s, s1: part[part.length - 1].s, rows: part });
    }
    const extras = new Map<Piece, THREE.Object3D[]>();
    for (const { piece, rows: part } of pieces) {
      buildDeck(plan, piece, part);
      buildEdges(plan, piece, part);
      buildUnderside(plan, piece, part);
      if (plan.park) buildBalustrade(plan, piece, part);
      if (plan.st.kind === "tunel") {
        buildTube(plan, piece, part);
        buildShell(plan, piece, part);
      }
    }
    buildPillars(plan, pieces);
    buildPortals(plan, pieces, extras);
    for (const { piece, s0, s1 } of pieces) {
      addChunk(scene, piece.group(extras.get(piece)), piece.center, piece.radius + 30);
      addLodChunk(scene, piece.center, piece.radius + 10, null, () => buildNear(plan, s0, s1));
    }
  }
}
