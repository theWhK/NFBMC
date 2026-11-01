// Casas de Porto Gordo, geradas por código (cada uma sai sempre igual, pela
// semente do lote): térreas de telhado colonial, sobrados com sacada, casas de
// platibanda geminadas na Vila, casas de muro e portão no Jardim, casinhas do
// Morro (tijolo baiano, laje, caixa-d'água, vergalhão, puxadinho, escada de
// fora, varal), mansões do Alto da Picanha, sítios com varanda e celeiro na Roça
// e quiosques na Praia. Tudo dentro da caixa do mapa (a colisão); só beiral,
// toldo e sacada saem um pouco, e nunca para cima da rua.
import { BOX, rgb, shade, type Rgb } from "./mesher.ts";
import { M } from "./building-materials.ts";
import {
  ALUMINUM, DARK, IRON, OFFWHITE, WHITE,
  airConditioner, antenna, awning, chimney, dish, clothesline, doorIn, gableRoof, gutter, hipRoof, onWall, pane,
  parapet, pick, plainWindow, railing, railingZ, range, rebars, rollerDoor, shedRoof, signBoard, slab,
  spread, stairs, wall, waterTank, windowIn,
  type Hole, type Lot, type Random, type WindowStyle,
} from "./building-kit.ts";

// --- Paletas ----------------------------------------------------------------------

export const STRONG = ["#e76f51", "#f4a261", "#e9c46a", "#2a9d8f", "#8ab17d", "#f28482", "#84a59d", "#6d597a", "#ffb4a2", "#4ea8de", "#ffd166", "#06d6a0", "#ef476f", "#b5838d", "#ffcad4", "#9bc1bc", "#f6bd60", "#5fa8d3"];
export const PASTEL = ["#f6e7cb", "#f2d0a4", "#e8d5b7", "#dfe7d4", "#d7e3ef", "#f4dede", "#efe6dd", "#fdf0d5", "#e3d5ca", "#cfe1b9", "#f1e3c6", "#ffe5b4", "#e2ece9", "#fae1dd"];
export const NEUTRAL = ["#f5f3ee", "#ebe7df", "#d9d5cc", "#c4bfb4", "#9b978f", "#4a4845", "#efe8dc", "#f8f8f6"];
export const MORRO_PAINT = ["#9ccc65", "#4fc3f7", "#ff8a65", "#ffd54f", "#f06292", "#ba68c8", "#4db6ac", "#e57373", "#fff176", "#aed581", "#90caf9", "#ffab91"];
export const RAW = ["#b8b2a7", "#a9a397", "#c4beb2", "#9e998f", "#b0a99b"];
/** Tons por cima da textura da telha (envelhecida, mais clara, mais escura). */
export const TILES = ["#ffffff", "#f3e2d6", "#e9cdbd", "#d9b6a3", "#c9c2bc", "#ffe9dc"];
const DOORS = ["#6b3e26", "#8d5a3b", "#3d2b1f", "#a0522d", "#2b4c7e", "#1f5f3f", "#7a1f1f", "#d9d9d9", "#40464d"];
const SHUTTERS = ["#2e6f40", "#1d4e89", "#8d5a3b", "#6b3e26", "#f1ede4", "#7a1f1f", "#3a7d7c"];

const col = (hex: string) => rgb(hex);
const vary = (random: Random, c: Rgb, spread = 0.08): Rgb => shade(c, 1 - spread + random() * spread * 2);

/** Vãos de uma parede e o que vai dentro de cada um (desenhado depois da parede). */
class Facade {
  holes: Hole[] = [];
  fills: (() => void)[] = [];
  add(h: Hole, fill: () => void) {
    this.holes.push(h);
    this.fills.push(fill);
  }
}

/**
 * Caixa de paredes (cx, cz, w × d, de y0 a y1) com os vãos de cada lado
 * (`sides(side, len, facade)`; 0 = frente, 1 = direita, 2 = fundo, 3 = esquerda).
 */
function walls(L: Lot, cx: number, cz: number, w: number, d: number, y0: number, y1: number, mat: number, color: Rgb, sides?: (side: number, len: number, f: Facade) => void, skip = 0) {
  for (let side = 0; side < 4; side++) {
    if (skip & (1 << side)) continue;
    onWall(L.m, w, d, side, (len) => {
      const f = new Facade();
      sides?.(side, len, f);
      wall(L.m, mat, color, len, y0, y1, f.holes);
      for (const fill of f.fills) fill();
    }, cx, cz);
  }
}

/** Embasamento: do fundo da fundação até o piso, um pouco para fora da parede. */
function plinth(L: Lot, cx: number, cz: number, w: number, d: number, color: Rgb, top = L.floor) {
  if (top - L.base < 0.05) return;
  L.m.box(M.concrete, color, cx - w / 2 - 0.03, cx + w / 2 + 0.03, L.base, top, cz - d / 2 - 0.03, cz + d / 2 + 0.03, BOX.bottom);
}

/** Degraus na frente da porta, quando o piso fica alto. */
function frontSteps(L: Lot, x0: number, x1: number, z: number, color: Rgb) {
  const rise = L.floor - (L.base + 0.4);
  if (rise < 0.15) return;
  const n = Math.min(5, Math.ceil(rise / 0.18));
  for (let i = 0; i < n; i++) {
    const top = L.floor - (i * rise) / n;
    L.m.box(M.concrete, color, x0, x1, L.base, top, z, z + 0.3 * (i + 1), BOX.bottom | BOX.back);
  }
}

/** Janela com o estilo dado numa fachada (vão + preenchimento). */
function addWindow(L: Lot, f: Facade, x0: number, x1: number, y0: number, y1: number, style: WindowStyle) {
  const h = { x0, x1, y0, y1 };
  f.add(h, () => windowIn(L.m, L.random, h, style));
}

function addDoor(L: Lot, f: Facade, x0: number, x1: number, y0: number, y1: number, kind: "wood" | "iron" | "glass", color: Rgb) {
  const h = { x0, x1, y0, y1 };
  f.add(h, () => doorIn(L.m, L.random, h, kind, color));
}

/** Portão basculante de garagem (chapa com frisos), num vão. */
function addGarage(L: Lot, f: Facade, x0: number, x1: number, y0: number, y1: number, color: Rgb) {
  const h = { x0, x1, y0, y1 };
  f.add(h, () => {
    const m = L.m;
    m.front(M.paint, color, x0, x1, y0, y1, -0.08);
    for (let y = y0 + 0.3; y < y1 - 0.1; y += 0.3) m.box(M.paint, shade(color, 0.8), x0 + 0.05, x1 - 0.05, y, y + 0.04, -0.08, -0.06, BOX.back);
  });
}

/** Estilo de janela de casa, sorteado (moldura, venezianas, grade). */
function houseWindow(random: Random, opts: { shutters?: number; bars?: number; trim?: Rgb | null; frame?: Rgb; lit?: number } = {}): WindowStyle {
  const wood = random() < 0.35;
  return plainWindow({
    frame: opts.frame ?? (wood ? col(pick(random, SHUTTERS)) : random() < 0.5 ? ALUMINUM : col("#f4f4f2")),
    shutters: random() < (opts.shutters ?? 0.3) ? col(pick(random, SHUTTERS)) : null,
    bars: random() < (opts.bars ?? 0.35),
    trim: opts.trim === undefined ? (random() < 0.4 ? OFFWHITE : null) : opts.trim,
    litChance: opts.lit ?? 0.22,
    panes: random() < 0.6 ? 2 : random() < 0.5 ? 3 : 1,
  });
}

