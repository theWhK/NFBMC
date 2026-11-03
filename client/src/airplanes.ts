// Aviões do Aeroporto do Pastel, feitos de formas simples: jato de um corredor
// (o de dois corredores é o mesmo, maior) e o teco-teco de asa alta. Cada
// companhia (todas de mentira) tem a pintura: cauda colorida com o símbolo,
// faixa e o nome na fuselagem. Cada avião é uma malha só (pintura + decalques,
// por grupos de material), com a geometria guardada por companhia.
//
// O nariz aponta para +z, a asa vai ao longo de x e o chão é y = 0.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { surface } from "./look.ts";

export interface Airline {
  name: string;
  /** Cor da cauda e da faixa, da barriga e do símbolo. */
  tail: string;
  belly: string;
  logo: string;
  /** Símbolo na cauda. */
  mark: "pastel" | "coxinha" | "gota" | "brigadeiro" | "hamburguer" | "torresmo";
}

export const AIRLINES: Airline[] = [
  { name: "Pastel Airlines", tail: "#f2b705", belly: "#8a5a2b", logo: "#fff3c4", mark: "pastel" },
  { name: "Coxinha Air", tail: "#f26b1d", belly: "#f26b1d", logo: "#ffe0a8", mark: "coxinha" },
  { name: "Azeite Linhas Aéreas", tail: "#1d3f8f", belly: "#1d3f8f", logo: "#b9c94a", mark: "gota" },
  { name: "Brigadeiro Express", tail: "#4a2c1d", belly: "#4a2c1d", logo: "#f4a6c8", mark: "brigadeiro" },
  { name: "GORD Linhas Aéreas", tail: "#d62828", belly: "#6b6b6b", logo: "#ffd23f", mark: "hamburguer" },
  { name: "Torresmo Táxi Aéreo", tail: "#2a9d8f", belly: "#2a9d8f", logo: "#f4e1b8", mark: "torresmo" },
];

// --- Pintura (atlas: uma linha por companhia; à esquerda o nome, à direita o símbolo) ---------

const ROW = 128;

function drawMark(ctx: CanvasRenderingContext2D, a: Airline, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = a.logo;
  ctx.strokeStyle = a.logo;
  switch (a.mark) {
    case "pastel": {
      // Meia-lua com as marquinhas do garfo na borda.
      ctx.beginPath();
      ctx.arc(0, r * 0.25, r * 0.85, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = a.tail;
      for (let k = -3; k <= 3; k++) ctx.fillRect(k * r * 0.24 - 2, r * 0.18, 4, r * 0.14);
      break;
    }
    case "coxinha":
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.9);
      ctx.quadraticCurveTo(r * 0.9, r * 0.2, r * 0.6, r * 0.7);
      ctx.quadraticCurveTo(0, r * 1.0, -r * 0.6, r * 0.7);
      ctx.quadraticCurveTo(-r * 0.9, r * 0.2, 0, -r * 0.9);
      ctx.fill();
      break;
    case "gota":
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.bezierCurveTo(r * 0.8, -r * 0.1, r * 0.7, r * 0.8, 0, r * 0.8);
      ctx.bezierCurveTo(-r * 0.7, r * 0.8, -r * 0.8, -r * 0.1, 0, -r);
      ctx.fill();
      break;
    case "brigadeiro":
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2);
      ctx.fill();
      for (let k = 0; k < 14; k++) {
        ctx.fillStyle = ["#ffffff", "#ffd23f", "#7ad3f0", "#ff6b6b"][k % 4];
        const ang = k * 2.4;
        ctx.fillRect(Math.cos(ang) * r * 0.5 * ((k % 3) / 3 + 0.3), Math.sin(ang) * r * 0.5 * ((k % 3) / 3 + 0.3), 6, 3);
      }
      break;
    case "hamburguer":
      ctx.beginPath();
      ctx.arc(0, -r * 0.05, r * 0.8, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(-r * 0.8, r * 0.05, r * 1.6, r * 0.18);
      ctx.fillRect(-r * 0.75, r * 0.33, r * 1.5, r * 0.3);
      break;
    case "torresmo":
      ctx.fillRect(-r * 0.8, -r * 0.4, r * 1.6, r * 0.8);
      ctx.fillStyle = "#c97a3a";
      ctx.fillRect(-r * 0.8, -r * 0.4, r * 1.6, r * 0.25);
      break;
  }
  ctx.restore();
}

