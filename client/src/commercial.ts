// Lojas, escritórios, torres, galpões, hangares e contêineres (versão detalhada).
// Mesmo jeito das casas (houses.ts): cada um sai sempre igual pela semente do
// lote, e o corpo fica dentro da caixa do mapa (a colisão).
import { BOX, rgb, shade, type Rgb } from "./mesher.ts";
import { M, litUv } from "./building-materials.ts";
import {
  ALUMINUM, DARK, OFFWHITE, WHITE,
  airConditioner, antenna, awning, doorIn, onWall, pane, parapet, pick, plainWindow, range, rollerDoor,
  signBoard, slab, spread, wall, waterTank, windowIn,
  type Hole, type Lot, type Random,
} from "./building-kit.ts";

const col = (hex: string) => rgb(hex);
const vary = (random: Random, c: Rgb, spread = 0.08): Rgb => shade(c, 1 - spread + random() * spread * 2);

/** Paredes de uma caixa com vãos (igual ao das casas, mas aqui cada lado desenha o que quiser depois). */
function box4(L: Lot, cx: number, cz: number, w: number, d: number, y0: number, y1: number, mat: number, color: Rgb, sides: (side: number, len: number) => { holes: Hole[]; fill?: () => void } | null) {
  for (let side = 0; side < 4; side++) {
    onWall(L.m, w, d, side, (len) => {
      const out = sides(side, len);
      wall(L.m, mat, color, len, y0, y1, out?.holes ?? []);
      out?.fill?.();
    }, cx, cz);
  }
}

function plinth(L: Lot, cx: number, cz: number, w: number, d: number, color: Rgb, top = L.floor) {
  if (top - L.base < 0.05) return;
  L.m.box(M.concrete, color, cx - w / 2 - 0.03, cx + w / 2 + 0.03, L.base, top, cz - d / 2 - 0.03, cz + d / 2 + 0.03, BOX.bottom);
}

/**
 * Fileira de vidraças ao longo de uma parede, de x0 a x1, entre y0 e y1:
 * as apagadas juntas num quadrilátero só (UV repetindo por vidraça), as acesas
 * uma a uma (cada uma com uma cena do atlas).
 */
function glassRow(L: Lot, x0: number, x1: number, y0: number, y1: number, z: number, panel: number, litChance: number, tint: Rgb) {
  const { m, random: r } = L;
  const n = Math.max(1, Math.round((x1 - x0) / panel));
  const pw = (x1 - x0) / n;
  let run = 0;
  const flush = (end: number) => {
    if (end > run) m.front(M.glass, tint, x0 + run * pw, x0 + end * pw, y0, y1, z, [0, 0, end - run, 1]);
  };
  for (let i = 0; i < n; i++) {
    if (r() < litChance) {
      flush(i);
      m.front(M.lit, WHITE, x0 + i * pw, x0 + (i + 1) * pw, y0, y1, z, litUv(Math.floor(r() * 16)));
      run = i + 1;
    }
  }
  flush(n);
}

// --- Lojas -------------------------------------------------------------------------

export const SHOP_WALLS = ["#f1e3c6", "#e8d2b0", "#d9e4dc", "#f3d6c8", "#e9c46a", "#f4a261", "#a8d5c2", "#f7f3ea", "#c9b8e8", "#ffd6a5"];
const AWNINGS = ["#c1121f", "#2a9d8f", "#f4a261", "#1d3557", "#ffb703", "#6a994e", "#e76f51", "#3a86ff"];

