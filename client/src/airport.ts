// Aeroporto do Pastel: pátio de concreto com a sinalização (linhas amarelas da
// taxiway, faixas de espera, linhas de entrada dos portões), luzes de pista e
// de taxiway, PAPI, placas, terminal de passageiros com a sala de embarque
// envidraçada (poltronas, lojas e o teto ondulado), pontes de embarque, torre
// de controle, hangares de teto em arco, terminal de cargas, tanques de
// combustível, birutas, estacionamento com carros, carrinhos de pátio e os
// aviões (parados nos portões e um que pousa, taxia e decola de novo, em laço).
//
// A planta vem de shared/airport.ts (tudo no referencial da pista: u ao longo
// dela, n para o lado do terminal); aqui só se desenha. O chão, as luzes e os
// aviões ficam num bloco comum; as construções têm dois níveis de detalhe.
import * as THREE from "three";
import { AIRPORT_LAYOUT, airportPoint, heightAt, seeded, type Airport, type Rect } from "@nfbmc/shared";

import { addChunk, addLodChunk } from "./chunks.ts";
import { surface } from "./look.ts";
import { Mesher, rgb, shade, type Rgb } from "./mesher.ts";
import { M, buildingMaterials } from "./building-materials.ts";
import { paintedTexture } from "./textures.ts";
import { AIRLINES, makePlane } from "./airplanes.ts";

// --- Materiais --------------------------------------------------------------------------------

/** Índices dos materiais do aeroporto no `Mesher` (depois dos dos prédios). */
const A = { slab: 10, asphalt: 11, paint: 12, glass: 13, sign: 14, lamp: 15 } as const;

/** Placas: uma linha por texto (fundo e letra de cada uma). */
const SIGNS: [string, string, string][] = [
  ["AEROPORTO INTERNACIONAL DO PASTEL", "#1d3f8f", "#ffffff"],
  ["HANGAR 1", "#e6e6e6", "#1d3f8f"],
  ["HANGAR 2", "#e6e6e6", "#1d3f8f"],
  ["PASTEL CARGO", "#e6e6e6", "#8a5a2b"],
  ["A1", "#f2c300", "#111111"],
  ["A2", "#f2c300", "#111111"],
  ["A3", "#f2c300", "#111111"],
  ["A4", "#f2c300", "#111111"],
  ["PORTÕES 1 - 4  ·  EMBARQUE", "#111111", "#f2c300"],
  ["09 - 27", "#b01818", "#ffffff"],
];
const SIGN_ROWS = 16;
const signRow = (text: string) => SIGNS.findIndex(([t]) => t === text);

function signTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = SIGN_ROWS * 64;
  const ctx = canvas.getContext("2d")!;
  SIGNS.forEach(([text, back, ink], i) => {
    const y = i * 64;
    ctx.fillStyle = back;
    ctx.fillRect(0, y, 1024, 64);
    ctx.fillStyle = ink;
    ctx.font = "bold 46px 'Russo One', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 512, y + 34, 1000);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Placas de concreto do pátio: 5 × 5 m, juntas escuras, manchas de óleo e borracha. */
const slabPainter = (ctx: CanvasRenderingContext2D, size: number, random: () => number) => {
  ctx.fillStyle = "#dcdad5";
  ctx.fillRect(0, 0, size, size);
  for (let k = 0; k < 4; k++) {
    const x = (k % 2) * (size / 2);
    const y = Math.floor(k / 2) * (size / 2);
    const v = 205 + random() * 25;
    ctx.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
    ctx.fillRect(x + 1, y + 1, size / 2 - 2, size / 2 - 2);
  }
  for (let i = 0; i < 14; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = 4 + random() * 18;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(60,55,50,${0.04 + random() * 0.08})`);
    g.addColorStop(1, "rgba(60,55,50,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.fillStyle = "rgba(70,70,70,0.7)";
  ctx.fillRect(0, 0, size, 1.5);
  ctx.fillRect(0, size / 2, size, 1.5);
  ctx.fillRect(0, 0, 1.5, size);
  ctx.fillRect(size / 2, 0, 1.5, size);
};

const asphaltPainter = (ctx: CanvasRenderingContext2D, size: number, random: () => number) => {
  ctx.fillStyle = "#56555a";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1800; i++) {
    const v = 60 + random() * 70;
    ctx.fillStyle = `rgba(${v},${v},${v + 4},0.6)`;
    ctx.fillRect(random() * size, random() * size, 1 + random(), 1 + random());
  }
};

let materials: THREE.Material[] | null = null;
function airportMaterials() {
  if (materials) return materials;
  const ground = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  const slabMap = paintedTexture(256, slabPainter, 601);
  slabMap.repeat.set(1 / 10, 1 / 10);
  const asphaltMap = paintedTexture(256, asphaltPainter, 602);
  asphaltMap.repeat.set(1 / 8, 1 / 8);
  const slab = surface(new THREE.MeshLambertMaterial({ vertexColors: true, map: slabMap, ...ground }), { roughness: 0.9 });
  const asphalt = surface(new THREE.MeshLambertMaterial({ vertexColors: true, map: asphaltMap, ...ground }), { roughness: 0.92 });
  const paint = surface(new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), { roughness: 0.6 });
  // Vidro da sala de embarque: deixa ver as poltronas lá dentro.
  const glass = surface(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }), {
    roughness: 0.05, metalness: 0.3, envMapIntensity: 1.6,
  });
  const sign = surface(new THREE.MeshLambertMaterial({ map: signTexture(), emissive: "#ffffff", emissiveIntensity: 0.25 }), { roughness: 0.5 });
  sign.emissiveMap = sign.map;
  const lamp = surface(new THREE.MeshBasicMaterial({ vertexColors: true }), { glow: 2.2 });
  materials = [...buildingMaterials(), slab, asphalt, paint, glass, sign, lamp];
  return materials;
}

// --- Desenho no referencial da pista ------------------------------------------------------------

type P3 = [number, number, number];

/** Mesher posto no referencial do aeroporto: (u, y, n) → local (x = u, z = ±n). */
class Pen {
  m: Mesher;
  sg: number;
  constructor(m: Mesher, a: Airport) {
    this.m = m;
    const f = a.frame;
    m.setFrame(f.x, heightAt(f.x, f.z), f.z, Math.atan2(-f.uz, f.ux));
    this.sg = f.nx * -f.uz + f.nz * f.ux > 0 ? 1 : -1;
  }
  box(mat: number, col: Rgb, u0: number, u1: number, y0: number, y1: number, n0: number, n1: number) {
    const a = this.sg * n0;
    const b = this.sg * n1;
    this.m.box(mat, col, Math.min(u0, u1), Math.max(u0, u1), y0, y1, Math.min(a, b), Math.max(a, b));
  }
  /** Quadrilátero virado para `dir` (u, y, n); a ordem dos pontos é corrigida se precisar. */
  quad(mat: number, col: Rgb, p: [P3, P3, P3, P3], dir: P3, uv?: number[]) {
    const q = p.map(([u, y, n]) => [u, y, this.sg * n] as P3);
    const ax = q[1][0] - q[0][0], ay = q[1][1] - q[0][1], az = q[1][2] - q[0][2];
    const bx = q[3][0] - q[0][0], by = q[3][1] - q[0][1], bz = q[3][2] - q[0][2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const same = (i: number, j: number) => Math.hypot(q[i][0] - q[j][0], q[i][1] - q[j][1], q[i][2] - q[j][2]) < 1e-4;
    if (same(0, 1) || same(0, 3) || same(1, 2) || same(2, 3)) {
      // Quadrilátero que é triângulo (ponta do arco): a normal da quina sairia zero (e o sombreamento, NaN).
      const pts = q.filter((pt, i) => !q.slice(0, i).some((o) => Math.hypot(o[0] - pt[0], o[1] - pt[1], o[2] - pt[2]) < 1e-4));
      if (pts.length < 3) return;
      const [a, b, c] = pts;
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const tn = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      if (Math.hypot(tn[0], tn[1], tn[2]) < 1e-6) return;
      const up = tn[0] * dir[0] + tn[1] * dir[1] + tn[2] * this.sg * dir[2] >= 0;
      const [x, y, z] = up ? [a, b, c] : [a, c, b];
      this.m.tri(mat, col, x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]);
      return;
    }
    if (Math.hypot(nx, ny, nz) < 1e-6) return;
    const ok = nx * dir[0] + ny * dir[1] + nz * this.sg * dir[2] >= 0;
    const [a, b, c, d] = ok ? q : [q[1], q[0], q[3], q[2]];
    this.m.quad(mat, col, a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2], uv);
  }
  /** Retângulo deitado (virado para cima) em y. */
  flat(mat: number, col: Rgb, u0: number, u1: number, n0: number, n1: number, y: number) {
    this.quad(mat, col, [[u0, y, n0], [u1, y, n0], [u1, y, n1], [u0, y, n1]], [0, 1, 0]);
  }
  cylinder(mat: number, col: Rgb, u: number, n: number, y0: number, y1: number, r0: number, r1: number, segments = 12, top = true) {
    this.m.cylinder(mat, col, u, this.sg * n, y0, y1, r0, r1, segments, top);
  }
  bar(mat: number, col: Rgb, a: P3, b: P3, t: number) {
    this.m.bar(mat, col, a[0], a[1], this.sg * a[2], b[0], b[1], this.sg * b[2], t);
  }
  /**
   * Placa de texto (linha `row` do atlas), centro (u, y, n), w × h, virada para
   * `face` (u, n) — a escrita sai certa para quem olha de frente.
   */
  sign(row: number, u: number, y: number, n: number, w: number, h: number, face: [number, number]) {
    const dx = face[0];
    const dz = this.sg * face[1];
    // Direita de quem olha a placa de frente: (dz, −dx) no local.
    const rx = dz * (w / 2);
    const rz = -dx * (w / 2);
    const cz = this.sg * n;
    const v1 = 1 - row / SIGN_ROWS - 0.003;
    const v0 = 1 - (row + 1) / SIGN_ROWS + 0.003;
    const off = 0.02;
    this.m.quad(
      A.sign, [1, 1, 1],
      u - rx + dx * off, y - h / 2, cz - rz + dz * off,
      u + rx + dx * off, y - h / 2, cz + rz + dz * off,
      u + rx + dx * off, y + h / 2, cz + rz + dz * off,
      u - rx + dx * off, y + h / 2, cz - rz + dz * off,
      [0, v0, 1, v1],
    );
  }
}

const YELLOW = rgb("#f2c300");
const WHITE = rgb("#f4f4f0");
const RED = rgb("#c81e1e");

/** Linha pintada ao longo de u ou de n (tracejada se `dash`). */
function lineU(p: Pen, col: Rgb, u0: number, u1: number, n: number, width: number, dash?: [number, number]) {
  if (!dash) return p.flat(A.paint, col, u0, u1, n - width / 2, n + width / 2, 0.04);
  for (let u = u0; u < u1; u += dash[0] + dash[1]) p.flat(A.paint, col, u, Math.min(u1, u + dash[0]), n - width / 2, n + width / 2, 0.04);
}
function lineN(p: Pen, col: Rgb, n0: number, n1: number, u: number, width: number, dash?: [number, number]) {
  if (!dash) return p.flat(A.paint, col, u - width / 2, u + width / 2, Math.min(n0, n1), Math.max(n0, n1), 0.04);
  for (let n = Math.min(n0, n1); n < Math.max(n0, n1); n += dash[0] + dash[1]) p.flat(A.paint, col, u - width / 2, u + width / 2, n, Math.min(Math.max(n0, n1), n + dash[0]), 0.04);
}

// --- Chão: pátio, taxiway, estacionamento e sinalização ------------------------------------------

function ground(a: Airport) {
  const m = new Mesher(airportMaterials());
  const p = new Pen(m, a);
  const { taxiway: tw, runway } = a;
  const tone = (k: number) => shade([1, 1, 1], k);
  // Taxiway e as saídas para a pista.
  p.flat(A.slab, tone(0.95), tw.u0 - tw.width / 2, tw.u1 + tw.width / 2, tw.n - tw.width / 2, tw.n + tw.width / 2, 0.015);
  for (const u of tw.exits) {
    p.flat(A.slab, tone(0.92), u - tw.width / 2, u + tw.width / 2, runway.width / 2 - 0.5, tw.n - tw.width / 2, 0.015);
    lineN(p, YELLOW, runway.width / 2 + 1, tw.n, u, 0.3);
    // Faixa de espera (duas contínuas e duas tracejadas) antes da pista.
    const hold = runway.width / 2 + 14;
    for (let k = 0; k < 2; k++) lineU(p, YELLOW, u - tw.width / 2 + 0.5, u + tw.width / 2 - 0.5, hold + k * 0.6, 0.18);
    for (let k = 0; k < 2; k++) lineU(p, YELLOW, u - tw.width / 2 + 0.5, u + tw.width / 2 - 0.5, hold - 1.4 - k * 0.6, 0.18, [1, 0.8]);
  }
  lineU(p, YELLOW, tw.u0, tw.u1, tw.n, 0.3);
  for (const s of [-1, 1]) lineU(p, YELLOW, tw.u0 - tw.width / 2, tw.u1 + tw.width / 2, tw.n + s * (tw.width / 2 - 0.5), 0.15);

  // Pátio dos portões.
  const [au0, au1, an0, an1] = a.apron;
  p.flat(A.slab, tone(1), au0, au1, an0, an1, 0.012);
  for (const g of a.gates) {
    // Linha de entrada (do eixo da taxiway até o portão) e a barra de parada da roda do nariz.
    lineN(p, YELLOW, tw.n, g.nose - (g.wide ? 9 : 6.6), g.u, 0.3);
    lineU(p, YELLOW, g.u - 2.5, g.u + 2.5, g.nose - (g.wide ? 9 : 6.6), 0.4);
    // Área do avião: contorno vermelho tracejado.
    const half = g.wide ? 27 : 19;
    const back = g.nose - (g.wide ? 58 : 41);
    lineN(p, RED, back, g.nose + 2, g.u - half, 0.2, [1.2, 1.2]);
    lineN(p, RED, back, g.nose + 2, g.u + half, 0.2, [1.2, 1.2]);
    lineU(p, RED, g.u - half, g.u + half, back, 0.2, [1.2, 1.2]);
  }
  // Via de serviço dos carrinhos na frente do terminal.
  const tn = a.terminal[2];
  lineU(p, WHITE, au0 + 4, au1 - 4, tn - 2, 0.15);
  lineU(p, WHITE, au0 + 4, au1 - 4, tn - 9, 0.15);
  lineU(p, WHITE, au0 + 4, au1 - 4, tn - 5.5, 0.15, [3, 3]);
  // Pátios na frente dos hangares e o de cargas.
  for (const h of a.hangars) {
    const [u0, u1, n0, n1] = h.rect;
    if (h.door < 0) p.flat(A.slab, tone(0.97), u0, u1, tw.n + tw.width / 2, n0, 0.012);
    else p.flat(A.slab, tone(0.97), u0, u1, n1, a.cargo ? a.cargo[2] : n1 + 10, 0.012);
  }
  if (a.cargo) {
    const [u0, u1, n0, n1] = a.cargo;
    p.flat(A.slab, tone(0.93), u0, u1, n0, n1, 0.012);
    // Ligação até a pista.
    p.flat(A.slab, tone(0.92), -12, 12, n1, -runway.width / 2 + 0.5, 0.015);
    lineN(p, YELLOW, n1 + 2, -runway.width / 2 - 1, 0, 0.3);
    lineU(p, YELLOW, u0 + 5, u1 - 5, (n0 + n1) / 2, 0.3);
  }
  // Estacionamento e o acesso.
  if (a.parking) {
    const [u0, u1, n0, n1] = a.parking;
    p.flat(A.asphalt, tone(1), u0, u1, n0, n1, 0.02);
    for (let n = n0 + 6; n + 5 < n1; n += 16) {
      for (let u = u0 + 3; u <= u1 - 3; u += 2.6) {
        lineN(p, WHITE, n, n + 5, u, 0.12);
        if (n + 10 < n1) lineN(p, WHITE, n + 5, n + 10, u, 0.12);
      }
    }
  }
  if (a.access) p.flat(A.asphalt, tone(0.95), a.access.u - 6, a.access.u + 6, a.access.n0, a.access.n1 + 2, 0.02);
  if (a.access) lineN(p, YELLOW, a.access.n0 + 2, a.access.n1, a.access.u, 0.2, [3, 4]);
  return m.finish("aeroporto-chao");
}

// --- Luzes (instanciadas) -----------------------------------------------------------------------

function lights(a: Airport) {
  const L = a.runway.length;
  const W = a.runway.width;
  const list: [number, number, number, string, number][] = [];
  const add = (u: number, n: number, y: number, color: string, s = 1) => list.push([u, n, y, color, s]);
  for (let u = -L / 2 + 10; u <= L / 2 - 10; u += 50) for (const s of [-1, 1]) add(u, s * (W / 2 + 1.2), 0.25, "#fff1c8");
  for (let n = -W / 2 + 1; n <= W / 2 - 1; n += 3) {
    add(-L / 2 + 3, n, 0.25, "#38ff5a");
    add(L / 2 - 3, n, 0.25, "#ff3030");
  }
  // PAPI: quatro caixas do lado esquerdo de quem pousa.
  for (const [u0, side] of [[-L / 2 + 130, -1], [L / 2 - 130, 1]] as const) {
    for (let k = 0; k < 4; k++) add(u0, side * (W / 2 + 10 + k * 3), 0.6, k < 2 ? "#ff3030" : "#ffffff", 2.4);
  }
  const tw = a.taxiway;
  const openings = tw.exits;
  for (let u = tw.u0; u <= tw.u1; u += 30) {
    if (openings.some((e) => Math.abs(e - u) < tw.width)) continue;
    for (const s of [-1, 1]) add(u, tw.n + s * (tw.width / 2 + 0.8), 0.25, "#3c6bff");
  }
  for (const e of openings) for (let n = W / 2 + 8; n < tw.n - tw.width / 2; n += 10) for (const s of [-1, 1]) add(e + s * (tw.width / 2 + 0.8), n, 0.25, "#3c6bff");
  // Linha central verde da saída.
  for (const e of openings) for (let n = W / 2 + 4; n < tw.n; n += 8) add(e, n, 0.1, "#38ff5a", 0.6);

  const geometry = new THREE.BoxGeometry(0.35, 0.3, 0.35);
  const material = surface(new THREE.MeshBasicMaterial({ color: "#ffffff" }), { glow: 3 });
  const mesh = new THREE.InstancedMesh(geometry, material, list.length);
  const base = heightAt(a.frame.x, a.frame.z);
  const matrix = new THREE.Matrix4();
  list.forEach(([u, n, y, color, s], i) => {
    const [x, z] = airportPoint(a, u, n);
    matrix.makeScale(s, s, s).setPosition(x, base + y, z);
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, new THREE.Color(color));
  });
  mesh.computeBoundingSphere();
  mesh.userData.noShadow = true;
  return mesh;
}

// --- Terminal, pontes de embarque e torre ------------------------------------------------------

const STEEL = rgb("#d9dde2");
const DARKSTEEL = rgb("#4c535b");
const CONCRETE = rgb("#c9c6c0");
const GLASS = rgb("#7fa6c4");

function terminal(p: Pen, a: Airport, random: () => number) {
  const [u0, u1, n0, n1] = a.terminal;
  const floor = 5.2;
  const top = 13;
  // Térreo de serviço (concreto, portas dos carrinhos de bagagem).
  p.box(M.concrete, CONCRETE, u0, u1, -0.3, floor, n0, n1);
  for (let u = u0 + 8; u < u1 - 6; u += 14) p.box(M.paint, shade(DARKSTEEL, 0.6), u, u + 4.5, 0, 3.6, n0 - 0.08, n0 + 0.2);
  // Laje da sala de embarque e o piso (carpete).
  p.box(M.concrete, CONCRETE, u0 - 0.5, u1 + 0.5, floor, floor + 0.35, n0 - 0.8, n1);
  p.flat(M.paint, rgb("#4a5a78"), u0 + 0.3, u1 - 0.3, n0 + 0.3, n1 - 0.3, floor + 0.37);
  // Fundo: lojas e lanchonetes (fachadas coloridas) e a parede do lado da rua.
  const shopsN = n0 + 15;
  p.box(M.plaster, rgb("#efe9df"), u0, u1, floor, top, shopsN, shopsN + 0.4);
  const shopColors = ["#c1121f", "#f4a261", "#2a9d8f", "#ffd23f", "#7b2cbf", "#e76f51", "#1d3557"];
  for (let u = u0 + 4; u < u1 - 10; u += 13) {
    const c = rgb(shopColors[Math.floor(random() * shopColors.length)]);
    p.box(M.paint, c, u, u + 10, floor + 3.2, floor + 4.2, shopsN - 0.3, shopsN);
    p.box(M.glass, GLASS, u + 0.6, u + 9.4, floor + 0.4, floor + 3.1, shopsN - 0.12, shopsN);
  }
  // Poltronas da sala de embarque: fileiras ao longo do vidro.
  const seat = rgb("#2f5fa8");
  for (let row = 0; row < 4; row++) {
    const n = n0 + 3 + row * 2.6;
    for (let u = u0 + 3; u < u1 - 6; u += 9) {
      p.box(M.paint, seat, u, u + 6, floor + 0.4, floor + 0.85, n - 0.3, n + 0.3);
      p.box(M.paint, shade(seat, 0.85), u, u + 6, floor + 0.85, floor + 1.4, n + 0.2, n + 0.35);
      p.box(M.paint, DARKSTEEL, u + 0.1, u + 5.9, floor + 0.35, floor + 0.4, n - 0.25, n + 0.25);
    }
  }
  // Passageiros (bonequinhos simples) esperando.
  const clothes = ["#e63946", "#457b9d", "#2a9d8f", "#f4a261", "#6d597a", "#264653", "#e9c46a", "#f1faee"];
  for (let k = 0; k < 40; k++) {
    const u = u0 + 4 + random() * (u1 - u0 - 8);
    const n = n0 + 1 + random() * 12;
    const c = rgb(clothes[Math.floor(random() * clothes.length)]);
    p.box(M.paint, c, u - 0.22, u + 0.22, floor + 0.37, floor + 1.45, n - 0.15, n + 0.15);
    p.box(M.paint, rgb("#e0ac80"), u - 0.12, u + 0.12, floor + 1.45, floor + 1.72, n - 0.12, n + 0.12);
  }
  // Luminárias do teto (acesas: fim de tarde).
  for (let u = u0 + 4; u < u1 - 2; u += 6) for (const n of [n0 + 4, n0 + 10]) p.flat(A.lamp, rgb("#fff1d0"), u, u + 3, n - 0.3, n + 0.3, top - 0.3);
  // Pano de vidro: frente (lado do pátio) e as pontas, com os montantes.
  p.quad(A.glass, GLASS, [[u0, floor + 0.35, n0], [u1, floor + 0.35, n0], [u1, top, n0], [u0, top, n0]], [0, 0, -1], [0, 0, 1, 1]);
  for (const u of [u0, u1]) p.quad(A.glass, GLASS, [[u, floor + 0.35, n0], [u, floor + 0.35, shopsN], [u, top, shopsN], [u, top, n0]], [u === u0 ? -1 : 1, 0, 0], [0, 0, 1, 1]);
  for (let u = u0; u <= u1 + 0.01; u += 3) p.box(M.paint, DARKSTEEL, u - 0.08, u + 0.08, floor + 0.35, top, n0 - 0.12, n0 + 0.05);
  for (const y of [floor + 0.35, floor + 3.6, top - 0.15]) p.box(M.paint, DARKSTEEL, u0, u1, y, y + 0.15, n0 - 0.14, n0 + 0.05);
  // Parte de trás (lado da rua): concreto e vidro escuro, com a entrada.
  p.box(M.plaster, rgb("#e9e5dc"), u0, u1, floor, top, shopsN + 0.4, n1);
  for (let u = u0 + 4; u < u1 - 4; u += 7) p.box(M.glass, rgb("#3e5568"), u, u + 5, floor + 1.2, top - 1.5, n1 - 0.05, n1 + 0.08);
  for (let u = u0 + 10; u < u1 - 10; u += 20) p.box(M.glass, rgb("#33475a"), u, u + 7, 0, 3.2, n1 - 0.05, n1 + 0.1);
  // Teto ondulado (arco ao longo de n), passando dos dois lados.
  const r0 = n0 - 5;
  const r1 = n1 + 6;
  const seg = 10;
  const yAt = (k: number) => top + 0.4 + Math.sin((k / seg) * Math.PI) * 2.6;
  const nAt = (k: number) => r0 + ((r1 - r0) * k) / seg;
  for (let k = 0; k < seg; k++) {
    const na = nAt(k);
    const nb = nAt(k + 1);
    const ya = yAt(k);
    const yb = yAt(k + 1);
    p.quad(M.metal, STEEL, [[u0 - 3, ya, na], [u1 + 3, ya, na], [u1 + 3, yb, nb], [u0 - 3, yb, nb]], [0, 1, 0]);
    p.quad(M.paint, rgb("#f2f2ef"), [[u0 - 3, ya - 0.3, na], [u1 + 3, ya - 0.3, na], [u1 + 3, yb - 0.3, nb], [u0 - 3, yb - 0.3, nb]], [0, -1, 0]);
  }
  for (const u of [u0 - 3, u1 + 3]) {
    for (let k = 0; k < seg; k++) {
      p.quad(M.paint, rgb("#e2e2de"), [[u, yAt(k) - 0.3, nAt(k)], [u, yAt(k + 1) - 0.3, nAt(k + 1)], [u, yAt(k + 1), nAt(k + 1)], [u, yAt(k), nAt(k)]], [u < 0 ? -1 : 1, 0, 0]);
    }
  }
  // Pilares do beiral (as pontas do arco passam da fachada).
  for (let u = u0; u <= u1 + 0.01; u += 15) {
    p.bar(M.paint, STEEL, [u, floor, n0 - 4], [u, yAt(0.3), n0 - 4.2], 0.35);
    p.bar(M.paint, STEEL, [u, 0, n1 + 5], [u, yAt(seg - 0.3), n1 + 5.2], 0.4);
  }
  // Letreiros: o nome na frente (lado da rua) e os portões no lado do pátio.
  p.sign(signRow("AEROPORTO INTERNACIONAL DO PASTEL"), 0, top - 0.3, n1 + 0.15, Math.min(70, u1 - u0 - 20), 4.2, [0, 1]);
  p.sign(signRow("PORTÕES 1 - 4  ·  EMBARQUE"), 0, floor - 1.4, n0 - 0.12, 24, 1.5, [0, -1]);
  // Marquise do embarque e desembarque (lado da rua).
  p.box(M.concrete, CONCRETE, u0 + 6, u1 - 6, 5.3, 5.7, n1, n1 + 8);
  for (let u = u0 + 8; u < u1 - 6; u += 12) p.cylinder(M.paint, STEEL, u, n1 + 7, 0, 5.3, 0.25, 0.25, 8, false);
  p.box(M.concrete, rgb("#b8b4ac"), u0 + 6, u1 - 6, -0.2, 0.18, n1, n1 + 3.5);
}

/** Ponte de embarque: rotunda no terminal, túnel inclinado, pernas com rodas e a cabine na porta. */
function jetBridge(p: Pen, a: Airport, g: Airport["gates"][number], left: number) {
  const n0 = a.terminal[2];
  const scale = g.wide ? 1.45 : 1;
  const r = 1.95 * scale;
  const doorN = g.nose - 6 * scale;
  const doorU = g.u + left * (r + 1.9);
  const sill = g.wide ? 3.8 : 2.9;
  const startU = g.u + left * 8;
  // Rotunda (cilindro) encostada no terminal.
  p.cylinder(M.metal, STEEL, startU, n0 - 3, 0, 8.4, 2.4, 2.4, 12);
  p.cylinder(M.paint, DARKSTEEL, startU, n0 - 3, 8.4, 8.6, 2.6, 2.6, 12);
  // Túnel até a cabine.
  const a0: P3 = [startU, 6.6, n0 - 5];
  const a1: P3 = [doorU + left * 1.4, sill + 1.5, doorN];
  p.bar(M.metal, STEEL, a0, a1, 2.8);
  // Faixa de vidro do túnel.
  p.bar(M.glass, GLASS, [a0[0], a0[1] + 0.4, a0[2]], [a1[0], a1[1] + 0.4, a1[2]], 2.85);
  // Pernas e rodas a 70% do caminho.
  const k = 0.7;
  const lu = a0[0] + (a1[0] - a0[0]) * k;
  const ly = a0[1] + (a1[1] - a0[1]) * k;
  const ln = a0[2] + (a1[2] - a0[2]) * k;
  for (const s of [-1, 1]) p.bar(M.paint, DARKSTEEL, [lu + s * 1.0, 0.6, ln], [lu + s * 1.0, ly - 1.3, ln], 0.35);
  p.box(M.paint, DARKSTEEL, lu - 1.8, lu + 1.8, 0.4, 0.8, ln - 0.6, ln + 0.6);
  for (const s of [-1, 1]) p.cylinder(M.paint, rgb("#1e1e1e"), lu + s * 1.2, ln, 0, 0.8, 0.42, 0.42, 10);
  // Cabine na porta do avião (com a sanfona escura).
  p.box(M.metal, shade(STEEL, 0.95), a1[0] - 1.6, a1[0] + 1.6, sill - 0.1, sill + 2.9, a1[2] - 1.8, a1[2] + 1.8);
  p.box(M.paint, rgb("#2a2a2a"), Math.min(a1[0], doorU) - 0.2, Math.max(a1[0], doorU) + 0.2, sill, sill + 2.6, doorN - 1.3, doorN + 1.3);
}

function tower(p: Pen, a: Airport) {
  const { u, n, height } = a.tower;
  p.box(M.concrete, CONCRETE, u - 6, u + 6, -0.3, 4, n - 6, n + 6);
  p.cylinder(M.concrete, CONCRETE, u, n, 4, height - 4, 3.4, 2.8, 14);
  // Varanda e a cabine de vidro (inclinada para fora).
  p.cylinder(M.concrete, rgb("#e4e2dc"), u, n, height - 4, height - 2.8, 3, 5.4, 12);
  p.cylinder(M.glass, rgb("#5f8fb0"), u, n, height - 2.8, height + 1.4, 5.0, 5.6, 8, false);
  p.cylinder(M.paint, DARKSTEEL, u, n, height + 1.4, height + 2.1, 5.8, 5.4, 8);
  p.cylinder(M.paint, rgb("#e9e7e2"), u, n, height + 2.1, height + 3, 4.4, 1.8, 8);
  p.bar(M.paint, rgb("#dddddd"), [u, height + 3, n], [u, height + 9, n], 0.18);
  p.bar(M.paint, rgb("#dddddd"), [u + 1.5, height + 3, n], [u + 1.5, height + 6, n], 0.1);
  p.cylinder(A.lamp, rgb("#ff2a2a"), u, n, height + 9, height + 9.5, 0.3, 0.3, 6);
  // Radar girando? Parado mesmo, numa torrezinha ao lado.
  p.box(M.paint, rgb("#f2f2f2"), u + 7.5, u + 9.5, -0.3, 6, n - 1, n + 1);
}

// --- Hangares e tanques ------------------------------------------------------------------------------

function hangar(p: Pen, h: Airport["hangars"][number], random: () => number) {
  const [u0, u1, n0, n1] = h.rect;
  const wallH = 9;
  const rise = 7;
  const cu = (u0 + u1) / 2;
  const hw = (u1 - u0) / 2;
  const clad = rgb(["#c9ced3", "#b9c1c8", "#d5d0c4"][Math.floor(random() * 3)]);
  // Paredes laterais.
  for (const u of [u0, u1]) p.box(M.metal, clad, u - 0.2, u + 0.2, -0.3, wallH, n0, n1);
  // Teto em arco (ao longo de u), passando um pouco nas pontas.
  const seg = 12;
  const at = (k: number): [number, number] => {
    const t = Math.PI - (k / seg) * Math.PI;
    return [cu + Math.cos(t) * (hw + 0.4), wallH + Math.sin(t) * rise];
  };
  for (let k = 0; k < seg; k++) {
    const [ua, ya] = at(k);
    const [ub, yb] = at(k + 1);
    const t = Math.PI - ((k + 0.5) / seg) * Math.PI;
    p.quad(M.metal, shade(clad, 0.92), [[ua, ya, n0 - 0.6], [ub, yb, n0 - 0.6], [ub, yb, n1 + 0.6], [ua, ya, n1 + 0.6]], [Math.cos(t), Math.sin(t), 0]);
  }
  // Oitões (frente e fundo): retângulo até a parede e o leque do arco.
  const doorN = h.door < 0 ? n0 : n1;
  for (const n of [n0, n1]) {
    const out = n === n0 ? -1 : 1;
    const isDoor = n === doorN;
    for (let k = 0; k < seg; k++) {
      const [ua, ya] = at(k);
      const [ub, yb] = at(k + 1);
      p.quad(M.metal, clad, [[ua, wallH, n], [ub, wallH, n], [ub, yb, n], [ua, ya, n]], [0, 0, out]);
    }
    if (!isDoor) {
      p.quad(M.metal, clad, [[u0, -0.3, n], [u1, -0.3, n], [u1, wallH, n], [u0, wallH, n]], [0, 0, out]);
      continue;
    }
    // Portão grande, de correr: as folhas empilhadas dos lados, metade aberto (o escuro de dentro aparece).
    const open = 0.35 + random() * 0.4;
    const gap = (u1 - u0 - 4) * open;
    p.box(M.paint, rgb("#1c1f22"), cu - gap / 2, cu + gap / 2, -0.2, wallH - 0.2, n - out * 3, n - out * 2.8);
    const leaf = rgb("#e8e8e4");
    p.quad(M.metal, leaf, [[u0 + 2, 0, n], [cu - gap / 2, 0, n], [cu - gap / 2, wallH, n], [u0 + 2, wallH, n]], [0, 0, out]);
    p.quad(M.metal, leaf, [[cu + gap / 2, 0, n], [u1 - 2, 0, n], [u1 - 2, wallH, n], [cu + gap / 2, wallH, n]], [0, 0, out]);
    p.box(M.paint, rgb("#3a3f45"), u0, u1, wallH - 0.4, wallH, n - out * 0.2, n + out * 0.4);
    // Por dentro: chão e paredes escuras atrás do vão.
    p.flat(M.concrete, rgb("#5b5a57"), cu - gap / 2, cu + gap / 2, Math.min(n, n - out * 2.8), Math.max(n, n - out * 2.8), 0.05);
    p.sign(signRow(h.label), cu, wallH + rise * 0.55, n + out * 0.08, Math.min(26, hw * 1.1), 3, [0, out]);
  }
  p.cylinder(A.lamp, rgb("#ff2a2a"), cu, (n0 + n1) / 2, wallH + rise, wallH + rise + 0.4, 0.25, 0.25, 6);
}

function fuelTanks(p: Pen, a: Airport) {
  if (!a.tanks.length) return;
  const us = a.tanks.map((t) => t.u);
  const ns = a.tanks.map((t) => t.n);
  const r = a.tanks[0].r;
  // Mureta de contenção em volta.
  const [u0, u1, n0, n1] = [Math.min(...us) - r - 3, Math.max(...us) + r + 3, Math.min(...ns) - r - 3, Math.max(...ns) + r + 3];
  for (const [a0, a1, b0, b1] of [[u0, u1, n0, n0 + 0.3], [u0, u1, n1 - 0.3, n1], [u0, u0 + 0.3, n0, n1], [u1 - 0.3, u1, n0, n1]]) p.box(M.concrete, CONCRETE, a0, a1, -0.2, 1.1, b0, b1);
  for (const t of a.tanks) {
    p.cylinder(M.paint, rgb("#f1f1ee"), t.u, t.n, -0.2, t.h, t.r, t.r, 18, false);
    p.cylinder(M.paint, rgb("#e2e2de"), t.u, t.n, t.h, t.h + 1.6, t.r + 0.1, 0.8, 18);
    p.cylinder(M.paint, rgb("#d6342c"), t.u, t.n, t.h * 0.62, t.h * 0.7, t.r + 0.03, t.r + 0.03, 18, false);
    p.bar(M.paint, DARKSTEEL, [t.u + t.r + 0.3, 0, t.n], [t.u + t.r * 0.3, t.h + 1, t.n + t.r * 0.9], 0.15);
  }
}

// --- Carrinhos de pátio e carros do estacionamento -------------------------------------------------

function vehicles(p: Pen, a: Airport, random: () => number, left: number) {
  for (const g of a.gates) {
    const s = g.wide ? 1.45 : 1;
    const right = -left;
    // Caminhão de combustível perto da asa direita.
    const fu = g.u + right * 9 * s;
    const fn = g.nose - 22 * s;
    p.box(M.paint, rgb("#f2f2ee"), fu - 1.25, fu + 1.25, 0.6, 3.2, fn - 2.5, fn + 3.5);
    p.box(M.paint, rgb("#f2c300"), fu - 1.27, fu + 1.27, 1.6, 1.9, fn - 2.5, fn + 3.5);
    p.box(M.paint, rgb("#2b2b2b"), fu - 1.25, fu + 1.25, 0.6, 2.9, fn + 3.6, fn + 5.6);
    p.box(M.glass, GLASS, fu - 1.15, fu + 1.15, 1.9, 2.7, fn + 5.6, fn + 5.68);
    for (const dn of [-1.6, 1.8, 4.8]) for (const su of [-1, 1]) p.cylinder(M.paint, rgb("#1a1a1a"), fu + su * 1.15, fn + dn, 0, 0.9, 0.45, 0.45, 8);
    // Trator de bagagem com três carretinhas, do lado direito, atrás.
    const bu = g.u + right * 6;
    for (let k = 0; k < 4; k++) {
      const bn = g.nose - 32 * s - k * 3.4;
      if (k === 0) p.box(M.paint, rgb("#f2c300"), bu - 0.8, bu + 0.8, 0.3, 1.5, bn - 1.2, bn + 1.2);
      else {
        p.box(M.paint, rgb("#6b6f75"), bu - 0.9, bu + 0.9, 0.4, 0.55, bn - 1.3, bn + 1.3);
        for (let b = 0; b < 3; b++) {
          const c = rgb(["#7a4a2a", "#1d3557", "#c1121f", "#2a9d8f", "#333333"][Math.floor(random() * 5)]);
          p.box(M.paint, c, bu - 0.7 + b * 0.5, bu - 0.3 + b * 0.5, 0.55, 0.55 + 0.4 + random() * 0.3, bn - 0.6, bn + 0.6);
        }
      }
    }
    // Escada na porta de trás, do lado esquerdo (quando não é o avião grande).
    if (!g.wide) {
      const su = g.u + left * 4.2;
      const sn = g.nose - 31;
      p.box(M.paint, rgb("#f2f2ee"), su - 1.1, su + 1.1, 0.4, 1.3, sn - 3, sn + 3);
      p.bar(M.paint, rgb("#c8c8c8"), [su, 1.4, sn - 2.6], [su - left * 0.1, 3.3, sn + 2.4], 1.2);
      for (const dn of [-2, 2]) for (const ss of [-1, 1]) p.cylinder(M.paint, rgb("#1a1a1a"), su + ss * 1.0, sn + dn, 0, 0.7, 0.35, 0.35, 8);
    }
    // Rebocador na frente do nariz.
    p.box(M.paint, rgb("#d6342c"), g.u - 1.3, g.u + 1.3, 0.2, 1.4, g.nose + 1.2, g.nose + 5.2);
  }
  // Postes de iluminação do pátio (entre os portões).
  const n0 = a.terminal[2];
  const poles: number[] = [];
  for (let k = 0; k + 1 < a.gates.length; k++) poles.push((a.gates[k].u + a.gates[k + 1].u) / 2);
  poles.push(a.apron[0] + 6, a.apron[1] - 6);
  for (const u of poles) {
    const n = u === a.apron[0] + 6 || u === a.apron[1] - 6 ? (a.apron[2] + a.apron[3]) / 2 : n0 - 12;
    p.cylinder(M.paint, rgb("#9aa0a6"), u, n, 0, 24, 0.35, 0.22, 8, false);
    p.box(M.paint, DARKSTEEL, u - 2, u + 2, 24, 24.6, n - 0.6, n + 0.6);
    p.box(A.lamp, rgb("#fff1c8"), u - 1.8, u + 1.8, 23.9, 24, n - 0.5, n + 0.5);
  }
  // Carros no estacionamento.
  if (a.parking) {
    const [u0, u1, pn0, pn1] = a.parking;
    const colors = ["#c1121f", "#f1f1f1", "#2b2b2b", "#9aa0a6", "#1d3557", "#e9c46a", "#3a5a40", "#f4a261"];
    for (let n = pn0 + 6; n + 5 < pn1; n += 16) {
      for (const row of [0, 1]) {
        if (row && n + 10 >= pn1) continue;
        for (let u = u0 + 3; u + 2.6 <= u1 - 3; u += 2.6) {
          if (random() < 0.35) continue;
          const c = rgb(colors[Math.floor(random() * colors.length)]);
          const cu = u + 1.3;
          const cn = n + 2.5 + row * 5;
          p.box(M.paint, c, cu - 0.85, cu + 0.85, 0.25, 0.95, cn - 2.1, cn + 2.1);
          p.box(M.paint, shade(c, 0.9), cu - 0.75, cu + 0.75, 0.95, 1.45, cn - 1.1 + row * 0.4, cn + 0.9 + row * 0.4);
          p.box(M.glass, rgb("#2d3a45"), cu - 0.77, cu + 0.77, 1.0, 1.4, cn - 0.9 + row * 0.4, cn + 0.7 + row * 0.4);
        }
      }
    }
  }
  // Placas da taxiway (amarelas, perto de cada saída).
  a.taxiway.exits.forEach((u, i) => {
    const n = a.taxiway.n - a.taxiway.width / 2 - 5;
    const su = u + a.taxiway.width / 2 + 4;
    p.box(M.paint, rgb("#222222"), su - 1.4, su + 1.4, 0.4, 1.6, n - 0.15, n + 0.15);
    p.sign(signRow(`A${i + 1}`), su, 1.0, n - 0.16, 2.6, 1.1, [0, -1]);
    p.sign(signRow(`A${i + 1}`), su, 1.0, n + 0.16, 2.6, 1.1, [0, 1]);
    p.sign(signRow("09 - 27"), su - 3.4, 1.0, a.runway.width / 2 + 15, 2.8, 1.0, [0, 1]);
    p.box(M.paint, rgb("#222222"), su - 4.9, su - 1.9, 0.4, 1.55, a.runway.width / 2 + 14.7, a.runway.width / 2 + 14.95);
  });
}

// --- Birutas (balançam com o vento) ---------------------------------------------------------------

function windsock(a: Airport, u: number, n: number) {
  const [x, z] = airportPoint(a, u, n);
  const y = heightAt(x, z);
  const group = new THREE.Group();
  group.position.set(x, y, z);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 6.5, 6).translate(0, 3.25, 0), new THREE.MeshLambertMaterial({ color: "#d9d9d9" }));
  group.add(pole);
  const sock = new THREE.Group();
  sock.position.y = 6.3;
  const stripes = new THREE.Group();
  for (let k = 0; k < 5; k++) {
    const r0 = 0.45 - k * 0.06;
    const piece = new THREE.Mesh(
      new THREE.CylinderGeometry(r0 - 0.06, r0, 0.7, 10, 1, true).rotateZ(Math.PI / 2).translate(0.35 + k * 0.7, 0, 0),
      new THREE.MeshLambertMaterial({ color: k % 2 ? "#ffffff" : "#ff6a00", side: THREE.DoubleSide }),
    );
    stripes.add(piece);
  }
  sock.add(stripes);
  group.add(sock);
  const base = 0.9 + (u > 0 ? 0.2 : -0.1);
  pole.onBeforeRender = () => {
    const t = performance.now() / 1000;
    sock.rotation.y = base + Math.sin(t * 0.37 + u) * 0.25 + Math.sin(t * 1.3) * 0.05;
    stripes.rotation.z = -0.08 - Math.max(0, Math.sin(t * 0.21 + n)) * 0.25;
    sock.updateMatrixWorld(true);
  };
  pole.frustumCulled = false;
  return group;
}

// --- O avião que pousa, taxia e decola (em laço) -----------------------------------------------------

interface Seg {
  a: P3;
  b: P3;
  v0: number;
  v1: number;
  dur: number;
  pitch: [number, number];
}

function flightPlan(ap: Airport) {
  const L = ap.runway.length;
  const tw = ap.taxiway;
  const tu = tw.u1;
  const A0 = ap.apron[1];
  const segs: Seg[] = [];
  let at: P3 = [-L / 2 - 2600, 0, 140];
  const go = (b: P3, v0: number, v1: number, pitch: [number, number] = [0, 0]) => {
    const d = Math.hypot(b[0] - at[0], b[1] - at[1], b[2] - at[2]);
    const dur = v0 + v1 > 0 ? (2 * d) / (v0 + v1) : 0;
    segs.push({ a: at, b, v0, v1, dur, pitch });
    at = b;
  };
  const wait = (seconds: number, pitch = 0) => segs.push({ a: at, b: at, v0: 0, v1: 0, dur: seconds, pitch: [pitch, pitch] });
  // [u, n, y]
  go([-L / 2 + 110, 0, 0.0], 72, 66, [0.06, 0.09]);
  go([tu - 40, 0, 0], 66, 12, [0.05, 0]);
  go([tu - 10, 8, 0], 12, 8);
  go([tu, 22, 0], 8, 8);
  go([tu, tw.n, 0], 8, 8);
  go([A0 + 10, tw.n, 0], 8, 8);
  go([A0 - 10, tw.n, 0], 8, 0);
  wait(25);
  go([A0 - 30, tw.n, 0], 0, 8);
  go([-tu + 10, tw.n, 0], 8, 8);
  go([-tu, tw.n - 12, 0], 8, 6);
  go([-tu, 12, 0], 6, 6);
  go([-tu + 12, 2, 0], 6, 3);
  go([-tu + 30, 0, 0], 3, 0);
  wait(8);
  go([-tu + 30 + 470, 0, 0], 0, 62);
  go([-tu + 30 + 470 + 160, 0, 9], 62, 72, [0.02, 0.2]);
  go([-tu + 30 + 470 + 160 + 3200, 0, 9 + 3200 * Math.tan(0.14)], 72, 85, [0.2, 0.2]);
  const total = segs.reduce((s, g) => s + g.dur, 0);
  return { segs, total };
}

/** Posição (u, n, y) e arfagem no tempo t do roteiro. */
function sample(plan: ReturnType<typeof flightPlan>, time: number): { p: P3; pitch: number } {
  let t = ((time % plan.total) + plan.total) % plan.total;
  for (const s of plan.segs) {
    if (t > s.dur) {
      t -= s.dur;
      continue;
    }
    const k = s.dur > 0 ? t / s.dur : 0;
    // Aceleração constante: s(t) = v0 t + (v1 − v0) t² / (2 dur), normalizado.
    const dist = s.v0 * t + ((s.v1 - s.v0) * t * t) / (2 * Math.max(s.dur, 1e-6));
    const total = ((s.v0 + s.v1) / 2) * s.dur;
    const f = total > 0 ? dist / total : 0;
    return { p: [s.a[0] + (s.b[0] - s.a[0]) * f, s.a[1] + (s.b[1] - s.a[1]) * f, s.a[2] + (s.b[2] - s.a[2]) * f], pitch: s.pitch[0] + (s.pitch[1] - s.pitch[0]) * k };
  }
  const last = plan.segs[plan.segs.length - 1];
  return { p: last.b, pitch: last.pitch[1] };
}

function movingPlane(a: Airport) {
  const plane = makePlane(2);
  const plan = flightPlan(a);
  const f = a.frame;
  const base = heightAt(f.x, f.z);
  let heading = 0;
  let lastFrame = -1;
  plane.frustumCulled = false;
  plane.rotation.order = "YXZ";
  const update = (time: number) => {
    const now = sample(plan, time);
    // Rumo pelo ponto um pouco mais à frente (curvas suaves); parado, fica o último.
    for (const dt of [1.2, -1.2, -4, -10]) {
      const other = sample(plan, time + dt).p;
      const du = (other[0] - now.p[0]) * Math.sign(dt);
      const dn = (other[1] - now.p[1]) * Math.sign(dt);
      if (Math.hypot(du, dn) > 0.05) {
        heading = Math.atan2(f.ux * du + f.nx * dn, f.uz * du + f.nz * dn);
        break;
      }
    }
    const [x, z] = airportPoint(a, now.p[0], now.p[1]);
    plane.position.set(x, base + now.p[2], z);
    plane.rotation.set(-now.pitch, heading, 0);
    plane.updateMatrixWorld();
  };
  update(0);
  plane.onBeforeRender = (renderer) => {
    const frame = renderer.info.render.frame;
    if (frame === lastFrame) return;
    lastFrame = frame;
    update(performance.now() / 1000 + 40);
  };
  return plane;
}

// --- Versão de longe das construções ------------------------------------------------------------------

function farBoxes(a: Airport, rects: { rect: Rect; h: number; color: string; round?: boolean }[]) {
  const material = surface(new THREE.MeshLambertMaterial({ color: "#ffffff" }), { roughness: 0.8 });
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 12).translate(0, 0.5, 0);
  const group = new THREE.Group();
  const base = heightAt(a.frame.x, a.frame.z);
  const angle = Math.atan2(-a.frame.uz, a.frame.ux);
  for (const { rect, h, color, round } of rects) {
    const [u0, u1, n0, n1] = rect;
    const [x, z] = airportPoint(a, (u0 + u1) / 2, (n0 + n1) / 2);
    const mesh = new THREE.Mesh(round ? cylinder : box, material.clone());
    (mesh.material as THREE.MeshLambertMaterial).color.set(color);
    mesh.position.set(x, base - 0.3, z);
    mesh.rotation.y = angle;
    mesh.scale.set(Math.abs(u1 - u0), h, Math.abs(n1 - n0));
    group.add(mesh);
  }
  return group;
}

// --- Montagem ---------------------------------------------------------------------------------------

export function buildAirport(scene: THREE.Scene) {
  const a = AIRPORT_LAYOUT;
  if (!a) return;
  airportMaterials();
  const center = airportPoint(a, 0, 40);
  const reach = Math.max(a.runway.length / 2, 260) + 80;

  // Chão, luzes, birutas, aviões parados e o que pousa e decola: bloco comum (qualquer qualidade).
  const group = new THREE.Group();
  group.add(ground(a), lights(a));
  for (const w of a.windsocks) group.add(windsock(a, w.u, w.n));
  const base = heightAt(a.frame.x, a.frame.z);
  for (const g of a.gates) {
    const plane = makePlane(g.airline, { wide: g.wide });
    const [x, z] = airportPoint(a, g.u, g.nose - 19.3 * (g.wide ? 1.45 : 1));
    plane.position.set(x, base, z);
    plane.rotation.y = Math.atan2(a.frame.nx, a.frame.nz);
    group.add(plane);
  }
  for (const [k, s] of a.smallPlanes.entries()) {
    const plane = makePlane(5 - (k % 2) * 5, { small: true });
    const [x, z] = airportPoint(a, s.u, s.n);
    plane.position.set(x, base, z);
    plane.rotation.y = Math.atan2(-a.frame.uz, a.frame.ux) + s.heading;
    group.add(plane);
  }
  if (a.freighter) {
    // Cargueiro parado no pátio de cargas (centro do avião = nariz − 19,3 × 1,45).
    const plane = makePlane(0, { wide: true });
    const [x, z] = airportPoint(a, a.freighter.u - 19.3 * 1.45 + 27.5, a.freighter.n);
    plane.position.set(x, base, z);
    plane.rotation.y = Math.atan2(a.frame.ux, a.frame.uz);
    group.add(plane);
  }
  addChunk(scene, group, center, reach + 200);
  const flying = new THREE.Group();
  flying.add(movingPlane(a));
  // O avião vai longe (aproximação e subida): o bloco dele é bem maior.
  addChunk(scene, flying, center, 3200);

  // Construções: terminal (com pontes e torre), cada hangar e o lado das cargas.
  const leftOf = (a.frame.nz * a.frame.ux - a.frame.nx * a.frame.uz) > 0 ? 1 : -1;
  const [tu0, tu1, tn0, tn1] = a.terminal;
  addLodChunk(
    scene, airportPoint(a, 0, tn0), (tu1 - tu0) / 2 + 60,
    farBoxes(a, [
      { rect: [tu0, tu1, tn0, tn1], h: 15, color: "#cfd3d6" },
      { rect: [a.tower.u - 3, a.tower.u + 3, a.tower.n - 3, a.tower.n + 3], h: a.tower.height + 2, color: "#cfcac2", round: true },
    ]),
    () => {
      const random = seeded(4401);
      const m = new Mesher(airportMaterials());
      const p = new Pen(m, a);
      terminal(p, a, random);
      // Ponte do lado esquerdo do avião (a porta da frente).
      for (const g of a.gates) jetBridge(p, a, g, leftOf);
      tower(p, a);
      vehicles(p, a, random, leftOf);
      return m.finish("terminal");
    },
  );
  for (const h of a.hangars) {
    const [u0, u1, n0, n1] = h.rect;
    addLodChunk(scene, airportPoint(a, (u0 + u1) / 2, (n0 + n1) / 2), 50, farBoxes(a, [{ rect: h.rect, h: 14, color: "#c3c8cc" }]), () => {
      const m = new Mesher(airportMaterials());
      hangar(new Pen(m, a), h, seeded(Math.round(u0 * 7 + n0)));
      return m.finish("hangar");
    });
  }
  if (a.tanks.length) {
    const t = a.tanks[1] ?? a.tanks[0];
    addLodChunk(scene, airportPoint(a, t.u, t.n), 50, farBoxes(a, a.tanks.map((k) => ({ rect: [k.u - k.r, k.u + k.r, k.n - k.r, k.n + k.r] as Rect, h: k.h, color: "#ececea", round: true }))), () => {
      const m = new Mesher(airportMaterials());
      fuelTanks(new Pen(m, a), a);
      return m.finish("tanques");
    });
  }
}

export { AIRLINES };