/** Telhado colonial sorteado (duas águas para um lado ou outro, ou quatro águas) sobre uma caixa. */
function colonialRoof(L: Lot, w: number, d: number, y: number, wallCol: Rgb, opts: { pitch?: number; eave?: number; hip?: number; tile?: Rgb } = {}) {
  const r = L.random;
  const m = L.m;
  const tile = opts.tile ?? vary(r, col(pick(r, TILES)), 0.06);
  const pitch = opts.pitch ?? range(r, 0.45, 0.62);
  const eave = opts.eave ?? range(r, 0.45, 0.7);
  // O beiral da frente não pode ir para a rua.
  const eaveFront = L.clear(0, d / 2 + eave + 0.2) ? eave : 0.25;
  const kind = r() < (opts.hip ?? 0.35) ? "hip" : r() < 0.6 ? "side" : "front";
  if (kind === "hip") return hipRoof(m, w, d, y, pitch, eave, tile, shade(wallCol, 0.8));
  if (kind === "side") {
    gableRoof(m, w, d, y, pitch, eave, tile, wallCol, M.plaster, M.tile, eaveFront);
    return y + (d / 2) * pitch;
  }
  // Empena virada para a rua (cumeeira ao longo de z): gira o telhado.
  m.push(0, 0, 0, Math.PI / 2);
  gableRoof(m, d, w, y, pitch, eave, tile, wallCol);
  m.pop();
  return y + (w / 2) * pitch;
}

// --- Térrea / sobrado (genérica, também usada na Vila e no Jardim) ------------------

interface HouseOpts {
  /** Corpo da casa: centro e tamanho (dentro do lote). */
  cx: number;
  cz: number;
  w: number;
  d: number;
  wall: Rgb;
  floors: number;
  floorH: number;
  /** Telhado: colonial, platibanda (laje escondida) ou laje com caixa-d'água. */
  roof: "colonial" | "platibanda" | "laje";
  window: WindowStyle;
  door: Rgb;
  /** Porta em que fração da fachada (0..1). */
  doorAt: number;
  /** Garagem no térreo (lado esquerdo da fachada). */
  garage: boolean;
  balcony: boolean;
  chimney: boolean;
  porch: boolean;
}

function house(L: Lot, o: HouseOpts) {
  const { m, random: r } = L;
  const top = L.floor + o.floors * o.floorH;
  m.grime = 0.18;
  m.grimeFloor = L.groundY + L.floor;
  plinth(L, o.cx, o.cz, o.w, o.d, shade(o.wall, 0.7));
  const winW = range(r, 1.0, 1.5);
  const winH = range(r, 1.0, 1.3);
  walls(L, o.cx, o.cz, o.w, o.d, L.floor, top, M.plaster, o.wall, (side, len, f) => {
    for (let fl = 0; fl < o.floors; fl++) {
      const y = L.floor + fl * o.floorH;
      if (side === 0) {
        if (fl === 0) {
          let x0 = 0.4;
          if (o.garage && len > 7) {
            addGarage(L, f, 0.4, 3.0, y, y + 2.3, col(pick(r, ["#e6e6e6", "#8a8f94", "#5b4636", "#2b2b2e"])));
            x0 = 3.4;
          }
          const doorX = x0 + (len - x0 - 1.4) * o.doorAt;
          addDoor(L, f, doorX + 0.25, doorX + 1.15, y, y + 2.15, r() < 0.7 ? "wood" : "iron", o.door);
          // Janelas dos dois lados da porta, onde couber.
          for (const [a, b] of spread(doorX - x0, Math.floor((doorX - x0) / 2.2), winW, 0.3)) addWindow(L, f, x0 + a, x0 + b, y + 1.0, y + 1.0 + winH, o.window);
          const rest = len - (doorX + 1.4);
          for (const [a, b] of spread(rest, Math.floor(rest / 2.2), winW, 0.3)) addWindow(L, f, doorX + 1.4 + a, doorX + 1.4 + b, y + 1.0, y + 1.0 + winH, o.window);
        } else {
          const n = Math.max(1, Math.floor(len / 2.6));
          for (const [a, b] of spread(len, n, o.balcony ? 1.1 : winW, 0.5)) {
            if (o.balcony && n <= 3 && Math.abs((a + b) / 2 - len / 2) < len / 4) addDoor(L, f, a, b, y, y + 2.15, "glass", ALUMINUM);
            else addWindow(L, f, a, b, y + 0.95, y + 0.95 + winH, o.window);
          }
        }
      } else {
        // Laterais e fundo: menos janelas, umas basculantes pequenas (banheiro, cozinha).
        const n = Math.floor(len / (side === 2 ? 3 : 3.6));
        for (const [a, b] of spread(len, n, 1.0, 0.8)) {
          if (r() < 0.25) continue;
          const small = r() < 0.35;
          addWindow(L, f, a, small ? a + 0.6 : b, y + (small ? 1.5 : 1.0), y + (small ? 2.0 : 1.0 + winH), o.window);
        }
      }
    }
  });
  m.grime = 0;
  // Faixa entre os andares.
  for (let fl = 1; fl < o.floors; fl++) {
    const y = L.floor + fl * o.floorH;
    m.box(M.plaster, shade(o.wall, 0.9), o.cx - o.w / 2 - 0.05, o.cx + o.w / 2 + 0.05, y - 0.1, y + 0.08, o.cz - o.d / 2 - 0.05, o.cz + o.d / 2 + 0.05, BOX.bottom);
  }
  // Sacada no andar de cima, com grade.
  if (o.balcony && o.floors > 1) {
    const out = Math.min(1.0, L.d / 2 - (o.cz + o.d / 2) + 0.8);
    const z0 = o.cz + o.d / 2;
    if (out > 0.5 && L.clear(o.cx, z0 + out + 0.3)) {
      const bw = Math.min(o.w - 1, 3.8);
      const y = L.floor + o.floorH;
      m.box(M.concrete, OFFWHITE, o.cx - bw / 2, o.cx + bw / 2, y - 0.14, y + 0.02, z0, z0 + out);
      const rail = r() < 0.6 ? IRON : OFFWHITE;
      railing(m, o.cx - bw / 2, o.cx + bw / 2, y, y + 1.0, z0 + out - 0.03, rail);
      railingZ(m, z0, z0 + out - 0.03, y, y + 1.0, o.cx - bw / 2 + 0.02, rail);
      railingZ(m, z0, z0 + out - 0.03, y, y + 1.0, o.cx + bw / 2 - 0.02, rail);
    }
  }
  // Varandinha na frente da porta: laje fininha em dois pilares.
  if (o.porch && o.floors === 1) {
    const z0 = o.cz + o.d / 2;
    const out = Math.min(1.6, L.d / 2 - z0 + 0.6);
    if (out > 0.9 && L.clear(o.cx, z0 + out + 0.2)) {
      const pw = Math.min(o.w - 0.6, 4.5);
      const x0 = o.cx - o.w / 2 + 0.3 + (o.w - 0.6 - pw) * o.doorAt;
      const y = L.floor + 2.6;
      m.box(M.concrete, OFFWHITE, x0, x0 + pw, y, y + 0.14, z0, z0 + out);
      for (const x of [x0 + 0.1, x0 + pw - 0.1]) m.box(M.plaster, OFFWHITE, x - 0.09, x + 0.09, L.floor, y, z0 + out - 0.2, z0 + out - 0.02);
      m.box(M.concrete, shade(OFFWHITE, 0.8), x0, x0 + pw, L.floor - 0.1, L.floor + 0.04, z0, z0 + out);
    }
  }
  frontSteps(L, o.cx + o.w / 2 - 2, o.cx + o.w / 2 - 0.5, o.cz + o.d / 2, col("#bdb8ae"));

  // Telhado.
  const ix = o.cx;
  const iz = o.cz;
  m.push(ix, 0, iz, 0);
  let roofTop = top;
  if (o.roof === "colonial") {
    roofTop = colonialRoof(L, o.w, o.d, top, o.wall);
  } else if (o.roof === "platibanda") {
    slab(m, -o.w / 2, o.w / 2, -o.d / 2, o.d / 2, top + 0.05, col("#8f8b84"), 0.05);
    // Telhado de uma água escondido atrás da platibanda.
    shedRoof(m, -o.w / 2 + 0.2, o.w / 2 - 0.2, -o.d / 2 + 0.2, o.d / 2 - 0.2, top + 0.15, top + 0.75, vary(r, col("#c8c6c0")), M.metal);
    parapet(m, o.w, o.d, top, range(r, 0.9, 1.3), o.wall, M.plaster, 0.15, OFFWHITE);
    roofTop = top + 1.3;
  } else {
    slab(m, -o.w / 2 - 0.1, o.w / 2 + 0.1, -o.d / 2 - 0.1, o.d / 2 + 0.1, top + 0.15, col("#a7a39b"));
    parapet(m, o.w + 0.2, o.d + 0.2, top + 0.15, 0.5, o.wall, M.plaster, 0.12, OFFWHITE);
    waterTank(m, range(r, -o.w / 4, o.w / 4), -o.d / 4, top + 0.15, 1);
  }
  if (o.chimney) chimney(m, o.w / 2 - 0.8, -o.d / 2 + 0.9, top - 0.3, roofTop + 0.4, WHITE);
  if (r() < 0.25) antenna(m, -o.w / 2 + 1, 0, roofTop - 0.2, 2.2);
  else if (o.roof !== "colonial" && r() < 0.4) dish(m, o.w / 2 - 0.9, top + 0.15, o.d / 2 - 1, range(r, -0.5, 0.5));
  m.pop();
  // Calha e condutor na frente.
  if (o.roof === "platibanda" && r() < 0.6) {
    onWall(m, o.w, o.d, 1, (len) => m.box(M.paint, col("#cfcfcf"), len - 0.5, len - 0.42, L.floor, top + 0.8, 0, 0.08, BOX.back), o.cx, o.cz);
  }
}