export function shop(L: Lot) {
  const { m, random: r } = L;
  const asian = L.district === "liberdade";
  const groundH = range(r, 3.6, 4.2);
  const upper = Math.max(0, Math.floor((L.height - groundH + 0.6) / 2.9));
  const top = L.floor + groundH + upper * 2.9;
  const w = L.w - 0.3;
  const d = L.d - 0.3;
  const wallCol = L.tone;
  const pillarCol = r() < 0.5 ? OFFWHITE : shade(wallCol, 0.8);
  const bays = Math.max(1, Math.round(w / range(r, 3.2, 4.5)));
  const bw = w / bays;
  const yG = L.floor + groundH;
  plinth(L, 0, 0, w, d, col("#9c978e"));
  m.grime = 0.2;
  m.grimeFloor = L.groundY + L.floor;
  const style = plainWindow({ frame: r() < 0.5 ? ALUMINUM : WHITE, sill: OFFWHITE, bars: r() < 0.3, litChance: 0.3, panes: 2 });
  box4(L, 0, 0, w, d, L.floor, top, M.plaster, wallCol, (side, len) => {
    const holes: Hole[] = [];
    const fills: (() => void)[] = [];
    if (side === 0) {
      for (let i = 0; i < bays; i++) {
        const h = { x0: i * bw + 0.25, x1: (i + 1) * bw - 0.25, y0: L.floor, y1: yG - 0.9 };
        holes.push(h);
        const kind = r();
        fills.push(() => {
          if (kind < 0.55) rollerDoor(m, r, h, vary(r, col(pick(r, ["#c9ccd0", "#b5b8bb", "#8a9096", "#d9d4c7"])), 0.05), pick(r, [1, 1, 0.85, 0.6, 0]), 0.75);
          else {
            // Vitrine com porta de vidro.
            pane(m, r, h.x0, h.x1, h.y0 + 0.4, h.y1, -0.15, 0.7, col("#4a4f55"));
            m.box(M.paint, DARK, h.x0, h.x1, h.y0, h.y0 + 0.4, -0.15, -0.05, BOX.back);
            const mid = (h.x0 + h.x1) / 2;
            for (const x of [h.x0 + 0.03, mid, h.x1 - 0.03]) m.box(M.paint, DARK, x - 0.03, x + 0.03, h.y0, h.y1, -0.15, -0.08, BOX.back | BOX.top);
            m.box(M.paint, DARK, h.x0, h.x1, h.y1 - 0.05, h.y1, -0.15, -0.08, BOX.back);
          }
        });
      }
      for (let fl = 0; fl < upper; fl++) {
        const y = yG + fl * 2.9;
        for (const [a, b] of spread(len, Math.max(1, Math.floor(len / 2.6)), 1.3, 0.6)) {
          const h = { x0: a, x1: b, y0: y + 0.9, y1: y + 2.2 };
          holes.push(h);
          fills.push(() => {
            windowIn(m, r, h, style);
            if (r() < 0.35) airConditioner(m, (a + b) / 2, y + 0.35);
          });
        }
      }
    } else if (side === 2) {
      for (let fl = 0; fl < upper; fl++) {
        const y = yG + fl * 2.9;
        for (const [a, b] of spread(len, Math.floor(len / 4), 1.0)) {
          const h = { x0: a, x1: b, y0: y + 1.1, y1: y + 2.0 };
          holes.push(h);
          fills.push(() => windowIn(m, r, h, style));
        }
      }
    }
    return { holes, fill: () => fills.forEach((f) => f()) };
  });
  m.grime = 0;
  // Pilares entre as portas e a faixa do letreiro.
  onWall(m, w, d, 0, (len) => {
    for (let i = 0; i <= bays; i++) {
      const x = Math.min(len - 0.15, Math.max(0.15, i * bw));
      m.box(M.plaster, pillarCol, x - 0.25, x + 0.25, L.floor, yG - 0.9, 0, 0.08, BOX.bottom);
    }
    const signIndex = asian ? 20 + Math.floor(r() * 6) : Math.floor(r() * 20);
    if (r() < 0.75) signBoard(m, signIndex, 0.4, len - 0.4, yG - 0.85, Math.min(0.75, (len - 0.8) / 8), 0.15);
    else m.box(M.plaster, shade(wallCol, 0.85), 0, len, yG - 0.9, yG, 0, 0.1);
    // Toldo listrado (se não for cair em cima da rua).
    if (r() < 0.65 && L.clear(len / 2 - w / 2, d / 2 + 1.3)) {
      const a = col(pick(r, AWNINGS));
      awning(m, 0.3, len - 0.3, yG - 0.95, 1.2, a, r() < 0.6 ? OFFWHITE : null);
    }
    // Lanternas vermelhas (Liberdade) e letreiro em pé.
    if (asian) {
      for (let i = 0; i < bays; i++) {
        const x = (i + 0.5) * bw;
        m.cylinder(M.lit, WHITE, x, 0.5, yG - 1.6, yG - 1.1, 0.18, 0.18, 8);
        m.cylinder(M.paint, col("#c1121f"), x, 0.5, yG - 1.62, yG - 1.08, 0.2, 0.2, 8, false);
      }
      // Placa de bandeira (perpendicular à fachada), para quem vem pela rua.
      if (upper > 0 && L.clear(len - 0.6 - w / 2, d / 2 + 1.9)) {
        m.push(len - 0.5, 0, 0.9, Math.PI / 2);
        signBoard(m, 20 + Math.floor(r() * 6), -0.8, 0.8, yG + 0.6, 0.2, 0.04, col("#c1121f"));
        m.push(0, 0, 0, Math.PI);
        signBoard(m, 20 + Math.floor(r() * 6), -0.8, 0.8, yG + 0.6, 0.2, 0.04, col("#c1121f"));
        m.pop();
        m.pop();
      }
    }
  });
  // Faixa entre os andares e platibanda.
  for (let fl = 1; fl < upper; fl++) {
    const y = yG + fl * 2.9;
    m.box(M.plaster, shade(wallCol, 0.9), -w / 2 - 0.04, w / 2 + 0.04, y - 0.08, y + 0.06, -d / 2 - 0.04, d / 2 + 0.04, BOX.bottom);
  }
  slab(m, -w / 2, w / 2, -d / 2, d / 2, top + 0.05, col("#8f8b84"), 0.05);
  parapet(m, w, d, top, range(r, 0.5, 1.0), wallCol, M.plaster, 0.15, OFFWHITE);
  if (r() < 0.7) waterTank(m, range(r, -w / 4, w / 4), -d / 4, top + 0.05, 1);
  if (r() < 0.3) antenna(m, w / 2 - 0.6, -d / 2 + 0.6, top, 2.5);
}

// --- Escritórios ---------------------------------------------------------------------

export const OFFICE_WALLS = ["#d6d0c4", "#bfb6a8", "#a89f91", "#c9c5bd", "#e0d8c8", "#8f8a82", "#b4a99a", "#d8c3a5", "#9fa6ad"];
const GLASS_TINTS = ["#7d8c9c", "#6f8d9a", "#5f7f8b", "#8b8270", "#76808b", "#60768e", "#7e9a92"];

