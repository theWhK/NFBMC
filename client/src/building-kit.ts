// Peças comuns das construções: paredes com vãos, janelas (moldura, peitoril,
// venezianas, grade), portas, portões, telhados (duas águas, quatro águas, uma
// água), platibanda, caixa-d'água, ar-condicionado, escada, toldo, letreiro.
// Tudo desenhado no referencial atual do `Mesher`: numa parede, x vai de 0 ao
// comprimento dela (da esquerda para a direita de quem olha de fora), y é a
// altura e z = 0 é a face da parede (z > 0 para fora).
import { BOX, mix, rgb, shade, type Mesher, type Rgb } from "./mesher.ts";
import { M, litUv, signUv } from "./building-materials.ts";

export type Random = () => number;

export const pick = <T>(random: Random, list: readonly T[]): T => list[Math.floor(random() * list.length) % list.length];
export const range = (random: Random, min: number, max: number) => min + random() * (max - min);

export const WHITE = rgb("#ffffff");
export const OFFWHITE = rgb("#f1ede4");
export const DARK = rgb("#2b2b2e");
export const IRON = rgb("#26282b");
export const ALUMINUM = rgb("#c9ccd0");
export const GLASS_TINT = rgb("#93a3b3");

/** Um vão na parede (janela, porta, portão). */
export interface Hole {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Parede retangular (0..len × y0..y1) com vãos, em z = 0, mais os "rebocos"
 * dos vãos (as laterais, para dentro, até `depth`).
 */
export function wall(m: Mesher, mat: number, col: Rgb, len: number, y0: number, y1: number, holes: readonly Hole[] = [], depth = 0.14) {
  if (holes.length === 0) {
    m.front(mat, col, 0, len, y0, y1, 0);
    return;
  }
  const xs = [0, len];
  const ys = [y0, y1];
  for (const h of holes) {
    xs.push(h.x0, h.x1);
    ys.push(Math.max(y0, h.y0), Math.min(y1, h.y1));
  }
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const inside = (x: number, y: number) => holes.some((h) => x > h.x0 && x < h.x1 && y > h.y0 && y < h.y1);
  for (let j = 0; j < ys.length - 1; j++) {
    const ya = ys[j];
    const yb = ys[j + 1];
    if (yb - ya < 1e-4) continue;
    const ym = (ya + yb) / 2;
    let start = -1;
    for (let i = 0; i < xs.length - 1; i++) {
      const xa = xs[i];
      const xb = xs[i + 1];
      if (xb - xa < 1e-4) continue;
      const solid = !inside((xa + xb) / 2, ym);
      if (solid && start < 0) start = i;
      if (!solid && start >= 0) {
        m.front(mat, col, xs[start], xa, ya, yb, 0);
        start = -1;
      }
    }
    if (start >= 0) m.front(mat, col, xs[start], len, ya, yb, 0);
  }
  // Laterais do vão (a espessura da parede), só na parte dentro desta parede.
  const inner = shade(col, 0.82);
  for (const h of holes) {
    const d = -depth;
    const hy0 = Math.max(y0, h.y0);
    const hy1 = Math.min(y1, h.y1);
    if (hy1 - hy0 < 1e-4) continue;
    // esquerda (olha para +x), direita (olha para -x), cima (olha para baixo), baixo (olha para cima)
    m.quad(mat, inner, h.x0, hy0, 0, h.x0, hy0, d, h.x0, hy1, d, h.x0, hy1, 0);
    m.quad(mat, inner, h.x1, hy0, d, h.x1, hy0, 0, h.x1, hy1, 0, h.x1, hy1, d);
    if (h.y1 <= y1 + 1e-4) m.quad(mat, inner, h.x0, hy1, 0, h.x0, hy1, d, h.x1, hy1, d, h.x1, hy1, 0);
    if (h.y0 > y0 + 0.01) m.quad(mat, inner, h.x0, hy0, d, h.x0, hy0, 0, h.x1, hy0, 0, h.x1, hy0, d);
  }
}

/** Abre um referencial em cada parede de uma caixa w × d (0 = frente, 1 = direita, 2 = fundo, 3 = esquerda). */
export function onWall(m: Mesher, w: number, d: number, side: number, draw: (len: number) => void, cx = 0, cz = 0) {
  switch (side) {
    case 0:
      m.push(cx - w / 2, 0, cz + d / 2, 0);
      draw(w);
      break;
    case 1:
      m.push(cx + w / 2, 0, cz + d / 2, Math.PI / 2);
      draw(d);
      break;
    case 2:
      m.push(cx + w / 2, 0, cz - d / 2, Math.PI);
      draw(w);
      break;
    default:
      m.push(cx - w / 2, 0, cz - d / 2, -Math.PI / 2);
      draw(d);
  }
  m.pop();
}

export interface WindowStyle {
  /** Cor do caixilho. */
  frame: Rgb;
  /** Moldura de reboco em volta (cor), ou null. */
  trim: Rgb | null;
  /** Peitoril (cor), ou null. */
  sill: Rgb | null;
  /** Venezianas abertas dos lados (cor), ou null. */
  shutters: Rgb | null;
  /** Grade de ferro na frente. */
  bars: boolean;
  /** Probabilidade de estar acesa. */
  litChance: number;
  /** Divisões verticais (folhas de correr). */
  panes: number;
  /** Profundidade do vidro (para dentro da parede). */
  depth: number;
  /** Versão leve (prédios altos, muitas janelas iguais): sem caixilho em relevo, peitoril chapado. */
  lite?: boolean;
}

export const plainWindow = (over: Partial<WindowStyle> = {}): WindowStyle => ({
  frame: ALUMINUM,
  trim: null,
  sill: OFFWHITE,
  shutters: null,
  bars: false,
  litChance: 0.2,
  panes: 2,
  depth: 0.12,
  ...over,
});

/** Vidro (escuro ou aceso) num retângulo da parede, em z. */
export function pane(m: Mesher, random: Random, x0: number, x1: number, y0: number, y1: number, z: number, litChance: number, tint: Rgb = GLASS_TINT) {
  if (random() < litChance) m.front(M.lit, WHITE, x0, x1, y0, y1, z, litUv(Math.floor(random() * 16)));
  else m.front(M.glass, shade(tint, 0.85 + random() * 0.3), x0, x1, y0, y1, z, [0, 0, 1, 1]);
}

/** Janela completa num vão já aberto na parede (o vão é x0..x1 × y0..y1). */
export function windowIn(m: Mesher, random: Random, h: Hole, style: WindowStyle) {
  const { x0, x1, y0, y1 } = h;
  const z = -style.depth;
  pane(m, random, x0, x1, y0, y1, z + 0.01, style.litChance);
  if (style.lite) {
    // Só um montante no meio e o peitoril (frente e cima).
    const mid = (x0 + x1) / 2;
    m.front(M.paint, style.frame, mid - 0.03, mid + 0.03, y0, y1, z + 0.03);
    if (style.sill) {
      m.front(M.concrete, style.sill, x0 - 0.06, x1 + 0.06, y0 - 0.06, y0, 0.06);
      m.quad(M.concrete, style.sill, x0 - 0.06, y0, 0.06, x1 + 0.06, y0, 0.06, x1 + 0.06, y0, z, x0 - 0.06, y0, z);
    }
    return;
  }
  // Caixilho: contorno e divisões (só as faces que aparecem).
  const t = 0.05;
  const f = style.frame;
  const zf = z + 0.05;
  m.box(M.paint, f, x0, x1, y0, y0 + t, z, zf, BOX.back | BOX.bottom | BOX.left | BOX.right);
  m.box(M.paint, f, x0, x1, y1 - t, y1, z, zf, BOX.back | BOX.top | BOX.left | BOX.right);
  m.box(M.paint, f, x0, x0 + t, y0 + t, y1 - t, z, zf, BOX.back | BOX.top | BOX.bottom | BOX.left);
  m.box(M.paint, f, x1 - t, x1, y0 + t, y1 - t, z, zf, BOX.back | BOX.top | BOX.bottom | BOX.right);
  for (let i = 1; i < style.panes; i++) {
    const x = x0 + ((x1 - x0) * i) / style.panes;
    m.box(M.paint, f, x - t / 2, x + t / 2, y0 + t, y1 - t, z, z + 0.06, BOX.back | BOX.top | BOX.bottom);
  }
  if (style.trim) {
    const w = 0.12;
    m.box(M.plaster, style.trim, x0 - w, x1 + w, y1, y1 + w, 0, 0.04, BOX.back | BOX.bottom);
    m.box(M.plaster, style.trim, x0 - w, x0, y0, y1, 0, 0.04, BOX.back | BOX.bottom | BOX.top);
    m.box(M.plaster, style.trim, x1, x1 + w, y0, y1, 0, 0.04, BOX.back | BOX.bottom | BOX.top);
  }
  if (style.sill) m.box(M.concrete, style.sill, x0 - 0.08, x1 + 0.08, y0 - 0.06, y0, -0.02, 0.07, BOX.back);
  if (style.shutters) {
    const sw = (x1 - x0) / 2;
    // Venezianas abertas, encostadas na parede dos dois lados.
    m.box(M.wood, style.shutters, x0 - sw - 0.02, x0 - 0.02, y0, y1, 0, 0.035, BOX.back | BOX.bottom);
    m.box(M.wood, style.shutters, x1 + 0.02, x1 + sw + 0.02, y0, y1, 0, 0.035, BOX.back | BOX.bottom);
  }
  if (style.bars) {
    // Grade: barras finas (só a frente, é o que se vê da rua).
    const n = Math.max(2, Math.round((x1 - x0) / 0.14));
    for (let i = 1; i < n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      m.front(M.paint, IRON, x - 0.012, x + 0.012, y0, y1, -0.012);
    }
    m.front(M.paint, IRON, x0, x1, (y0 + y1) / 2 - 0.015, (y0 + y1) / 2 + 0.015, -0.008);
  }
}

/** Porta (madeira, ferro ou vidro) num vão, com soleira. */
export function doorIn(m: Mesher, random: Random, h: Hole, kind: "wood" | "iron" | "glass", color: Rgb) {
  const z = -0.1;
  if (kind === "glass") {
    pane(m, random, h.x0, h.x1, h.y0, h.y1, z, 0.4);
    m.box(M.paint, color, (h.x0 + h.x1) / 2 - 0.03, (h.x0 + h.x1) / 2 + 0.03, h.y0, h.y1, z, z + 0.05, BOX.back | BOX.bottom | BOX.top);
  } else {
    m.front(kind === "wood" ? M.wood : M.paint, color, h.x0, h.x1, h.y0, h.y1, z);
    // Almofadas da porta (ou as frisas da porta de ferro).
    const inset = 0.12;
    const mid = (h.y0 + h.y1) / 2;
    m.box(kind === "wood" ? M.wood : M.paint, shade(color, 0.85), h.x0 + inset, h.x1 - inset, mid + 0.08, h.y1 - inset, z, z + 0.025, BOX.back);
    m.box(kind === "wood" ? M.wood : M.paint, shade(color, 0.85), h.x0 + inset, h.x1 - inset, h.y0 + inset + 0.1, mid - 0.08, z, z + 0.025, BOX.back);
    // Maçaneta.
    m.box(M.paint, ALUMINUM, h.x1 - 0.14, h.x1 - 0.08, mid - 0.04, mid + 0.02, z, z + 0.07);
  }
  // Batente.
  m.box(M.paint, shade(color, 0.7), h.x0, h.x1, h.y1 - 0.06, h.y1, z, z + 0.04, BOX.back);
  // Soleira.
  m.box(M.concrete, OFFWHITE, h.x0 - 0.06, h.x1 + 0.06, h.y0 - 0.04, h.y0 + 0.02, -0.14, 0.08, BOX.back);
}

/** Porta de enrolar (aço ondulado na horizontal) num vão; `open` = quanto está aberta (0..1). */
export function rollerDoor(m: Mesher, random: Random, h: Hole, color: Rgb, open: number, litChance = 0.6) {
  const z = -0.12;
  const yb = h.y1 - (h.y1 - h.y0) * open;
  if (open > 0.05) {
    // Lá dentro: loja acesa (ou escura).
    pane(m, random, h.x0, h.x1, h.y0, yb, z - 0.4, litChance, rgb("#3a3a3a"));
  }
  // Chapa ondulada: os gomos correm na horizontal (u ao longo da altura).
  if (h.y1 - yb > 0.02) m.quad(M.metal, color, h.x1, yb, z, h.x1, h.y1, z, h.x0, h.y1, z, h.x0, yb, z, [yb, 0, h.y1, h.x1 - h.x0]);
  // Caixa da porta em cima e trilhos dos lados.
  m.box(M.paint, shade(color, 0.8), h.x0 - 0.05, h.x1 + 0.05, h.y1, h.y1 + 0.35, -0.05, 0.12, BOX.back);
  m.box(M.paint, DARK, h.x0, h.x0 + 0.06, h.y0, h.y1, z, z + 0.12, BOX.back | BOX.top);
  m.box(M.paint, DARK, h.x1 - 0.06, h.x1, h.y0, h.y1, z, z + 0.12, BOX.back | BOX.top);
  if (open < 0.95) m.box(M.paint, shade(color, 0.6), h.x0, h.x1, yb - 0.06, yb, z, z + 0.04, BOX.back);
}

/** Ar-condicionado de janela/parede (caixa com grade), em x, altura y. */
export function airConditioner(m: Mesher, x: number, y: number, outward = 0.45) {
  m.box(M.paint, rgb("#d9dad6"), x - 0.32, x + 0.32, y, y + 0.42, 0, outward);
  m.box(M.paint, rgb("#8d8f8e"), x - 0.26, x + 0.26, y + 0.06, y + 0.36, outward, outward + 0.01, BOX.back);
  // Suporte.
  m.bar(M.paint, IRON, x - 0.25, y - 0.25, 0, x - 0.25, y, outward - 0.05, 0.03);
  m.bar(M.paint, IRON, x + 0.25, y - 0.25, 0, x + 0.25, y, outward - 0.05, 0.03);
}

/** Calha e condutor (cano de descida) num canto. */
export function gutter(m: Mesher, col: Rgb, len: number, y: number, downAt: number, ground: number) {
  m.box(M.paint, col, -0.05, len + 0.05, y - 0.12, y, 0, 0.12, BOX.back);
  m.box(M.paint, col, downAt - 0.04, downAt + 0.04, ground, y - 0.12, 0.02, 0.1, BOX.back | BOX.top);
}

/**
 * Telhado de duas águas sobre uma caixa w × d (cumeeira ao longo de x),
 * a partir da altura y, com beiral `eave` e caída `pitch` (altura/meia-largura).
 * `gable` = cor das empenas (os triângulos das pontas), na parede.
 */
export function gableRoof(m: Mesher, w: number, d: number, y: number, pitch: number, eave: number, tileCol: Rgb, gable: Rgb, gableMat: number = M.plaster, roofMat: number = M.tile, eaveFront = eave) {
  const hd = d / 2;
  const rise = hd * pitch;
  const top = y + rise;
  const x0 = -w / 2 - eave;
  const x1 = w / 2 + eave;
  // Abas: a da frente (desce para +z) e a do fundo.
  const zf = hd + eaveFront;
  const zb = -hd - eave;
  const yf = y - eaveFront * pitch;
  const yb = y - eave * pitch;
  const slopeF = Math.hypot(zf, top - yf);
  const slopeB = Math.hypot(-zb, top - yb);
  m.quad(roofMat, tileCol, x0, yf, zf, x1, yf, zf, x1, top, 0, x0, top, 0, [x0, 0, x1, slopeF]);
  m.quad(roofMat, tileCol, x1, yb, zb, x0, yb, zb, x0, top, 0, x1, top, 0, [-x1, 0, -x0, slopeB]);
  // Por baixo: o madeiramento aparente do beiral (as águas vistas de baixo).
  const under = shade(gable, 0.75);
  m.quad(M.wood, under, x1, yf - 0.03, zf, x0, yf - 0.03, zf, x0, top - 0.03, 0, x1, top - 0.03, 0);
  m.quad(M.wood, under, x0, yb - 0.03, zb, x1, yb - 0.03, zb, x1, top - 0.03, 0, x0, top - 0.03, 0);
  // Testeiras: a borda das telhas na frente, no fundo e nas pontas.
  const edge = shade(tileCol, 0.6);
  m.front(M.paint, edge, x0, x1, yf - 0.12, yf, zf);
  m.quad(M.paint, edge, x1, yb - 0.12, zb, x0, yb - 0.12, zb, x0, yb, zb, x1, yb, zb);
  m.quad(M.paint, edge, x1, yf - 0.12, zf, x1, top - 0.12, 0, x1, top, 0, x1, yf, zf);
  m.quad(M.paint, edge, x1, top - 0.12, 0, x1, yb - 0.12, zb, x1, yb, zb, x1, top, 0);
  m.quad(M.paint, edge, x0, yb - 0.12, zb, x0, top - 0.12, 0, x0, top, 0, x0, yb, zb);
  m.quad(M.paint, edge, x0, top - 0.12, 0, x0, yf - 0.12, zf, x0, yf, zf, x0, top, 0);
  // Empenas (triângulos) nas paredes das pontas.
  m.tri(gableMat, gable, w / 2, y, hd, w / 2, y, -hd, w / 2, top, 0);
  m.tri(gableMat, gable, -w / 2, y, -hd, -w / 2, y, hd, -w / 2, top, 0);
  // Cumeeira.
  m.box(roofMat, shade(tileCol, 0.9), x0, x1, top - 0.06, top + 0.1, -0.13, 0.13, BOX.bottom | BOX.left | BOX.right);
}

/** Telhado de quatro águas sobre w × d (cumeeira ao longo do lado maior). */
export function hipRoof(m: Mesher, w: number, d: number, y: number, pitch: number, eave: number, tileCol: Rgb, under: Rgb, roofMat: number = M.tile) {
  const hw = w / 2 + eave;
  const hd = d / 2 + eave;
  const ye = y - eave * pitch;
  const along = hw >= hd;
  const half = along ? hd : hw;
  const top = ye + half * pitch;
  // Cumeeira: um segmento no meio do lado maior.
  const r = along ? hw - half : hd - half;
  const col = tileCol;
  const side = shade(tileCol, 0.92);
  if (along) {
    const sl = Math.hypot(half, top - ye);
    m.quad(roofMat, col, -hw, ye, hd, hw, ye, hd, r, top, 0, -r, top, 0, [-hw, 0, hw, sl]);
    m.quad(roofMat, col, hw, ye, -hd, -hw, ye, -hd, -r, top, 0, r, top, 0, [-hw, 0, hw, sl]);
    const st = Math.hypot(hw - r, top - ye);
    m.tri(roofMat, side, hw, ye, hd, hw, ye, -hd, r, top, 0, [-hd, 0, hd, 0, 0, st]);
    m.tri(roofMat, side, -hw, ye, -hd, -hw, ye, hd, -r, top, 0, [-hd, 0, hd, 0, 0, st]);
    if (r > 0.01) m.box(roofMat, shade(col, 0.9), -r - 0.1, r + 0.1, top - 0.06, top + 0.08, -0.12, 0.12, BOX.bottom);
  } else {
    const sl = Math.hypot(half, top - ye);
    m.quad(roofMat, col, hw, ye, hd, hw, ye, -hd, 0, top, -r, 0, top, r, [-hd, 0, hd, sl]);
    m.quad(roofMat, col, -hw, ye, -hd, -hw, ye, hd, 0, top, r, 0, top, -r, [-hd, 0, hd, sl]);
    const st = Math.hypot(hd - r, top - ye);
    m.tri(roofMat, side, -hw, ye, hd, hw, ye, hd, 0, top, r, [-hw, 0, hw, 0, 0, st]);
    m.tri(roofMat, side, hw, ye, -hd, -hw, ye, -hd, 0, top, -r, [-hw, 0, hw, 0, 0, st]);
    if (r > 0.01) m.box(roofMat, shade(col, 0.9), -0.12, 0.12, top - 0.06, top + 0.08, -r - 0.1, r + 0.1, BOX.bottom);
  }
  // Forro do beiral (embaixo) e testeira.
  m.quad(M.wood, under, -hw, ye - 0.02, -hd, hw, ye - 0.02, -hd, hw, ye - 0.02, hd, -hw, ye - 0.02, hd);
  const fascia = shade(tileCol, 0.55);
  m.box(M.paint, fascia, -hw, hw, ye - 0.14, ye, -hd, hd, BOX.top | BOX.bottom);
  return top;
}

/** Telhado de uma água (cai para +z): de `yHigh` no fundo a `yLow` na frente. */
export function shedRoof(m: Mesher, x0: number, x1: number, z0: number, z1: number, yLow: number, yHigh: number, col: Rgb, mat: number = M.metal, thick = 0.06) {
  const len = Math.hypot(z1 - z0, yHigh - yLow);
  m.quad(mat, col, x0, yLow, z1, x1, yLow, z1, x1, yHigh, z0, x0, yHigh, z0, [x0, 0, x1, len]);
  m.quad(mat, shade(col, 0.6), x1, yLow - thick, z1, x0, yLow - thick, z1, x0, yHigh - thick, z0, x1, yHigh - thick, z0);
  m.front(M.paint, shade(col, 0.7), x0, x1, yLow - thick, yLow, z1);
  m.quad(M.paint, shade(col, 0.7), x0, yHigh - thick, z0, x0, yLow - thick, z1, x0, yLow, z1, x0, yHigh, z0);
  m.quad(M.paint, shade(col, 0.7), x1, yLow - thick, z1, x1, yHigh - thick, z0, x1, yHigh, z0, x1, yLow, z1);
}

/** Platibanda: mureta em volta do topo de uma caixa w × d, com rufo (capa) em cima. */
export function parapet(m: Mesher, w: number, d: number, y: number, h: number, col: Rgb, mat: number = M.plaster, t = 0.15, cap: Rgb | null = OFFWHITE) {
  const hw = w / 2;
  const hd = d / 2;
  const inner = shade(col, 0.8);
  m.box(mat, col, -hw, hw, y, y + h, hd - t, hd, BOX.bottom | BOX.back);
  m.box(mat, col, -hw, hw, y, y + h, -hd, -hd + t, BOX.bottom | BOX.front);
  m.box(mat, col, -hw, -hw + t, y, y + h, -hd + t, hd - t, BOX.bottom | BOX.front | BOX.back);
  m.box(mat, col, hw - t, hw, y, y + h, -hd + t, hd - t, BOX.bottom | BOX.front | BOX.back);
  // Faces de dentro mais escuras.
  m.quad(mat, inner, hw - t, y, hd - t, -hw + t, y, hd - t, -hw + t, y + h, hd - t, hw - t, y + h, hd - t);
  m.quad(mat, inner, -hw + t, y, -hd + t, hw - t, y, -hd + t, hw - t, y + h, -hd + t, -hw + t, y + h, -hd + t);
  if (cap) m.box(M.concrete, cap, -hw - 0.04, hw + 0.04, y + h, y + h + 0.06, -hd - 0.04, hd + 0.04, BOX.bottom);
}

/** Laje plana (piso de cima) de w × d em y, com uma bordinha. */
export function slab(m: Mesher, x0: number, x1: number, z0: number, z1: number, y: number, col: Rgb, thick = 0.15) {
  m.box(M.concrete, col, x0, x1, y - thick, y, z0, z1);
}

/** Caixa-d'água de fibra (azul) em cima da laje, com tampa. */
export function waterTank(m: Mesher, x: number, z: number, y: number, size = 1) {
  const blue = rgb("#2f6db5");
  m.cylinder(M.paint, blue, x, z, y, y + 0.75 * size, 0.5 * size, 0.62 * size, 12, false);
  m.cylinder(M.paint, shade(blue, 1.15), x, z, y + 0.75 * size, y + 0.86 * size, 0.64 * size, 0.6 * size, 12);
}

/** Vergalhões aparentes (pilar da laje que "um dia vai subir"). */
export function rebars(m: Mesher, x: number, z: number, y: number, random: Random) {
  const rust = rgb("#5a3424");
  m.box(M.concrete, rgb("#9c9a94"), x - 0.1, x + 0.1, y, y + 0.15, z - 0.1, z + 0.1);
  for (const [dx, dz] of [[-0.06, -0.06], [0.06, -0.06], [-0.06, 0.06], [0.06, 0.06]]) {
    const h = 0.6 + random() * 0.6;
    const bend = random() < 0.4 ? 0.12 : 0;
    m.bar(M.paint, rust, x + dx, y, z + dz, x + dx + bend, y + h, z + dz, 0.02);
  }
}

/** Escada externa encostada numa parede (sobe ao longo de +x a partir de x0), sem corrimão de alvenaria. */
export function stairs(m: Mesher, x0: number, run: number, y0: number, y1: number, width: number, col: Rgb, rail: Rgb | null) {
  const steps = Math.max(3, Math.round((y1 - y0) / 0.18));
  const tread = run / steps;
  const rise = (y1 - y0) / steps;
  for (let i = 0; i < steps; i++) {
    m.box(M.concrete, col, x0 + i * tread, x0 + (i + 1) * tread, y0 + i * rise, y0 + (i + 1) * rise, 0, width, BOX.back | BOX.bottom);
  }
  // Viga por baixo (a escada "voa" encostada na parede).
  m.quad(M.concrete, shade(col, 0.7), x0 + run, y1 - rise, width, x0, y0, width, x0, y0, 0, x0 + run, y1 - rise, 0);
  if (rail) {
    m.bar(M.paint, rail, x0, y0 + 0.9, width, x0 + run, y1 + 0.9, width, 0.04);
    for (let i = 0; i <= steps; i += Math.max(1, Math.floor(steps / 4))) {
      const x = x0 + i * tread;
      m.bar(M.paint, rail, x, y0 + i * rise, width - 0.03, x, y0 + i * rise + 0.9, width - 0.03, 0.03);
    }
  }
}

/** Varal: dois postes, o fio e umas roupas coloridas penduradas. */
export function clothesline(m: Mesher, random: Random, x0: number, x1: number, z: number, y: number) {
  const pole = rgb("#7a7a7a");
  m.bar(M.paint, pole, x0, y, z, x0, y + 1.7, z, 0.04);
  m.bar(M.paint, pole, x1, y, z, x1, y + 1.7, z, 0.04);
  m.bar(M.paint, rgb("#dddddd"), x0, y + 1.65, z, x1, y + 1.62, z, 0.012);
  const colors = ["#e63946", "#f1faee", "#457b9d", "#ffb703", "#8ecae6", "#fb8500", "#2a9d8f", "#ffffff"];
  let x = x0 + 0.2;
  while (x < x1 - 0.5) {
    const w = 0.3 + random() * 0.5;
    const h = 0.4 + random() * 0.5;
    const col = rgb(pick(random, colors));
    // Roupa dos dois lados (é um quadrinho fino).
    m.quad(M.paint, col, x, y + 1.63 - h, z + 0.01, x + w, y + 1.63 - h, z + 0.01, x + w, y + 1.63, z + 0.01, x, y + 1.63, z + 0.01);
    m.quad(M.paint, col, x + w, y + 1.63 - h, z - 0.01, x, y + 1.63 - h, z - 0.01, x, y + 1.63, z - 0.01, x + w, y + 1.63, z - 0.01);
    x += w + 0.1 + random() * 0.3;
  }
}

/** Toldo inclinado, listrado, saindo `out` metros da parede, de x0 a x1, a partir de y. */
export function awning(m: Mesher, x0: number, x1: number, y: number, out: number, a: Rgb, b: Rgb | null) {
  const drop = out * 0.45;
  const stripes = b ? Math.max(2, Math.round((x1 - x0) / 0.45)) : 1;
  const sw = (x1 - x0) / stripes;
  for (let i = 0; i < stripes; i++) {
    const col = b && i % 2 ? b : a;
    const xa = x0 + i * sw;
    const xb = xa + sw;
    m.quad(M.paint, col, xa, y - drop, out, xb, y - drop, out, xb, y, 0, xa, y, 0);
    m.quad(M.paint, shade(col, 0.6), xb, y - drop, out, xa, y - drop, out, xa, y, 0, xb, y, 0);
    // Babado na frente.
    m.front(M.paint, col, xa, xb, y - drop - 0.25, y - drop, out);
    m.quad(M.paint, shade(col, 0.7), xb, y - drop - 0.25, out - 0.005, xa, y - drop - 0.25, out - 0.005, xa, y - drop, out - 0.005, xb, y - drop, out - 0.005);
  }
  // Laterais.
  m.quad(M.paint, shade(a, 0.85), x0, y - drop - 0.25, 0, x0, y - drop - 0.25, out, x0, y - drop, out, x0, y, 0);
  m.quad(M.paint, shade(a, 0.85), x1, y - drop - 0.25, out, x1, y - drop - 0.25, 0, x1, y, 0, x1, y - drop, out);
}

/** Letreiro na parede (placa com o nome, do atlas), de x0 a x1, embaixo em y, altura h. */
export function signBoard(m: Mesher, index: number, x0: number, x1: number, y: number, h: number, out = 0.12, frame: Rgb = DARK) {
  m.box(M.paint, frame, x0 - 0.05, x1 + 0.05, y - 0.05, y + h + 0.05, 0, out);
  m.front(M.sign, WHITE, x0, x1, y, y + h, out + 0.005, signUv(index));
}

/** Grade de ferro (muro, sacada) de x0 a x1, de y0 a y1, em z. */
export function railing(m: Mesher, x0: number, x1: number, y0: number, y1: number, z: number, col: Rgb = IRON, spacing = 0.12) {
  m.box(M.paint, col, x0, x1, y1 - 0.04, y1, z - 0.025, z + 0.025);
  m.box(M.paint, col, x0, x1, y0, y0 + 0.03, z - 0.02, z + 0.02, BOX.bottom | BOX.left | BOX.right);
  const n = Math.max(1, Math.round((x1 - x0) / spacing));
  // Barras: frente e verso (finas, sem as laterais).
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    m.front(M.paint, col, x - 0.01, x + 0.01, y0 + 0.03, y1 - 0.04, z + 0.01);
    m.quad(M.paint, col, x + 0.01, y0 + 0.03, z - 0.01, x - 0.01, y0 + 0.03, z - 0.01, x - 0.01, y1 - 0.04, z - 0.01, x + 0.01, y1 - 0.04, z - 0.01);
  }
}