// --- Vila do Pastel: casas de platibanda coloridas, geminadas, e térreas -------------

export function vilaHouse(L: Lot) {
  const r = L.random;
  const floors = L.height > 5.3 ? 2 : 1;
  const floorH = floors === 2 ? L.height / 2 : Math.max(3, L.height * 0.75);
  const type = L.pitched ? 1 : r() * 0.75;
  if (type < 0.5) {
    // Geminadas: duas (ou três) casinhas de platibanda, cada uma de uma cor.
    const units = L.w > 10.2 && r() < 0.4 ? 3 : 2;
    const uw = L.w / units;
    const depth = L.d - range(r, 0.5, 1.5);
    const cz = -L.d / 2 + depth / 2;
    for (let i = 0; i < units; i++) {
      const cx = -L.w / 2 + uw * (i + 0.5);
      const wallCol = i === 0 ? L.tone : vary(r, col(pick(r, STRONG)));
      unitPlatibanda(L, cx, cz, uw, depth, wallCol, floors, floorH, i % 2 === 0);
    }
    return;
  }
  const w = L.w - range(r, 0, 0.8);
  const d = L.d - range(r, 1.0, 2.0);
  house(L, {
    cx: 0,
    cz: -L.d / 2 + d / 2,
    w,
    d,
    wall: L.tone,
    floors,
    floorH,
    roof: L.pitched ? "colonial" : "laje",
    window: houseWindow(r, { shutters: 0.45 }),
    door: col(pick(r, DOORS)),
    doorAt: r(),
    garage: false,
    balcony: floors === 2 && r() < 0.6,
    chimney: false,
    porch: r() < 0.4,
  });
}

/** Uma casinha de platibanda (fachada reta, cornija, porta e janela), parte de uma fileira. */
function unitPlatibanda(L: Lot, cx: number, cz: number, w: number, d: number, wallCol: Rgb, floors: number, floorH: number, doorLeft: boolean) {
  const { m, random: r } = L;
  const top = L.floor + floors * floorH;
  const trim = r() < 0.7 ? OFFWHITE : shade(wallCol, 0.75);
  const style = houseWindow(r, { shutters: 0.5, trim, bars: 0.5 });
  const door = col(pick(r, DOORS));
  plinth(L, cx, cz, w, d, shade(wallCol, 0.6));
  m.grime = 0.2;
  m.grimeFloor = L.groundY + L.floor;
  walls(L, cx, cz, w, d, L.floor, top, M.plaster, wallCol, (side, len, f) => {
    if (side !== 0) {
      if (side === 2) for (const [a, b] of spread(len, 1, 0.9)) addWindow(L, f, a, b, L.floor + 1.3, L.floor + 2.1, style);
      return;
    }
    for (let fl = 0; fl < floors; fl++) {
      const y = L.floor + fl * floorH;
      if (fl === 0) {
        const dx = doorLeft ? 0.35 : len - 1.25;
        addDoor(L, f, dx, dx + 0.9, y, y + 2.2, r() < 0.6 ? "wood" : "iron", door);
        const wx0 = doorLeft ? 1.6 : 0.4;
        const wx1 = doorLeft ? len - 0.4 : len - 1.6;
        if (wx1 - wx0 > 0.9) {
          const ww = Math.min(1.4, wx1 - wx0);
          const c = (wx0 + wx1) / 2;
          addWindow(L, f, c - ww / 2, c + ww / 2, y + 0.95, y + 2.15, style);
        }
      } else {
        for (const [a, b] of spread(len, len > 4.5 ? 2 : 1, 1.1, 0.4)) addWindow(L, f, a, b, y + 0.9, y + 2.1, style);
      }
    }
  }, 0b1010);
  m.grime = 0;
  // Cornija e platibanda (a mureta que esconde o telhado), com frisos.
  const ph = range(r, 0.8, 1.3);
  m.push(cx, 0, cz, 0);
  m.box(M.plaster, trim, -w / 2, w / 2, top - 0.05, top + 0.15, d / 2, d / 2 + 0.12, BOX.back);
  m.box(M.plaster, wallCol, -w / 2, w / 2, top + 0.15, top + ph, d / 2 - 0.15, d / 2, BOX.bottom | BOX.back);
  m.box(M.plaster, trim, -w / 2, w / 2, top + ph, top + ph + 0.1, d / 2 - 0.18, d / 2 + 0.06, BOX.back);
  // Almofada decorativa no meio da platibanda, às vezes com um frontãozinho.
  if (r() < 0.6) m.box(M.plaster, trim, -w / 4, w / 4, top + 0.3, top + ph - 0.15, d / 2, d / 2 + 0.03, BOX.back | BOX.bottom);
  if (r() < 0.3) m.box(M.plaster, wallCol, -w / 6, w / 6, top + ph + 0.1, top + ph + 0.45, d / 2 - 0.15, d / 2, BOX.bottom | BOX.back);
  // Telhado de uma água atrás da platibanda (cai para o fundo).
  m.push(0, 0, 0, Math.PI);
  shedRoof(m, -w / 2, w / 2, -d / 2 + 0.15, d / 2 + 0.3, top - 0.2, top + ph - 0.15, vary(r, col(pick(r, TILES))), M.tile);
  m.pop();
  // Paredes laterais da fileira só nas pontas (no meio, a casa vizinha encosta).
  m.pop();
  if (Math.abs(cx - w / 2 + L.w / 2) < 0.01 || Math.abs(cx + w / 2 - L.w / 2) < 0.01) {
    const left = Math.abs(cx - w / 2 + L.w / 2) < 0.01;
    onWall(m, w, d, left ? 3 : 1, (len) => {
      wall(m, M.plaster, wallCol, len, L.floor, top + ph, []);
    }, cx, cz);
  }
}