export function office(L: Lot) {
  const { m, random: r } = L;
  const w = L.w - 0.4;
  const d = L.d - 0.4;
  const fh = 3.1;
  const lobbyH = 4.5;
  const floors = Math.max(2, Math.floor((L.height - lobbyH) / fh));
  const top = L.floor + lobbyH + floors * fh;
  const wallCol = L.tone;
  const tint = vary(r, col(pick(r, GLASS_TINTS)), 0.05);
  const style = r() < 0.4 ? "ribbon" : r() < 0.6 ? "punched" : "brise";
  const lit = range(r, 0.12, 0.3);
  plinth(L, 0, 0, w, d, col("#6f6c66"));
  // Térreo de vidro, recuado atrás de pilares.
  const yL = L.floor + lobbyH;
  const inset = 1.2;
  box4(L, 0, 0, w - inset * 2, d - inset * 2, L.floor, yL, M.concrete, shade(wallCol, 0.8), (side, len) => ({
    holes: [{ x0: 0.3, x1: len - 0.3, y0: L.floor, y1: yL - 0.4 }],
    fill: () => {
      glassRow(L, 0.3, len - 0.3, L.floor, yL - 0.4, -0.05, 2.0, side === 0 ? 0.8 : 0.4, tint);
      for (let x = 0.3; x <= len - 0.29; x += (len - 0.6) / Math.max(1, Math.round((len - 0.6) / 2))) m.box(M.paint, DARK, x - 0.04, x + 0.04, L.floor, yL - 0.4, -0.05, 0.02, BOX.back);
      if (side === 0) doorIn(m, r, { x0: len / 2 - 1, x1: len / 2 + 1, y0: L.floor, y1: L.floor + 2.6 }, "glass", DARK);
    },
  }));
  // Pilares e a laje do primeiro andar.
  const cols = Math.max(2, Math.round(w / 6));
  for (let i = 0; i <= cols; i++) {
    const x = -w / 2 + 0.4 + ((w - 0.8) * i) / cols;
    for (const z of [d / 2 - 0.4, -d / 2 + 0.4]) m.box(M.concrete, wallCol, x - 0.3, x + 0.3, L.base, yL, z - 0.3, z + 0.3, BOX.bottom);
  }
  // Marquise na entrada.
  if (L.clear(0, d / 2 + 2)) m.box(M.concrete, OFFWHITE, -2.5, 2.5, yL - 0.9, yL - 0.7, d / 2 - inset, d / 2 + 1.6);

  // Andares: fita de janela, janelas soltas ou brises.
  const yb = yL;
  m.grime = 0;
  if (style === "punched") {
    const sty = plainWindow({ frame: col(pick(r, ["#c9ccd0", "#2b2b2e", "#f4f4f2"])), sill: OFFWHITE, panes: 2, litChance: lit, depth: 0.18 });
    const lite = { ...sty, lite: true };
    const ww = range(r, 1.4, 1.9);
    box4(L, 0, 0, w, d, yb, top, M.plaster, wallCol, (side, len) => {
      const holes: Hole[] = [];
      const n = Math.max(1, Math.floor(len / range(r, 2.6, 3.2)));
      const spots = spread(len, n, ww, 0.8);
      for (let fl = 0; fl < floors; fl++) for (const [a, b] of spots) holes.push({ x0: a, x1: b, y0: yb + fl * fh + 0.9, y1: yb + fl * fh + 2.5 });
      return {
        holes,
        fill: () => {
          for (const h of holes) {
            // Do terceiro andar para cima, janela leve (de longe ninguém vê o caixilho).
            windowIn(m, r, h, h.y0 > yb + 2 * fh ? lite : sty);
            if (r() < 0.18) airConditioner(m, (h.x0 + h.x1) / 2, h.y0 - 0.55, 0.4);
          }
        },
      };
    });
  } else {
    // Fita: um vão contínuo por andar em cada lado, com a faixa (peitoril) de concreto.
    const sill = 0.9;
    const head = 0.45;
    box4(L, 0, 0, w, d, yb, top, style === "brise" ? M.concrete : M.plaster, wallCol, (side, len) => {
      const holes: Hole[] = [];
      for (let fl = 0; fl < floors; fl++) holes.push({ x0: 0.5, x1: len - 0.5, y0: yb + fl * fh + sill, y1: yb + (fl + 1) * fh - head });
      return {
        holes,
        fill: () => {
          for (const h of holes) {
            glassRow(L, h.x0, h.x1, h.y0, h.y1, -0.15, 1.5, lit, tint);
            // Montantes.
            const n = Math.max(1, Math.round((h.x1 - h.x0) / 1.5));
            for (let i = 1; i < n; i++) {
              const x = h.x0 + ((h.x1 - h.x0) * i) / n;
              m.box(M.paint, ALUMINUM, x - 0.03, x + 0.03, h.y0, h.y1, -0.15, -0.1, BOX.back | BOX.top | BOX.bottom);
            }
          }
          if (style === "brise") {
            // Brises verticais (lâminas) na frente da fachada toda.
            const fins = Math.max(2, Math.round(len / 1.2));
            const finCol = col(pick(r, ["#e9e5dc", "#8f8a82", "#c58b5a", "#3d3c3a"]));
            for (let i = 0; i <= fins; i++) {
              const x = 0.3 + ((len - 0.6) * i) / fins;
              m.box(M.paint, finCol, x - 0.05, x + 0.05, yb, top - 0.3, 0, 0.6, BOX.back);
            }
          }
        },
      };
    });
  }
  // Faixa (friso) entre os andares.
  if (style !== "brise") {
    for (let fl = 1; fl <= floors; fl += style === "ribbon" ? 1 : 3) {
      const y = yb + fl * fh;
      m.box(M.concrete, shade(wallCol, 1.05), -w / 2 - 0.06, w / 2 + 0.06, y - 0.12, y + 0.04, -d / 2 - 0.06, d / 2 + 0.06, BOX.bottom);
    }
  }
  rooftop(L, w, d, top, wallCol);
}