let atlas: THREE.Texture | null = null;
function liveryAtlas() {
  if (atlas) return atlas;
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = ROW * 8;
  const ctx = canvas.getContext("2d")!;
  AIRLINES.forEach((a, i) => {
    const y = i * ROW;
    // Nome (fundo transparente: só as letras aparecem na fuselagem).
    ctx.fillStyle = a.tail === "#f2b705" ? "#8a5a2b" : a.tail;
    ctx.font = "italic bold 72px 'Russo One', Arial, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(a.name, 16, y + ROW / 2, 690);
    // Símbolo da cauda (com fundo da cor da cauda).
    ctx.fillStyle = a.tail;
    ctx.fillRect(768, y, 256, ROW);
    drawMark(ctx, a, 896, y + ROW / 2, ROW * 0.42);
  });
  atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  return atlas;
}

const paint = surface(new THREE.MeshLambertMaterial({ vertexColors: true }), { roughness: 0.35, metalness: 0.15, clearcoat: 0.6 });
let decal: THREE.Material | null = null;
const decalMaterial = () =>
  (decal ??= surface(new THREE.MeshLambertMaterial({ map: liveryAtlas(), transparent: false, alphaTest: 0.5, side: THREE.DoubleSide }), { roughness: 0.4, clearcoat: 0.5 }));

// --- Peças ----------------------------------------------------------------------------------------

type Piece = [THREE.BufferGeometry, string];

function colored(g: THREE.BufferGeometry, color: string) {
  const geometry = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const n = geometry.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  if (!geometry.attributes.uv) geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  for (const name of Object.keys(geometry.attributes)) if (!["position", "normal", "uv", "color"].includes(name)) geometry.deleteAttribute(name);
  return geometry;
}

/** Superfície de asa: trapézio enflechado, com espessura (raiz em x = 0, ponta em x = span). */
function wing(span: number, root: number, tip: number, sweep: number, thick: number) {
  const shape = new THREE.Shape();
  shape.moveTo(0, root / 2);
  shape.lineTo(span, root / 2 - sweep);
  shape.lineTo(span, root / 2 - sweep - tip);
  shape.lineTo(0, -root / 2);
  shape.closePath();
  // Shape no plano XY → deitado no XZ (y vira −z: o bordo de ataque fica para +z).
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  g.translate(0, 0, -thick / 2);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Quadro do atlas: retângulo plano de w × h no plano local, virado para +x (lado esquerdo) ou −x. */
function decalQuad(row: number, u0: number, u1: number, w: number, h: number, side: 1 | -1) {
  const g = new THREE.PlaneGeometry(w, h);
  const v1 = 1 - row / 8;
  const v0 = 1 - (row + 1) / 8;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const su = uv.getX(i);
    const sv = uv.getY(i);
    uv.setXY(i, side > 0 ? u1 - su * (u1 - u0) : u0 + su * (u1 - u0), v0 + sv * (v1 - v0));
  }
  g.rotateY((side * Math.PI) / 2);
  return g;
}

const WHITE = "#f4f5f7";
const GREY = "#b9bec4";
const DARK = "#1f2329";