// --- Jardim: muro baixo com portão, garagem, casa térrea ou sobrado --------------

export function jardimHouse(L: Lot) {
  const { m, random: r } = L;
  const floors = L.height > 5.7 ? 2 : 1;
  const floorH = floors === 2 ? L.height / 2 : Math.max(3, L.height * 0.7);
  const yard = range(r, 3, 4.2);
  const d = L.d - yard - 0.5;
  const cz = -L.d / 2 + 0.5 + d / 2;
  const wallCol = L.tone;
  const garageSide = r() < 0.6;
  const w = garageSide ? L.w - 3.4 : L.w - 0.8;
  const cx = garageSide ? L.w / 2 - 0.4 - w / 2 : 0;
  house(L, {
    cx,
    cz,
    w,
    d,
    wall: wallCol,
    floors,
    floorH,
    roof: L.pitched ? "colonial" : "platibanda",
    window: houseWindow(r, { shutters: 0.35, bars: 0.25 }),
    door: col(pick(r, DOORS)),
    doorAt: r(),
    garage: !garageSide && floors === 2 && r() < 0.5,
    balcony: floors === 2 && r() < 0.65,
    chimney: r() < 0.3,
    porch: r() < 0.5,
  });
  // Abrigo do carro do lado: laje fininha em pilares, ou telhadinho.
  if (garageSide) {
    const gx0 = -L.w / 2 + 0.2;
    const gx1 = cx - w / 2;
    const gz0 = cz - d / 2 + 1;
    const gz1 = L.d / 2 - 0.4;
    const y = L.floor + 2.5;
    if (r() < 0.5) {
      m.box(M.concrete, OFFWHITE, gx0, gx1, y, y + 0.15, gz0, cz + d / 2 + 1.2);
      m.box(M.plaster, OFFWHITE, gx0 + 0.05, gx0 + 0.25, L.floor, y, cz + d / 2 + 0.9, cz + d / 2 + 1.1);
    } else {
      m.push(0, 0, 0, 0);
      shedRoof(m, gx0, gx1, gz0, cz + d / 2 + 1.2, y, y + 0.4, vary(r, col("#9fb0bf")), M.metal);
      m.pop();
      m.box(M.paint, IRON, gx0 + 0.05, gx0 + 0.15, L.floor, y, cz + d / 2 + 1.0, cz + d / 2 + 1.1);
    }
    // Piso da garagem.
    m.box(M.concrete, col("#a8a59e"), gx0, gx1, L.floor - 0.2, L.floor + 0.02, gz0, gz1);
  }
  // Jardinzinho na frente (grama) e o caminho até a porta.
  m.box(M.concrete, col("#5f8a3a"), -L.w / 2 + 0.2, L.w / 2 - 0.2, L.floor - 0.25, L.floor - 0.02, cz + d / 2, L.d / 2 - 0.2, BOX.bottom);
  // Muro baixo na frente e dos lados, com portão de pedestre e de garagem.
  frontWall(L, wallCol, garageSide ? [-L.w / 2 + 0.3, -L.w / 2 + 3.0] : null, r() < 0.5 ? "grade" : "baixo");
}

/** Muro na frente e nos lados do lote (na beira da caixa), com portão; `gate` = vão do portão de carro. */
function frontWall(L: Lot, wallCol: Rgb, gate: [number, number] | null, kind: "grade" | "baixo" | "alto") {
  const { m, random: r } = L;
  const t = 0.15;
  const hw = L.w / 2;
  const hd = L.d / 2;
  const h = kind === "alto" ? 2.2 : kind === "grade" ? 0.7 : 1.2;
  const murCol = r() < 0.5 ? shade(wallCol, 0.95) : col(pick(r, ["#e8e2d6", "#d8d2c4", "#bcb6a8"]));
  const capCol = OFFWHITE;
  const ped: [number, number] = [hw - 1.6, hw - 0.6];
  const y0 = L.base;
  const yTop = L.floor + h;
  // Frente, com os vãos.
  const cuts: [number, number][] = [ped];
  if (gate) cuts.push(gate);
  cuts.sort((a, b) => a[0] - b[0]);
  let x = -hw;
  for (const [a, b] of [...cuts, [hw, hw] as [number, number]]) {
    if (a - x > 0.05) {
      m.box(M.plaster, murCol, x, a, y0, yTop, hd - t, hd, BOX.bottom);
      m.box(M.concrete, capCol, x - 0.03, a + 0.03, yTop, yTop + 0.06, hd - t - 0.03, hd + 0.03, BOX.bottom);
      if (kind === "grade") railing(m, x + 0.05, a - 0.05, yTop + 0.06, yTop + 1.1, hd - t / 2, IRON, 0.11);
    }
    x = b;
  }
  // Pilares e portões.
  const gateCol = pick(r, [IRON, col("#e6e6e6"), col("#4b3a2a"), col("#2d4a3a")]);
  for (const [a, b] of cuts) {
    m.box(M.plaster, murCol, a - 0.25, a, y0, L.floor + 2.0, hd - 0.3, hd + 0.02, BOX.bottom);
    m.box(M.plaster, murCol, b, b + 0.25, y0, L.floor + 2.0, hd - 0.3, hd + 0.02, BOX.bottom);
    // Portão de grade (barras).
    const gz = hd - t / 2;
    railing(m, a, b, L.floor + 0.05, L.floor + 1.8, gz, gateCol, 0.1);
    m.box(M.paint, gateCol, a, b, L.floor + 0.05, L.floor + 0.6, gz - 0.015, gz + 0.015);
  }
  // Laterais do muro.
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -hw : hw - t;
    m.box(M.plaster, murCol, x0, x0 + t, y0, L.floor + 1.8, -hd + 0.2, hd - t, BOX.bottom);
    m.box(M.concrete, capCol, x0 - 0.02, x0 + t + 0.02, L.floor + 1.8, L.floor + 1.86, -hd + 0.2, hd - t, BOX.bottom);
  }
  // Caixa do correio e o número.
  m.box(M.paint, col("#c1121f"), ped[0] - 0.55, ped[0] - 0.3, L.floor + 1.0, L.floor + 1.3, hd, hd + 0.12);
}

// --- Morro do Torresmo: casinhas de tijolo, laje, caixa-d'água e puxadinho ------------