/** Cobertura: platibanda, casa de máquinas, caixa-d'água de concreto, antenas, condensadoras. */
function rooftop(L: Lot, w: number, d: number, top: number, wallCol: Rgb) {
  const { m, random: r } = L;
  slab(m, -w / 2, w / 2, -d / 2, d / 2, top + 0.05, col("#7f7c76"), 0.08);
  parapet(m, w, d, top, range(r, 0.9, 1.3), wallCol, M.plaster, 0.2, OFFWHITE);
  // Casa de máquinas (elevador) e caixa-d'água em cima dela.
  const mw = Math.min(w * 0.4, range(r, 4, 7));
  const md = Math.min(d * 0.4, range(r, 4, 6));
  const mx = range(r, -w / 2 + mw / 2 + 1, w / 2 - mw / 2 - 1);
  const mz = range(r, -d / 2 + md / 2 + 1, d / 2 - md / 2 - 1);
  m.box(M.plaster, shade(wallCol, 0.95), mx - mw / 2, mx + mw / 2, top, top + 3.2, mz - md / 2, mz + md / 2);
  m.box(M.concrete, col("#a19d95"), mx - mw / 2 + 0.3, mx + mw / 2 - 0.3, top + 3.2, top + 5.0, mz - md / 2 + 0.3, mz + md / 2 - 0.3);
  m.box(M.metal, col("#9aa0a6"), mx - mw / 2 + 0.5, mx - mw / 2 + 1.5, top + 0.8, top + 2.2, mz + md / 2, mz + md / 2 + 0.05, BOX.back);
  // Condensadoras de ar-condicionado e antenas.
  const units = Math.floor(range(r, 1, 5));
  for (let i = 0; i < units; i++) {
    const x = range(r, -w / 2 + 1.2, w / 2 - 1.2);
    const z = range(r, -d / 2 + 1.2, d / 2 - 1.2);
    if (Math.abs(x - mx) < mw / 2 + 1 && Math.abs(z - mz) < md / 2 + 1) continue;
    m.box(M.paint, col("#d9dad6"), x - 0.5, x + 0.5, top + 0.05, top + 0.9, z - 0.35, z + 0.35);
    m.cylinder(M.paint, col("#555555"), x, z, top + 0.9, top + 0.92, 0.32, 0.32, 8);
  }
  if (r() < 0.7) antenna(m, mx + mw / 2 - 0.4, mz, top + 5.0, range(r, 3, 7));
  if (r() < 0.3) m.bar(M.paint, col("#c1121f"), mx - mw / 2 + 0.3, top + 5, mz, mx - mw / 2 + 0.3, top + 5 + range(r, 6, 12), mz, 0.12);
}

// --- Torres -------------------------------------------------------------------------

export const TOWER_TINTS = ["#6f8aa3", "#5f8a85", "#b09a78", "#97a6b3", "#4f6f8f", "#7d939f", "#88a49a", "#a9b4bd"];
const TOWER_FRAMES = ["#2b2e33", "#c9ccd0", "#8a8f94", "#3a3d42", "#d9d4c7"];