/** Jato de um corredor (~38 m, nariz em z = +19). */
function jet(a: Airline, row: number) {
  const r = 1.95;
  const y = 3.5;
  const parts: Piece[] = [];
  const body = new THREE.CylinderGeometry(r, r, 28, 20, 1, true).rotateX(Math.PI / 2).translate(0, y, 1);
  parts.push([body, WHITE]);
  // Barriga colorida: meia-casca por baixo, um tico maior.
  const belly = new THREE.CylinderGeometry(r + 0.02, r + 0.02, 28, 20, 1, true, Math.PI * 0.62, Math.PI * 0.76).rotateX(Math.PI / 2).translate(0, y, 1);
  parts.push([belly, a.belly]);
  // Nariz (meia esfera esticada) e cabine.
  parts.push([new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 2.2).translate(0, y, 15), WHITE]);
  // Cone da cauda subindo.
  const tail = new THREE.CylinderGeometry(r, 0.45, 9, 20, 1, true).rotateX(-Math.PI / 2);
  const pos = tail.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getZ(i) + 4.5) / 9; // 0 na frente, 1 atrás? (rotateX(−90°): +y → −z)
    pos.setY(i, pos.getY(i) + (1 - t) * 1.2);
  }
  tail.translate(0, y, -17.5);
  parts.push([tail, WHITE]);
  // Janelas: fileira escura dos dois lados, e o para-brisa.
  for (const s of [-1, 1]) {
    parts.push([new THREE.BoxGeometry(0.06, 0.32, 23).translate(s * (r + 0.01), y + 0.55, 1.5), DARK]);
    parts.push([new THREE.BoxGeometry(0.05, 1.5, 0.9).translate(s * (r + 0.01), y - 0.1, 12.6), "#c9ced4"]);
    // Faixa da companhia embaixo das janelas.
    parts.push([new THREE.BoxGeometry(0.05, 0.22, 26).translate(s * (r + 0.015), y - 0.05, 0.5), a.tail]);
  }
  parts.push([new THREE.BoxGeometry(2.4, 0.5, 0.9).rotateX(-0.6).translate(0, y + 1.25, 15.8), DARK]);
  // Asas baixas, enflechadas, com diedro.
  for (const s of [-1, 1]) {
    const w = wing(16.5, 6.4, 1.6, 6, 0.42);
    if (s < 0) w.scale(-1, 1, 1);
    w.rotateZ(s * 0.09).translate(s * 1.3, y - 1.3, 2.4);
    parts.push([w, GREY]);
    // Winglet.
    parts.push([new THREE.BoxGeometry(0.15, 1.6, 1.3).rotateX(-0.4).translate(s * 17.7, y + 0.95, -4.5), a.tail]);
    // Motor embaixo da asa.
    const x = s * 5.8;
    parts.push([new THREE.CylinderGeometry(0.95, 0.85, 3.8, 18).rotateX(Math.PI / 2).translate(x, y - 1.95, 2.2), a.tail === "#f2b705" ? "#d9d9d9" : WHITE]);
    parts.push([new THREE.CylinderGeometry(0.8, 0.8, 0.1, 18).rotateX(Math.PI / 2).translate(x, y - 1.95, 4.12), DARK]);
    parts.push([new THREE.BoxGeometry(0.3, 1.0, 2.2).translate(x, y - 1.2, 1.4), GREY]);
    // Trem de pouso principal.
    parts.push([new THREE.CylinderGeometry(0.12, 0.12, 2.0, 8).translate(s * 2.9, y - 2.6, 0), GREY]);
    for (const dz of [-0.45, 0.45]) parts.push([new THREE.CylinderGeometry(0.55, 0.55, 0.42, 14).rotateZ(Math.PI / 2).translate(s * 2.9, 0.55, dz), DARK]);
    // Estabilizador horizontal.
    const h = wing(6, 3.6, 1.2, 2.6, 0.22);
    if (s < 0) h.scale(-1, 1, 1);
    h.rotateZ(s * 0.06).translate(s * 0.4, y + 0.9, -17.2);
    parts.push([h, GREY]);
  }
  // Trem do nariz.
  parts.push([new THREE.CylinderGeometry(0.1, 0.1, 2.2, 8).translate(0, y - 2.6, 12.2), GREY]);
  parts.push([new THREE.CylinderGeometry(0.42, 0.42, 0.5, 12).rotateZ(Math.PI / 2).translate(0, 0.42, 12.2), DARK]);
  // Deriva (cauda) na cor da companhia.
  const fin = wing(6.4, 5.8, 2.4, 4.4, 0.32).rotateZ(Math.PI / 2).translate(0, y + 1.6, -15.6);
  parts.push([fin, a.tail]);

  // Decalques: nome nos dois lados da fuselagem e o símbolo dos dois lados da deriva.
  const decals: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1] as const) {
    decals.push(decalQuad(row, 0.01, 0.69, 11, 1.55, s).translate(s * (r + 0.04), y + 1.25, 2));
    decals.push(decalQuad(row, 0.76, 0.99, 3.2, 1.6, s).translate(s * 0.2, y + 5.3, -17.6));
  }
  return { parts, decals };
}