export function morroHouse(L: Lot) {
  const { m, random: r } = L;
  const floors = Math.max(1, Math.min(3, Math.round((L.height - 0.7) / 2.8)));
  const fh = 2.75;
  // Escada de fora: do lado direito (casa mais estreita) ou na frente (mais rasa).
  const stair = floors >= 2 ? (r() < 0.35 ? "side" : r() < 0.4 ? "front" : "none") : "none";
  let w = L.w - 0.2;
  let d = L.d - 0.2;
  let cx = 0;
  let cz = 0;
  if (stair === "side") {
    w -= 1.0;
    cx = -0.5;
  } else if (stair === "front") {
    d -= 1.0;
    cz = -0.5;
  }
  const top = L.floor + floors * fh;
  // Acabamento de cada andar: pintado, reboco cru ou tijolo à vista (o principal foi sorteado antes).
  const finish: { mat: number; color: Rgb }[] = [];
  const main = L.finish === "brick" ? { mat: M.brick, color: vary(r, WHITE, 0.06) } : { mat: M.plaster, color: L.tone };
  for (let fl = 0; fl < floors; fl++) {
    const roll = r();
    if (fl === 0 && L.finish !== "paint" && roll < 0.35) finish.push({ mat: M.plaster, color: vary(r, col(pick(r, MORRO_PAINT)), 0.1) });
    else if (fl > 0 && L.finish === "paint" && roll < 0.35) finish.push({ mat: M.brick, color: vary(r, WHITE, 0.08) });
    else if (fl > 0 && L.finish === "raw" && roll < 0.25) finish.push({ mat: M.brick, color: vary(r, WHITE, 0.08) });
    else finish.push(main);
  }
  const frameCol = r() < 0.5 ? ALUMINUM : r() < 0.5 ? IRON : col(pick(r, SHUTTERS));
  const style = plainWindow({ frame: frameCol, sill: r() < 0.5 ? col("#bdb8ae") : null, bars: r() < 0.55, litChance: 0.28, panes: r() < 0.5 ? 2 : 1, depth: 0.1 });
  const concrete = col("#a9a69f");
  plinth(L, cx, cz, w, d, concrete);
  m.grime = 0.25;
  m.grimeFloor = L.groundY + L.floor;
  for (let fl = 0; fl < floors; fl++) {
    const y0 = L.floor + fl * fh;
    const y1 = y0 + fh;
    const { mat, color } = finish[fl];
    walls(L, cx, cz, w, d, y0, y1 - 0.2, mat, color, (side, len, f) => {
      if (side === 0) {
        if (fl === 0) {
          const dx = r() < 0.5 ? 0.3 : len - 1.2;
          addDoor(L, f, dx, dx + 0.85, y0, y0 + 2.1, "iron", col(pick(r, ["#2b4c7e", "#7a1f1f", "#1f5f3f", "#d9d9d9", "#40464d", "#c9a227"])));
          const free0 = dx < 1 ? 1.4 : 0.3;
          const free1 = dx < 1 ? len - 0.3 : len - 1.6;
          if (free1 - free0 > 0.9) {
            const ww = Math.min(1.2, free1 - free0);
            const c = (free0 + free1) / 2;
            addWindow(L, f, c - ww / 2, c + ww / 2, y0 + 1.0, y0 + 2.0, style);
          }
        } else {
          const n = len > 6 ? 2 : 1;
          for (const [a, b] of spread(len, n, 1.0, 0.5)) {
            if (stair === "front" && fl === 1 && a < 1.6) {
              addDoor(L, f, a, a + 0.8, y0, y0 + 2.05, "iron", col("#40464d"));
              continue;
            }
            // Às vezes a janela ainda não tem caixilho (só o vão escuro).
            if (r() < 0.12) {
              const h = { x0: a, x1: b, y0: y0 + 1.0, y1: y0 + 2.0 };
              f.add(h, () => pane(m, r, h.x0, h.x1, h.y0, h.y1, -0.35, 0.15, col("#333333")));
            } else addWindow(L, f, a, b, y0 + 1.0, y0 + 2.0, style);
          }
        }
      } else if (r() < 0.6 && len > 3) {
        const c = range(r, 1, len - 1.6);
        if (side === 1 && stair === "side" && fl === 1) addDoor(L, f, len - 1.4, len - 0.6, y0, y0 + 2.05, "iron", col("#40464d"));
        else addWindow(L, f, c, c + 0.8, y0 + 1.2, y0 + 2.0, style);
      }
    });
    // Viga da laje aparente (concreto) e pilares nos cantos, quando é tijolo.
    m.box(M.concrete, concrete, cx - w / 2 - 0.02, cx + w / 2 + 0.02, y1 - 0.2, y1, cz - d / 2 - 0.02, cz + d / 2 + 0.02, BOX.bottom);
    if (mat === M.brick) {
      for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const x = cx + (px * w) / 2;
        const z = cz + (pz * d) / 2;
        m.box(M.concrete, concrete, x - 0.12, x + 0.12, y0, y1 - 0.2, z - 0.12, z + 0.12, BOX.bottom | BOX.top);
      }
    }
  }
  m.grime = 0;
  // Escada externa até o primeiro andar.
  if (stair === "side") {
    onWall(m, w, d, 1, () => stairs(m, 0.2, d - 0.6, L.floor, L.floor + fh, 0.95, concrete, r() < 0.6 ? IRON : null), cx, cz);
  } else if (stair === "front") {
    onWall(m, w, d, 0, () => stairs(m, 1.6, w - 1.8, L.floor, L.floor + fh, 0.95, concrete, r() < 0.5 ? IRON : null), cx, cz);
  }
  // Em cima: laje aberta (com mureta, caixa-d'água, vergalhão, varal, puxadinho) ou telha de fibrocimento.
  m.push(cx, 0, cz, 0);
  const roofKind = r();
  if (roofKind < 0.28) {
    // Telhado de uma água (fibrocimento/zinco) direto em cima.
    shedRoof(m, -w / 2 - 0.25, w / 2 + 0.25, -d / 2 - 0.2, d / 2 + Math.min(0.3, L.d / 2 - d / 2 - cz), top + 0.1, top + 0.1 + d * 0.12, vary(r, col("#b9bdbf"), 0.1), M.metal);
    if (r() < 0.6) waterTank(m, range(r, -w / 4, w / 4), -d / 4, top + d * 0.12 + 0.1, 0.9);
  } else {
    slab(m, -w / 2 - 0.05, w / 2 + 0.05, -d / 2 - 0.05, d / 2 + 0.05, top + 0.02, concrete);
    const mureta = r();
    if (mureta < 0.55) parapet(m, w, d, top, range(r, 0.4, 1.0), finish[floors - 1].color, finish[floors - 1].mat, 0.14, null);
    // Puxadinho: quartinho de tijolo em parte da laje, coberto de zinco.
    if (r() < 0.35 && w > 4.5) {
      const pw = w * range(r, 0.4, 0.6);
      const pd = d * range(r, 0.45, 0.65);
      const px = -w / 2 + pw / 2 + 0.15;
      const pz = -d / 2 + pd / 2 + 0.15;
      const ph = 2.4;
      m.pop();
      const pull: Lot = { ...L, floor: top };
      walls(pull, cx + px, cz + pz, pw, pd, top, top + ph, M.brick, vary(r, WHITE, 0.06), (side, len, f) => {
        if (side === 0) addDoor(pull, f, 0.3, 1.1, top, top + 2.0, "iron", col("#40464d"));
        else if (side === 1 && len > 2) addWindow(pull, f, len / 2 - 0.4, len / 2 + 0.4, top + 1.1, top + 1.8, style);
      });
      m.push(cx, 0, cz, 0);
      shedRoof(m, px - pw / 2 - 0.2, px + pw / 2 + 0.2, pz - pd / 2 - 0.15, pz + pd / 2 + 0.3, top + ph, top + ph + 0.35, vary(r, col("#aeb3b5"), 0.1), M.metal);
    }
    if (r() < 0.85) waterTank(m, range(r, -w / 2 + 0.9, w / 2 - 0.9), range(r, -d / 2 + 0.9, 0), top, range(r, 0.8, 1.1));
    // Vergalhões nos cantos (o andar de cima que ainda vai sair).
    if (r() < 0.55) {
      for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        if (r() < 0.75) rebars(m, (px * w) / 2 - px * 0.15, (pz * d) / 2 - pz * 0.15, top, r);
      }
    }
    if (r() < 0.4) clothesline(m, r, -w / 2 + 0.6, w / 2 - 0.6, range(r, 0, d / 3), top);
  }
  if (r() < 0.35) antenna(m, w / 2 - 0.5, -d / 2 + 0.5, top, 2.0);
  else if (r() < 0.45) dish(m, range(r, -w / 2 + 0.7, w / 2 - 0.7), top + (roofKind < 0.28 ? 0.1 + d * 0.06 : 0), d / 2 - 0.7, range(r, -0.6, 0.6));
  m.pop();
  // Ar-condicionado.
  if (floors >= 2 && r() < 0.35) onWall(m, w, d, 0, (len) => airConditioner(m, len - 0.8, L.floor + fh + 0.4), cx, cz);
}