export function tower(L: Lot) {
  const { m, random: r } = L;
  const fh = 3.3;
  const tint = L.tone;
  const frame = col(pick(r, TOWER_FRAMES));
  const stone = vary(r, col(pick(r, ["#c9c2b4", "#8d8a85", "#d6d0c4", "#5b5852", "#e0d8c8"])), 0.04);
  const lit = range(r, 0.12, 0.3);
  // Pódio (térreo + 2 andares) ocupando a caixa; a torre recuada em cima.
  const podiumFloors = 2;
  const lobbyH = 6;
  const yP = L.floor + lobbyH + podiumFloors * fh;
  const w = L.w - 0.4;
  const d = L.d - 0.4;
  const set = Math.min(2.5, Math.min(w, d) * 0.12);
  const tw = w - set * 2;
  const td = d - set * 2;
  const total = L.floor + L.height;
  const crown = r() < 0.5 ? 2 : 0;
  const shaftFloors = Math.max(4, Math.floor((total - yP) / fh) - crown);
  const yT = yP + shaftFloors * fh;
  plinth(L, 0, 0, w, d, stone);

  // Térreo de vidro alto entre pilares de pedra.
  box4(L, 0, 0, w, d, L.floor, yP, M.concrete, stone, (side, len) => {
    const holes: Hole[] = [{ x0: 0.8, x1: len - 0.8, y0: L.floor, y1: L.floor + lobbyH - 0.6 }];
    for (let fl = 0; fl < podiumFloors; fl++) holes.push({ x0: 0.8, x1: len - 0.8, y0: L.floor + lobbyH + fl * fh + 0.8, y1: L.floor + lobbyH + (fl + 1) * fh - 0.3 });
    return {
      holes,
      fill: () => {
        const h = holes[0];
        glassRow(L, h.x0, h.x1, h.y0, h.y1, -0.25, 2.2, side === 0 ? 0.7 : 0.35, tint);
        for (let i = 0, n = Math.max(2, Math.round((h.x1 - h.x0) / 4.5)); i <= n; i++) {
          const x = h.x0 + ((h.x1 - h.x0) * i) / n;
          m.box(M.concrete, stone, x - 0.35, x + 0.35, h.y0, h.y1, -0.25, 0.05, BOX.back);
        }
        for (let k = 1; k < holes.length; k++) glassRow(L, holes[k].x0, holes[k].x1, holes[k].y0, holes[k].y1, -0.12, 1.5, lit, tint);
        if (side === 0) doorIn(m, r, { x0: len / 2 - 1.2, x1: len / 2 + 1.2, y0: L.floor, y1: L.floor + 3 }, "glass", frame);
      },
    };
  });
  // Laje do pódio (terraço) com mureta.
  slab(m, -w / 2, w / 2, -d / 2, d / 2, yP + 0.05, col("#8d8a85"), 0.1);
  parapet(m, w, d, yP, 1.1, stone, M.concrete, 0.2, OFFWHITE);
  if (L.clear(0, d / 2 + 3)) m.box(M.concrete, OFFWHITE, -4, 4, L.floor + lobbyH - 0.6, L.floor + lobbyH - 0.3, d / 2, d / 2 + 2.5);

  // Corpo da torre: pele de vidro (andar por andar) e faixas.
  const glassStyle = r() < 0.55 ? "skin" : "bands";
  const panel = range(r, 1.3, 1.8);
  for (let side = 0; side < 4; side++) {
    onWall(m, tw, td, side, (len) => {
      for (let fl = 0; fl < shaftFloors; fl++) {
        const y = yP + fl * fh;
        if (glassStyle === "skin") glassRow(L, 0, len, y + 0.25, y + fh, 0, panel, lit, tint);
        else {
          glassRow(L, 0, len, y + 0.9, y + fh - 0.2, -0.1, panel, lit, tint);
          m.front(M.concrete, stone, 0, len, y, y + 0.9, 0);
          m.front(M.concrete, stone, 0, len, y + fh - 0.2, y + fh, 0);
        }
      }
      // Quinas (pilares de canto) cobrindo a emenda das faces.
      m.box(M.paint, frame, -0.15, 0.25, yP, yT, -0.3, 0.12, BOX.bottom | BOX.top);
    });
  }
  // Faixa de cada andar (caixilho horizontal) e os montantes de cima a baixo.
  for (let fl = 0; fl <= shaftFloors; fl += glassStyle === "skin" ? 1 : 1) {
    const y = yP + fl * fh;
    m.box(M.paint, frame, -tw / 2 - 0.06, tw / 2 + 0.06, y, y + 0.25, -td / 2 - 0.06, td / 2 + 0.06, BOX.bottom | (fl < shaftFloors ? BOX.top : 0));
  }
  if (glassStyle === "skin") {
    for (let side = 0; side < 4; side++) {
      onWall(m, tw, td, side, (len) => {
        const n = Math.max(1, Math.round(len / (panel * 2)));
        for (let i = 1; i < n; i++) {
          const x = (len * i) / n;
          m.box(M.paint, frame, x - 0.05, x + 0.05, yP, yT, 0, 0.12, BOX.back | BOX.bottom | BOX.top);
        }
      });
    }
  }
  // Coroamento: andares técnicos recuados, venezianas de metal, mastro.
  m.box(M.concrete, col("#7f7c76"), -tw / 2, tw / 2, yT - 0.1, yT + 0.1, -td / 2, td / 2);
  if (crown) {
    const cw = tw - 2;
    const cd = td - 2;
    for (let side = 0; side < 4; side++) {
      onWall(m, cw, cd, side, (len) => {
        m.quad(M.metal, col("#8a9096"), len, yT, 0, len, yT + crown * fh, 0, 0, yT + crown * fh, 0, 0, yT, 0, [0, 0, crown * fh, len]);
      });
    }
    m.box(M.paint, frame, -cw / 2 - 0.1, cw / 2 + 0.1, yT + crown * fh, yT + crown * fh + 0.5, -cd / 2 - 0.1, cd / 2 + 0.1, BOX.bottom);
  }
  parapet(m, tw, td, yT, 1.2, frame, M.paint, 0.2, null);
  const yTop = yT + crown * fh;
  if (r() < 0.6) {
    m.bar(M.paint, col("#b9bdbf"), 0, yTop, 0, 0, yTop + range(r, 8, 22), 0, 0.3);
    m.box(M.lit, WHITE, -0.25, 0.25, yTop + 1, yTop + 1.4, -0.25, 0.25);
  } else {
    // Heliponto.
    m.box(M.concrete, col("#5b5852"), -Math.min(7, tw / 2 - 1), Math.min(7, tw / 2 - 1), yTop + 0.5, yTop + 0.8, -Math.min(7, td / 2 - 1), Math.min(7, td / 2 - 1));
    m.box(M.paint, col("#ffd23f"), -1.5, 1.5, yTop + 0.8, yTop + 0.82, -0.25, 0.25);
    m.box(M.paint, col("#ffd23f"), -1.5, -1.0, yTop + 0.8, yTop + 0.82, -2, 2);
    m.box(M.paint, col("#ffd23f"), 1.0, 1.5, yTop + 0.8, yTop + 0.82, -2, 2);
  }
}

// --- Galpões e hangares ------------------------------------------------------------------

export const CLADDING = ["#d9dcdf", "#b9c1c8", "#8fa3b5", "#6f8a7a", "#c9b79c", "#e6e1d6", "#7d8794", "#4f6d8a", "#a6463a"];