/** Grade ao longo de z (lado de uma sacada), em x. */
export function railingZ(m: Mesher, z0: number, z1: number, y0: number, y1: number, x: number, col: Rgb = IRON, spacing = 0.12) {
  m.push(x, 0, z1, Math.PI / 2);
  railing(m, 0, z1 - z0, y0, y1, 0, col, spacing);
  m.pop();
}

/** Antena (mastro com hastes) em cima do telhado. */
export function antenna(m: Mesher, x: number, z: number, y: number, h: number) {
  const col = rgb("#9a9ea3");
  m.bar(M.paint, col, x, y, z, x, y + h, z, 0.04);
  for (let i = 0; i < 3; i++) {
    const yy = y + h * (0.6 + i * 0.15);
    const len = 0.6 - i * 0.15;
    m.bar(M.paint, col, x - len, yy, z, x + len, yy, z, 0.025);
  }
}

/** Antena parabólica (prato inclinado num suporte), virada para +z girada de `yaw`. */
export function dish(m: Mesher, x: number, y: number, z: number, yaw: number, r = 0.45) {
  const col = rgb("#e4e4e0");
  m.push(x, y, z, yaw);
  const t = 0.5; // inclinação do prato (para cima)
  const ny = Math.sin(t);
  const nz = Math.cos(t);
  const cy = 0.9;
  const vy = Math.cos(t);
  const vz = -Math.sin(t);
  const seg = 10;
  const pt = (i: number): [number, number, number] => {
    const a = (i / seg) * Math.PI * 2;
    return [Math.cos(a) * r, cy + Math.sin(a) * r * vy, Math.sin(a) * r * vz];
  };
  for (let i = 0; i < seg; i++) {
    const [ax, ay, az] = pt(i);
    const [bx, by, bz] = pt(i + 1);
    // Frente côncava (o centro um pouco para trás) e o verso.
    m.tri(M.paint, col, 0, cy - ny * 0.08, -nz * 0.08, ax, ay, az, bx, by, bz);
    m.tri(M.paint, shade(col, 0.8), 0, cy - ny * 0.14, -nz * 0.14, bx, by, bz, ax, ay, az);
  }
  // Braço com o LNB e o pé.
  m.bar(M.paint, IRON, 0, cy - r * vy, -r * vz, 0, cy + ny * 0.4, nz * 0.4, 0.025);
  m.box(M.paint, IRON, -0.04, 0.04, cy + ny * 0.4 - 0.05, cy + ny * 0.4 + 0.05, nz * 0.4 - 0.05, nz * 0.4 + 0.05);
  m.bar(M.paint, IRON, 0, 0, -0.15, 0, cy - 0.05, -0.12, 0.04);
  m.pop();
}