// --- Alto da Picanha: mansões (moderna ou neoclássica) -----------------------------

export function mansion(L: Lot) {
  const r = L.random;
  if (L.pitched) classicMansion(L);
  else modernMansion(L);
}

function modernMansion(L: Lot) {
  const { m, random: r } = L;
  const yard = range(r, 3.5, 5);
  const d = L.d - yard - 1;
  const cz = -L.d / 2 + 0.6 + d / 2;
  const white = L.tone;
  const dark = col(pick(r, ["#3d3c3a", "#4a4845", "#5b5852", "#2f3437"]));
  const woodCol = col(pick(r, ["#b07a4f", "#9a6a43", "#c58b5a"]));
  const fh = Math.max(3.1, L.height / 2);
  const y1 = L.floor + fh;
  const y2 = y1 + fh;
  const w = L.w - 1;
  // Térreo: caixa recuada com vidros grandes e a garagem dupla.
  const gw = 6;
  const gx = -w / 2 + gw / 2;
  plinth(L, 0, cz, w, d, col("#8d8a85"));
  const groundW = w - gw;
  walls(L, gw / 2, cz, groundW, d - 1, L.floor, y1, M.plaster, white, (side, len, f) => {
    if (side === 0) {
      // Pano de vidro do chão ao teto, com montantes.
      const h = { x0: 0.4, x1: len - 0.4, y0: L.floor + 0.05, y1: y1 - 0.3 };
      f.add(h, () => {
        const n = Math.max(2, Math.round((h.x1 - h.x0) / 1.6));
        for (let i = 0; i < n; i++) {
          const a = h.x0 + ((h.x1 - h.x0) * i) / n;
          const b = h.x0 + ((h.x1 - h.x0) * (i + 1)) / n;
          pane(m, r, a, b, h.y0, h.y1, -0.15, 0.35);
          m.box(M.paint, DARK, b - 0.03, b + 0.03, h.y0, h.y1, -0.15, -0.1, BOX.back);
        }
      });
    } else if (side !== 2) {
      for (const [a, b] of spread(len, Math.floor(len / 4), 1.6)) addWindow(L, f, a, b, L.floor + 0.6, y1 - 0.4, plainWindow({ frame: DARK, sill: null, panes: 1, litChance: 0.3 }));
    }
  });
  // Garagem dupla (portão de lâminas) embaixo do andar de cima.
  walls(L, gx, cz, gw, d - 1, L.floor, y1, M.plaster, white, (side, len, f) => {
    if (side === 0) addGarage(L, f, 0.4, len - 0.4, L.floor, L.floor + 2.5, woodCol);
  }, 0b0100);
  // Andar de cima em balanço para a frente, com painel de madeira e faixa de vidro.
  const over = Math.min(1.0, L.d / 2 - (cz + d / 2) - 0.2);
  const ud = d - 1 + Math.max(0, over) + 0.5;
  const ucz = cz - (d - 1) / 2 + ud / 2 - 0.5;
  m.box(M.concrete, white, -w / 2 - 0.1, w / 2 + 0.1, y1 - 0.3, y1, ucz - ud / 2, ucz + ud / 2 + 0.1);
  walls(L, 0, ucz, w, ud, y1, y2, M.plaster, dark, (side, len, f) => {
    if (side === 0) {
      const h = { x0: len * 0.38, x1: len - 0.5, y0: y1 + 0.5, y1: y2 - 0.35 };
      f.add(h, () => {
        const n = Math.max(2, Math.round((h.x1 - h.x0) / 1.5));
        for (let i = 0; i < n; i++) {
          const a = h.x0 + ((h.x1 - h.x0) * i) / n;
          pane(m, r, a, a + (h.x1 - h.x0) / n, h.y0, h.y1, -0.12, 0.35);
        }
        m.box(M.paint, DARK, h.x0, h.x1, h.y0 - 0.04, h.y0, -0.12, 0, BOX.back);
      });
      // Painel de madeira (ripado) no resto.
      f.add({ x0: 0.3, x1: len * 0.38 - 0.3, y0: y1 + 0.3, y1: y2 - 0.3 }, () => {
        m.front(M.wood, woodCol, 0.3, len * 0.38 - 0.3, y1 + 0.3, y2 - 0.3, -0.02);
      });
    } else if (side !== 2) {
      for (const [a, b] of spread(len, Math.floor(len / 4.5), 2.2)) addWindow(L, f, a, b, y1 + 0.5, y2 - 0.4, plainWindow({ frame: DARK, sill: null, panes: 2, litChance: 0.3 }));
    } else {
      for (const [a, b] of spread(len, Math.floor(len / 3), 1.8)) addWindow(L, f, a, b, y1 + 0.4, y2 - 0.4, plainWindow({ frame: DARK, sill: null, panes: 2, litChance: 0.3 }));
    }
  });
  // Cobertura: laje com platibanda fina e brise; volume da escada/caixa em cima.
  m.push(0, 0, ucz, 0);
  slab(m, -w / 2 - 0.3, w / 2 + 0.3, -ud / 2 - 0.3, ud / 2 + 0.3, y2 + 0.25, white, 0.25);
  parapet(m, w + 0.6, ud + 0.6, y2 + 0.25, 0.35, white, M.plaster, 0.1, null);
  m.box(M.plaster, white, -w / 4, w / 4 - 1, y2 + 0.25, y2 + 2.0, -ud / 2 + 0.6, -ud / 2 + 3.2);
  // Brises verticais de madeira na frente do vidro.
  for (let x = -w / 2 + w * 0.42; x < w / 2 - 0.6; x += 0.45) m.box(M.wood, woodCol, x, x + 0.06, y1 + 0.1, y2 + 0.25, ud / 2 + 0.05, ud / 2 + 0.35);
  m.pop();
  // Muro de vidro/grade e jardim.
  m.box(M.concrete, col("#5f8a3a"), -L.w / 2 + 0.2, L.w / 2 - 0.2, L.floor - 0.25, L.floor - 0.02, cz + d / 2, L.d / 2 - 0.2, BOX.bottom);
  m.box(M.concrete, col("#9a968e"), gx - gw / 2, gx + gw / 2, L.floor - 0.2, L.floor + 0.01, cz + d / 2 - 1, L.d / 2 - 0.15, BOX.bottom);
  frontWall(L, white, [-L.w / 2 + 0.6, -L.w / 2 + 6.0], r() < 0.6 ? "grade" : "baixo");
}