export function warehouse(L: Lot) {
  const { m, random: r } = L;
  const hangar = L.district === "aeroporto";
  const dock = !hangar && L.d > 22 && r() < 0.5;
  const w = L.w - 0.4;
  const d = L.d - (dock ? 3 : 0.4);
  const cz = dock ? -1.3 : 0;
  const cladding = L.tone;
  const baseCol = col("#a9a69f");
  const wallH = hangar ? L.height * 0.75 : L.height * 0.85;
  const top = L.floor + wallH;
  const baseH = hangar ? 1 : range(r, 1.4, 2.4);
  const roofKind = hangar ? "arch" : pick(r, ["gable", "gable", "shed", "arch"] as const);
  const roofCol = vary(r, col(pick(r, ["#c8ccd0", "#aeb3b7", "#9aa3a8", "#d9d9d6"])), 0.05);
  plinth(L, 0, cz, w, d, baseCol);
  // Base de bloco de concreto e a chapa ondulada em cima.
  const doors = hangar ? 1 : Math.max(1, Math.min(4, Math.floor(w / range(r, 9, 14))));
  const doorW = hangar ? w * 0.8 : Math.min(5, w / doors - 2);
  const doorH = hangar ? wallH - 1.2 : Math.min(wallH - 1.5, range(r, 4, 5.5));
  const frontHoles = (len: number): Hole[] => {
    const out: Hole[] = [];
    for (const [a, b] of spread(len, doors, doorW, 1.2)) out.push({ x0: a, x1: b, y0: L.floor, y1: L.floor + doorH });
    return out;
  };
  m.grime = 0.25;
  m.grimeFloor = L.groundY + L.floor;
  for (let side = 0; side < 4; side++) {
    onWall(m, w, d, side, (len) => {
      const holes = side === 0 ? frontHoles(len) : [];
      // Porta de gente na frente e uma porta de enrolar no fundo, às vezes.
      if (side === 0 && !hangar) holes.push({ x0: len - 1.6, x1: len - 0.7, y0: L.floor, y1: L.floor + 2.1 });
      if (side === 2 && r() < 0.5) holes.push({ x0: len / 2 - 2, x1: len / 2 + 2, y0: L.floor, y1: L.floor + 4 });
      // Faixa de janelas altas (translúcidas) embaixo do beiral, nas laterais.
      const band = side % 2 === 1 && !hangar ? { x0: 1, x1: len - 1, y0: top - 1.6, y1: top - 0.6 } : null;
      if (band) holes.push(band);
      const lowHoles = holes.filter((h) => h.y0 < L.floor + baseH);
      wall(m, M.concrete, baseCol, len, L.floor, L.floor + baseH, lowHoles.map((h) => ({ ...h, y1: Math.min(h.y1, L.floor + baseH + 1) })));
      // Chapa ondulada: as ondas correm na vertical.
      wall(m, M.metal, cladding, len, L.floor + baseH, top, holes);
      // Rufo entre a base e a chapa.
      m.box(M.paint, shade(cladding, 0.8), 0, len, L.floor + baseH - 0.05, L.floor + baseH + 0.08, 0, 0.08, BOX.back);
      for (const h of holes) {
        if (h === band) {
          glassRow(L, h.x0, h.x1, h.y0, h.y1, -0.08, 2, 0.25, col("#9fb3bf"));
          continue;
        }
        if (h.x1 - h.x0 < 1.2) {
          doorIn(m, r, h, "iron", col(pick(r, ["#40464d", "#1d3557", "#c9a227"])));
          continue;
        }
        if (hangar) {
          // Portas de correr do hangar, uma parte aberta (lá dentro escuro, uma luz).
          const open = range(r, 0.2, 0.5);
          const gap = (h.x1 - h.x0) * open;
          const g0 = (h.x0 + h.x1) / 2 - gap / 2;
          pane(m, r, g0, g0 + gap, h.y0, h.y1, -3, 0.5, col("#3a3a3a"));
          m.quad(M.metal, shade(cladding, 0.9), h.x0, h.y0, -0.1, g0, h.y0, -0.1, g0, h.y1, -0.1, h.x0, h.y1, -0.1);
          m.quad(M.metal, shade(cladding, 0.9), g0 + gap, h.y0, -0.1, h.x1, h.y0, -0.1, h.x1, h.y1, -0.1, g0 + gap, h.y1, -0.1);
          m.box(M.paint, DARK, h.x0, h.x1, h.y1, h.y1 + 0.5, -0.2, 0.2, BOX.back);
        } else {
          rollerDoor(m, r, h, vary(r, col(pick(r, ["#c9ccd0", "#e6e1d6", "#f4a261", "#2a9d8f", "#c1121f"])), 0.05), pick(r, [1, 1, 0, 0.3, 0.8]), 0.3);
          // Luminária em cima da porta.
          m.box(M.paint, DARK, (h.x0 + h.x1) / 2 - 0.3, (h.x0 + h.x1) / 2 + 0.3, h.y1 + 0.5, h.y1 + 0.62, 0, 0.5);
          m.box(M.lit, WHITE, (h.x0 + h.x1) / 2 - 0.25, (h.x0 + h.x1) / 2 + 0.25, h.y1 + 0.48, h.y1 + 0.5, 0.05, 0.45);
        }
      }
      if (side === 0 && !hangar && r() < 0.8) {
        const sw = Math.min(len * 0.5, 10);
        signBoard(m, 26 + Math.floor(r() * 5), len / 2 - sw / 2, len / 2 + sw / 2, top - 1.6, sw / 8, 0.1);
      }
      // Condutor de água no canto.
      m.box(M.paint, shade(cladding, 0.75), len - 0.25, len - 0.1, L.floor, top, 0, 0.15, BOX.back);
    }, 0, cz);
  }
  m.grime = 0;
  // Cantoneiras.
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    m.box(M.paint, shade(cladding, 0.85), (sx * w) / 2 - 0.12, (sx * w) / 2 + 0.12, L.floor + baseH, top, cz + (sz * d) / 2 - 0.12, cz + (sz * d) / 2 + 0.12, BOX.bottom | BOX.top);
  }
  m.push(0, 0, cz, 0);
  if (roofKind === "arch") archRoof(L, w, d, top, roofCol, cladding);
  else if (roofKind === "shed") sawtoothRoof(L, w, d, top, roofCol, cladding);
  else lowGable(L, w, d, top, roofCol, cladding);
  m.pop();
  // Doca de carga na frente.
  if (dock) {
    const z0 = cz + d / 2;
    m.box(M.concrete, baseCol, -w / 2 + 1, w / 2 - 1, L.base, L.floor + 1.2, z0, z0 + 2.4, BOX.bottom);
    m.box(M.paint, col("#ffd23f"), -w / 2 + 1, w / 2 - 1, L.floor + 1.0, L.floor + 1.2, z0 + 2.4, z0 + 2.45, BOX.back);
    for (let x = -w / 2 + 2; x < w / 2 - 1; x += 3) m.box(M.paint, DARK, x - 0.15, x + 0.15, L.floor + 0.3, L.floor + 1.1, z0 + 2.4, z0 + 2.55, BOX.back);
    // Marquise de chapa sobre a doca, presa na parede por mãos-francesas.
    if (L.clear(0, z0 + 3.2)) {
      const y = L.floor + 5.2;
      m.box(M.metal, roofCol, -w / 2 + 1, w / 2 - 1, y, y + 0.08, z0, z0 + 2.6);
      m.box(M.paint, shade(roofCol, 0.75), -w / 2 + 1, w / 2 - 1, y - 0.25, y + 0.1, z0 + 2.5, z0 + 2.62, BOX.back);
      for (let x = -w / 2 + 1.5; x < w / 2 - 1; x += 5) m.bar(M.paint, DARK, x, y - 1.6, z0, x, y - 0.05, z0 + 2.4, 0.08);
    }
  }
}