/** Teco-teco de asa alta (~8,5 m). */
function smallPlane(a: Airline, row: number) {
  const parts: Piece[] = [];
  const y = 1.25;
  parts.push([new THREE.BoxGeometry(1.15, 1.3, 4.2).translate(0, y + 0.3, 0.6), WHITE]);
  parts.push([new THREE.BoxGeometry(1.0, 0.9, 1.4).translate(0, y + 0.1, 3.3), WHITE]);
  parts.push([new THREE.CylinderGeometry(0.55, 0.12, 4.2, 10).rotateX(-Math.PI / 2).translate(0, y + 0.45, -3.4), WHITE]);
  parts.push([new THREE.BoxGeometry(1.18, 0.55, 1.8).translate(0, y + 0.75, 1.3), "#2a3440"]);
  parts.push([new THREE.BoxGeometry(11, 0.14, 1.5).translate(0, y + 1.05, 0.9), WHITE]);
  for (const s of [-1, 1]) {
    parts.push([new THREE.BoxGeometry(0.08, 1.4, 0.12).rotateZ(s * 0.6).translate(s * 1.0, y + 0.35, 1.0), GREY]);
    parts.push([new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12).rotateZ(Math.PI / 2).translate(s * 0.95, 0.3, 0.6), DARK]);
    parts.push([new THREE.BoxGeometry(0.06, 0.12, 1.4).translate(s * 0.65, y + 0.25, 0.2), a.tail]);
  }
  parts.push([new THREE.BoxGeometry(3.4, 0.08, 1.0).translate(0, y + 0.55, -5.1), WHITE]);
  parts.push([new THREE.BoxGeometry(0.1, 1.5, 1.2).translate(0, y + 1.2, -5.2), a.tail]);
  parts.push([new THREE.CylinderGeometry(0.22, 0.22, 0.25, 10).rotateZ(Math.PI / 2).translate(0, 0.25, 3.4), DARK]);
  // Hélice parada.
  parts.push([new THREE.BoxGeometry(0.14, 1.8, 0.06).rotateZ(0.4).translate(0, y + 0.1, 4.05), DARK]);
  const decals: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1] as const) decals.push(decalQuad(row, 0.76, 0.99, 1.1, 0.55, s).translate(s * 0.08, y + 1.3, -5.25));
  return { parts, decals };
}

const cache = new Map<string, THREE.BufferGeometry>();

/** Geometria de um avião (pintura e decalques em dois grupos de material). Guardada (compartilhada). */
function planeGeometry(airline: number, small: boolean) {
  const key = `${airline}:${small}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const a = AIRLINES[airline % AIRLINES.length];
  const { parts, decals } = (small ? smallPlane : jet)(a, airline % AIRLINES.length);
  const body = mergeGeometries(parts.map(([g, c]) => colored(g, c)))!;
  const marks = mergeGeometries(decals.map((g) => colored(g, "#ffffff")))!;
  const geometry = mergeGeometries([body, marks], true)!;
  geometry.computeBoundingSphere();
  geometry.userData.shared = true;
  cache.set(key, geometry);
  return geometry;
}

/** Um avião pronto para pôr na cena (malha única, dois materiais). */
export function makePlane(airline: number, options: { small?: boolean; wide?: boolean } = {}) {
  const mesh = new THREE.Mesh(planeGeometry(airline, !!options.small), [paint, decalMaterial()]);
  if (options.wide) mesh.scale.set(1.45, 1.35, 1.45);
  return mesh;
}