function classicMansion(L: Lot) {
  const { m, random: r } = L;
  const yard = range(r, 3.5, 5);
  const d = L.d - yard - 1;
  const cz = -L.d / 2 + 0.6 + d / 2;
  const wallCol = L.tone;
  const trim = OFFWHITE;
  const floors = 2;
  const fh = Math.max(3.2, L.height / 2);
  const top = L.floor + floors * fh;
  const w = L.w - 1;
  const style = plainWindow({ frame: col("#f4f4f2"), trim, sill: trim, shutters: r() < 0.5 ? col(pick(r, ["#2e4a3a", "#1d3557", "#f4f4f2"])) : null, panes: 3, litChance: 0.3 });
  plinth(L, 0, cz, w, d, col("#c9c2b4"));
  m.grime = 0.12;
  m.grimeFloor = L.groundY + L.floor;
  walls(L, 0, cz, w, d, L.floor, top, M.plaster, wallCol, (side, len, f) => {
    for (let fl = 0; fl < floors; fl++) {
      const y = L.floor + fl * fh;
      // Simétrica: janelas altas em vãos iguais, a porta no meio.
      const n = Math.max(3, Math.floor(len / 2.8) | 1);
      spread(len, n, 1.3, 0.8).forEach(([a, b], i) => {
        if (side === 0 && fl === 0 && i === (n - 1) / 2) addDoor(L, f, a - 0.2, b + 0.2, y, y + 2.7, "wood", col("#4a2c1a"));
        else if (side === 0 || r() < 0.6) addWindow(L, f, a, b, y + 0.8, y + 2.7, style);
      });
    }
  });
  m.grime = 0;
  // Cornija entre andares e embaixo do telhado.
  for (const y of [L.floor + fh, top]) m.box(M.plaster, trim, -w / 2 - 0.12, w / 2 + 0.12, y - 0.15, y + 0.1, cz - d / 2 - 0.12, cz + d / 2 + 0.12, BOX.bottom);
  // Pórtico de colunas na frente, com a sacada em cima.
  const z0 = cz + d / 2;
  const out = Math.min(2.4, L.d / 2 - z0 - 0.3);
  if (out > 1.2) {
    const pw = Math.min(6, w * 0.45);
    const y = L.floor + fh;
    m.box(M.concrete, trim, -pw / 2, pw / 2, y - 0.35, y, z0, z0 + out);
    for (let i = 0; i < 4; i++) {
      const x = -pw / 2 + 0.3 + ((pw - 0.6) * i) / 3;
      m.cylinder(M.plaster, trim, x, z0 + out - 0.3, L.floor, y - 0.35, 0.2, 0.17, 10, false);
      m.box(M.plaster, trim, x - 0.26, x + 0.26, y - 0.5, y - 0.35, z0 + out - 0.56, z0 + out - 0.04);
      m.box(M.plaster, trim, x - 0.26, x + 0.26, L.floor, L.floor + 0.2, z0 + out - 0.56, z0 + out - 0.04);
    }
    // Balaústre da sacada.
    m.box(M.plaster, trim, -pw / 2, pw / 2, y + 0.85, y + 0.98, z0 + out - 0.2, z0 + out);
    for (let x = -pw / 2 + 0.1; x < pw / 2; x += 0.22) m.cylinder(M.plaster, trim, x, z0 + out - 0.1, y, y + 0.85, 0.06, 0.05, 6, false);
    m.box(M.concrete, col("#c9c2b4"), -pw / 2 - 0.3, pw / 2 + 0.3, L.floor - 0.1, L.floor + 0.1, z0, z0 + out + 0.4);
  }
  // Telhado de quatro águas escuro (ardósia), com mansardas às vezes.
  m.push(0, 0, cz, 0);
  const tile = col(pick(r, ["#7d8288", "#9aa0a6", "#ffffff", "#c9c2bc"]));
  const ridge = hipRoof(m, w, d, top, range(r, 0.5, 0.7), 0.6, tile, OFFWHITE);
  if (r() < 0.6) chimney(m, w / 2 - 1.5, -d / 4, top, ridge + 0.5, col("#e8d8c8"));
  m.pop();
  m.box(M.concrete, col("#5f8a3a"), -L.w / 2 + 0.2, L.w / 2 - 0.2, L.floor - 0.25, L.floor - 0.02, z0, L.d / 2 - 0.2, BOX.bottom);
  frontWall(L, wallCol, [-L.w / 2 + 0.6, -L.w / 2 + 4.0], r() < 0.5 ? "grade" : "alto");
}

// --- Roça do Milho: casa de sítio com varanda em volta, e celeiro --------------------

export function farmHouse(L: Lot) {
  const { m, random: r } = L;
  const porch = 2.0;
  const w = L.w - porch * 2;
  const d = L.d - porch * 2;
  const wallCol = L.tone;
  const trimCol = col(pick(r, ["#1d4e89", "#2e6f40", "#7a1f1f", "#3a7d7c"]));
  const fh = Math.max(3.0, L.height * 0.7);
  const top = L.floor + fh;
  const style = plainWindow({ frame: trimCol, shutters: trimCol, sill: null, trim: null, panes: 2, litChance: 0.3 });
  plinth(L, 0, 0, L.w, L.d, col("#a8653a"), L.floor);
  // Piso da varanda (lajota vermelha).
  m.box(M.concrete, col("#a8653a"), -L.w / 2, L.w / 2, L.floor - 0.05, L.floor + 0.02, -L.d / 2, L.d / 2, BOX.bottom);
  m.grime = 0.15;
  m.grimeFloor = L.groundY + L.floor;
  walls(L, 0, 0, w, d, L.floor, top, M.plaster, wallCol, (side, len, f) => {
    const n = Math.max(1, Math.floor(len / 2.6));
    spread(len, n, 1.1, 0.6).forEach(([a, b], i) => {
      if (side === 0 && i === Math.floor(n / 2)) addDoor(L, f, a - 0.1, b + 0.1, L.floor, L.floor + 2.2, "wood", trimCol);
      else addWindow(L, f, a, b, L.floor + 0.95, L.floor + 2.15, style);
    });
  });
  m.grime = 0;
  // Esteios de madeira da varanda e o telhado grande cobrindo tudo.
  const postCol = col("#7a5232");
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1], [0, -1]]) {
    const x = (sx * (L.w - 0.3)) / 2;
    const z = (sz * (L.d - 0.3)) / 2;
    m.box(M.wood, postCol, x - 0.1, x + 0.1, L.floor, top, z - 0.1, z + 0.1, BOX.bottom);
  }
  // Guarda-corpo de madeira na frente.
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -L.w / 2 + 0.2 : 0.8;
    const x1 = s < 0 ? -0.8 : L.w / 2 - 0.2;
    m.box(M.wood, postCol, x0, x1, L.floor + 0.85, L.floor + 0.95, L.d / 2 - 0.2, L.d / 2 - 0.1);
    m.box(M.wood, postCol, x0, x1, L.floor + 0.4, L.floor + 0.48, L.d / 2 - 0.2, L.d / 2 - 0.1);
  }
  const tile = vary(r, col(pick(r, TILES)), 0.05);
  const ridge = hipRoof(m, L.w, L.d, top, range(r, 0.42, 0.52), 0.5, tile, col("#c9a27a"));
  if (r() < 0.6) chimney(m, w / 2 - 0.6, -d / 4, top - 0.2, ridge + 0.4, WHITE);
}