/** Telhado de duas águas baixinho (metálico), com a empena de chapa. */
function lowGable(L: Lot, w: number, d: number, y: number, roofCol: Rgb, cladding: Rgb) {
  const { m } = L;
  const pitch = 0.12;
  const eave = 0.4;
  // Cumeeira ao longo do lado maior.
  const along = w >= d;
  m.push(0, 0, 0, along ? 0 : Math.PI / 2);
  const W = along ? w : d;
  const D = along ? d : w;
  const top = y + (D / 2) * pitch;
  const x0 = -W / 2 - eave;
  const x1 = W / 2 + eave;
  const zf = D / 2 + eave;
  const yf = y - eave * pitch;
  const sl = Math.hypot(zf, top - yf);
  m.quad(M.metal, roofCol, x0, yf, zf, x1, yf, zf, x1, top, 0, x0, top, 0, [x0, 0, x1, sl]);
  m.quad(M.metal, roofCol, x1, yf, -zf, x0, yf, -zf, x0, top, 0, x1, top, 0, [-x1, 0, -x0, sl]);
  m.quad(M.metal, shade(roofCol, 0.5), x1, yf - 0.05, zf, x0, yf - 0.05, zf, x0, top - 0.05, 0, x1, top - 0.05, 0);
  m.quad(M.metal, shade(roofCol, 0.5), x0, yf - 0.05, -zf, x1, yf - 0.05, -zf, x1, top - 0.05, 0, x0, top - 0.05, 0);
  // Empenas de chapa.
  m.tri(M.metal, cladding, W / 2, y, D / 2, W / 2, y, -D / 2, W / 2, top, 0, [0, y, D, y, D / 2, top]);
  m.tri(M.metal, cladding, -W / 2, y, -D / 2, -W / 2, y, D / 2, -W / 2, top, 0, [0, y, D, y, D / 2, top]);
  // Cumeeira e lanternim (a "chaminé" de ventilação ao longo da cumeeira).
  m.box(M.paint, shade(roofCol, 0.9), x0, x1, top - 0.05, top + 0.12, -0.3, 0.3, BOX.bottom);
  if (L.random() < 0.5) {
    const lw = W * 0.7;
    m.box(M.metal, shade(roofCol, 0.8), -lw / 2, lw / 2, top, top + 0.8, -0.8, 0.8, BOX.bottom | BOX.top);
    m.box(M.metal, roofCol, -lw / 2 - 0.2, lw / 2 + 0.2, top + 0.8, top + 0.9, -1.2, 1.2, BOX.bottom);
  }
  // Calhas.
  m.box(M.paint, shade(roofCol, 0.7), x0, x1, yf - 0.25, yf, zf, zf + 0.2, BOX.top);
  m.box(M.paint, shade(roofCol, 0.7), x0, x1, yf - 0.25, yf, -zf - 0.2, -zf, BOX.top);
  m.pop();
}

/** Telhado em arco (galpão de estrutura metálica, hangar), arco ao longo de x. */
function archRoof(L: Lot, w: number, d: number, y: number, roofCol: Rgb, cladding: Rgb) {
  const { m } = L;
  const span = w;
  const rise = Math.min(span * 0.18, 8);
  const segs = 12;
  const z0 = -d / 2 - 0.4;
  const z1 = d / 2 + 0.4;
  const pt = (i: number): [number, number] => {
    const t = i / segs;
    const x = -span / 2 - 0.3 + (span + 0.6) * t;
    return [x, y + rise * Math.sin(t * Math.PI) - 0.1];
  };
  let along = 0;
  for (let i = 0; i < segs; i++) {
    const [xa, ya] = pt(i);
    const [xb, yb] = pt(i + 1);
    const len = Math.hypot(xb - xa, yb - ya);
    // Arco vai de -x a +x; cada faixa vai de z1 a z0 (normal para cima/fora).
    m.quad(M.metal, roofCol, xa, ya, z1, xa, ya, z0, xb, yb, z0, xb, yb, z1, [0, along, z1 - z0, along + len]);
    m.quad(M.metal, shade(roofCol, 0.5), xb, yb - 0.05, z1, xb, yb - 0.05, z0, xa, ya - 0.05, z0, xa, ya - 0.05, z1);
    along += len;
    // Fecho das pontas (a parede em arco).
    for (const z of [d / 2, -d / 2]) {
      const s = z > 0 ? 1 : -1;
      const cxa = Math.max(-span / 2, Math.min(span / 2, xa));
      const cxb = Math.max(-span / 2, Math.min(span / 2, xb));
      if (s > 0) m.quad(M.metal, cladding, cxa, y, z, cxb, y, z, cxb, yb, z, cxa, ya, z);
      else m.quad(M.metal, cladding, cxb, y, z, cxa, y, z, cxa, ya, z, cxb, yb, z);
    }
  }
}