/** Chaminé de tijolo (churrasqueira) com chapéu. */
export function chimney(m: Mesher, x: number, z: number, y0: number, y1: number, col: Rgb) {
  m.box(M.brick, col, x - 0.3, x + 0.3, y0, y1, z - 0.3, z + 0.3);
  m.box(M.concrete, rgb("#8e8c86"), x - 0.38, x + 0.38, y1, y1 + 0.08, z - 0.38, z + 0.38);
  m.box(M.concrete, rgb("#5f5d58"), x - 0.15, x + 0.15, y1 + 0.08, y1 + 0.3, z - 0.15, z + 0.15);
  m.box(M.concrete, rgb("#8e8c86"), x - 0.3, x + 0.3, y1 + 0.3, y1 + 0.36, z - 0.3, z + 0.3);
}

/** Paleta: cor e uma variação dela (pintura velha, mais clara ou mais escura). */
export function weathered(random: Random, hex: string, spread = 0.12): Rgb {
  const c = rgb(hex);
  return mix(c, shade(c, 1 - spread + random() * spread * 2), 1);
}

/** Um lote: a caixa do mapa (colisão) já no referencial dela, com a rua em +z. */
export interface Lot {
  m: Mesher;
  random: Random;
  /** Largura (ao longo da rua) e fundo da caixa. */
  w: number;
  d: number;
  /** Altura das paredes (do mapa). */
  height: number;
  /** Nível do piso térreo (y local; o chão no centro é 0). */
  floor: number;
  /** Fundo da fundação (onde a parede encontra o chão no lado mais baixo). */
  base: number;
  /** Altura do chão (mundo) no centro do lote: o y = 0 local. */
  groundY: number;
  /** Bairro e tipo do mapa. */
  district: string;
  tint: number;
  /** Cor principal (parede, chapa, vidro), sorteada antes: a versão de longe usa a mesma. */
  tone: Rgb;
  /** Acabamento principal: "paint", "brick" ou "raw" (casas do morro). */
  finish: string;
  /** Telhado inclinado (de telha) ou plano (laje, platibanda)? Também decidido antes. */
  pitched: boolean;
  /** Ponto local fora da rua? (beirais, toldos e sacadas não podem invadir a rua) */
  clear: (x: number, z: number) => boolean;
}

/** Vãos de janelas espalhados por uma parede de comprimento `len`, centrados. */
export function spread(len: number, count: number, width: number, margin = 0.6): [number, number][] {
  const out: [number, number][] = [];
  if (count <= 0) return out;
  const usable = len - margin * 2;
  const step = usable / count;
  for (let i = 0; i < count; i++) {
    const c = margin + step * (i + 0.5);
    out.push([c - width / 2, c + width / 2]);
  }
  return out;
}