/** Celeiro de madeira vermelha (com o X branco nas portas) ou galpão de sítio. */
export function barn(L: Lot) {
  const { m, random: r } = L;
  const red = L.tone;
  const white = OFFWHITE;
  const wallH = Math.max(3.5, L.height * 0.55);
  const top = L.floor + wallH;
  const w = L.w - 0.4;
  const d = L.d - 0.4;
  plinth(L, 0, 0, w, d, col("#8d8a85"));
  // Paredes de tábua (o oitão, em cima, é a empena do telhado holandês).
  walls(L, 0, 0, w, d, L.floor, top, M.wood, red, (side, len, f) => {
    if (side === 0) {
      const dw = Math.min(4, len * 0.45);
      const h = { x0: len / 2 - dw / 2, x1: len / 2 + dw / 2, y0: L.floor, y1: L.floor + Math.min(3.3, wallH - 0.2) };
      f.add(h, () => {
        // Portas de correr com o X branco.
        m.front(M.wood, red, h.x0, h.x1, h.y0, h.y1, -0.05);
        for (const [a, b] of [[h.x0, (h.x0 + h.x1) / 2], [(h.x0 + h.x1) / 2, h.x1]]) {
          m.box(M.wood, white, a, b, h.y0, h.y0 + 0.14, -0.05, 0.02, BOX.back);
          m.box(M.wood, white, a, b, h.y1 - 0.14, h.y1, -0.05, 0.02, BOX.back);
          m.box(M.wood, white, a, a + 0.14, h.y0, h.y1, -0.05, 0.02, BOX.back);
          m.box(M.wood, white, b - 0.14, b, h.y0, h.y1, -0.05, 0.02, BOX.back);
          m.bar(M.wood, white, a + 0.1, h.y0 + 0.1, 0.0, b - 0.1, h.y1 - 0.1, 0.0, 0.12);
          m.bar(M.wood, white, a + 0.1, h.y1 - 0.1, 0.01, b - 0.1, h.y0 + 0.1, 0.01, 0.12);
        }
      });
    } else if (side !== 2) {
      for (const [a, b] of spread(len, Math.floor(len / 3.5), 0.8)) addWindow(L, f, a, b, L.floor + 1.6, L.floor + 2.4, plainWindow({ frame: white, sill: null, panes: 1, litChance: 0.1 }));
    }
  });
  // Cantoneiras brancas.
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = (sx * w) / 2;
    const z = (sz * d) / 2;
    m.box(M.wood, white, x - 0.1, x + 0.1, L.floor, top, z - 0.1, z + 0.1, BOX.bottom | BOX.top);
  }
  // Telhado holandês (duas caídas de cada lado), cumeeira ao longo de z (empena para a rua).
  const hw = w / 2 + 0.35;
  const yKnee = top + w * 0.28;
  const yTop = yKnee + w * 0.16;
  const kx = w * 0.27;
  const roofCol = vary(r, col(pick(r, ["#5a5f63", "#7a7f83", "#8a3a2a"])), 0.06);
  const z0 = -d / 2 - 0.35;
  const z1 = d / 2 + 0.35;
  const seg = (xa: number, ya: number, xb: number, yb: number) => {
    // Água de xa (mais baixo) a xb, ao longo de z.
    const len = Math.hypot(xb - xa, yb - ya);
    if (xa > 0) m.quad(M.metal, roofCol, xa, ya, z1, xa, ya, z0, xb, yb, z0, xb, yb, z1, [0, 0, z1 - z0, len]);
    else m.quad(M.metal, roofCol, xa, ya, z0, xa, ya, z1, xb, yb, z1, xb, yb, z0, [0, 0, z1 - z0, len]);
  };
  seg(hw, top - 0.2, kx, yKnee);
  seg(kx, yKnee, 0, yTop);
  seg(-hw, top - 0.2, -kx, yKnee);
  seg(-kx, yKnee, 0, yTop);
  // Empenas de tábua (frente e fundo).
  for (const [z, s] of [[d / 2, 1], [-d / 2, -1]] as const) {
    m.push(0, 0, z, s > 0 ? 0 : Math.PI);
    m.quad(M.wood, red, -w / 2, top, 0, w / 2, top, 0, kx * 0.95, yKnee, 0, -kx * 0.95, yKnee, 0);
    m.tri(M.wood, red, -kx * 0.95, yKnee, 0, kx * 0.95, yKnee, 0, 0, yTop - 0.05, 0);
    // Portinhola do feno.
    m.box(M.wood, white, -0.7, 0.7, yKnee - 1.1, yKnee + 0.3, 0, 0.05, BOX.back);
    m.front(M.wood, shade(red, 0.8), -0.58, 0.58, yKnee - 0.98, yKnee + 0.18, 0.06);
    m.pop();
  }
  // Por baixo das abas (para não ver através quando se olha de baixo).
  m.quad(M.wood, shade(red, 0.5), hw, top - 0.25, z0, hw, top - 0.25, z1, w / 2, top - 0.05, z1, w / 2, top - 0.05, z0);
  m.quad(M.wood, shade(red, 0.5), -hw, top - 0.25, z1, -hw, top - 0.25, z0, -w / 2, top - 0.05, z0, -w / 2, top - 0.05, z1);
}

// --- Praia da Batata Frita: quiosques -------------------------------------------------

export function kiosk(L: Lot) {
  const { m, random: r } = L;
  const color = L.tone;
  const w = L.w - 0.6;
  const d = L.d - 0.6;
  const top = L.floor + 2.7;
  plinth(L, 0, 0, w, d, col("#cbb994"));
  // Base de alvenaria com o balcão aberto na frente e nas laterais.
  walls(L, 0, 0, w, d, L.floor, top, M.plaster, color, (side, len, f) => {
    if (side === 2) {
      addDoor(L, f, len - 1.2, len - 0.4, L.floor, L.floor + 2.1, "iron", col("#40464d"));
      return;
    }
    const h = { x0: 0.4, x1: len - 0.4, y0: L.floor + 1.05, y1: top - 0.3 };
    f.add(h, () => {
      // Interior aceso (cozinha) e o balcão de inox.
      pane(m, r, h.x0, h.x1, h.y0, h.y1, -0.9, 0.85, col("#666666"));
      m.box(M.paint, col("#d6d8da"), h.x0 - 0.1, h.x1 + 0.1, h.y0 - 0.05, h.y0 + 0.04, -0.4, 0.35);
    });
  });
  // Telhado de palha/telha de quatro águas, com beiral largo.
  const eave = L.clear(0, L.d / 2 + 1.1) ? 1.0 : 0.5;
  const thatch = r() < 0.5;
  const ridge = hipRoof(m, w, d, top, 0.75, eave, thatch ? col("#d9b26f") : vary(r, col(pick(r, TILES))), col("#b98b55"), thatch ? M.wood : M.tile);
  // Letreiro no alto e a batata gigante.
  signBoard(m, 31, -1.8, 1.8, top - 0.05 + 0.1, 0.45, 0.2);
  if (r() < 0.5) {
    m.push(0, 0, d / 2 + 0.25, 0);
    signBoard(m, 31, -1.8, 1.8, top - 0.25, 0.45, 0.05);
    m.pop();
  }
  if (r() < 0.6) {
    const fries = col("#ffd23f");
    for (let i = 0; i < 5; i++) m.box(M.paint, fries, -0.3 + i * 0.13, -0.22 + i * 0.13, ridge, ridge + 0.6 + (i % 2) * 0.25, -0.05, 0.05);
    m.box(M.paint, col("#e63946"), -0.4, 0.4, ridge - 0.1, ridge + 0.35, -0.2, 0.2);
  }
  // Guarda-sol e mesinhas na frente, dentro do lote.
}

/** Casa genérica (bairros sem estilo próprio): térrea ou sobrado colonial. */
export function genericHouse(L: Lot) {
  const r = L.random;
  const floors = L.height > 5.5 ? 2 : 1;
  const d = L.d - 1;
  house(L, {
    cx: 0,
    cz: -0.5,
    w: L.w - 0.6,
    d,
    wall: L.tone,
    floors,
    floorH: floors === 2 ? L.height / 2 : Math.max(3, L.height * 0.7),
    roof: L.pitched ? "colonial" : "platibanda",
    window: houseWindow(r),
    door: col(pick(r, DOORS)),
    doorAt: r(),
    garage: false,
    balcony: floors === 2 && r() < 0.5,
    chimney: r() < 0.2,
    porch: r() < 0.4,
  });
}