/** Telhado em dente de serra (shed): faixas inclinadas com vidro na parte em pé. */
function sawtoothRoof(L: Lot, w: number, d: number, y: number, roofCol: Rgb, cladding: Rgb) {
  const { m, random: r } = L;
  const teeth = Math.max(2, Math.round(d / 7));
  const tz = d / teeth;
  const rise = Math.min(2.6, tz * 0.4);
  for (let i = 0; i < teeth; i++) {
    const za = -d / 2 + i * tz;
    const zb = za + tz;
    const sl = Math.hypot(tz, rise);
    // Água: sobe de zb (baixo) para za (alto)... o vidro fica de frente para +z? Fica para o fundo (luz sem sol direto).
    m.quad(M.metal, roofCol, -w / 2 - 0.2, y, zb, w / 2 + 0.2, y, zb, w / 2 + 0.2, y + rise, za, -w / 2 - 0.2, y + rise, za, [-w / 2, 0, w / 2, sl]);
    // Parte em pé, envidraçada, olhando para -z.
    m.push(0, 0, za, Math.PI);
    glassRow(L, -w / 2, w / 2, y, y + rise - 0.15, 0, 2.2, 0.15, col("#9fb3bf"));
    m.pop();
    // Lados (triângulos de chapa).
    m.tri(M.metal, cladding, w / 2, y, zb, w / 2, y, za, w / 2, y + rise, za, [0, y, tz, y, tz, y + rise]);
    m.tri(M.metal, cladding, -w / 2, y, za, -w / 2, y, zb, -w / 2, y + rise, za, [0, y, tz, y, 0, y + rise]);
  }
  if (r() < 0.5) m.box(M.paint, shade(roofCol, 0.7), -w / 2 - 0.2, w / 2 + 0.2, y - 0.25, y, d / 2, d / 2 + 0.2, BOX.top);
}

// --- Contêineres --------------------------------------------------------------------------

export const CONTAINERS = ["#c1121f", "#2a6bff", "#e9c46a", "#2a9d8f", "#f4a261", "#6c757d", "#1d3557", "#8d5a3b", "#e76f51", "#3a7d44"];

/** Pilha de contêineres: um por andar, a cor muda; portas numa ponta. */
export function containers(L: Lot) {
  const { m, random: r } = L;
  const levels = Math.max(1, Math.round(L.height / 2.6));
  const w = L.w - 0.1;
  const d = L.d - 0.1;
  for (let f = 0; f < levels; f++) {
    const y0 = L.floor + f * 2.6;
    const y1 = y0 + 2.55;
    const c = f === 0 ? L.tone : vary(r, col(pick(r, CONTAINERS)), 0.08);
    const flip = r() < 0.5 ? 1 : -1;
    // Laterais compridas com gomos (ondas na vertical).
    for (const side of [0, 2]) {
      onWall(m, w, d, side, (len) => {
        m.front(M.metal, c, 0.12, len - 0.12, y0 + 0.12, y1 - 0.12, -0.02);
        // Longarinas (em cima e embaixo) e colunas de canto.
        m.box(M.paint, shade(c, 0.7), 0, len, y0, y0 + 0.14, -0.02, 0.03, BOX.back);
        m.box(M.paint, shade(c, 0.7), 0, len, y1 - 0.14, y1, -0.02, 0.03, BOX.back);
        m.box(M.paint, shade(c, 0.6), 0, 0.14, y0, y1, -0.02, 0.04, BOX.back);
        m.box(M.paint, shade(c, 0.6), len - 0.14, len, y0, y1, -0.02, 0.04, BOX.back);
        // Placa com o código.
        if (r() < 0.6) m.box(M.paint, OFFWHITE, len - 2.2, len - 0.6, y1 - 0.7, y1 - 0.4, -0.02, 0.005, BOX.back);
      });
    }
    // Pontas: portas (com as travas) numa, painel liso na outra.
    for (const side of [1, 3]) {
      onWall(m, w, d, side, (len) => {
        m.front(M.metal, shade(c, 0.95), 0.1, len - 0.1, y0 + 0.12, y1 - 0.12, -0.02, [y0, 0, y1, len]);
        m.box(M.paint, shade(c, 0.6), 0, 0.12, y0, y1, -0.02, 0.04, BOX.back);
        m.box(M.paint, shade(c, 0.6), len - 0.12, len, y0, y1, -0.02, 0.04, BOX.back);
        m.box(M.paint, shade(c, 0.7), 0, len, y0, y0 + 0.14, -0.02, 0.03, BOX.back);
        m.box(M.paint, shade(c, 0.7), 0, len, y1 - 0.14, y1, -0.02, 0.03, BOX.back);
        if ((side === 1) === (flip > 0)) {
          m.box(M.paint, shade(c, 0.5), len / 2 - 0.02, len / 2 + 0.02, y0 + 0.14, y1 - 0.14, -0.02, 0.02, BOX.back);
          for (const t of [0.18, 0.38, 0.62, 0.82]) {
            const x = len * t;
            m.bar(M.paint, ALUMINUM, x, y0 + 0.2, 0.05, x, y1 - 0.2, 0.05, 0.035);
            m.box(M.paint, ALUMINUM, x - 0.05, x + 0.05, y0 + 1.1, y0 + 1.25, 0, 0.09);
          }
        }
      });
    }
    m.box(M.metal, shade(c, 0.9), -w / 2, w / 2, y1 - 0.02, y1, -d / 2, d / 2, BOX.bottom | BOX.front | BOX.back | BOX.left | BOX.right);
  }
}

