// Carrocerias dos carros da garagem e do trânsito, esculpidas por seções.
//
// Cada carro é descrito pelas medidas do de verdade (entre-eixos, balanços,
// altura) e por curvas: o perfil de cima e de baixo da lataria, a meia largura
// em planta (bico e traseira afinando, para-lamas alargados) e o perfil da
// estufa (para-brisa, teto, vigia). Com isso a carroceria sai como um sólido de
// seções arredondadas (car-kit.ts), as caixas de roda recortadas, e os detalhes
// (faróis, lanternas, grades, vidros, faixas) são "adesivos" que seguem a
// lataria. Em cima de tudo, a piada de comida de cada um.
//
// A geometria de cada estilo é montada uma vez só e guardada; o que muda de um
// carro para outro é o material da pintura (um por cor).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { BODY_SIZE, type BodyStyle, type TrafficKind } from "@nfbmc/shared";

import {
  Bin, Solid, Surf, bump, clipLine, curve, ellipse, mirrorX, patchPoly, patchRect, patchStrip, rounded, roundRect,
  sections, smoothstep, sweep, type Fn, type MatName, type P2, type PatchOptions, type SectionShape, type Surface,
} from "./car-kit.ts";
import { caliperGeometry, wheelGeometry, type WheelSpec } from "./car-wheels.ts";

// --- Descrição de um carro ------------------------------------------------------

interface Design {
  length: number;
  width: number;
  /** Rodas: z do eixo dianteiro e traseiro, mais o pneu e o aro. */
  wheels: WheelSpec & { front: number; rear: number; gap?: number; inset?: number; flare?: [number, number]; tub?: number };
  body: {
    top: P2[];
    bottom: P2[];
    plan: P2[];
    /** Altura da linha de ombro (absoluta, ao longo do comprimento). */
    shoulder: P2[];
    shape: SectionShape;
    /** Abaulado ao longo do comprimento (negativo = para-lamas mais altos que o capô). */
    crown?: P2[];
    nTop?: P2[];
  };
  cabin?: {
    top: P2[];
    shape: SectionShape;
    /** Quanto a base da estufa afunda na lataria e o recuo dela para dentro. */
    sink?: number;
    inset?: number;
    /** Para-brisa (z de baixo e de cima) e vigia (z de cima e de baixo). */
    ws: [number, number];
    bl?: [number, number];
    /** Janelas laterais: queda abaixo do teto, coluna B (z, largura), aresta de trás (z embaixo, z em cima). */
    drop?: number;
    b?: [number, number] | null;
    c?: [P2, P2] | null;
    /** Vidro lateral de trás extra (quebra-vento traseiro), entre a coluna C e esta reta. */
    quarter?: [P2, P2] | null;
    belt?: number;
    /** Moldura das janelas: "trim" (borracha preta) ou "chrome". */
    frame?: MatName;
    /** Coluna B preta (vidro "contínuo") ou da cor do carro. */
    bBlack?: boolean;
    /** Material e cor da estufa (padrão: a pintura). */
    mat?: MatName;
    color?: string;
    /** false = as janelas são desenhadas à mão nos detalhes. */
    auto?: boolean;
  };
  /** Portas: [frente, trás] de cada uma (z), para as linhas e maçanetas. */
  doors?: [number, number][];
  /** Retrovisor: z e altura (a partir do topo da lataria). */
  mirror?: { z: number; rise?: number; mat?: MatName; size?: number };
  /** Placa da frente e de trás (altura do centro); null = sem placa. */
  plates?: { front: number | null; rear: number | null };
  details?: (k: Kit) => void;
  food?: (k: Kit) => void;
}

// --- Kit de peças (o que os desenhos de cada carro usam) ------------------------

export interface Kit {
  detail: boolean;
  bin: Bin;
  L: number;
  W: number;
  body: Solid;
  cabin: Solid | null;
  wheel: { front: number; rear: number; radius: number; width: number; x: number; arch: number };
  /** Topo da lataria (linha do meio) e o topo de tudo (com a estufa) num ponto. */
  bodyTop: Fn;
  topAt: (z: number, x?: number) => number;
  sideAt: (z: number, y: number) => number;
  frontAt: (x: number, y: number) => number;
  rearAt: (x: number, y: number) => number;
  s: {
    front: Surface;
    rear: Surface;
    top: Surface;
    hood: Surface;
    side: (side: number) => Surface;
    cabFront: Surface | null;
    cabRear: Surface | null;
    cabSide: ((side: number) => Surface) | null;
  };
  patch: (surface: Surface, outline: P2[], mat: MatName, color?: THREE.ColorRepresentation | null, opts?: PatchOptions) => void;
  rect: (surface: Surface, a0: number, a1: number, b0: number, b1: number, mat: MatName, color?: THREE.ColorRepresentation | null, opts?: PatchOptions) => void;
  strip: (surface: Surface, path: P2[], width: number, mat: MatName, color?: THREE.ColorRepresentation | null, opts?: PatchOptions) => void;
  /** Farol/lanterna: aro escuro, refletor cromado e a lente acesa (ou as lâmpadas, se dadas). */
  lamp: (surface: Surface, outline: P2[], color: THREE.ColorRepresentation, opts?: { bulbs?: P2[][]; bezel?: MatName | null; bezelColor?: string; dome?: number; reflector?: boolean; frame?: number }) => void;
  glass: (surface: Surface, outline: P2[], frame?: MatName | null, frameWidth?: number) => void;
  geo: (mat: MatName, geometry: THREE.BufferGeometry, color?: THREE.ColorRepresentation | null, pos?: [number, number, number], rot?: [number, number, number], scale?: [number, number, number]) => void;
  box: (mat: MatName, color: THREE.ColorRepresentation | null, size: [number, number, number], pos: [number, number, number], opts?: { r?: number; rot?: [number, number, number] }) => void;
  cyl: (mat: MatName, color: THREE.ColorRepresentation | null, r: number, len: number, pos: [number, number, number], opts?: { r2?: number; rot?: [number, number, number]; seg?: number; open?: boolean }) => void;
  sphere: (mat: MatName, color: THREE.ColorRepresentation | null, r: number, pos: [number, number, number], opts?: { scale?: [number, number, number]; rot?: [number, number, number]; seg?: number }) => void;
  lathe: (mat: MatName, color: THREE.ColorRepresentation | null, profile: P2[], pos: [number, number, number], opts?: { rot?: [number, number, number]; seg?: number; scale?: [number, number, number] }) => void;
  tube: (mat: MatName, color: THREE.ColorRepresentation | null, points: [number, number, number][], radius: number, opts?: { seg?: number; radial?: number }) => void;
  sweep: (mat: MatName, color: THREE.ColorRepresentation | null, path: [number, number, number][], section: P2[] | ((t: number) => P2[]), up?: [number, number, number]) => void;
  both: (fn: (side: number) => void) => void;
  /** Segmentos: menos no trânsito. */
  seg: (n: number) => number;
  /** Trechos (z) cobertos pelo para-brisa e pela vigia (faixas por cima pulam). */
  glassZ: [number, number][];
}

/** Faixa por cima do carro (capô, teto, tampa), pulando os vidros. */
export function topStripe(k: Kit, x0: number, x1: number, color: string, z0 = -k.L / 2 + 0.02, z1 = k.L / 2 - 0.02) {
  const cuts = k.glassZ.map(([a, b]) => [Math.min(a, b) - 0.02, Math.max(a, b) + 0.02] as [number, number]).sort((a, b) => a[0] - b[0]);
  let from = z0;
  const spans: [number, number][] = [];
  for (const [a, b] of cuts) {
    if (a > from) spans.push([from, Math.min(a, z1)]);
    from = Math.max(from, b);
  }
  if (from < z1) spans.push([from, z1]);
  for (const [a, b] of spans) if (b - a > 0.05) k.rect(k.s.top, x0, x1, a, b, "accent", color, { off: 0.005, step: 0.05, na: 2 });
}

const v3 = (p: [number, number, number]) => new THREE.Vector3(...p);

/** Expande (d > 0) ou encolhe um contorno a partir das quinas. */
function grow(poly: P2[], d: number): P2[] {
  const n = poly.length;
  const ca = poly.reduce((s, p) => s + p[0], 0) / n;
  const cb = poly.reduce((s, p) => s + p[1], 0) / n;
  return poly.map((p, i) => {
    const a = poly[(i - 1 + n) % n];
    const b = poly[(i + 1) % n];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    let nx = ty;
    let ny = -tx;
    if (nx * (p[0] - ca) + ny * (p[1] - cb) < 0) { nx = -nx; ny = -ny; }
    return [p[0] + nx * d, p[1] + ny * d] as P2;
  });
}

function flip(g: THREE.BufferGeometry) {
  if (g.index) {
    const arr = Array.from(g.index.array);
    for (let t = 0; t < arr.length; t += 3) [arr[t + 1], arr[t + 2]] = [arr[t + 2], arr[t + 1]];
    g.setIndex(arr);
  }
  const n = g.attributes.normal;
  if (n) for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}

export const LAMP = {
  head: "#fff4d8",
  headCool: "#eef6ff",
  tail: "#b80d18",
  tailHot: "#ff2a2a",
  turn: "#ff9314",
  reverse: "#f2f2f2",
};

// --- Montagem -------------------------------------------------------------------

export interface BuiltBody {
  /** Uma geometria por material (a pintura é a "paint"). */
  parts: Map<MatName, THREE.BufferGeometry>;
  /** Onde ficam as rodas e de que tamanho (posição do centro, no chão y = raio). */
  wheels: { x: number; z: number; radius: number }[];
  wheel: WheelSpec;
  length: number;
  /** Altura e posição do teto (giroflex, placa de nome). */
  roofY: number;
  roofZ: number;
  /** Tempo de montagem (ms), para conferir. */
  ms: number;
}

/** Monta a descrição: sólidos, superfícies e o kit. */
function makeKit(d: Design, detail: boolean, bin: Bin): Kit {
  const L = d.length;
  const W = d.width;
  const wh = d.wheels;
  const R = wh.radius;
  const gap = wh.gap ?? 0.05;
  const arch = R + gap;
  const top = curve(d.body.top);
  const bottom = curve(d.body.bottom);
  const plan = curve(d.body.plan);
  const shoulder = curve(d.body.shoulder);
  const crown = d.body.crown ? curve(d.body.crown) : null;
  const nTop = d.body.nTop ? curve(d.body.nTop) : undefined;
  const flareAmt = wh.flare ?? [0, 0];
  const centers = [wh.front, wh.rear];
  const flare = (z: number, y: number) => {
    let f = 0;
    centers.forEach((c, i) => {
      if (!flareAmt[i]) return;
      f += flareAmt[i] * bump(z, c, arch + 0.45) * (1 - smoothstep(R + arch - 0.02, R + arch + 0.16, y));
    });
    return f;
  };
  // Posição lateral das rodas: a face de fora rente à lataria na altura do eixo.
  const probe = new Solid({ z0: -L / 2, z1: L / 2, top, bottom, half: plan, shoulder, shape: d.body.shape, flare, crownAt: crown ?? undefined });
  const wheelX = Math.max(probe.width(wh.front, R + 0.02), 0.3) - wh.width / 2 - (wh.inset ?? 0.025);
  const xIn = wheelX - wh.width / 2 - 0.04;
  const clamp = (z: number, x: number) => {
    if (Math.abs(x) < xIn) return -Infinity;
    let y = -Infinity;
    for (const c of centers) {
      const dz = z - c;
      if (Math.abs(dz) < arch) y = Math.max(y, R + Math.sqrt(arch * arch - dz * dz));
    }
    return y;
  };
  const body = new Solid({
    z0: -L / 2, z1: L / 2, top, bottom, half: plan, shoulder, shape: d.body.shape, flare, clamp, nTopAt: nTop, crownAt: crown ?? undefined,
  });

  let cabin: Solid | null = null;
  if (d.cabin) {
    const c = d.cabin;
    const ctop = curve(c.top);
    const sink = c.sink ?? 0.07;
    const inset = c.inset ?? 0.012;
    const z0 = c.top[0][0];
    const z1 = c.top[c.top.length - 1][0];
    const cb = (z: number) => top(z) - sink;
    cabin = new Solid({
      z0, z1, top: (z) => Math.max(ctop(z), cb(z) + 0.004), bottom: cb,
      half: (z) => Math.max(0.05, body.width(z, cb(z)) - inset),
      shoulder: (z) => cb(z) + 0.002, shape: c.shape,
    });
  }

  const solidsTop = cabin ? [body, cabin] : [body];
  const s = {
    front: Surf.front(body),
    rear: Surf.rear(body),
    top: Surf.top(...solidsTop),
    hood: Surf.top(body),
    side: (side: number) => Surf.side(body, side),
    cabFront: cabin ? Surf.front(cabin) : null,
    cabRear: cabin ? Surf.rear(cabin) : null,
    cabSide: cabin ? (side: number) => Surf.side(cabin!, side) : null,
  };
  const seg = (n: number) => (detail ? n : Math.max(4, Math.round(n / 2.5)));
  const colorOf = (c: THREE.ColorRepresentation | null | undefined) => (c === undefined ? null : c);
  // No trânsito, os adesivos são bem mais grossos (poucos triângulos).
  const lite = (o: PatchOptions = {}): PatchOptions => (detail ? o : { ...o, rings: Math.min(o.rings ?? 2, 2), step: Math.max(o.step ?? 0, 0.1), dome: 0 });
  const k: Kit = {
    detail, bin, L, W, body, cabin,
    wheel: { front: wh.front, rear: wh.rear, radius: R, width: wh.width, x: wheelX, arch },
    bodyTop: top,
    topAt: (z, x = 0) => {
      let best = -Infinity;
      for (const so of solidsTop) {
        const y = so.top(z, x);
        if (y !== null) best = Math.max(best, y);
      }
      return best === -Infinity ? 0 : best;
    },
    sideAt: (z, y) => body.side(z, y) ?? 0,
    frontAt: (x, y) => body.front(x, y) ?? L / 2,
    rearAt: (x, y) => body.rear(x, y) ?? -L / 2,
    s,
    patch: (surface, outline, mat, color, opts) => bin.add(mat, patchPoly(surface, outline, lite(opts)), colorOf(color)),
    rect: (surface, a0, a1, b0, b1, mat, color, opts) => bin.add(mat, patchRect(surface, a0, a1, b0, b1, detail ? opts : { ...opts, step: 0.3 }), colorOf(color)),
    strip: (surface, path, width, mat, color, opts) => bin.add(mat, patchStrip(surface, path, width, lite(opts)), colorOf(color)),
    lamp: (surface, outline, color, opts = {}) => {
      const frame = opts.frame ?? 0.012;
      if (opts.bezel !== null && detail) bin.add(opts.bezel ?? "trim", patchPoly(surface, grow(outline, frame), { off: 0.003, rings: 2 }), opts.bezelColor ?? "#141416");
      if (opts.bulbs && detail) {
        if (opts.reflector !== false) bin.add("chrome", patchPoly(surface, outline, { off: 0.005, dome: (opts.dome ?? 0.01) * 0.4, rings: 3 }));
        for (const b of opts.bulbs) bin.add("lamp", patchPoly(surface, b, { off: 0.008, dome: opts.dome ?? 0.01, rings: 4 }), color);
      } else {
        bin.add("lamp", patchPoly(surface, outline, lite({ off: 0.006, dome: opts.dome ?? 0.008, rings: 4 })), color);
      }
    },
    glass: (surface, outline, frame = "trim", frameWidth = 0.014) => {
      // A moldura fica quase toda escondida pelo vidro: basta a borda (um anel só).
      if (frame) bin.add(frame, patchPoly(surface, grow(outline, frameWidth), { off: 0.003, rings: 1, step: detail ? 0.05 : 0.12 }), frame === "trim" ? "#0c0c0d" : null);
      bin.add("glass", patchPoly(surface, outline, { off: 0.006, rings: detail ? 4 : 2, step: detail ? 0.05 : 0.12 }));
    },
    geo: (mat, geometry, color, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) => bin.place(mat, geometry, colorOf(color), pos[0], pos[1], pos[2], rot, scale),
    box: (mat, color, size, pos, opts = {}) => {
      const r = opts.r ?? 0;
      const g = r > 0 ? new RoundedBoxGeometry(size[0], size[1], size[2], detail ? 3 : 1, Math.min(r, ...size.map((v) => v / 2 - 0.0005))) : new THREE.BoxGeometry(...size);
      bin.place(mat, g, colorOf(color), pos[0], pos[1], pos[2], opts.rot);
    },
    cyl: (mat, color, r, len, pos, opts = {}) => {
      const g = new THREE.CylinderGeometry(r, opts.r2 ?? r, len, seg(opts.seg ?? 20), 1, opts.open ?? false);
      bin.place(mat, g, colorOf(color), pos[0], pos[1], pos[2], opts.rot);
    },
    sphere: (mat, color, r, pos, opts = {}) => {
      const n = seg(opts.seg ?? 20);
      const g = new THREE.SphereGeometry(r, n, Math.max(4, Math.round(n * 0.7)));
      bin.place(mat, g, colorOf(color), pos[0], pos[1], pos[2], opts.rot, opts.scale);
    },
    lathe: (mat, color, profile, pos, opts = {}) => {
      const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)), seg(opts.seg ?? 24));
      bin.place(mat, g, colorOf(color), pos[0], pos[1], pos[2], opts.rot, opts.scale);
    },
    tube: (mat, color, points, radius, opts = {}) => {
      const path = new THREE.CatmullRomCurve3(points.map(v3));
      const g = new THREE.TubeGeometry(path, seg(opts.seg ?? 24), radius, seg(opts.radial ?? 8), false);
      bin.add(mat, g, colorOf(color));
    },
    sweep: (mat, color, path, section, up = [0, 1, 0]) => bin.add(mat, sweep(path.map(v3), section, v3(up)), colorOf(color)),
    both: (fn) => { fn(1); fn(-1); },
    seg,
    glassZ: d.cabin && d.cabin.auto !== false ? [[d.cabin.ws[1], d.cabin.ws[0]], ...(d.cabin.bl ? [[d.cabin.bl[1], d.cabin.bl[0]] as [number, number]] : [])] : [],
  };
  return k;
}

/** Peças que todo carro tem: caixas de roda, vidros, retrovisores, portas, limpadores, placas. */
function standard(k: Kit, d: Design) {
  const { bin, wheel, detail } = k;
  const R = wheel.radius;
  // Caixas de roda: o "túnel" escuro por dentro do arco e a parede de dentro.
  for (const z of [wheel.front, wheel.rear]) {
    for (const side of [1, -1]) {
      const outer = Math.max(k.sideAt(z, R + wheel.arch * 0.9) - 0.01, d.wheels.tub ?? 0);
      const inner = wheel.x - wheel.width / 2 - 0.03;
      const len = Math.max(0.05, outer - inner);
      const tub = new THREE.CylinderGeometry(wheel.arch - 0.006, wheel.arch - 0.006, len, k.seg(28), 1, true, -0.25, Math.PI + 0.5);
      tub.rotateZ(Math.PI / 2);
      flip(tub);
      bin.place("trim", tub, "#0b0b0c", side * (inner + len / 2), R, z);
      const wall = new THREE.CircleGeometry(wheel.arch, k.seg(28), -0.25, Math.PI + 0.5);
      wall.rotateZ(Math.PI / 2);
      wall.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
      bin.place("trim", wall, "#0b0b0c", side * inner, R, z);
    }
  }

  const c = d.cabin;
  if (c && c.auto !== false && k.cabin && k.s.cabFront && k.s.cabSide) {
    const cabTop = curve(c.top);
    const frameMat = c.frame ?? "trim";
    // Para-brisa: do pé ao alto, a largura da estufa menos a coluna A.
    const ws: P2[] = [];
    const pillar = 0.055;
    const n = detail ? 14 : 6;
    for (let i = 0; i <= n; i++) {
      const z = c.ws[0] + ((c.ws[1] - c.ws[0]) * i) / n;
      const y = cabTop(z) - (i === n ? 0.035 : 0);
      const w = k.cabin.width(z, y - 0.02) - pillar;
      if (w > 0.05) ws.push([w, y]);
    }
    if (ws.length > 2) {
      const outline: P2[] = [...ws, ...ws.slice().reverse().map(([x, y]) => [-x, y] as P2)];
      k.glass(k.s.cabFront, rounded(outline, 2), frameMat === "chrome" ? "trim" : frameMat, 0.016);
    }
    if (c.bl && k.s.cabRear) {
      const bl: P2[] = [];
      for (let i = 0; i <= n; i++) {
        const z = c.bl[0] + ((c.bl[1] - c.bl[0]) * i) / n;
        const y = cabTop(z) - (i === 0 ? 0.035 : 0);
        const w = k.cabin.width(z, y - 0.02) - pillar * 1.1;
        if (w > 0.05) bl.push([w, y]);
      }
      if (bl.length > 2) {
        const outline: P2[] = [...bl, ...bl.slice().reverse().map(([x, y]) => [-x, y] as P2)];
        k.glass(k.s.cabRear, rounded(outline, 2), "trim", 0.016);
      }
    }
    // Janelas laterais: entre a cintura e o teto, cortadas pelas colunas.
    const drop = c.drop ?? 0.07;
    const belt = c.belt ?? 0.025;
    const z0 = c.top[0][0];
    const z1 = c.top[c.top.length - 1][0];
    const pts: P2[] = [];
    const lower: P2[] = [];
    const steps = detail ? 60 : 20;
    for (let i = 0; i <= steps; i++) {
      const z = z0 + ((z1 - z0) * i) / steps;
      const yb = k.bodyTop(z) + belt - (c.sink ?? 0.07) * 0.5;
      const yt = cabTop(z) - drop;
      if (yt - yb > 0.03) {
        lower.push([z, yb]);
        pts.push([z, yt]);
      }
    }
    if (pts.length > 2) {
      let dlo: P2[] = [...lower, ...pts.reverse()];
      if (c.c) dlo = clipLine(dlo, c.c[0], c.c[1], [c.c[0][0] + 1, c.c[0][1]]);
      const windows: P2[][] = [];
      if (c.b) {
        const [bz, bw] = c.b;
        windows.push(clipLine(dlo, [bz + bw / 2, 0], [bz + bw / 2 + 0.06, 2], [bz + 2, 1]));
        let rearWin = clipLine(dlo, [bz - bw / 2, 0], [bz - bw / 2 + 0.06, 2], [bz - 2, 1]);
        if (c.quarter) {
          const q = c.quarter;
          windows.push(clipLine(rearWin, q[0], q[1], [q[0][0] - 1, q[0][1]]));
          rearWin = clipLine(rearWin, [q[0][0] + 0.06, q[0][1]], [q[1][0] + 0.06, q[1][1]], [q[0][0] + 1, q[0][1]]);
        }
        windows.push(rearWin);
      } else windows.push(dlo);
      for (const side of [1, -1]) {
        const surf = k.s.cabSide(side);
        for (const w of windows) if (w.length > 2) k.glass(surf, rounded(w, 1), frameMat, 0.016);
        if (c.b && c.bBlack !== false) {
          const [bz, bw] = c.b;
          const bp = clipLine(clipLine(dlo, [bz + bw / 2 + 0.01, 0], [bz + bw / 2 + 0.07, 2], [bz - 2, 1]), [bz - bw / 2 - 0.01, 0], [bz - bw / 2 + 0.05, 2], [bz + 2, 1]);
          if (bp.length > 2) k.patch(surf, bp, "trim", "#0c0c0d", { off: 0.004 });
        }
      }
    }
  }

  // Linhas das portas e maçanetas.
  if (d.doors && detail) {
    for (const side of [1, -1]) {
      const surf = k.s.side(side);
      for (const [zf, zr] of d.doors) {
        for (const z of [zf, zr]) {
          const y0 = curve(d.body.bottom)(z) + 0.05;
          const y1 = k.bodyTop(z) - 0.035;
          k.strip(surf, [[z, y0], [z + 0.015, (y0 + y1) / 2], [z, y1]], 0.006, "trim", "#0a0a0b", { off: 0.002 });
        }
        const hz = zr + 0.13;
        const hy = k.bodyTop(hz) - 0.11;
        k.patch(surf, roundRect(hz - 0.06, hy - 0.014, hz + 0.06, hy + 0.014, 0.012), "chrome", null, { off: 0.004, dome: 0.006 });
      }
    }
  }

  // Retrovisores na base da coluna A.
  if (d.mirror) {
    const m = d.mirror;
    const size = m.size ?? 1;
    const y = k.bodyTop(m.z) + (m.rise ?? 0.08);
    const x = (k.body.side(m.z, k.bodyTop(m.z) - 0.04) ?? k.W / 2) + 0.07 * size;
    k.both((side) => {
      const mc = m.mat === "trim" ? "#151517" : null;
      k.sphere(m.mat ?? "paint", mc, 0.09 * size, [side * x, y, m.z - 0.02], { scale: [1.15, 0.72, 0.7], seg: 18 });
      k.box(m.mat ?? "paint", mc, [0.08 * size, 0.035, 0.07], [side * (x - 0.07 * size), y - 0.03, m.z], { r: 0.012 });
      // Espelho (cromado) na face de trás.
      const g = new THREE.CircleGeometry(0.085 * size, k.seg(18));
      g.scale(1.05, 0.68, 1);
      g.rotateY(Math.PI);
      k.geo("chrome", g, null, [side * x, y, m.z - 0.075]);
    });
  }

  // Limpadores do para-brisa.
  if (c && c.auto !== false && k.s.cabFront && detail) {
    const cabTop = curve(c.top);
    const yb = cabTop(c.ws[0]) + 0.04;
    for (const x0 of [-0.42, 0.1]) {
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= 6; i++) {
        const x = x0 + i * 0.075;
        const y = yb + i * 0.012;
        const p = k.s.cabFront.at(x, y);
        if (p) pts.push([p[0], p[1], p[2] + 0.014]);
      }
      if (pts.length > 2) k.tube("trim", "#111113", pts, 0.007, { seg: 8, radial: 5 });
    }
  }

  // Placas (padrão Mercosul: branca com a faixa azul em cima).
  if (d.plates) {
    for (const [where, y] of [["front", d.plates.front], ["rear", d.plates.rear]] as const) {
      if (y === null) continue;
      const surf = where === "front" ? k.s.front : k.s.rear;
      k.patch(surf, roundRect(-0.2, y - 0.065, 0.2, y + 0.065, 0.01), "trim", "#f1f1ee", { off: 0.008 });
      k.rect(surf, -0.195, 0.195, y + 0.038, y + 0.06, "trim", "#1f45a8", { off: 0.011, na: 4, nb: 1 });
      if (detail) {
        for (let i = 0; i < 7; i++) {
          const x = -0.15 + i * 0.05 + (i > 2 ? 0.0 : 0);
          k.rect(surf, x - 0.016, x + 0.016, y - 0.042, y + 0.022, "trim", "#202020", { off: 0.012, na: 1, nb: 1 });
        }
      }
    }
  }
}

// --- Ajudantes de desenho ----------------------------------------------------------

/** Aerofólio: lâmina com perfil de asa, nas colunas, com placas nas pontas. */
function wing(k: Kit, z: number, y: number, span: number, chord: number, color: THREE.ColorRepresentation | null, opts: { mat?: MatName; posts?: number; postMat?: MatName; plates?: boolean; angle?: number; arch?: number } = {}) {
  const mat = opts.mat ?? (color === null ? "paint" : "accent");
  const thick = chord * 0.12;
  const airfoil: P2[] = [];
  const n = k.seg(14);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    airfoil.push([chord * (0.5 - t), thick * Math.sin(Math.PI * Math.pow(t, 0.7)) * 0.9]);
  }
  for (let i = n - 1; i > 0; i--) {
    const t = i / n;
    airfoil.push([chord * (0.5 - t), -thick * 0.25 * Math.sin(Math.PI * t)]);
  }
  const ang = opts.angle ?? 0.08;
  const rotated = airfoil.map(([u, v]) => [u * Math.cos(ang) - v * Math.sin(ang), u * Math.sin(ang) + v * Math.cos(ang)] as P2);
  const path: [number, number, number][] = [];
  const m = k.seg(16);
  for (let i = 0; i <= m; i++) {
    const t = i / m - 0.5;
    path.push([t * span, y + (opts.arch ?? 0) * (1 - 4 * t * t), z]);
  }
  // Varredura de lado: u vai para +z com up = y quando o caminho corre em +x.
  k.sweep(mat, color, path, rotated);
  const posts = opts.posts ?? 0.35;
  if (posts > 0) {
    k.both((side) => {
      const x = side * span * posts;
      const base = k.topAt(z, x);
      const h = y - base;
      if (h > 0.01) k.box(opts.postMat ?? "trim", opts.postMat === "paint" ? null : "#151517", [0.025, h + 0.02, chord * 0.45], [x, base + h / 2, z], { r: 0.008 });
    });
  }
  if (opts.plates !== false) {
    k.both((side) => k.box(opts.postMat ?? "trim", "#151517", [0.012, thick * 2.6, chord * 1.05], [side * span / 2, y + thick * 0.4, z], { r: 0.004 }));
  }
}

/** Grade de barras horizontais (ou verticais) dentro de um contorno da frente. */
function grilleBars(k: Kit, surface: Surface, x0: number, x1: number, y0: number, y1: number, bars: number, mat: MatName, color: THREE.ColorRepresentation | null, vertical = false, thick = 0.012) {
  for (let i = 0; i < bars; i++) {
    const t = (i + 0.5) / bars;
    if (vertical) {
      const x = x0 + (x1 - x0) * t;
      k.rect(surface, x - thick / 2, x + thick / 2, y0, y1, mat, color, { off: 0.009, na: 1, nb: 3 });
    } else {
      const y = y0 + (y1 - y0) * t;
      k.rect(surface, x0, x1, y - thick / 2, y + thick / 2, mat, color, { off: 0.009, nb: 1 });
    }
  }
}

/** Grade de colmeia: pontinhos escuros sobre o fundo. */
function honeycomb(k: Kit, surface: Surface, x0: number, x1: number, y0: number, y1: number, color: string, cell = 0.03) {
  if (!k.detail) return;
  for (let y = y0 + cell / 2, row = 0; y < y1 - cell * 0.3; y += cell * 0.8, row++) {
    for (let x = x0 + cell / 2 + (row % 2 ? cell / 2 : 0); x < x1 - cell * 0.3; x += cell) {
      k.patch(surface, ellipse(x, y, cell * 0.38, cell * 0.3, 6), "trim", color, { off: 0.008, rings: 1, step: 1 });
    }
  }
}

/** Escapamento: ponteira cromada com o miolo escuro. */
function exhaust(k: Kit, x: number, y: number, r: number, len = 0.14, oval = 1) {
  const z = k.rearAt(x, y + r + 0.02) + 0.03;
  k.cyl("chrome", null, r, len, [x, y, z - len / 2 + 0.02], { rot: [Math.PI / 2, 0, 0], seg: 20 });
  const inner = new THREE.CircleGeometry(r * 0.82, k.seg(18));
  inner.rotateY(Math.PI);
  k.geo("trim", inner, "#050505", [x, y, z - len + 0.018], [0, 0, 0], [1, oval, 1]);
}

/** Antena fina (chicote) a partir de um ponto. */
function antenna(k: Kit, x: number, y: number, z: number, h = 0.6, lean = -0.25) {
  if (!k.detail) return;
  k.tube("trim", "#111", [[x, y, z], [x, y + h * 0.5, z + lean * 0.5 * h], [x, y + h, z + lean * h]], 0.003, { seg: 4, radial: 4 });
}

/** Caminho de para-choque em planta, rente à frente (ou trás) a uma altura. */
function bumperPath(k: Kit, y: number, half: number, wrap: number, front: boolean, out = 0.02): [number, number, number][] {
  const pts: [number, number, number][] = [];
  const n = k.seg(24);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = (t * 2 - 1) * half;
    const zEdge = front ? k.frontAt(x * 0.98, y) : k.rearAt(x * 0.98, y);
    pts.push([x, y, zEdge + (front ? out : -out)]);
  }
  // Pontas dobrando para trás (ou para a frente) nas laterais.
  if (wrap > 0) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    const dz = front ? -wrap : wrap;
    pts.unshift([first[0] + 0.02, y, first[2] + dz]);
    pts.push([last[0] - 0.02, y, last[2] + dz]);
  }
  return front ? pts.slice().reverse() : pts;
}

/**
 * Para-choque envolvente: um sólido que segue a planta da carroceria, um
 * pouquinho para fora, entre duas alturas, da ponta até `depth` para dentro.
 */
function wrapBumper(k: Kit, front: boolean, y0: number, y1: number, depth: number, mat: MatName, color: THREE.ColorRepresentation | null, out = 0.025, shape: Partial<SectionShape> = {}) {
  const plan = k.body.spec.half;
  const end = front ? k.L / 2 : -k.L / 2;
  const z0 = front ? end - depth : end - out;
  const z1 = front ? end + out : end + depth;
  const solid = new Solid({
    z0, z1,
    top: (z) => {
      const t = front ? (z - z0) / (z1 - z0) : (z1 - z) / (z1 - z0);
      return y1 - Math.max(0, t - 0.92) * (y1 - y0) * 0.6;
    },
    bottom: () => y0,
    half: (z) => {
      const zz = Math.max(-k.L / 2, Math.min(k.L / 2, z));
      const tip = front ? Math.max(0, z - (end - 0.03)) : Math.max(0, end + 0.03 - z);
      return plan(zz) + out - tip * 3;
    },
    shape: { nTop: 6, nBot: 6, tumble: 0.02, tuck: 0.02, crown: 0, ...shape },
    // As caixas de roda cortam o para-choque também.
    clamp: (z, x) => {
      const c = k.body.spec.clamp?.(z, x) ?? -Infinity;
      return c > -Infinity ? c + 0.01 : c;
    },
  });
  const zs = sections(z0, z1, k.detail ? 0.03 : 0.1, k.detail ? 0.01 : 0.04, [], 0.06);
  k.bin.add(mat, solid.geometry(zs, k.detail ? 28 : 12), color);
  const surf = front ? Surf.front(solid) : Surf.rear(solid);
  return { solid, surf };
}

/** Saia lateral (estribo) entre as rodas. */
function sideSkirt(k: Kit, y0: number, y1: number, out: number, mat: MatName, color: THREE.ColorRepresentation | null) {
  const zf = k.wheel.front - k.wheel.arch - 0.02;
  const zr = k.wheel.rear + k.wheel.arch + 0.02;
  k.both((side) => {
    const x = k.body.side((zf + zr) / 2, y1) ?? k.W / 2;
    k.box(mat, color, [out + 0.03, y1 - y0, zf - zr], [side * (x + out / 2 - 0.015), (y0 + y1) / 2, (zf + zr) / 2], { r: Math.min(0.025, (y1 - y0) / 2.2) });
  });
}

/** Contorno espelhado: os pontos dados (lado +x) refletidos para o lado pedido. */
const sideOf = (side: number, pts: P2[]): P2[] => pts.map(([x, y]) => [x * side, y] as P2);

/** Tomada de ar escura com filetes por cima. */
function vent(k: Kit, surface: Surface, outline: P2[], slats = 0, vertical = false) {
  k.patch(surface, outline, "trim", "#0b0b0c", { off: 0.004 });
  if (!slats || !k.detail) return;
  const as = outline.map((p) => p[0]);
  const bs = outline.map((p) => p[1]);
  grilleBars(k, surface, Math.min(...as) + 0.01, Math.max(...as) - 0.01, Math.min(...bs) + 0.01, Math.max(...bs) - 0.01, slats, "trim", "#2a2a2c", vertical, 0.008);
}

// --- A garagem -----------------------------------------------------------------

const sz = BODY_SIZE;

/** Formas de seção comuns. */
const SHAPE = {
  modern: { nTop: 3.4, nBot: 3.6, tumble: 0.1, tuck: 0.16, crown: 0.12 },
  boxy: { nTop: 5, nBot: 5, tumble: 0.06, tuck: 0.08, crown: 0.08 },
  round: { nTop: 2.4, nBot: 2.8, tumble: 0.14, tuck: 0.2, crown: 0.1 },
  cabin: { nTop: 4.5, nBot: 8, tumble: 0.28, tuck: 0, crown: 0.06 },
  cabinRound: { nTop: 3, nBot: 8, tumble: 0.3, tuck: 0, crown: 0.05 },
} satisfies Record<string, SectionShape>;

const DESIGNS: Partial<Record<BodyStyle, Design>> = {};

// Honda Civic Si (8ª geração, "New Civic"): monovolume com o para-brisa bem
// deitado e começando lá na frente, faróis em lâmina, lanternas em bumerangue.
DESIGNS.sedan = {
  ...sz.sedan,
  wheels: { front: 1.33, rear: -1.37, radius: 0.312, width: 0.215, rim: "seven", rimRatio: 0.69, caliper: "#c1121f", flare: [0.01, 0.01] },
  body: {
    top: [[-2.25, 0.5], [-2.23, 0.78], [-2.17, 0.93], [-2.0, 0.985], [-1.6, 0.995], [-0.9, 0.955], [0.0, 0.925], [1.0, 0.885], [1.6, 0.82], [2.0, 0.735], [2.18, 0.655], [2.25, 0.5]],
    bottom: [[-2.25, 0.36], [-2.12, 0.26], [-1.8, 0.21], [1.8, 0.2], [2.12, 0.24], [2.25, 0.33]],
    plan: [[-2.25, 0.6], [-2.2, 0.78], [-2.05, 0.85], [-1.4, 0.875], [0.0, 0.875], [1.3, 0.868], [1.85, 0.82], [2.12, 0.72], [2.25, 0.5]],
    shoulder: [[-2.25, 0.82], [-1.0, 0.8], [1.0, 0.74], [2.25, 0.6]],
    shape: SHAPE.modern,
  },
  cabin: {
    top: [[-1.66, 0.95], [-1.5, 1.08], [-1.2, 1.27], [-0.85, 1.38], [-0.35, 1.425], [0.1, 1.405], [0.45, 1.29], [0.8, 1.1], [1.1, 0.88]],
    shape: SHAPE.cabin,
    ws: [1.02, 0.12],
    bl: [-0.85, -1.58],
    b: [-0.18, 0.09],
    c: [[-1.12, 0.9], [-0.8, 1.38]],
    drop: 0.07,
  },
  doors: [[0.98, -0.16], [-0.2, -0.98]],
  mirror: { z: 0.88, rise: 0.06 },
  plates: { front: 0.4, rear: 0.62 },
  details: (k) => {
    const { s } = k;
    // Faróis em lâmina, subindo para o para-lama.
    k.both((side) => {
      const o: P2[] = rounded([[0.28, 0.6], [0.52, 0.61], [0.78, 0.66], [0.82, 0.72], [0.6, 0.71], [0.3, 0.66]].map(([x, y]) => [x * side, y] as P2), 2);
      k.lamp(s.front, o, LAMP.headCool, { bulbs: [ellipse(0.62 * side, 0.675, 0.045, 0.03, 16), ellipse(0.45 * side, 0.64, 0.04, 0.026, 16)] });
      k.lamp(s.front, ellipse(0.66 * side, 0.4, 0.045, 0.03, 16), LAMP.head, { bezel: "chrome" });
      // Lanternas em bumerangue: na tampa e no para-lama.
      const t: P2[] = rounded([[0.38, 0.86], [0.7, 0.85], [0.84, 0.82], [0.85, 0.92], [0.6, 0.955], [0.38, 0.94]].map(([x, y]) => [x * side, y] as P2), 2);
      k.lamp(s.rear, t, LAMP.tail, { bulbs: [ellipse(0.72 * side, 0.89, 0.045, 0.03, 14), ellipse(0.52 * side, 0.9, 0.05, 0.03, 14)] });
    });
    // Grade fina cromada entre os faróis, emblema e a tomada de baixo (colmeia do Si).
    k.rect(s.front, -0.3, 0.3, 0.6, 0.64, "chrome", null, { off: 0.007 });
    k.patch(s.front, roundRect(-0.27, 0.6, 0.27, 0.66, 0.02), "trim", "#111", { off: 0.004 });
    k.patch(s.front, ellipse(0, 0.63, 0.05, 0.03, 16), "chrome", null, { off: 0.01, dome: 0.004 });
    k.patch(s.front, rounded([[-0.5, 0.27], [0.5, 0.27], [0.44, 0.47], [-0.44, 0.47]], 2), "trim", "#0d0d0e", { off: 0.004 });
    honeycomb(k, s.front, -0.42, 0.42, 0.29, 0.45, "#1d1d1f");
    k.patch(s.front, roundRect(0.31, 0.61, 0.37, 0.64, 0.01), "trim", "#d00000", { off: 0.009 });
    // Spoiler de tampa e o para-choque de trás com refletores.
    wing(k, -1.98, 1.03, 1.3, 0.16, null, { posts: 0, plates: false, angle: 0.18 });
    k.both((side) => k.patch(s.rear, roundRect(0.6 * side - 0.08, 0.44, 0.6 * side + 0.08, 0.47, 0.01), "lamp", LAMP.tail, { off: 0.006 }));
    exhaust(k, 0.45, 0.3, 0.04);
    antenna(k, 0, k.topAt(-0.8), -0.8, 0.12, -1);
  },
  food: (k) => {
    // Sushi: um nigiri de salmão no teto, com a faixa de alga, e hashis de antena.
    const y = k.topAt(-0.35);
    k.box("food", "#f7f3ea", [0.62, 0.2, 1.1], [0, y + 0.1, -0.35], { r: 0.09 });
    if (k.detail) for (let i = 0; i < 36; i++) {
      const a = i * 2.39;
      k.sphere("food", "#fffdf6", 0.035, [Math.sin(a) * 0.27, y + 0.08 + (i % 3) * 0.04, -0.35 + Math.cos(a * 1.7) * 0.5], { seg: 6, scale: [1, 0.7, 1.4] });
    }
    k.box("food", "#f2774a", [0.7, 0.08, 1.24], [0, y + 0.235, -0.35], { r: 0.035 });
    for (let i = 0; i < 6; i++) k.box("food", "#fbd2bd", [0.71, 0.012, 0.025], [0, y + 0.27, -0.85 + i * 0.2], { rot: [0, 0.25, 0] });
    k.box("food", "#14261a", [0.74, 0.3, 0.2], [0, y + 0.13, -0.35], { r: 0.01 });
    k.both((side) => k.cyl("food", "#c99a5b", 0.012, 0.9, [side * 0.12, y + 0.42, -0.6], { r2: 0.006, rot: [0.9, 0, side * 0.1], seg: 6 }));
    // Wasabi no canto da tampa.
    k.sphere("food", "#8cc152", 0.08, [0.45, k.topAt(-1.95, 0.45) + 0.03, -1.95], { scale: [1, 0.6, 1] });
  },
};

// VW Fusca 1300: tudo redondo, para-lamas soltos com o farol em cima, estribo,
// para-choques de lâmina cromados e o motor atrás (com a grade de ventilação).
DESIGNS.fusca = {
  ...sz.fusca,
  wheels: { front: 1.24, rear: -1.16, radius: 0.33, width: 0.16, rim: "steel", rimColor: "#d8d4c8", rimRatio: 0.56, caliper: null, gap: 0.06, inset: -0.07, tub: 0.8 },
  body: {
    top: [[-2.02, 0.46], [-2.0, 0.6], [-1.92, 0.76], [-1.7, 0.88], [-1.4, 0.95], [-0.6, 0.97], [0.5, 0.97], [0.9, 0.93], [1.4, 0.84], [1.75, 0.72], [1.95, 0.58], [2.02, 0.42]],
    bottom: [[-2.02, 0.36], [-1.8, 0.3], [1.8, 0.3], [2.02, 0.36]],
    plan: [[-2.02, 0.3], [-1.95, 0.46], [-1.75, 0.57], [-1.3, 0.63], [-0.5, 0.655], [0.4, 0.655], [1.0, 0.62], [1.5, 0.56], [1.85, 0.46], [2.02, 0.28]],
    shoulder: [[-2.0, 0.66], [0, 0.72], [2.0, 0.6]],
    shape: { nTop: 2.4, nBot: 3, tumble: 0.18, tuck: 0.18, crown: 0.16 },
  },
  cabin: {
    top: [[-1.5, 0.9], [-1.32, 1.07], [-0.98, 1.3], [-0.6, 1.44], [-0.15, 1.5], [0.2, 1.47], [0.42, 1.32], [0.6, 1.1], [0.72, 0.92]],
    shape: { nTop: 2.6, nBot: 8, tumble: 0.34, tuck: 0, crown: 0.05 },
    sink: 0.08,
    ws: [0.64, 0.24],
    b: [-0.42, 0.07],
    c: [[-1.02, 0.94], [-0.8, 1.45]],
    drop: 0.08,
    frame: "chrome",
    bBlack: false,
  },
  doors: [[0.62, -0.32]],
  mirror: { z: 0.45, rise: 0.12, mat: "chrome", size: 0.7 },
  plates: { front: null, rear: 0.6 },
  details: (k) => {
    const { s, wheel, bin } = k;
    const R = wheel.radius;
    // Para-lamas soltos: dianteiro (com o farol no alto) e traseiro (com a lanterna).
    const fender = (zc: number, z0: number, z1: number, topY: P2[], lamp: "head" | "tail") => {
      const top = curve(topY);
      const arch = wheel.arch + 0.01;
      const solid = new Solid({
        z0, z1, top, shape: { nTop: 2.2, nBot: 3, tumble: 0.1, tuck: 0.1, crown: 0 },
        bottom: (z) => {
          const t = Math.max(0, 1 - Math.abs(z - zc) / (z1 - z0));
          return 0.36 + t * 0.02;
        },
        half: curve([[z0, 0.06], [z0 + 0.15, 0.13], [zc, 0.19], [z1 - 0.18, 0.16], [z1, 0.06]]),
        cx: curve([[z0, 0.66], [zc, 0.62], [z1, 0.56]].map(([z, x]) => [z, x] as P2).sort((a, b) => a[0] - b[0])),
        shoulder: (z) => top(z) - 0.16,
        clamp: (z) => {
          const dz = z - zc;
          return Math.abs(dz) < arch ? R + Math.sqrt(arch * arch - dz * dz) : -Infinity;
        },
      });
      const g = solid.geometry(sections(z0, z1, k.detail ? 0.03 : 0.08, k.detail ? 0.015 : 0.05, [], 0.1), k.detail ? 26 : 12);
      bin.add("paint", g);
      bin.add("paint", mirrorX(g));
      solid.release();
      const front = Surf.front(solid);
      const rear = Surf.rear(solid);
      for (const side of [1, -1]) {
        const flipX = (o: P2[]) => o.map(([x, y]) => [x * side, y] as P2);
        if (lamp === "head") {
          // Farol redondo de 7" no bico do para-lama, com o aro cromado.
          const cx = 0.58;
          const cy = top(z1 - 0.14) - 0.08;
          const surf: Surface = side > 0 ? front : { at: (a, b) => { const p = front.at(-a, b); return p ? [-p[0], p[1], p[2]] : null; }, dir: [0, 0, 1] };
          k.lamp(surf, flipX(ellipse(cx, cy, 0.085, 0.085, 28)), LAMP.head, { bezel: "chrome", dome: 0.03, bulbs: [ellipse(cx * side, cy, 0.03, 0.03, 12)].map((e) => e), frame: 0.016 });
          // Pisca em cima do para-lama.
          k.sphere("lamp", LAMP.turn, 0.03, [side * 0.6, top(z1 - 0.45) + 0.01, z1 - 0.45], { scale: [0.8, 0.6, 1.4], seg: 12 });
          k.sphere("chrome", null, 0.034, [side * 0.6, top(z1 - 0.45) - 0.005, z1 - 0.45], { scale: [0.9, 0.5, 1.6], seg: 12 });
        } else {
          const surf: Surface = side > 0 ? rear : { at: (a, b) => { const p = rear.at(-a, b); return p ? [-p[0], p[1], p[2]] : null; }, dir: [0, 0, -1] };
          const cy = top(z0 + 0.2) - 0.05;
          k.lamp(surf, flipX(rounded([[0.6, cy - 0.11], [0.67, cy - 0.09], [0.69, cy + 0.06], [0.62, cy + 0.11], [0.54, cy + 0.06], [0.53, cy - 0.07]], 3)), LAMP.tail, { bezel: "chrome", dome: 0.02 });
        }
      }
    };
    fender(wheel.front, 0.6, 2.0, [[0.6, 0.42], [0.8, 0.64], [1.02, 0.83], [1.3, 0.88], [1.6, 0.88], [1.8, 0.86], [1.93, 0.74], [2.0, 0.5]], "head");
    fender(wheel.rear, -1.98, -0.46, [[-1.98, 0.5], [-1.9, 0.74], [-1.7, 0.87], [-1.4, 0.9], [-1.0, 0.86], [-0.72, 0.68], [-0.46, 0.42]], "tail");
    // Estribo entre os para-lamas.
    k.both((side) => k.box("trim", "#1a1a1a", [0.2, 0.035, 1.3], [side * 0.68, 0.4, 0.07], { r: 0.012 }));
    // Para-choques de lâmina com as garras.
    for (const front of [true, false]) {
      const y = front ? 0.47 : 0.5;
      const pts: [number, number, number][] = [];
      const zEnd = front ? 2.0 + 0.06 : -2.0 - 0.06;
      for (let i = 0; i <= k.seg(20); i++) {
        const t = (i / k.seg(20)) * 2 - 1;
        pts.push([t * 0.82, y, zEnd - (front ? 1 : -1) * (t * t * 0.18)]);
      }
      k.sweep("chrome", null, front ? pts.reverse() : pts, rounded([[-0.03, -0.05], [0.03, -0.05], [0.035, 0.05], [-0.025, 0.055]], 2));
      k.both((side) => {
        k.box("chrome", null, [0.05, 0.22, 0.05], [side * 0.36, y + 0.03, zEnd + (front ? 0.015 : -0.015)], { r: 0.022 });
        k.box("trim", "#222", [0.05, 0.05, 0.2], [side * 0.5, y - 0.04, zEnd - (front ? 0.12 : -0.12)]);
      });
    }
    // Vigia oval pequena (desenhada à mão: a estufa do Fusca é redonda demais para a automática).
    if (k.s.cabRear) k.glass(k.s.cabRear, rounded(roundRect(-0.3, 1.08, 0.3, 1.3, 0.09), 2), "chrome", 0.014);
    // Capô do porta-malas com o friso, a maçaneta e o emblema VW.
    k.strip(s.hood, [[0, 1.98], [0, 1.0]], 0.022, "chrome", null, { off: 0.004 });
    k.patch(s.front, ellipse(0, 0.6, 0.06, 0.06, 24), "chrome", null, { off: 0.008, dome: 0.008 });
    k.patch(s.front, ellipse(0, 0.6, 0.045, 0.045, 24), "accent", "#1c3d8f", { off: 0.012 });
    // Tampa do motor com a grade de ventilação e a luz de placa.
    for (let i = 0; i < 4; i++) {
      for (const side of [1, -1]) k.rect(s.rear, side * 0.06, side * 0.3, 0.86 - i * 0.03, 0.873 - i * 0.03, "trim", "#0d0d0d", { off: 0.004, nb: 1 });
    }
    k.patch(s.rear, roundRect(-0.12, 0.71, 0.12, 0.76, 0.02), "chrome", null, { off: 0.01, dome: 0.01 });
    exhaust(k, 0.32, 0.33, 0.028, 0.2);
    exhaust(k, -0.32, 0.33, 0.028, 0.2);
  },
  food: (k) => {
    // Pão de queijo gigante no teto: casquinha dourada, rachada e com pontinhos queimados.
    const y = k.topAt(-0.15);
    const g = new THREE.SphereGeometry(0.5, k.seg(40), k.seg(26));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      const n = v.clone().normalize();
      const crack = Math.sin(n.x * 9 + Math.sin(n.z * 7) * 2) * Math.sin(n.z * 8 + n.x * 3);
      const r = 0.5 * (1 + 0.035 * Math.sin(n.x * 17) * Math.cos(n.z * 13) - 0.05 * Math.max(0, crack - 0.75));
      v.copy(n).multiplyScalar(r);
      if (v.y < -0.18) v.y = -0.18 + (v.y + 0.18) * 0.2;
      p.setXYZ(i, v.x * 1.1, v.y * 0.62, v.z * 1.1);
    }
    g.computeVertexNormals();
    k.geo("food", g, "#e2aa4f", [0, y + 0.08, -0.15]);
    if (k.detail) for (let i = 0; i < 22; i++) {
      const a = i * 2.4;
      const r = 0.12 + (i % 5) * 0.08;
      k.sphere("food", "#a86424", 0.03, [Math.cos(a) * r, y + 0.08 + 0.3 * Math.sqrt(Math.max(0, 1 - (r / 0.55) ** 2)), -0.15 + Math.sin(a) * r], { scale: [1.4, 0.35, 1.2], seg: 8 });
    }
  },
};

// Porsche 911 Turbo (997): faróis ovais "olho de sapo" em cima dos para-lamas,
// capô baixo entre eles, quadris largos com as tomadas de ar atrás das portas,
// lanternas finas e o aerofólio de duas lâminas.
DESIGNS.porsche = {
  ...sz.porsche,
  wheels: { front: 1.27, rear: -1.08, radius: 0.34, width: 0.24, rim: "twin5", rimRatio: 0.72, caliper: "#f1c40f", flare: [0.02, 0.07] },
  body: {
    top: [[-2.22, 0.5], [-2.2, 0.72], [-2.1, 0.86], [-1.8, 0.94], [-1.2, 0.96], [-0.4, 0.93], [0.6, 0.86], [1.3, 0.78], [1.9, 0.66], [2.15, 0.56], [2.22, 0.42]],
    bottom: [[-2.22, 0.36], [-2.05, 0.22], [-1.6, 0.18], [1.7, 0.17], [2.12, 0.2], [2.22, 0.3]],
    plan: [[-2.22, 0.55], [-2.15, 0.75], [-1.95, 0.84], [-1.4, 0.88], [-0.7, 0.85], [0.2, 0.83], [1.1, 0.86], [1.7, 0.84], [2.05, 0.74], [2.22, 0.5]],
    shoulder: [[-2.2, 0.66], [-1.2, 0.68], [0, 0.66], [1.3, 0.6], [2.2, 0.48]],
    shape: { nTop: 3, nBot: 3.4, tumble: 0.1, tuck: 0.18, crown: 0.1 },
    crown: [[-2.2, 0.15], [-0.3, 0.15], [0.7, -0.05], [1.3, -0.22], [2.0, -0.2], [2.22, 0]],
  },
  cabin: {
    top: [[-1.92, 0.9], [-1.6, 1.0], [-1.1, 1.17], [-0.6, 1.28], [-0.2, 1.3], [0.1, 1.27], [0.45, 1.1], [0.72, 0.9]],
    shape: { nTop: 3.2, nBot: 8, tumble: 0.34, tuck: 0, crown: 0.06 },
    ws: [0.66, 0.08],
    bl: [-0.65, -1.5],
    b: null,
    c: [[-0.92, 0.92], [-0.62, 1.25]],
    drop: 0.08,
  },
  doors: [[0.78, -0.55]],
  mirror: { z: 0.55, rise: 0.08 },
  plates: { front: 0.36, rear: 0.58 },
  details: (k) => {
    const { s } = k;
    k.both((side) => {
      // Farol oval na ponta do para-lama, olhando para a frente e para cima.
      const o = ellipse(0.6 * side, 0.6, 0.15, 0.085, 28, side * 0.25);
      k.lamp(s.front, o, LAMP.headCool, { bulbs: [ellipse(0.66 * side, 0.6, 0.045, 0.04, 16), ellipse(0.52 * side, 0.59, 0.045, 0.04, 14)], dome: 0.02 });
      // Tomadas de ar na frente (três bocas) e piscas.
      k.patch(s.front, roundRect(0.38 * side - 0.18, 0.26, 0.38 * side + 0.18, 0.42, 0.05), "trim", "#0b0b0c", { off: 0.004 });
      k.patch(s.front, roundRect(0.62 * side - 0.08, 0.44, 0.62 * side + 0.08, 0.48, 0.015), "lamp", LAMP.turn, { off: 0.006 });
      // Tomada lateral atrás da porta (quadril do Turbo).
      k.patch(s.side(side), rounded([[-0.62, 0.6], [-0.86, 0.58], [-0.92, 0.72], [-0.66, 0.76]], 2), "trim", "#0b0b0c", { off: 0.004 });
      // Lanternas finas, de ponta a ponta do para-lama.
      k.lamp(s.rear, rounded([[0.36 * side, 0.82], [0.74 * side, 0.8], [0.76 * side, 0.86], [0.38 * side, 0.88]], 2), LAMP.tail, { bulbs: [ellipse(0.62 * side, 0.84, 0.06, 0.02, 12)] });
      exhaust(k, 0.3 * side, 0.3, 0.045, 0.14);
      exhaust(k, 0.42 * side, 0.3, 0.045, 0.14);
    });
    k.patch(s.front, roundRect(-0.2, 0.26, 0.2, 0.42, 0.06), "trim", "#0b0b0c", { off: 0.004 });
    // Capô com o emblema e a tampa do motor com a grade.
    k.patch(s.hood, ellipse(0, 2.0, 0.03, 0.04, 16), "accent", "#c9a227", { off: 0.008, dome: 0.004 });
    honeycomb(k, s.top, -0.4, 0.4, -1.95, -1.55, "#151515", 0.05);
    // Aerofólio de duas lâminas.
    wing(k, -1.9, k.topAt(-1.9) + 0.09, 1.22, 0.24, null, { posts: 0.25, postMat: "paint", plates: false, angle: 0.06 });
    wing(k, -1.98, k.topAt(-1.98) + 0.02, 1.18, 0.16, "#151515", { mat: "trim", posts: 0, plates: false, angle: 0.2 });
    k.rect(s.rear, -0.42, 0.42, 0.8, 0.84, "trim", "#2a0a0a", { off: 0.005 });
  },
  food: (k) => {
    // Pururuca: placas de couro estourado no capô e na tampa, e uma maçã no bico.
    const spots: [number, number, number][] = [[-0.3, 1.5, 0.16], [0.25, 1.25, 0.13], [-0.05, 0.95, 0.12], [0.35, 1.75, 0.1], [-0.4, -1.3, 0.13], [0.2, -1.65, 0.12], [0.0, -1.0, 0.12]];
    for (const [x, z, r] of spots) {
      const y = k.topAt(z, x);
      k.sphere("food", "#e7b46a", r, [x, y, z], { scale: [1, 0.22, 1], seg: 14 });
      if (k.detail) for (let i = 0; i < 4; i++) k.sphere("food", "#f6d79a", r * 0.25, [x + Math.cos(i * 1.6) * r * 0.5, y + 0.02, z + Math.sin(i * 1.6) * r * 0.5], { scale: [1, 0.5, 1], seg: 8 });
    }
    k.sphere("food", "#c8102e", 0.12, [0, k.topAt(2.0, 0) + 0.06, 2.02], { seg: 18 });
    k.cyl("food", "#5b3a1e", 0.01, 0.06, [0, k.topAt(2.0, 0) + 0.19, 2.02], { seg: 6 });
  },
};


// Fiat Uno Mille: a caixinha de quinas vivas, vidro grande, para-choques
// pretos envolventes, faróis retangulares e lanternas em pé na tampa.
DESIGNS.uno = {
  ...sz.uno,
  wheels: { front: 1.145, rear: -1.215, radius: 0.287, width: 0.145, rim: "hubcap", rimColor: "#b9bdc2", rimRatio: 0.58, caliper: null, inset: 0.03 },
  body: {
    top: [[-1.825, 0.5], [-1.815, 0.76], [-1.79, 0.9], [-1.7, 0.93], [-0.5, 0.92], [0.7, 0.885], [1.2, 0.83], [1.65, 0.76], [1.79, 0.7], [1.825, 0.5]],
    bottom: [[-1.825, 0.32], [-1.6, 0.25], [1.5, 0.23], [1.825, 0.3]],
    plan: [[-1.825, 0.66], [-1.79, 0.73], [-1.6, 0.765], [0, 0.775], [1.4, 0.77], [1.74, 0.74], [1.825, 0.68]],
    shoulder: [[-1.8, 0.78], [1.8, 0.68]],
    shape: { nTop: 5, nBot: 5, tumble: 0.06, tuck: 0.06, crown: 0.05 },
  },
  cabin: {
    top: [[-1.8, 0.94], [-1.765, 1.2], [-1.71, 1.37], [-1.56, 1.415], [-0.6, 1.425], [0.0, 1.415], [0.3, 1.3], [0.55, 1.08], [0.78, 0.86]],
    shape: { nTop: 6, nBot: 8, tumble: 0.2, tuck: 0, crown: 0.04 },
    ws: [0.72, 0.05],
    bl: [-1.58, -1.79],
    b: [-0.62, 0.08],
    c: [[-1.48, 0.95], [-1.42, 1.4]],
    drop: 0.06,
  },
  doors: [[0.68, -0.6]],
  mirror: { z: 0.6, rise: 0.06, mat: "trim", size: 0.85 },
  plates: { front: 0.4, rear: 0.62 },
  details: (k) => {
    const { s } = k;
    // Para-choques pretos envolventes e o friso lateral.
    const fb = wrapBumper(k, true, 0.28, 0.54, 0.38, "trim", "#1c1c1e", 0.03);
    const rb = wrapBumper(k, false, 0.3, 0.56, 0.32, "trim", "#1c1c1e", 0.03);
    k.both((side) => {
      k.strip(s.side(side), [[1.48, 0.55], [-1.5, 0.55]], 0.06, "trim", "#1c1c1e", { off: 0.008 });
      // Faróis retangulares de vidro com o pisca ao lado.
      k.lamp(s.front, sideOf(side, roundRect(0.32, 0.6, 0.66, 0.71, 0.012)), LAMP.head, { bulbs: [sideOf(side, roundRect(0.36, 0.615, 0.62, 0.695, 0.01))], dome: 0.004 });
      k.lamp(s.front, sideOf(side, roundRect(0.67, 0.6, 0.745, 0.71, 0.01)), LAMP.turn, { dome: 0.004 });
      // Lanternas em pé nas pontas da tampa.
      k.lamp(s.rear, sideOf(side, roundRect(0.52, 0.66, 0.73, 0.9, 0.015)), LAMP.tail, { bulbs: [sideOf(side, roundRect(0.54, 0.79, 0.71, 0.88, 0.01)), sideOf(side, roundRect(0.54, 0.73, 0.71, 0.775, 0.01))] });
      k.patch(rb.surf, sideOf(side, roundRect(0.55, 0.4, 0.68, 0.44, 0.01)), "lamp", LAMP.tail, { off: 0.006 });
      k.patch(fb.surf, sideOf(side, roundRect(0.45, 0.42, 0.62, 0.47, 0.01)), "trim", "#0a0a0a", { off: 0.006 });
    });
    // Grade com as cinco barras inclinadas e o emblema.
    k.patch(s.front, roundRect(-0.31, 0.6, 0.31, 0.71, 0.01), "trim", "#111113", { off: 0.004 });
    for (let i = 0; i < 5; i++) {
      const x = -0.2 + i * 0.1;
      k.patch(s.front, [[x - 0.03, 0.61], [x - 0.01, 0.61], [x + 0.03, 0.7], [x + 0.01, 0.7]], "chrome", null, { off: 0.008, rings: 1 });
    }
    k.patch(fb.surf, roundRect(-0.36, 0.33, 0.36, 0.38, 0.015), "trim", "#0a0a0a", { off: 0.006 });
    exhaust(k, -0.45, 0.29, 0.025, 0.12);
    antenna(k, 0.62, k.bodyTop(0.7) + 0.02, 0.7, 0.7, -0.15);
  },
  food: (k) => {
    // Coxinha gigante no teto: gota empanada, com a pontinha e uma mordida mostrando o frango.
    const y = k.topAt(-0.55);
    const prof: P2[] = [];
    const n = k.seg(26);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const yy = t * 0.95;
      const r = t < 0.38 ? 0.36 * Math.sqrt(1 - ((0.38 - t) / 0.38) ** 2) : 0.36 * Math.pow(1 - (t - 0.38) / 0.62, 1.35);
      prof.push([Math.max(0.004, r), yy]);
    }
    const g = new THREE.LatheGeometry(prof.map(([r, yy]) => new THREE.Vector2(r, yy)), k.seg(36));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), yy = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(z, x);
      const bumpy = 1 + 0.04 * Math.sin(a * 11 + yy * 23) * Math.sin(yy * 31 + a * 3);
      p.setXYZ(i, x * bumpy, yy, z * bumpy);
    }
    g.computeVertexNormals();
    k.geo("food", g, "#c97a2b", [0, y - 0.03, -0.55], [0.12, 0, 0.08]);
    k.sphere("food", "#f3e3b5", 0.13, [0.24, y + 0.22, -0.35], { scale: [0.45, 0.8, 0.8], seg: 14 });
    k.cyl("food", "#a85a1c", 0.025, 0.12, [0.1, y + 0.98, -0.47], { r2: 0.015, rot: [0.12, 0, 0.1], seg: 8 });
  },
};

// VW Gol G2 "bolinha": hatch arredondado, faróis ovais emendados na grade fina,
// lanternas largas e o bagageiro no teto.
DESIGNS.gol = {
  ...sz.gol,
  wheels: { front: 1.18, rear: -1.29, radius: 0.29, width: 0.175, rim: "hubcap", rimColor: "#aeb3b8", rimRatio: 0.58, caliper: null },
  body: {
    top: [[-1.9, 0.52], [-1.885, 0.78], [-1.83, 0.9], [-1.65, 0.95], [-0.5, 0.93], [0.6, 0.89], [1.2, 0.82], [1.62, 0.72], [1.83, 0.62], [1.9, 0.48]],
    bottom: [[-1.9, 0.32], [-1.65, 0.24], [1.5, 0.22], [1.9, 0.3]],
    plan: [[-1.9, 0.62], [-1.83, 0.75], [-1.5, 0.8], [0, 0.8], [1.3, 0.79], [1.7, 0.74], [1.9, 0.6]],
    shoulder: [[-1.9, 0.78], [0, 0.72], [1.9, 0.6]],
    shape: { nTop: 3.2, nBot: 3.8, tumble: 0.12, tuck: 0.14, crown: 0.1 },
  },
  cabin: {
    top: [[-1.83, 0.95], [-1.74, 1.14], [-1.56, 1.32], [-1.3, 1.39], [-0.4, 1.4], [0.05, 1.38], [0.35, 1.25], [0.62, 1.05], [0.82, 0.88]],
    shape: SHAPE.cabinRound,
    ws: [0.76, 0.08],
    bl: [-1.3, -1.8],
    b: [-0.66, 0.08],
    c: [[-1.42, 0.95], [-1.22, 1.37]],
    drop: 0.065,
  },
  doors: [[0.74, -0.64]],
  mirror: { z: 0.66, rise: 0.06, mat: "trim", size: 0.85 },
  plates: { front: 0.38, rear: 0.62 },
  details: (k) => {
    const { s } = k;
    const fb = wrapBumper(k, true, 0.27, 0.5, 0.4, "trim", "#3a3b3e", 0.03, { nTop: 4, nBot: 4 });
    wrapBumper(k, false, 0.29, 0.53, 0.35, "trim", "#3a3b3e", 0.03, { nTop: 4, nBot: 4 });
    k.both((side) => {
      k.strip(s.side(side), [[1.5, 0.5], [-1.55, 0.5]], 0.05, "trim", "#3a3b3e", { off: 0.008 });
      // Faróis ovais com o pisca na ponta, emendados na grade.
      k.lamp(s.front, sideOf(side, rounded([[0.28, 0.56], [0.6, 0.56], [0.7, 0.6], [0.66, 0.68], [0.3, 0.68]], 2)), LAMP.head, { bulbs: [sideOf(side, ellipse(0.46, 0.62, 0.11, 0.04, 20))], dome: 0.006 });
      // Lanternas largas, quase ovais.
      k.lamp(s.rear, sideOf(side, rounded([[0.32, 0.68], [0.7, 0.66], [0.74, 0.76], [0.66, 0.84], [0.34, 0.84]], 2)), LAMP.tail, { bulbs: [sideOf(side, roundRect(0.36, 0.74, 0.66, 0.82, 0.02)), sideOf(side, roundRect(0.38, 0.69, 0.55, 0.725, 0.01))] });
      k.patch(fb.surf, sideOf(side, ellipse(0.55, 0.38, 0.05, 0.03, 14)), "lamp", LAMP.head, { off: 0.007 });
    });
    k.patch(s.front, roundRect(-0.26, 0.57, 0.26, 0.66, 0.02), "trim", "#141416", { off: 0.004 });
    grilleBars(k, s.front, -0.24, 0.24, 0.58, 0.65, 3, "trim", "#2e2f33");
    k.patch(s.front, ellipse(0, 0.615, 0.05, 0.05, 20), "chrome", null, { off: 0.012, dome: 0.004 });
    k.patch(fb.surf, roundRect(-0.38, 0.3, 0.38, 0.36, 0.02), "trim", "#111", { off: 0.006 });
    exhaust(k, -0.45, 0.28, 0.026, 0.12);
    antenna(k, 0.0, k.topAt(0.05), 0.05, 0.4, -0.5);
  },
  food: (k) => {
    // Bagageiro no teto com bolinhas de queijo (empanadas, uma mordida com o queijo puxando).
    const z0 = -1.15;
    const z1 = 0.0;
    const yb = k.topAt(-0.6) + 0.07;
    k.both((side) => {
      k.box("trim", "#151517", [0.04, 0.035, z1 - z0], [side * 0.5, yb, (z0 + z1) / 2], { r: 0.012 });
      for (const z of [z0 + 0.05, z1 - 0.05]) k.box("trim", "#151517", [0.06, 0.07, 0.07], [side * 0.5, yb - 0.04, z], { r: 0.015 });
    });
    for (const z of [z0 + 0.2, (z0 + z1) / 2, z1 - 0.2]) k.box("trim", "#202022", [1.04, 0.025, 0.04], [0, yb + 0.02, z], { r: 0.01 });
    const balls: [number, number, number][] = [[-0.3, -0.95, 0], [0.05, -0.92, 0], [0.32, -0.98, 0], [-0.22, -0.6, 0], [0.15, -0.62, 0], [-0.32, -0.28, 0], [0.04, -0.3, 0], [0.33, -0.33, 0], [-0.08, -0.62, 1], [0.15, -0.75, 1]];
    // Bolinha empanada: esfera com a casquinha irregular (farinha de rosca).
    const ball = new THREE.SphereGeometry(0.13, k.seg(18), k.seg(12));
    const bp = ball.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(bp, i);
      const n = v.clone().normalize();
      const f = 1 + 0.07 * Math.sin(n.x * 23 + n.y * 7) * Math.sin(n.z * 19 + n.x * 5) + 0.04 * Math.sin(n.y * 31);
      bp.setXYZ(i, v.x * f, v.y * f, v.z * f);
    }
    ball.computeVertexNormals();
    for (const [x, z, layer] of balls) {
      const y = yb + 0.035 + 0.13 + layer * 0.17;
      k.geo("food", ball.clone(), layer ? "#efbb5a" : "#e3a94c", [x, y, z], [x * 3, z * 2, 0]);
    }
    // O queijo puxando de uma bolinha mordida.
    k.tube("food", "#fbe7a3", [[0.15, yb + 0.5, -0.75], [0.22, yb + 0.62, -0.68], [0.3, yb + 0.6, -0.6]], 0.025, { seg: 8, radial: 6 });
  },
};

// Toyota Etios hatch: alto e estreito, teto reto até o fim, faróis grandes
// puxados para o para-lama, a grade fininha em cima e a boca trapezoidal no
// para-choque. Calotas de aço, como todo Etios de autoescola.
DESIGNS.etios = {
  ...sz.etios,
  wheels: { front: 1.13, rear: -1.33, radius: 0.29, width: 0.175, rim: "hubcap", rimColor: "#b3b7bc", rimRatio: 0.6, caliper: null, inset: 0.025 },
  body: {
    top: [[-1.89, 0.55], [-1.88, 0.84], [-1.84, 0.95], [-1.74, 0.985], [-0.8, 0.975], [0.2, 0.95], [0.9, 0.905], [1.35, 0.86], [1.68, 0.8], [1.84, 0.73], [1.89, 0.52]],
    bottom: [[-1.89, 0.35], [-1.7, 0.25], [1.6, 0.22], [1.89, 0.3]],
    plan: [[-1.89, 0.74], [-1.84, 0.8], [-1.6, 0.835], [0, 0.845], [1.2, 0.84], [1.65, 0.79], [1.84, 0.7], [1.89, 0.56]],
    shoulder: [[-1.89, 0.8], [0, 0.77], [1.89, 0.64]],
    shape: { nTop: 4.8, nBot: 4.5, tumble: 0.06, tuck: 0.09, crown: 0.07 },
  },
  cabin: {
    top: [[-1.82, 0.985], [-1.79, 1.2], [-1.72, 1.42], [-1.55, 1.5], [-0.6, 1.51], [0.05, 1.49], [0.35, 1.36], [0.68, 1.12], [0.96, 0.9]],
    shape: SHAPE.cabin,
    ws: [0.92, 0.08],
    bl: [-1.56, -1.8],
    b: [-0.3, 0.08],
    c: [[-1.3, 0.98], [-1.14, 1.48]],
    drop: 0.065,
  },
  doors: [[0.9, -0.28], [-0.33, -1.06]],
  mirror: { z: 0.8, rise: 0.06, size: 0.9 },
  plates: { front: 0.38, rear: 0.6 },
  details: (k) => {
    const { s } = k;
    k.both((side) => {
      // Faróis grandes, subindo e entrando no para-lama, com a lâmpada redonda e o pisca.
      k.lamp(s.front, sideOf(side, rounded([[0.3, 0.6], [0.58, 0.6], [0.76, 0.63], [0.82, 0.7], [0.62, 0.73], [0.32, 0.69]], 2)), LAMP.head, { bulbs: [sideOf(side, ellipse(0.5, 0.655, 0.06, 0.04, 18))], dome: 0.006 });
      k.patch(s.front, sideOf(side, roundRect(0.66, 0.635, 0.77, 0.67, 0.012)), "lamp", LAMP.turn, { off: 0.008 });
      // Lanternas em pé no canto da tampa, entrando na lateral.
      k.lamp(s.rear, sideOf(side, rounded([[0.46, 0.7], [0.68, 0.7], [0.7, 0.86], [0.62, 0.92], [0.47, 0.91]], 2)), LAMP.tail, { bulbs: [sideOf(side, roundRect(0.5, 0.8, 0.65, 0.88, 0.012)), sideOf(side, roundRect(0.5, 0.73, 0.65, 0.77, 0.01))] });
      // Faróis de neblina nas pontas do para-choque.
      k.lamp(s.front, sideOf(side, ellipse(0.64, 0.38, 0.045, 0.035, 16)), LAMP.head, { bezel: "trim" });
      k.patch(s.rear, sideOf(side, roundRect(0.46, 0.38, 0.6, 0.42, 0.01)), "lamp", LAMP.tail, { off: 0.006 });
    });
    // Grade fininha entre os faróis, com o friso cromado e o emblema.
    k.patch(s.front, rounded([[-0.3, 0.62], [0.3, 0.62], [0.32, 0.69], [-0.32, 0.69]], 1), "trim", "#141416", { off: 0.004 });
    k.patch(s.front, roundRect(-0.28, 0.645, 0.28, 0.66, 0.006), "chrome", null, { off: 0.008 });
    k.patch(s.front, ellipse(0, 0.655, 0.055, 0.035, 18), "chrome", null, { off: 0.011, dome: 0.003 });
    // A boca trapezoidal grande no para-choque.
    const mouth: P2[] = rounded([[-0.44, 0.27], [0.44, 0.27], [0.38, 0.5], [-0.38, 0.5]], 2);
    k.patch(s.front, mouth, "trim", "#0d0d0f", { off: 0.004 });
    grilleBars(k, s.front, -0.38, 0.38, 0.3, 0.47, 3, "trim", "#26262a");
    // Para-choque de trás com a faixa preta embaixo, escape e a antena no fim do teto.
    k.patch(s.rear, roundRect(-0.6, 0.27, 0.6, 0.34, 0.02), "trim", "#141416", { off: 0.005 });
    k.patch(s.rear, roundRect(-0.12, 0.66, 0.12, 0.69, 0.01), "chrome", null, { off: 0.008 });
    exhaust(k, -0.45, 0.28, 0.025, 0.12);
    antenna(k, 0.0, k.topAt(-1.45), -1.45, 0.45, -0.4);
  },
  food: (k) => {
    // Marmita de alumínio no teto, aberta: arroz, feijão, bife, ovo frito e salada.
    const y = k.topAt(-0.55) + 0.01;
    const z = -0.6;
    const W = 0.92;
    const D = 1.15;
    const H = 0.17;
    k.box("chrome", null, [W, 0.02, D], [0, y + 0.01, z], { r: 0.008 });
    k.both((side) => k.box("chrome", null, [0.025, H, D], [side * (W / 2 - 0.012), y + H / 2, z], { r: 0.008 }));
    for (const dz of [-1, 1]) k.box("chrome", null, [W, H, 0.025], [0, y + H / 2, z + dz * (D / 2 - 0.012)], { r: 0.008 });
    // A borda dobrada da marmita.
    k.box("chrome", null, [W + 0.06, 0.018, 0.05], [0, y + H, z + D / 2], { r: 0.006 });
    k.box("chrome", null, [W + 0.06, 0.018, 0.05], [0, y + H, z - D / 2], { r: 0.006 });
    // A tampa aberta, de pé atrás.
    k.box("chrome", null, [W + 0.04, 0.02, 0.45], [0, y + H + 0.17, z - D / 2 - 0.06], { r: 0.008, rot: [-1.25, 0, 0] });
    const top = y + H - 0.02;
    // Arroz (montinho branco cheio de grão) e feijão (caldo escuro com grãos).
    const rice = new THREE.SphereGeometry(0.3, k.seg(20), k.seg(12), 0, Math.PI * 2, 0, Math.PI / 2);
    const rp = rice.attributes.position;
    for (let i = 0; i < rp.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(rp, i);
      const f = 1 + 0.05 * Math.sin(v.x * 70) * Math.sin(v.z * 63 + v.y * 40);
      rp.setXYZ(i, v.x * f * 1.35, v.y * 0.45 * f, v.z * f);
    }
    rice.computeVertexNormals();
    k.geo("food", rice, "#f4f1e6", [-0.2, top - 0.03, z + 0.22]);
    k.box("food", "#3b2216", [0.38, 0.03, 0.42], [0.24, top - 0.01, z + 0.25], { r: 0.015 });
    for (let i = 0; i < 9; i++) k.sphere("food", "#2a160d", 0.03, [0.12 + (i % 3) * 0.11, top + 0.01, z + 0.12 + Math.floor(i / 3) * 0.12], { scale: [1.3, 0.7, 0.9], seg: 8 });
    // Bife acebolado.
    k.box("food", "#6e3a1c", [0.42, 0.04, 0.3], [-0.18, top, z - 0.22], { r: 0.03, rot: [0, 0.2, 0] });
    for (const dx of [-0.1, 0.02, 0.12]) k.cyl("food", "#e9d8a6", 0.035, 0.01, [-0.18 + dx, top + 0.03, z - 0.2 + dx * 0.3], { seg: 10 });
    // Ovo frito: clara achatada e a gema.
    k.cyl("food", "#fbf8ef", 0.13, 0.015, [0.24, top + 0.02, z - 0.22], { seg: 18 });
    k.sphere("food", "#f2a20c", 0.05, [0.26, top + 0.035, z - 0.2], { scale: [1, 0.55, 1], seg: 12 });
    // Salada: alface e rodelas de tomate na ponta.
    for (const [dx, dz] of [[-0.3, -0.45], [-0.18, -0.48], [0.3, -0.45]] as const) k.sphere("food", "#5fa83a", 0.07, [dx, top + 0.02, z + dz], { scale: [1.2, 0.6, 1], seg: 10 });
    for (const dx of [0.0, 0.12]) k.cyl("food", "#d2352a", 0.06, 0.02, [dx, top + 0.035, z - 0.46], { seg: 14, rot: [0.2, 0, 0.1] });
  },
};

// VW Golf GTI (Mk5): hatch de ombro marcado, a grade em escudo preta em
// colmeia com o friso vermelho, faróis grandes com dois projetores e o
// spoiler no alto da tampa.
DESIGNS.hatch = {
  ...sz.hatch,
  wheels: { front: 1.24, rear: -1.34, radius: 0.32, width: 0.225, rim: "five", rimColor: "#c4c8cc", rimRatio: 0.715, caliper: "#c1121f" },
  body: {
    top: [[-2.1, 0.55], [-2.09, 0.85], [-2.05, 0.98], [-1.95, 1.0], [-1.0, 1.0], [0.0, 0.97], [0.9, 0.93], [1.45, 0.89], [1.85, 0.83], [2.04, 0.75], [2.1, 0.55]],
    bottom: [[-2.1, 0.38], [-1.95, 0.25], [1.9, 0.22], [2.1, 0.32]],
    plan: [[-2.1, 0.75], [-2.05, 0.84], [-1.8, 0.875], [0, 0.88], [1.3, 0.875], [1.85, 0.82], [2.05, 0.72], [2.1, 0.56]],
    shoulder: [[-2.1, 0.86], [-1.0, 0.84], [1.0, 0.8], [2.1, 0.66]],
    shape: { nTop: 4, nBot: 3.8, tumble: 0.08, tuck: 0.14, crown: 0.1 },
  },
  cabin: {
    top: [[-2.03, 1.0], [-1.985, 1.2], [-1.9, 1.38], [-1.7, 1.45], [-0.8, 1.47], [-0.1, 1.455], [0.3, 1.35], [0.7, 1.12], [1.02, 0.93]],
    shape: SHAPE.cabin,
    ws: [0.97, 0.02],
    bl: [-1.78, -2.0],
    b: [-0.32, 0.09],
    c: [[-1.25, 0.98], [-1.02, 1.45]],
    drop: 0.07,
  },
  doors: [[1.0, -0.3], [-0.34, -1.08]],
  mirror: { z: 0.88, rise: 0.06 },
  plates: { front: 0.36, rear: 0.62 },
  details: (k) => {
    const { s } = k;
    k.both((side) => {
      // Faróis grandes com dois projetores redondos.
      k.lamp(s.front, sideOf(side, rounded([[0.3, 0.6], [0.66, 0.6], [0.8, 0.66], [0.78, 0.74], [0.52, 0.74], [0.3, 0.7]], 2)), LAMP.headCool, { bulbs: [sideOf(side, ellipse(0.62, 0.67, 0.05, 0.05, 18)), sideOf(side, ellipse(0.44, 0.66, 0.045, 0.045, 18))] });
      k.lamp(s.front, sideOf(side, ellipse(0.64, 0.38, 0.05, 0.05, 18)), LAMP.head, { bezel: "trim" });
      // Lanternas horizontais que entram na tampa.
      k.lamp(s.rear, sideOf(side, rounded([[0.36, 0.86], [0.78, 0.84], [0.84, 0.9], [0.8, 0.96], [0.4, 0.95]], 2)), LAMP.tail, { bulbs: [sideOf(side, ellipse(0.66, 0.9, 0.08, 0.03, 16)), sideOf(side, ellipse(0.46, 0.905, 0.05, 0.025, 14))] });
    });
    // Grade em escudo: a parte de cima fina (com o friso vermelho) e a boca grande de baixo.
    const shield: P2[] = rounded([[-0.3, 0.71], [0.3, 0.71], [0.32, 0.62], [0.46, 0.5], [0.48, 0.3], [-0.48, 0.3], [-0.46, 0.5], [-0.32, 0.62]], 2);
    k.patch(s.front, shield, "trim", "#0e0e10", { off: 0.004 });
    honeycomb(k, s.front, -0.42, 0.42, 0.31, 0.6, "#26262a", 0.034);
    k.rect(s.front, -0.3, 0.3, 0.655, 0.67, "trim", "#d00000", { off: 0.009 });
    k.patch(s.front, roundRect(-0.07, 0.505, 0.07, 0.555, 0.02), "trim", "#e8e8e8", { off: 0.01 });
    k.patch(s.front, roundRect(-0.045, 0.515, 0.045, 0.545, 0.01), "trim", "#d00000", { off: 0.012 });
    k.patch(s.front, ellipse(0, 0.685, 0.04, 0.04, 18), "chrome", null, { off: 0.012, dome: 0.004 });
    // Spoiler no alto da tampa e os dois escapamentos do mesmo lado.
    wing(k, -1.92, k.topAt(-1.88) + 0.004, 1.2, 0.2, null, { posts: 0, plates: false, angle: 0.1 });
    exhaust(k, -0.48, 0.3, 0.035, 0.12);
    exhaust(k, -0.38, 0.3, 0.035, 0.12);
    k.rect(s.rear, -0.6, 0.6, 0.3, 0.36, "trim", "#141416", { off: 0.004 });
    antenna(k, 0, k.topAt(-1.4), -1.4, 0.1, -1.4);
  },
  food: (k) => {
    // Romeu e Julieta: faixas de queijo sobre a goiabada e um queijo minas no teto.
    for (const x of [-0.24, 0.24]) topStripe(k, x - 0.09, x + 0.09, "#f6d36b");
    const y = k.topAt(-0.7);
    k.cyl("food", "#f4ecd2", 0.34, 0.2, [0, y + 0.1, -0.7], { seg: 32 });
    k.cyl("food", "#efe3c0", 0.33, 0.012, [0, y + 0.205, -0.7], { seg: 32 });
    k.box("food", "#8a1424", [0.26, 0.14, 0.3], [0.05, y + 0.28, -0.75], { r: 0.02, rot: [0, 0.4, 0] });
  },
};

// Chevrolet Opala SS 4.1 cupê (1975-79): capô comprido, cupê fastback sem
// coluna B, faróis redondos, grade cromada larga, para-choques de lâmina e o
// capô preto do SS.
DESIGNS.opala = {
  ...sz.opala,
  wheels: { front: 1.45, rear: -1.22, radius: 0.33, width: 0.195, rim: "rally", rimColor: "#c7cbd0", rimRatio: 0.56, caliper: null },
  body: {
    top: [[-2.4, 0.55], [-2.38, 0.78], [-2.3, 0.86], [-1.6, 0.88], [-0.6, 0.86], [0.6, 0.86], [1.6, 0.85], [2.2, 0.82], [2.37, 0.76], [2.4, 0.56]],
    bottom: [[-2.4, 0.4], [-2.2, 0.28], [2.2, 0.26], [2.4, 0.38]],
    plan: [[-2.4, 0.8], [-2.35, 0.86], [-2.0, 0.89], [0, 0.89], [2.0, 0.89], [2.34, 0.86], [2.4, 0.82]],
    shoulder: [[-2.4, 0.76], [2.4, 0.74]],
    shape: { nTop: 4.5, nBot: 4, tumble: 0.06, tuck: 0.12, crown: 0.06 },
  },
  cabin: {
    top: [[-1.85, 0.86], [-1.6, 0.97], [-1.2, 1.14], [-0.75, 1.29], [-0.3, 1.335], [0.15, 1.325], [0.45, 1.18], [0.7, 0.98], [0.92, 0.82]],
    shape: { nTop: 5, nBot: 8, tumble: 0.24, tuck: 0, crown: 0.05 },
    ws: [0.86, 0.18],
    bl: [-0.72, -1.62],
    b: null,
    c: [[-1.25, 0.9], [-0.86, 1.3]],
    drop: 0.065,
    frame: "chrome",
  },
  doors: [[0.78, -0.58]],
  mirror: { z: 0.66, rise: 0.08, mat: "chrome", size: 0.7 },
  plates: { front: null, rear: 0.62 },
  details: (k) => {
    const { s } = k;
    // Grade larga cromada com os faróis redondos nas pontas.
    k.patch(s.front, roundRect(-0.86, 0.56, 0.86, 0.8, 0.02), "chrome", null, { off: 0.004 });
    k.patch(s.front, roundRect(-0.6, 0.58, 0.6, 0.78, 0.01), "trim", "#0d0d0e", { off: 0.007 });
    grilleBars(k, s.front, -0.58, 0.58, 0.59, 0.77, 6, "chrome", null);
    k.patch(s.front, roundRect(-0.12, 0.64, 0.12, 0.72, 0.015), "trim", "#c1121f", { off: 0.012 });
    k.both((side) => {
      k.patch(s.front, sideOf(side, roundRect(0.6, 0.57, 0.85, 0.79, 0.02)), "trim", "#0d0d0e", { off: 0.007 });
      k.lamp(s.front, sideOf(side, ellipse(0.725, 0.68, 0.085, 0.085, 28)), LAMP.head, { bezel: "chrome", dome: 0.025, bulbs: [sideOf(side, ellipse(0.725, 0.68, 0.03, 0.03, 12))], frame: 0.012 });
      // Lanternas retangulares largas.
      k.lamp(s.rear, sideOf(side, roundRect(0.3, 0.6, 0.84, 0.78, 0.015)), LAMP.tail, { bezel: "chrome", bulbs: [sideOf(side, roundRect(0.33, 0.62, 0.6, 0.76, 0.01)), sideOf(side, roundRect(0.62, 0.62, 0.81, 0.76, 0.01))] });
      exhaust(k, side * 0.5, 0.3, 0.032, 0.14);
    });
    // Para-choques de lâmina cromados.
    for (const front of [true, false]) {
      const y = front ? 0.48 : 0.5;
      k.sweep("chrome", null, bumperPath(k, y, 0.88, 0.25, front, 0.03), rounded([[-0.035, -0.06], [0.035, -0.06], [0.04, 0.06], [-0.03, 0.065]], 2));
      k.both((side) => k.box("trim", "#1a1a1a", [0.06, 0.14, 0.05], [side * 0.42, y, (front ? 1 : -1) * (k.L / 2 + 0.05)], { r: 0.02 }));
    }
    k.patch(s.rear, roundRect(-0.28, 0.62, 0.28, 0.76, 0.01), "chrome", null, { off: 0.006 });
  },
  food: (k) => {
    // O SS: capô preto fosco e as faixas pretas nas laterais.
    k.rect(k.s.hood, -0.55, 0.55, 1.05, 2.3, "trim", "#141414", { off: 0.005, step: 0.06 });
    k.both((side) => k.strip(k.s.side(side), [[1.9, 0.66], [0.4, 0.66], [-1.9, 0.66]], 0.07, "accent", "#111111", { off: 0.006 }));
    // Picanha no espeto, no teto: as peças dobradas em "C", a capa de gordura por fora e as marcas da grelha.
    const y = k.topAt(-0.3) + 0.2;
    k.cyl("chrome", null, 0.018, 1.9, [0, y - 0.1, -0.3], { rot: [Math.PI / 2, 0, 0], seg: 10 });
    k.cyl("trim", "#5b3a1e", 0.035, 0.25, [0, y - 0.1, -0.3 + 1.05], { rot: [Math.PI / 2, 0, 0], seg: 10 });
    k.both((side) => k.box("trim", "#3a2a1e", [0.05, 0.14, 0.05], [0, y - 0.18, -0.3 + side * 0.8], { r: 0.015 }));
    const arc = Math.PI * 1.45;
    const turn = -Math.PI / 2 - (arc + (Math.PI * 2 - arc) / 2);
    for (const z of [-0.78, -0.3, 0.18]) {
      const meat = new THREE.TorusGeometry(0.15, 0.07, k.seg(10), k.seg(22), arc);
      meat.rotateZ(turn);
      meat.scale(1, 1, 2.2);
      meat.rotateY(Math.PI / 2);
      k.geo("food", meat, "#8c3420", [0, y, z]);
      const fat = new THREE.TorusGeometry(0.205, 0.03, k.seg(6), k.seg(22), arc * 0.9);
      fat.rotateZ(turn + arc * 0.05);
      fat.scale(1, 1, 4.6);
      fat.rotateY(Math.PI / 2);
      k.geo("food", fat, "#f1e6cf", [0, y, z]);
      if (k.detail) for (let m = -1; m <= 1; m++) k.box("food", "#2b120a", [0.17, 0.012, 0.03], [0, y + 0.215, z + m * 0.09], { rot: [0, 0.5, 0] });
    }
  },
};

// Ford Mustang GT (S550): capô comprido com as entradas, a boca trapezoidal,
// faróis em lâmina, lanternas de três barras em pé e o teto fastback.
DESIGNS.muscle = {
  ...sz.muscle,
  wheels: { front: 1.45, rear: -1.27, radius: 0.344, width: 0.255, rim: "twin5", rimColor: "#33363b", rimRatio: 0.7, caliper: "#c1121f", flare: [0.01, 0.03] },
  body: {
    top: [[-2.4, 0.6], [-2.39, 0.86], [-2.3, 0.97], [-2.05, 0.995], [-1.3, 0.975], [-0.2, 0.93], [0.8, 0.92], [1.6, 0.87], [2.15, 0.79], [2.33, 0.72], [2.4, 0.52]],
    bottom: [[-2.4, 0.4], [-2.2, 0.26], [2.1, 0.22], [2.4, 0.3]],
    plan: [[-2.4, 0.72], [-2.32, 0.88], [-1.9, 0.955], [-1.2, 0.96], [0, 0.93], [1.4, 0.95], [2.0, 0.9], [2.3, 0.8], [2.4, 0.64]],
    shoulder: [[-2.4, 0.86], [-1.2, 0.83], [0.5, 0.75], [2.4, 0.68]],
    shape: { nTop: 4, nBot: 3.6, tumble: 0.08, tuck: 0.16, crown: 0.08 },
  },
  cabin: {
    top: [[-1.95, 0.99], [-1.7, 1.05], [-1.25, 1.2], [-0.8, 1.33], [-0.35, 1.375], [0.05, 1.365], [0.4, 1.25], [0.75, 1.05], [1.02, 0.89]],
    shape: SHAPE.cabin,
    ws: [0.97, 0.08],
    bl: [-0.7, -1.85],
    b: null,
    c: [[-1.25, 0.95], [-0.72, 1.36]],
    drop: 0.075,
  },
  doors: [[0.9, -0.62]],
  mirror: { z: 0.78, rise: 0.07 },
  plates: { front: 0.4, rear: 0.66 },
  details: (k) => {
    const { s } = k;
    // Boca trapezoidal grande com a colmeia e o cavalinho cromado.
    const mouth: P2[] = rounded([[-0.5, 0.74], [0.5, 0.74], [0.64, 0.6], [0.6, 0.4], [-0.6, 0.4], [-0.64, 0.6]], 1);
    k.patch(s.front, mouth, "trim", "#0c0c0d", { off: 0.004 });
    honeycomb(k, s.front, -0.6, 0.6, 0.4, 0.7, "#1f1f22", 0.04);
    k.patch(s.front, [[-0.1, 0.56], [0.08, 0.6], [0.12, 0.54], [-0.06, 0.52]], "chrome", null, { off: 0.012, dome: 0.006 });
    k.both((side) => {
      // Faróis em lâmina com as três "guelras" de LED.
      k.lamp(s.front, sideOf(side, rounded([[0.6, 0.72], [0.9, 0.73], [0.92, 0.79], [0.66, 0.79]], 2)), LAMP.headCool, { bulbs: [0, 1, 2].map((i) => sideOf(side, roundRect(0.68 + i * 0.05, 0.735, 0.7 + i * 0.05, 0.775, 0.004))) });
      k.patch(s.front, sideOf(side, rounded([[0.62, 0.3], [0.86, 0.3], [0.84, 0.42], [0.66, 0.42]], 2)), "trim", "#0c0c0d", { off: 0.004 });
      // Três barras em pé de cada lado, no painel preto.
      k.patch(s.rear, sideOf(side, roundRect(0.3, 0.76, 0.84, 0.94, 0.02)), "trim", "#0c0c0d", { off: 0.004 });
      for (let i = 0; i < 3; i++) k.lamp(s.rear, sideOf(side, roundRect(0.4 + i * 0.14, 0.78, 0.48 + i * 0.14, 0.92, 0.015)), LAMP.tail, { bezel: null, dome: 0.006 });
      // Entradas do capô e as quatro saídas de escape.
      k.patch(s.hood, sideOf(side, rounded([[0.28, 1.5], [0.44, 1.52], [0.42, 1.68], [0.3, 1.66]], 2)), "trim", "#0c0c0d", { off: 0.004 });
      exhaust(k, side * 0.48, 0.32, 0.045, 0.14);
      exhaust(k, side * 0.6, 0.32, 0.045, 0.14);
    });
    k.rect(s.rear, -0.6, 0.6, 0.3, 0.38, "trim", "#141416", { off: 0.004 });
    k.patch(s.front, roundRect(-0.7, 0.24, 0.7, 0.3, 0.02), "trim", "#111", { off: 0.004 });
    wing(k, -2.2, 1.02, 1.4, 0.12, null, { posts: 0, plates: false, angle: 0.25 });
  },
  food: (k) => {
    // Faixas pretas de corrida por cima e um tubo de mostarda gigante no teto.
    for (const x of [-0.22, 0.22]) topStripe(k, x - 0.12, x + 0.12, "#121212");
    const y = k.topAt(-0.4);
    const prof: P2[] = [[0.001, 0], [0.16, 0.02], [0.2, 0.1], [0.2, 0.75], [0.17, 0.85], [0.08, 0.92], [0.06, 1.0], [0.03, 1.12], [0.001, 1.13]];
    // O frasco deitado, com o bico para trás, e a tampa vermelha na frente.
    k.lathe("food", "#f2c200", prof, [0, y + 0.2, 0.25], { rot: [-Math.PI / 2, 0, 0], seg: 28, scale: [0.85, 0.85, 0.85] });
    k.lathe("food", "#d62828", [[0.001, 0], [0.175, 0], [0.175, 0.08], [0.12, 0.11], [0.001, 0.11]], [0, y + 0.2, 0.25], { rot: [Math.PI / 2, 0, 0], seg: 28 });
    k.box("food", "#f7f3e6", [0.02, 0.16, 0.36], [0.172, y + 0.2, -0.15], { r: 0.008 });
  },
};

// Toyota Supra (Mk4): tudo arredondado, bico baixo com a boca oval, faróis
// com três projetores, lanternas redondas e o aerofólio em arco.
DESIGNS.supra = {
  ...sz.supra,
  wheels: { front: 1.25, rear: -1.3, radius: 0.32, width: 0.25, rim: "five", rimColor: "#c9ced4", rimRatio: 0.69, caliper: "#c1121f", flare: [0.01, 0.02] },
  body: {
    top: [[-2.25, 0.58], [-2.24, 0.82], [-2.15, 0.93], [-1.9, 0.97], [-1.3, 0.96], [-0.5, 0.9], [0.5, 0.84], [1.3, 0.76], [1.9, 0.66], [2.15, 0.56], [2.25, 0.42]],
    bottom: [[-2.25, 0.36], [-2.05, 0.22], [2.0, 0.18], [2.25, 0.26]],
    plan: [[-2.25, 0.62], [-2.15, 0.82], [-1.8, 0.895], [-1.3, 0.905], [0, 0.885], [1.2, 0.9], [1.8, 0.84], [2.1, 0.72], [2.25, 0.5]],
    shoulder: [[-2.25, 0.8], [-1.3, 0.78], [0, 0.68], [1.3, 0.6], [2.25, 0.46]],
    shape: { nTop: 2.8, nBot: 3.4, tumble: 0.14, tuck: 0.2, crown: 0.12 },
    crown: [[-2.25, 0.12], [0.4, 0.1], [1.3, -0.04], [2.25, 0.02]],
  },
  cabin: {
    top: [[-1.62, 0.96], [-1.4, 1.03], [-1.0, 1.17], [-0.6, 1.25], [-0.2, 1.275], [0.15, 1.25], [0.45, 1.12], [0.75, 0.92], [0.92, 0.8]],
    shape: SHAPE.cabinRound,
    ws: [0.86, 0.12],
    bl: [-0.6, -1.52],
    b: null,
    c: [[-1.1, 0.96], [-0.62, 1.25]],
    drop: 0.07,
  },
  doors: [[0.85, -0.68]],
  mirror: { z: 0.72, rise: 0.06 },
  plates: { front: null, rear: 0.62 },
  details: (k) => {
    const { s } = k;
    // Boca oval no meio do bico e as tomadas dos lados.
    k.patch(s.front, rounded([[-0.42, 0.26], [0.42, 0.26], [0.5, 0.36], [0.42, 0.44], [-0.42, 0.44], [-0.5, 0.36]], 3), "trim", "#0c0c0d", { off: 0.004 });
    k.rect(s.front, -0.44, 0.44, 0.345, 0.36, "paint", null, { off: 0.008 });
    k.both((side) => {
      // Faróis em gota, com três projetores redondos.
      k.lamp(s.front, sideOf(side, rounded([[0.38, 0.5], [0.66, 0.53], [0.8, 0.57], [0.74, 0.62], [0.42, 0.57]], 2)), LAMP.headCool, { bulbs: [0, 1, 2].map((i) => sideOf(side, ellipse(0.48 + i * 0.1, 0.545 + i * 0.012, 0.03, 0.026, 14))) });
      k.patch(s.front, sideOf(side, ellipse(0.66, 0.36, 0.1, 0.05, 18)), "trim", "#0c0c0d", { off: 0.004 });
      // Lanternas redondas: o anel vermelho por fora e a de ré/pisca no meio.
      for (const [x, r] of [[0.66, 0.085], [0.42, 0.075]] as const) {
        k.lamp(s.rear, sideOf(side, ellipse(x, 0.79, r, r * 0.9, 24)), LAMP.tail, { bulbs: [sideOf(side, ellipse(x, 0.79, r * 0.45, r * 0.4, 14))], reflector: true, dome: 0.012 });
      }
      exhaust(k, side * 0.55, 0.3, 0.045, 0.14);
    });
    k.patch(s.rear, roundRect(-0.28, 0.73, 0.28, 0.85, 0.02), "trim", "#2a0a0a", { off: 0.004 });
    // Aerofólio em arco: pés altos da cor do carro e a lâmina por cima da tampa.
    wing(k, -1.86, 1.17, 1.62, 0.28, null, { posts: 0.47, postMat: "paint", plates: false, angle: 0.06, arch: 0.04 });
  },
  food: (k) => {
    // Cachorro-quente no teto: o pão aberto, a salsicha saindo das pontas e a mostarda em zigue-zague.
    const y = k.topAt(-0.25);
    k.sphere("food", "#d9973f", 0.3, [0.13, y + 0.1, -0.25], { scale: [0.6, 0.55, 2.9], seg: 24 });
    k.sphere("food", "#d9973f", 0.3, [-0.13, y + 0.1, -0.25], { scale: [0.6, 0.55, 2.9], seg: 24 });
    k.sphere("food", "#b5442a", 0.15, [0, y + 0.2, -0.25], { scale: [1, 1, 7.2], seg: 20 });
    const zig: [number, number, number][] = [];
    for (let i = 0; i <= 12; i++) zig.push([(i % 2 ? 0.09 : -0.09), y + 0.35, -1.05 + i * 0.135]);
    k.tube("food", "#f2c200", zig, 0.022, { seg: 48, radial: 6 });
  },
};

// Nissan Skyline GT-R (R34): caixote de quinas vivas, boca enorme, faróis
// angulosos, as quatro lanternas redondas e o aerofólio alto.
DESIGNS.skyline = {
  ...sz.skyline,
  wheels: { front: 1.32, rear: -1.345, radius: 0.326, width: 0.245, rim: "six", rimColor: "#55595f", rimRatio: 0.7, caliper: "#c9a227", flare: [0.015, 0.02] },
  body: {
    top: [[-2.3, 0.6], [-2.29, 0.88], [-2.24, 0.98], [-2.1, 1.0], [-1.5, 1.0], [-0.7, 0.96], [0.4, 0.92], [1.3, 0.86], [1.95, 0.8], [2.22, 0.72], [2.3, 0.48]],
    bottom: [[-2.3, 0.36], [-2.15, 0.22], [2.1, 0.19], [2.3, 0.24]],
    plan: [[-2.3, 0.79], [-2.27, 0.86], [-2.1, 0.89], [0, 0.89], [1.9, 0.885], [2.22, 0.82], [2.3, 0.7]],
    shoulder: [[-2.3, 0.86], [0, 0.78], [2.3, 0.66]],
    shape: { nTop: 4.6, nBot: 4.5, tumble: 0.07, tuck: 0.12, crown: 0.06 },
  },
  cabin: {
    top: [[-1.82, 1.0], [-1.6, 1.1], [-1.25, 1.27], [-0.95, 1.355], [-0.2, 1.37], [0.25, 1.355], [0.55, 1.22], [0.85, 1.03], [1.06, 0.91]],
    shape: { nTop: 5.5, nBot: 8, tumble: 0.26, tuck: 0, crown: 0.04 },
    ws: [1.0, 0.22],
    bl: [-0.92, -1.75],
    b: [-0.45, 0.08],
    c: [[-1.3, 1.0], [-1.0, 1.35]],
    drop: 0.065,
  },
  doors: [[0.98, -0.52]],
  mirror: { z: 0.88, rise: 0.06 },
  plates: { front: 0.36, rear: 0.66 },
  details: (k) => {
    const { s } = k;
    // Boca grande com a barra no meio, grade de cima pequena com o emblema.
    k.patch(s.front, rounded([[-0.62, 0.26], [0.62, 0.26], [0.66, 0.5], [0.4, 0.54], [-0.4, 0.54], [-0.66, 0.5]], 2), "trim", "#0c0c0d", { off: 0.004 });
    honeycomb(k, s.front, -0.58, 0.58, 0.28, 0.5, "#1e1e21", 0.036);
    k.rect(s.front, -0.64, 0.64, 0.39, 0.41, "paint", null, { off: 0.009 });
    k.patch(s.front, roundRect(-0.28, 0.6, 0.28, 0.69, 0.015), "trim", "#0c0c0d", { off: 0.004 });
    k.patch(s.front, roundRect(-0.07, 0.625, 0.07, 0.665, 0.01), "trim", "#d00000", { off: 0.01 });
    k.both((side) => {
      // Faróis angulosos, mais altos na ponta, com dois projetores.
      k.lamp(s.front, sideOf(side, [[0.3, 0.6], [0.78, 0.62], [0.82, 0.73], [0.34, 0.69]]), LAMP.headCool, { bulbs: [sideOf(side, ellipse(0.66, 0.67, 0.05, 0.04, 16)), sideOf(side, ellipse(0.46, 0.65, 0.045, 0.035, 16))] });
      // Quatro lanternas redondas.
      for (const x of [0.42, 0.68]) k.lamp(s.rear, sideOf(side, ellipse(x, 0.84, 0.085, 0.085, 26)), LAMP.tail, { bulbs: [sideOf(side, ellipse(x, 0.84, 0.05, 0.05, 18))], dome: 0.012 });
      // Respiro atrás da roda da frente.
      vent(k, s.side(side), rounded([[0.86, 0.6], [0.95, 0.6], [0.92, 0.78], [0.84, 0.78]], 1), 3, true);
    });
    // Capô com a entrada de ar, aerofólio alto ajustável e a ponteira grande.
    vent(k, s.hood, roundRect(-0.25, 1.35, 0.25, 1.55, 0.03), 4);
    wing(k, -1.98, 1.22, 1.62, 0.26, null, { posts: 0.3, postMat: "paint", plates: true, angle: 0.12 });
    k.patch(s.front, roundRect(-0.7, 0.21, 0.7, 0.26, 0.02), "trim", "#111", { off: 0.004 });
    exhaust(k, 0.55, 0.3, 0.06, 0.16);
    k.rect(s.rear, -0.8, 0.8, 0.27, 0.36, "trim", "#141416", { off: 0.004 });
  },
  food: (k) => {
    // Shoyu: faixa marrom nas laterais e o frasquinho de molho de soja no teto.
    k.both((side) => k.strip(k.s.side(side), [[2.1, 0.56], [-2.1, 0.56]], 0.1, "accent", "#5a2e12", { off: 0.006 }));
    const y = k.topAt(-0.3);
    const sc = 0.72;
    k.lathe("food", "#2a1308", [[0.001, 0], [0.2, 0.0], [0.24, 0.12], [0.24, 0.4], [0.16, 0.55], [0.09, 0.6], [0.09, 0.66], [0.001, 0.66]], [0, y, -0.3], { seg: 28, scale: [sc, sc, sc] });
    k.lathe("food", "#d00000", [[0.001, 0], [0.11, 0], [0.12, 0.12], [0.06, 0.2], [0.02, 0.24], [0.001, 0.24]], [0, y + 0.64 * sc, -0.3], { seg: 24, scale: [sc, sc, sc] });
    k.cyl("food", "#f2e8d0", 0.245 * sc, 0.14 * sc, [0, y + 0.26 * sc, -0.3], { seg: 28, open: true });
  },
};

// Lamborghini Murciélago: cunha baixa e larguíssima, cabine bem para a frente,
// as tomadas de ar em cima dos quadris, faróis trapezoidais e a grade de
// colmeia atrás.
DESIGNS.wedge = {
  ...sz.wedge,
  wheels: { front: 1.27, rear: -1.395, radius: 0.335, width: 0.3, rim: "five", rimColor: "#c2c6cb", rimRatio: 0.69, caliper: "#e0b000", flare: [0.0, 0.03] },
  body: {
    top: [[-2.3, 0.55], [-2.28, 0.84], [-2.15, 0.95], [-1.6, 0.98], [-0.8, 0.94], [0.0, 0.88], [0.8, 0.78], [1.6, 0.65], [2.1, 0.54], [2.3, 0.4]],
    bottom: [[-2.3, 0.38], [-2.1, 0.22], [2.0, 0.16], [2.3, 0.22]],
    plan: [[-2.3, 0.8], [-2.2, 0.93], [-1.6, 1.0], [-0.8, 0.98], [0.2, 0.93], [1.0, 0.96], [1.7, 0.93], [2.15, 0.8], [2.3, 0.62]],
    shoulder: [[-2.3, 0.78], [-1.0, 0.72], [0.5, 0.6], [2.3, 0.4]],
    shape: { nTop: 5, nBot: 4, tumble: 0.12, tuck: 0.25, crown: 0.08 },
    crown: [[-2.3, 0.05], [0.2, 0.05], [0.9, -0.12], [2.3, -0.1]],
  },
  cabin: {
    top: [[-1.95, 0.93], [-1.4, 0.985], [-0.9, 1.07], [-0.45, 1.13], [-0.05, 1.13], [0.3, 1.05], [0.7, 0.88], [0.98, 0.76]],
    shape: { nTop: 5, nBot: 8, tumble: 0.36, tuck: 0, crown: 0.05 },
    ws: [0.88, -0.02],
    bl: [-0.55, -0.85],
    b: null,
    c: [[-0.78, 0.9], [-0.42, 1.1]],
    drop: 0.055,
  },
  doors: [[0.82, -0.68]],
  mirror: { z: 0.72, rise: 0.08 },
  plates: { front: null, rear: 0.5 },
  details: (k) => {
    const { s } = k;
    k.both((side) => {
      // Faróis trapezoidais finos, seguindo a quina do capô.
      k.lamp(s.hood, sideOf(side, [[0.55, 2.05], [0.88, 1.9], [0.86, 1.78], [0.52, 1.95]]), LAMP.headCool, { bulbs: [sideOf(side, ellipse(0.72, 1.92, 0.05, 0.04, 14)), sideOf(side, ellipse(0.6, 1.98, 0.04, 0.03, 12))] });
      // Tomadas de baixo da frente (duas bocas).
      k.patch(s.front, sideOf(side, [[0.2, 0.24], [0.78, 0.24], [0.84, 0.4], [0.3, 0.38]]), "trim", "#0b0b0c", { off: 0.004 });
      // Tomada lateral em cima do quadril (a "orelha") e a de baixo, antes da roda.
      const z0 = -0.75;
      const z1 = -1.2;
      const xs = (z: number) => (k.body.side(z, 0.86) ?? 0.95) - 0.03;
      const yTop = (z: number) => k.topAt(z, side * 0.85);
      k.sweep("paint", null, [[side * xs(z0), yTop(z0) + 0.0, z0], [side * xs((z0 + z1) / 2), yTop((z0 + z1) / 2) + 0.06, (z0 + z1) / 2], [side * xs(z1), yTop(z1) + 0.07, z1]],
        (t) => roundRect(-0.09, -0.06, 0.09, 0.08 * Math.min(1, t * 3 + 0.2), 0.03, 2));
      k.patch(s.side(side), [[-0.72, 0.84], [-0.72, 0.92], [-0.8, 0.95], [-0.8, 0.85]], "trim", "#050505", { off: 0.02 });
      vent(k, s.side(side), [[-0.72, 0.42], [-0.95, 0.4], [-0.98, 0.66], [-0.72, 0.6]], 4, true);
      // Lanternas trapezoidais (duas de cada lado).
      k.lamp(s.rear, sideOf(side, [[0.5, 0.72], [0.9, 0.7], [0.9, 0.78], [0.55, 0.8]]), LAMP.tail, { bulbs: [sideOf(side, roundRect(0.6, 0.72, 0.85, 0.77, 0.01))] });
    });
    // Grade de colmeia atrás, as ponteiras no meio e a tampa do motor com as aletas.
    k.patch(s.rear, roundRect(-0.85, 0.3, 0.85, 0.66, 0.03), "trim", "#0b0b0c", { off: 0.004 });
    honeycomb(k, s.rear, -0.8, 0.8, 0.33, 0.62, "#222226", 0.045);
    for (const x of [-0.12, 0.12]) exhaust(k, x, 0.33, 0.06, 0.14, 0.7);
    for (let i = 0; i < 6; i++) k.rect(s.top, -0.42, 0.42, -1.05 - i * 0.14, -1.0 - i * 0.14, "trim", "#141416", { off: 0.006, nb: 1 });
    k.patch(s.hood, ellipse(0, 2.12, 0.05, 0.06, 18), "accent", "#c9a227", { off: 0.008, dome: 0.006 });
    wing(k, -2.15, 0.99, 1.4, 0.16, null, { posts: 0, plates: false, angle: 0.25 });
  },
  food: (k) => {
    // Lasanha: as camadas de massa, molho e queijo pelas laterais e um manjericão no capô.
    const layers: [number, string][] = [[0.36, "#f2c14e"], [0.44, "#c1121f"], [0.52, "#f7f1e1"], [0.6, "#f2c14e"]];
    k.both((side) => {
      for (const [y, color] of layers) k.strip(k.s.side(side), [[1.0, y], [0.0, y], [-1.0, y]], 0.055, "accent", color, { off: 0.006 });
    });
    const z = 1.45;
    const y = k.topAt(z, 0.0);
    for (const [dx, dz, a] of [[0, 0, 0], [0.12, -0.08, 0.9], [-0.1, -0.1, -0.8]] as const) {
      k.sphere("food", "#2f8a2f", 0.14, [dx, y + 0.02, z + dz], { scale: [0.55, 0.12, 1], rot: [0, a, 0], seg: 14 });
    }
    k.sphere("food", "#c1121f", 0.09, [0.0, y + 0.03, z - 0.25], { scale: [1.3, 0.3, 1.3], seg: 14 });
  },
};

// Ferrari Enzo: bico de Fórmula 1 no meio, para-lamas altos com os faróis
// finos, a bolha da cabine, as tomadas laterais e as quatro lanternas redondas.
DESIGNS.ferrari = {
  ...sz.ferrari,
  wheels: { front: 1.25, rear: -1.4, radius: 0.35, width: 0.3, rim: "five", rimColor: "#c9ced4", rimRatio: 0.69, caliper: "#151515", flare: [0.0, 0.03] },
  body: {
    top: [[-2.35, 0.62], [-2.33, 0.9], [-2.2, 1.0], [-1.8, 1.02], [-1.0, 1.0], [-0.3, 0.97], [0.5, 0.82], [1.3, 0.74], [1.9, 0.64], [2.25, 0.5], [2.35, 0.36]],
    bottom: [[-2.35, 0.4], [-2.15, 0.2], [2.0, 0.14], [2.35, 0.18]],
    plan: [[-2.35, 0.82], [-2.25, 0.95], [-1.7, 1.01], [-0.9, 0.98], [0.0, 0.92], [0.9, 0.97], [1.6, 0.97], [2.1, 0.86], [2.35, 0.66]],
    shoulder: [[-2.35, 0.8], [-1.0, 0.75], [0.3, 0.56], [1.5, 0.5], [2.35, 0.34]],
    shape: { nTop: 3, nBot: 3.6, tumble: 0.14, tuck: 0.25, crown: 0.1 },
    crown: [[-2.35, 0.1], [-0.5, 0.1], [0.4, -0.3], [1.4, -0.42], [2.35, -0.28]],
  },
  cabin: {
    top: [[-1.3, 0.98], [-1.0, 1.04], [-0.6, 1.12], [-0.2, 1.15], [0.15, 1.12], [0.5, 0.98], [0.9, 0.79], [1.12, 0.7]],
    shape: { nTop: 2.8, nBot: 8, tumble: 0.42, tuck: 0, crown: 0.04 },
    ws: [1.02, 0.02],
    bl: [-0.5, -1.2],
    b: null,
    c: [[-0.6, 0.95], [-0.28, 1.12]],
    drop: 0.06,
  },
  doors: [[0.88, -0.58]],
  mirror: { z: 0.82, rise: 0.08, size: 0.9 },
  plates: { front: null, rear: 0.6 },
  details: (k) => {
    const { s } = k;
    // Bico de Fórmula 1: um sólido estreito no meio, mais alto que o capô.
    const nose = new Solid({
      z0: 0.9, z1: k.L / 2 + 0.02,
      top: curve([[0.9, 0.62], [1.3, 0.72], [1.9, 0.66], [2.2, 0.56], [2.37, 0.42]]),
      bottom: () => 0.3,
      half: curve([[0.9, 0.08], [1.2, 0.26], [2.0, 0.28], [2.3, 0.22], [2.37, 0.12]]),
      shape: { nTop: 2.6, nBot: 3, tumble: 0.2, tuck: 0.1, crown: 0.1 },
    });
    k.bin.add("paint", nose.geometry(sections(0.9, k.L / 2 + 0.02, k.detail ? 0.04 : 0.12, k.detail ? 0.015 : 0.05, [], 0.12), k.detail ? 28 : 12));
    const noseFront = Surf.front(nose);
    k.patch(noseFront, ellipse(0, 0.48, 0.06, 0.03, 14), "accent", "#f2c200", { off: 0.006 });
    nose.release();
    k.both((side) => {
      // Bocas dos lados do bico.
      k.patch(s.front, sideOf(side, rounded([[0.3, 0.2], [0.82, 0.22], [0.86, 0.42], [0.32, 0.48]], 2)), "trim", "#090909", { off: 0.004 });
      // Faróis finos e compridos em cima dos para-lamas.
      k.lamp(s.hood, sideOf(side, rounded([[0.66, 2.08], [0.8, 1.98], [0.82, 1.72], [0.72, 1.7], [0.64, 1.95]], 2)), LAMP.headCool, { bulbs: [sideOf(side, ellipse(0.74, 1.88, 0.035, 0.08, 14))] });
      // Tomada lateral grande antes da roda de trás.
      vent(k, s.side(side), rounded([[-0.62, 0.3], [-0.98, 0.3], [-1.02, 0.68], [-0.66, 0.6]], 2), 3);
      // As quatro lanternas redondas no alto da traseira.
      for (const x of [0.5, 0.74]) k.lamp(s.rear, sideOf(side, ellipse(x, 0.86, 0.07, 0.07, 24)), LAMP.tail, { bulbs: [sideOf(side, ellipse(x, 0.86, 0.04, 0.04, 16))], bezel: "chrome", dome: 0.012 });
      exhaust(k, side * 0.12, 0.42, 0.05, 0.14);
    });
    // Difusor de trás, o vidro do motor e o spoiler da tampa.
    k.patch(s.rear, roundRect(-0.85, 0.22, 0.85, 0.62, 0.03), "trim", "#0b0b0c", { off: 0.004 });
    for (let i = 0; i < 6; i++) k.rect(s.rear, -0.75 + i * 0.3, -0.73 + i * 0.3, 0.22, 0.6, "trim", "#2a2a2c", { off: 0.008, na: 1, nb: 3 });
    k.patch(s.top, roundRect(-0.38, -1.95, 0.38, -1.25, 0.05), "glass", null, { off: 0.006 });
    k.patch(s.hood, ellipse(0, 2.18, 0.035, 0.045, 18), "accent", "#f2c200", { off: 0.008, dome: 0.005 });
    wing(k, -2.28, 1.03, 1.5, 0.1, null, { posts: 0, plates: false, angle: 0.35 });
  },
  food: (k) => {
    // Farofa espalhada pelo capô, pela tampa e um montinho no teto.
    const crumbs = k.detail ? 90 : 24;
    for (let i = 0; i < crumbs; i++) {
      const x = Math.sin(i * 12.9898) * 0.75;
      const z = (i % 2 ? 1 : -1) * (0.8 + (Math.cos(i * 7.13) * 0.5 + 0.5) * 1.3);
      const y = k.topAt(z, x);
      if (y <= 0) continue;
      k.box("food", i % 3 ? "#e6c27a" : i % 5 ? "#c9954a" : "#8a5a2b", [0.04, 0.025, 0.04], [x, y + 0.01, z], { rot: [i, i * 2, 0] });
    }
    const y = k.topAt(-0.2);
    k.sphere("food", "#dcb36a", 0.3, [0, y, -0.2], { scale: [1, 0.35, 1.2], seg: 20 });
    if (k.detail) for (let i = 0; i < 30; i++) {
      const a = i * 2.4;
      const r = (i % 7) * 0.04;
      k.box("food", i % 2 ? "#b8823a" : "#f0d391", [0.03, 0.02, 0.03], [Math.cos(a) * r, y + 0.1 - r * 0.25, -0.2 + Math.sin(a) * r * 1.2], { rot: [i, i, 0] });
    }
    // Pedaços de bacon da farofa.
    for (let i = 0; i < 6; i++) k.box("food", "#8e2d1d", [0.06, 0.03, 0.04], [Math.cos(i) * 0.18, y + 0.08, -0.2 + Math.sin(i * 1.7) * 0.2], { rot: [0, i, 0.3] });
  },
};

// Bugatti Veyron: formas cheias, a grade em ferradura, faróis em gota com os
// LEDs, as entradas de ar no teto, a pintura de duas cores com o "C" na lateral.
DESIGNS.veyron = {
  ...sz.veyron,
  wheels: { front: 1.31, rear: -1.4, radius: 0.355, width: 0.3, rim: "turbine", rimColor: "#d2d6db", rimRatio: 0.72, caliper: "#151515", flare: [0.01, 0.03] },
  body: {
    top: [[-2.23, 0.68], [-2.21, 0.92], [-2.1, 1.0], [-1.6, 1.02], [-0.9, 1.0], [-0.3, 0.97], [0.5, 0.86], [1.2, 0.77], [1.8, 0.67], [2.15, 0.56], [2.23, 0.4]],
    bottom: [[-2.23, 0.4], [-2.05, 0.2], [2.0, 0.14], [2.23, 0.2]],
    plan: [[-2.23, 0.8], [-2.13, 0.95], [-1.5, 1.0], [-0.6, 0.96], [0.4, 0.95], [1.3, 0.99], [1.9, 0.92], [2.15, 0.78], [2.23, 0.56]],
    shoulder: [[-2.23, 0.8], [-1.0, 0.72], [0.3, 0.6], [1.5, 0.52], [2.23, 0.36]],
    shape: { nTop: 2.8, nBot: 3.2, tumble: 0.15, tuck: 0.25, crown: 0.1 },
    crown: [[-2.23, 0.1], [-0.2, 0.08], [0.6, -0.14], [1.4, -0.22], [2.23, -0.06]],
  },
  cabin: {
    top: [[-1.25, 0.99], [-0.95, 1.07], [-0.55, 1.17], [-0.15, 1.2], [0.2, 1.17], [0.55, 1.02], [0.95, 0.83], [1.15, 0.75]],
    shape: { nTop: 3, nBot: 8, tumble: 0.38, tuck: 0, crown: 0.04 },
    ws: [1.05, 0.08],
    bl: [-0.5, -1.15],
    b: null,
    c: [[-0.62, 0.95], [-0.3, 1.17]],
    drop: 0.06,
  },
  doors: [[0.9, -0.6]],
  mirror: { z: 0.85, rise: 0.08, size: 0.95 },
  plates: { front: null, rear: 0.62 },
  details: (k) => {
    const { s } = k;
    // Grade em ferradura: o aro cromado e a malha escura dentro.
    const shoe: P2[] = [];
    for (let i = 0; i <= 20; i++) {
      const a = Math.PI * (0.05 + 0.9 * (i / 20));
      shoe.push([Math.cos(a) * 0.2, 0.42 + Math.sin(a) * 0.16]);
    }
    shoe.push([-0.19, 0.26], [0.19, 0.26]);
    const horseshoe = rounded(shoe.reverse(), 1);
    k.patch(s.front, grow(horseshoe, 0.022), "chrome", null, { off: 0.005 });
    k.patch(s.front, horseshoe, "trim", "#111114", { off: 0.008 });
    honeycomb(k, s.front, -0.17, 0.17, 0.28, 0.55, "#2a2a2e", 0.03);
    k.patch(s.front, ellipse(0, 0.6, 0.06, 0.035, 18), "accent", "#c1121f", { off: 0.012, dome: 0.004 });
    k.both((side) => {
      // Faróis em gota com os quatro LEDs.
      k.lamp(s.front, sideOf(side, rounded([[0.4, 0.5], [0.7, 0.52], [0.84, 0.58], [0.78, 0.64], [0.5, 0.6]], 2)), LAMP.headCool, { bulbs: [0, 1, 2, 3].map((i) => sideOf(side, ellipse(0.5 + i * 0.075, 0.55 + i * 0.012, 0.022, 0.022, 10))) });
      k.patch(s.front, sideOf(side, rounded([[0.3, 0.22], [0.78, 0.22], [0.82, 0.38], [0.36, 0.36]], 2)), "trim", "#0b0b0c", { off: 0.004 });
      // O "C" cromado da lateral e a tomada atrás dele.
      const cpath: P2[] = [];
      for (let i = 0; i <= 16; i++) {
        const a = -Math.PI / 2 + Math.PI * (i / 16);
        cpath.push([-0.55 - Math.cos(a) * 0.28, 0.6 + Math.sin(a) * 0.3]);
      }
      k.strip(s.side(side), cpath, 0.03, "chrome", null, { off: 0.008 });
      vent(k, s.side(side), rounded([[-0.86, 0.45], [-1.0, 0.45], [-1.02, 0.75], [-0.88, 0.72]], 1), 3, true);
      // Entradas de ar no teto (os dois "snorkels" atrás da cabine).
      const zs = -1.15;
      const yb = k.topAt(zs, side * 0.32);
      k.sweep("paint", null, [[side * 0.32, yb - 0.02, zs - 0.45], [side * 0.32, yb + 0.12, zs - 0.05], [side * 0.32, yb + 0.16, zs + 0.15]], (t) => roundRect(-0.1, -0.06 - t * 0.02, 0.1, 0.06 + t * 0.03, 0.04, 2));
      k.patch({ at: (a, b) => [a, b, zs + 0.16], dir: [0, 0, 1] }, sideOf(side, roundRect(0.24, yb + 0.1, 0.4, yb + 0.22, 0.03)), "trim", "#060606", { off: 0.003, rings: 2 });
      // Lanterna fina de ponta a ponta.
      k.lamp(s.rear, sideOf(side, rounded([[0.05, 0.86], [0.86, 0.82], [0.88, 0.86], [0.05, 0.9]], 1)), LAMP.tail, { dome: 0.004 });
    });
    // Motor à mostra, aerofólio deitado e a ponteira central trapezoidal.
    k.patch(s.top, roundRect(-0.42, -1.85, 0.42, -1.35, 0.05), "trim", "#141416", { off: 0.006 });
    if (k.detail) for (let i = 0; i < 4; i++) k.cyl("chrome", null, 0.05, 0.6, [0, k.topAt(-1.6) + 0.02, -1.42 - i * 0.13], { rot: [0, 0, Math.PI / 2], seg: 12 });
    k.patch(s.rear, roundRect(-0.85, 0.24, 0.85, 0.6, 0.03), "trim", "#0b0b0c", { off: 0.004 });
    k.patch(s.rear, roundRect(-0.2, 0.36, 0.2, 0.5, 0.04), "chrome", null, { off: 0.01, dome: 0.006 });
    k.patch(s.rear, roundRect(-0.17, 0.38, 0.17, 0.48, 0.03), "trim", "#050505", { off: 0.014 });
    wing(k, -2.0, 1.04, 1.5, 0.3, null, { posts: 0, plates: false, angle: 0.03 });
  },
  food: (k) => {
    // Brigadeiro de duas cores: chocolate ao leite na frente e granulado colorido por cima.
    k.rect(k.s.hood, -0.9, 0.9, 0.95, 2.2, "accent", "#8a5a3c", { off: 0.005, step: 0.06 });
    k.both((side) => {
      const front: P2[] = [];
      for (let i = 0; i <= 16; i++) {
        const a = -Math.PI / 2 + Math.PI * (i / 16);
        front.push([-0.55 - Math.cos(a) * 0.28, 0.6 + Math.sin(a) * 0.3]);
      }
      front.push([2.1, 0.9], [2.1, 0.3]);
      const out = front.map(([z, y]) => [z, y] as P2);
      k.patch(k.s.side(side), out.reverse(), "accent", "#8a5a3c", { off: 0.005, rings: 6 });
    });
    const colors = ["#ff5ca8", "#4cc9f0", "#ffd23f", "#7ae582", "#ffffff", "#ff8c42"];
    const n = k.detail ? 120 : 30;
    for (let i = 0; i < n; i++) {
      const x = Math.sin(i * 3.7) * 0.85;
      const z = Math.cos(i * 5.3) * 2.0;
      const y = k.topAt(z, x);
      if (y <= 0) continue;
      k.cyl("food", colors[i % colors.length], 0.013, 0.09, [x, y + 0.012, z], { rot: [Math.PI / 2, i * 1.3, 0], seg: 6 });
    }
    const y = k.topAt(-0.2);
    k.sphere("food", "#3a2014", 0.24, [0, y + 0.16, -0.2], { seg: 22 });
    for (let i = 0; i < (k.detail ? 40 : 8); i++) {
      const a = i * 2.4;
      const b = Math.acos(1 - (i / 40) * 1.6);
      k.cyl("food", colors[i % colors.length], 0.012, 0.06, [Math.sin(b) * Math.cos(a) * 0.24, y + 0.16 + Math.cos(b) * 0.24, -0.2 + Math.sin(b) * Math.sin(a) * 0.24], { rot: [a, b, 0], seg: 5 });
    }
  },
};

// Koenigsegg Agera: gota baixa e lisa, cabine bolha, faróis grandes nas
// quinas, tomadas atrás das portas, aerofólio de pescoço de cisne e a ponteira
// central em fenda.
DESIGNS.hyper = {
  ...sz.hyper,
  wheels: { front: 1.31, rear: -1.35, radius: 0.35, width: 0.29, rim: "y5", rimColor: "#2f3236", rimRatio: 0.71, caliper: "#c01c28", flare: [0.0, 0.03] },
  body: {
    top: [[-2.15, 0.62], [-2.13, 0.86], [-2.0, 0.95], [-1.5, 0.98], [-0.9, 0.97], [-0.3, 0.92], [0.4, 0.82], [1.1, 0.72], [1.7, 0.62], [2.05, 0.52], [2.15, 0.36]],
    bottom: [[-2.15, 0.4], [-2.0, 0.2], [1.9, 0.14], [2.15, 0.2]],
    plan: [[-2.15, 0.75], [-2.05, 0.92], [-1.5, 1.0], [-0.6, 0.96], [0.3, 0.95], [1.2, 0.99], [1.8, 0.92], [2.08, 0.78], [2.15, 0.58]],
    shoulder: [[-2.15, 0.78], [-1.0, 0.72], [0.3, 0.58], [1.4, 0.5], [2.15, 0.36]],
    shape: { nTop: 2.8, nBot: 3.2, tumble: 0.15, tuck: 0.25, crown: 0.1 },
    crown: [[-2.15, 0.1], [-0.3, 0.1], [0.5, -0.12], [1.3, -0.18], [2.15, -0.05]],
  },
  cabin: {
    top: [[-1.35, 0.97], [-1.0, 1.04], [-0.6, 1.1], [-0.2, 1.12], [0.15, 1.1], [0.5, 0.97], [0.85, 0.8], [1.05, 0.72]],
    shape: { nTop: 2.8, nBot: 8, tumble: 0.42, tuck: 0, crown: 0.04 },
    ws: [0.98, 0.05],
    bl: [-0.55, -1.25],
    b: null,
    c: [[-0.62, 0.95], [-0.3, 1.1]],
    drop: 0.06,
  },
  doors: [[0.85, -0.6]],
  mirror: { z: 0.78, rise: 0.08, size: 0.9 },
  plates: { front: null, rear: null },
  details: (k) => {
    const { s } = k;
    k.both((side) => {
      // Faróis grandes nas quinas, com as lâmpadas em fileira.
      k.lamp(s.front, sideOf(side, rounded([[0.42, 0.5], [0.76, 0.48], [0.9, 0.56], [0.82, 0.62], [0.5, 0.6]], 2)), LAMP.headCool, { bulbs: [0, 1, 2].map((i) => sideOf(side, ellipse(0.52 + i * 0.1, 0.545, 0.035, 0.035, 12))) });
      // Tomada atrás da porta e as lanternas redondas.
      vent(k, s.side(side), rounded([[-0.64, 0.5], [-0.98, 0.48], [-1.0, 0.76], [-0.7, 0.74]], 2), 4);
      k.lamp(s.rear, sideOf(side, ellipse(0.62, 0.8, 0.09, 0.06, 22)), LAMP.tail, { bulbs: [sideOf(side, ellipse(0.62, 0.8, 0.05, 0.03, 14))], dome: 0.01 });
      // Divisor da frente com os "dentes".
      k.patch(s.front, sideOf(side, rounded([[0.15, 0.22], [0.8, 0.22], [0.84, 0.38], [0.2, 0.42]], 2)), "trim", "#0b0b0c", { off: 0.004 });
    });
    k.patch(s.front, roundRect(-0.15, 0.24, 0.15, 0.44, 0.04), "trim", "#0b0b0c", { off: 0.004 });
    // Ponteira central em fenda e o difusor.
    k.patch(s.rear, roundRect(-0.8, 0.22, 0.8, 0.55, 0.03), "trim", "#0b0b0c", { off: 0.004 });
    k.patch(s.rear, roundRect(-0.28, 0.6, 0.28, 0.7, 0.04), "chrome", null, { off: 0.008, dome: 0.004 });
    k.patch(s.rear, roundRect(-0.25, 0.62, 0.25, 0.68, 0.03), "trim", "#050505", { off: 0.012 });
    // Aerofólio de pescoço de cisne (os pés saem de cima e seguram por cima).
    const zw = -1.92;
    const yw = 1.18;
    k.both((side) => {
      const x = side * 0.42;
      const base = k.topAt(zw + 0.15, x);
      k.sweep("trim", "#151517", [[x, base - 0.02, zw + 0.25], [x, base + 0.12, zw + 0.12], [x, yw + 0.08, zw - 0.02]], roundRect(-0.012, -0.05, 0.012, 0.05, 0.01, 2), [1, 0, 0]);
    });
    wing(k, zw, yw, 1.7, 0.3, "#151517", { mat: "trim", posts: 0, plates: true, angle: 0.08 });
  },
  food: (k) => {
    // Kibe no teto (bola de futebol americano com os vincos), hortelã e o limão.
    k.both((side) => k.strip(k.s.side(side), [[1.9, 0.4], [-1.9, 0.4]], 0.05, "accent", "#7ab55c", { off: 0.006 }));
    const y = k.topAt(-0.25);
    const g = new THREE.SphereGeometry(0.25, k.seg(28), k.seg(18));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      const t = v.y / 0.25;
      const r = Math.pow(Math.max(0, 1 - t * t), 0.7);
      const a = Math.atan2(v.z, v.x);
      const ridge = 1 - 0.05 * Math.abs(Math.sin(a * 3 + t * 2));
      const len = Math.hypot(v.x, v.z) || 1;
      p.setXYZ(i, (v.x / len) * 0.22 * r * ridge, v.y * 2.6, (v.z / len) * 0.22 * r * ridge);
    }
    g.computeVertexNormals();
    k.geo("food", g, "#7a4a24", [0, y + 0.2, -0.25], [Math.PI / 2, 0, 0]);
    for (const [x, z, a] of [[0.25, 0.2, 0.4], [-0.22, 0.25, -0.6], [0.2, -0.75, 2.4]] as const) k.sphere("food", "#4caf50", 0.08, [x, y + 0.05, -0.25 + z], { scale: [0.5, 0.1, 1], rot: [0, a, 0], seg: 10 });
    k.cyl("food", "#e8e36a", 0.17, 0.03, [0.0, y + 0.03, 0.45], { seg: 24 });
    k.cyl("food", "#f6f3b8", 0.15, 0.032, [0.0, y + 0.03, 0.45], { seg: 24 });
  },
};

// BMW M3 GTR (E46): cupê de corrida com os para-lamas alargados em caixa, o
// duplo rim, faróis com os dois "anéis", divisor grande, aerofólio alto e a
// pintura prata com as veias azuis do gorgonzola.
DESIGNS.m3 = {
  ...sz.m3,
  wheels: { front: 1.41, rear: -1.32, radius: 0.335, width: 0.28, rim: "mesh", rimColor: "#d6d9dd", rimRatio: 0.69, caliper: "#c1121f", flare: [0.035, 0.045], inset: 0.015 },
  body: {
    top: [[-2.25, 0.58], [-2.24, 0.86], [-2.18, 0.96], [-1.95, 0.99], [-1.5, 0.985], [-0.7, 0.95], [0.4, 0.92], [1.3, 0.87], [1.95, 0.78], [2.2, 0.68], [2.25, 0.46]],
    bottom: [[-2.25, 0.3], [-2.1, 0.17], [2.05, 0.13], [2.25, 0.15]],
    plan: [[-2.25, 0.7], [-2.18, 0.83], [-1.9, 0.88], [-1.3, 0.89], [-0.6, 0.86], [0.5, 0.86], [1.4, 0.89], [1.95, 0.86], [2.2, 0.76], [2.25, 0.6]],
    shoulder: [[-2.25, 0.84], [0, 0.78], [2.25, 0.62]],
    shape: { nTop: 3.6, nBot: 3.8, tumble: 0.1, tuck: 0.14, crown: 0.1 },
  },
  cabin: {
    top: [[-1.6, 0.98], [-1.42, 1.08], [-1.15, 1.2], [-0.85, 1.27], [-0.35, 1.29], [0.1, 1.27], [0.45, 1.13], [0.8, 0.96], [1.0, 0.88]],
    shape: SHAPE.cabin,
    ws: [0.95, 0.12],
    bl: [-0.85, -1.55],
    b: [-0.45, 0.06],
    c: [[-1.15, 0.98], [-0.86, 1.25]],
    drop: 0.065,
  },
  doors: [[0.95, -0.55]],
  mirror: { z: 0.84, rise: 0.06 },
  plates: { front: null, rear: null },
  details: (k) => {
    const { s } = k;
    // Duplo rim: dois rins arredondados com moldura cromada e barras pretas.
    k.both((side) => {
      const kidney = sideOf(side, rounded([[0.04, 0.58], [0.2, 0.58], [0.22, 0.66], [0.2, 0.75], [0.05, 0.73]], 2));
      k.patch(s.front, grow(kidney, 0.015), "chrome", null, { off: 0.004 });
      k.patch(s.front, kidney, "trim", "#0b0b0c", { off: 0.007 });
      for (let i = 0; i < 6; i++) k.rect(s.front, side * (0.06 + i * 0.026), side * (0.07 + i * 0.026), 0.6, 0.72, "trim", "#2a2a2e", { off: 0.01, na: 1, nb: 2 });
      // Faróis: o vidro e os dois anéis.
      k.lamp(s.front, sideOf(side, rounded([[0.3, 0.62], [0.7, 0.63], [0.78, 0.69], [0.66, 0.73], [0.32, 0.71]], 2)), LAMP.headCool, { bulbs: [sideOf(side, ellipse(0.6, 0.675, 0.04, 0.035, 18)), sideOf(side, ellipse(0.43, 0.67, 0.04, 0.035, 18))] });
      // Lanternas em "L" e as saídas de escape laterais antes da roda de trás.
      k.lamp(s.rear, sideOf(side, [[0.4, 0.84], [0.82, 0.82], [0.84, 0.9], [0.6, 0.9], [0.58, 0.95], [0.42, 0.95]]), LAMP.tail, { bulbs: [sideOf(side, roundRect(0.62, 0.84, 0.8, 0.88, 0.01)), sideOf(side, roundRect(0.44, 0.86, 0.56, 0.93, 0.01))] });
      k.cyl("chrome", null, 0.045, 0.16, [side * (k.W / 2 - 0.08), 0.22, -0.82], { rot: [0, 0, Math.PI / 2], seg: 16 });
      // Asinhas (canards) na frente.
      k.box("trim", "#111113", [0.14, 0.012, 0.12], [side * 0.7, 0.42, k.frontAt(side * 0.7, 0.42) - 0.04], { rot: [0, 0, side * 0.25] });
    });
    // Divisor e boca de baixo, ressalto e respiros do capô.
    k.patch(s.front, rounded([[-0.62, 0.22], [0.62, 0.22], [0.6, 0.4], [-0.6, 0.4]], 2), "trim", "#0b0b0c", { off: 0.004 });
    k.box("trim", "#111113", [1.36, 0.022, 0.14], [0, 0.135, 2.2], { r: 0.008 });
    k.both((side) => vent(k, s.hood, sideOf(side, rounded([[0.2, 1.6], [0.5, 1.6], [0.5, 1.82], [0.24, 1.82]], 1)), 4));
    k.patch(s.hood, ellipse(0, 2.1, 0.04, 0.04, 18), "chrome", null, { off: 0.008, dome: 0.005 });
    // Aerofólio alto de corrida e o difusor.
    wing(k, -1.96, 1.28, 1.68, 0.32, "#151517", { mat: "trim", posts: 0.28, plates: true, angle: 0.14 });
    k.patch(s.rear, roundRect(-0.8, 0.18, 0.8, 0.42, 0.03), "trim", "#0b0b0c", { off: 0.004 });
    for (let i = 0; i < 5; i++) k.rect(s.rear, -0.6 + i * 0.3, -0.585 + i * 0.3, 0.18, 0.4, "trim", "#2a2a2c", { off: 0.008, na: 1, nb: 3 });
    // Número de corrida nas portas.
    k.both((side) => k.patch(s.side(side), ellipse(0.18, 0.62, 0.17, 0.17, 28), "accent", "#f4f4f4", { off: 0.006 }));
  },
  food: (k) => {
    // Gorgonzola: veias azuis pela carroceria prata e a faixa azul lateral.
    k.both((side) => k.strip(k.s.side(side), [[2.1, 0.42], [0, 0.42], [-2.1, 0.42]], 0.12, "accent", "#2a4fd1", { off: 0.006 }));
    const veins: [number, number, number][] = [[-0.5, 1.6, 0.4], [0.3, 1.1, -0.3], [0.6, 0.2, 0.5], [-0.2, -0.6, -0.4], [0.45, -1.5, 0.3], [-0.6, -1.0, 0.6], [0.1, 1.85, -0.9], [-0.35, -1.8, 1.2]];
    for (const [x, z, rot] of veins) {
      const path: P2[] = [];
      for (let i = 0; i <= 8; i++) path.push([x + Math.sin(rot) * i * 0.08 + Math.sin(i * 1.7 + z) * 0.03, z + Math.cos(rot) * i * 0.08]);
      k.strip(k.s.top, path, 0.035, "accent", "#3a6bff", { off: 0.007 });
      k.strip(k.s.top, path.slice(3, 7).map(([a, b]) => [a + 0.06, b - 0.03] as P2), 0.02, "accent", "#2a4fd1", { off: 0.008 });
    }
    k.both((side) => k.patch(k.s.side(side), ellipse(0.18, 0.62, 0.11, 0.11, 24), "accent", "#2a4fd1", { off: 0.009 }));
  },
};

// Audi A3 (8L, 2002) "todo mexido": hatch de três portas rebaixado, rodas
// enormes de aro fundo, aerofólio de caminhão, divisor, saias, escapamento
// canhão, neon por baixo, tomada no teto e bacon no capô.
DESIGNS.a3 = {
  ...sz.a3,
  wheels: { front: 1.24, rear: -1.27, radius: 0.33, width: 0.235, rim: "deep", rimColor: "#3a3d42", rimRatio: 0.76, caliper: "#ff6a00", flare: [0.02, 0.025], inset: 0.012 },
  body: {
    top: [[-2.1, 0.52], [-2.09, 0.82], [-2.05, 0.94], [-1.95, 0.965], [-1.0, 0.95], [0.0, 0.92], [0.9, 0.87], [1.45, 0.8], [1.85, 0.72], [2.05, 0.62], [2.1, 0.46]],
    bottom: [[-2.1, 0.3], [-1.95, 0.17], [1.9, 0.13], [2.1, 0.18]],
    plan: [[-2.1, 0.66], [-2.03, 0.8], [-1.7, 0.86], [0, 0.865], [1.3, 0.86], [1.85, 0.81], [2.05, 0.7], [2.1, 0.55]],
    shoulder: [[-2.1, 0.82], [0, 0.76], [2.1, 0.62]],
    shape: { nTop: 3.4, nBot: 3.8, tumble: 0.1, tuck: 0.14, crown: 0.1 },
  },
  cabin: {
    top: [[-2.0, 0.96], [-1.955, 1.12], [-1.86, 1.27], [-1.6, 1.33], [-0.6, 1.345], [0.0, 1.33], [0.35, 1.2], [0.72, 1.0], [0.96, 0.87]],
    shape: SHAPE.cabinRound,
    ws: [0.92, 0.03],
    bl: [-1.64, -1.97],
    b: [-0.74, 0.06],
    c: [[-1.42, 0.96], [-1.26, 1.32]],
    drop: 0.065,
  },
  doors: [[0.9, -0.72]],
  mirror: { z: 0.8, rise: 0.06 },
  plates: { front: 0.34, rear: 0.6 },
  details: (k) => {
    const { s } = k;
    // Grade trapezoidal com moldura cromada e os "anéis" (de cebola).
    const grille: P2[] = rounded([[-0.3, 0.6], [0.3, 0.6], [0.28, 0.48], [-0.28, 0.48]], 1);
    k.patch(s.front, grow(grille, 0.015), "chrome", null, { off: 0.004 });
    k.patch(s.front, grille, "trim", "#0e0e10", { off: 0.007 });
    grilleBars(k, s.front, -0.27, 0.27, 0.49, 0.59, 4, "trim", "#2a2a2c");
    for (let i = 0; i < 4; i++) {
      const g = new THREE.TorusGeometry(0.04, 0.009, k.seg(6), k.seg(16));
      const x = -0.09 + i * 0.06;
      k.geo("food", g, "#e8c27a", [x, 0.66, k.frontAt(x, 0.66) + 0.012]);
    }
    k.both((side) => {
      // Faróis com os dois projetores e as lanternas retangulares.
      k.lamp(s.front, sideOf(side, rounded([[0.33, 0.6], [0.74, 0.6], [0.8, 0.67], [0.72, 0.72], [0.35, 0.7]], 2)), LAMP.headCool, { bulbs: [sideOf(side, ellipse(0.62, 0.66, 0.05, 0.045, 18)), sideOf(side, ellipse(0.45, 0.65, 0.045, 0.04, 16))] });
      k.lamp(s.rear, sideOf(side, rounded([[0.4, 0.84], [0.8, 0.82], [0.82, 0.9], [0.42, 0.92]], 1)), LAMP.tail, { bulbs: [sideOf(side, roundRect(0.44, 0.85, 0.62, 0.9, 0.01)), sideOf(side, roundRect(0.64, 0.845, 0.78, 0.885, 0.01))] });
      k.patch(s.front, sideOf(side, rounded([[0.4, 0.22], [0.78, 0.22], [0.8, 0.4], [0.44, 0.38]], 2)), "trim", "#0b0b0c", { off: 0.004 });
    });
    k.patch(s.front, roundRect(-0.36, 0.22, 0.36, 0.4, 0.03), "trim", "#0b0b0c", { off: 0.004 });
    honeycomb(k, s.front, -0.34, 0.34, 0.24, 0.38, "#232326", 0.035);
    // As preparações: aerofólio de caminhão, divisor, saias, canhão e neon.
    wing(k, -1.92, 1.62, 1.8, 0.34, "#111111", { mat: "trim", posts: 0.33, plates: true, angle: 0.18 });
    k.box("trim", "#111111", [1.5, 0.03, 0.2], [0, 0.13, 2.08], { r: 0.012 });
    sideSkirt(k, 0.12, 0.26, 0.05, "trim", "#111111");
    k.cyl("chrome", null, 0.12, 0.26, [0.48, 0.3, -2.06], { rot: [Math.PI / 2, 0, 0], r2: 0.09, seg: 24 });
    const inner = new THREE.CircleGeometry(0.1, k.seg(20));
    inner.rotateY(Math.PI);
    k.geo("trim", inner, "#050505", [0.48, 0.3, -2.195]);
    const neon = new THREE.PlaneGeometry(1.5, 3.4).rotateX(Math.PI / 2);
    k.geo("lamp", neon, "#b84cff", [0, 0.1, 0]);
    // Tomada de ar no teto.
    const yr = k.topAt(0.1);
    k.sweep("trim", "#111111", [[0, yr - 0.02, -0.25], [0, yr + 0.08, 0.05], [0, yr + 0.11, 0.22]], (t) => roundRect(-0.24, -0.05, 0.24, 0.04 + t * 0.06, 0.03, 2));
    k.patch({ at: (a, b) => [a, b, 0.225], dir: [0, 0, 1] }, roundRect(-0.2, yr + 0.06, 0.2, yr + 0.15, 0.02), "trim", "#020202", { off: 0.002, rings: 2 });
  },
  food: (k) => {
    // Tiras de bacon onduladas pelo capô.
    for (const x of [-0.38, -0.13, 0.13, 0.38]) {
      const path: P2[] = [];
      for (let i = 0; i <= 14; i++) path.push([x + Math.sin(i * 0.9 + x * 7) * 0.03, 1.0 + i * 0.07]);
      k.strip(k.s.hood, path, 0.11, "food", "#b63a26", { off: 0.012 });
      k.strip(k.s.hood, path.map(([a, b]) => [a + 0.02, b] as P2), 0.03, "food", "#f2c2a6", { off: 0.016 });
    }
  },
};

// --- Montagem e cache ------------------------------------------------------------

const bodyCache = new Map<string, BuiltBody>();

export type Livery = (k: Kit) => void;

/** Geometria da carroceria de um estilo (montada uma vez por estilo + pintura especial). */
export function bodyGeometry(style: BodyStyle, livery?: { key: string; draw: Livery }): BuiltBody {
  const key = `${style}|${livery?.key ?? ""}`;
  const hit = bodyCache.get(key);
  if (hit) return hit;
  const design = DESIGNS[style] ?? DESIGNS.sedan!;
  const built = assemble(design, true, livery?.draw);
  bodyCache.set(key, built);
  return built;
}

/** z do ponto mais alto do teto (onde vão o giroflex e a placa de nome). */
export function roofPeak(k: Kit) {
  const cabin = k.cabin;
  if (!cabin) return 0;
  let best = cabin.spec.z0;
  let bestY = -Infinity;
  for (let z = cabin.spec.z0; z <= cabin.spec.z1; z += 0.05) {
    const y = cabin.spec.top(z);
    if (y > bestY) {
      bestY = y;
      best = z;
    }
  }
  return best;
}

function assemble(d: Design, detail: boolean, livery?: Livery): BuiltBody {
  const start = performance.now();
  const bin = new Bin();
  const k = makeKit(d, detail, bin);
  const L = d.length;
  const dense: [number, number][] = [d.wheels.front, d.wheels.rear].map((c) => [c - k.wheel.arch - 0.05, c + k.wheel.arch + 0.05]);
  const zs = sections(-L / 2, L / 2, detail ? 0.045 : 0.16, detail ? 0.018 : 0.065, dense, 0.14);
  bin.add("paint", k.body.geometry(zs, detail ? 40 : 16));
  if (k.cabin) {
    const c = k.cabin.spec;
    bin.add(d.cabin?.mat ?? "paint", k.cabin.geometry(sections(c.z0, c.z1, detail ? 0.04 : 0.14, detail ? 0.02 : 0.08, [], 0.1), detail ? 36 : 14), d.cabin?.color ?? null);
  }
  standard(k, d);
  d.details?.(k);
  if (livery) livery(k);
  else d.food?.(k);
  // Pinças de freio (ficam paradas; a roda gira por fora delas).
  const wheels: { x: number; z: number; radius: number }[] = [];
  for (const z of [d.wheels.front, d.wheels.rear]) {
    for (const side of [1, -1]) {
      wheels.push({ x: side * k.wheel.x, z, radius: d.wheels.radius });
      const cal = caliperGeometry(d.wheels);
      if (cal && detail) bin.place("trim", side > 0 ? cal : mirrorX(cal), d.wheels.caliper ?? null, side * k.wheel.x, d.wheels.radius, z);
    }
  }
  const roofZ = roofPeak(k);
  const roofY = k.topAt(roofZ);
  k.body.release();
  k.cabin?.release();
  const parts = bin.build();
  for (const g of parts.values()) g.userData.shared = true;
  return { parts, wheels, wheel: d.wheels, length: L, roofY, roofZ, ms: performance.now() - start };
}

// --- Trânsito --------------------------------------------------------------------

const trafficCache = new Map<TrafficKind, BuiltBody>();

const TRAFFIC: Partial<Record<TrafficKind, Design>> = {};

// Sedã comum (o "três volumes" de toda cidade).
TRAFFIC.sedan = {
  length: 4.2,
  width: 1.7,
  wheels: { front: 1.3, rear: -1.17, radius: 0.3, width: 0.185, rim: "hubcap", rimColor: "#aeb3b8", rimRatio: 0.6, caliper: null },
  body: {
    top: [[-2.1, 0.55], [-2.08, 0.82], [-2.0, 0.93], [-1.6, 0.95], [-0.8, 0.93], [0.2, 0.9], [1.0, 0.86], [1.6, 0.8], [1.98, 0.7], [2.1, 0.5]],
    bottom: [[-2.1, 0.34], [-1.9, 0.24], [1.9, 0.22], [2.1, 0.3]],
    plan: [[-2.1, 0.68], [-2.0, 0.8], [-1.5, 0.85], [0, 0.85], [1.5, 0.85], [1.95, 0.78], [2.1, 0.66]],
    shoulder: [[-2.1, 0.8], [2.1, 0.68]],
    shape: SHAPE.modern,
  },
  cabin: {
    top: [[-1.5, 0.95], [-1.3, 1.1], [-1.0, 1.32], [-0.7, 1.42], [0.1, 1.43], [0.4, 1.32], [0.75, 1.08], [1.0, 0.88]],
    shape: SHAPE.cabin,
    ws: [0.92, 0.2],
    bl: [-0.72, -1.45],
    b: [-0.25, 0.08],
    c: [[-0.95, 0.95], [-0.72, 1.4]],
  },
  mirror: { z: 0.82, rise: 0.06, mat: "trim", size: 0.9 },
  plates: { front: 0.38, rear: 0.6 },
  details: (k) => {
    const { s } = k;
    k.both((side) => {
      k.lamp(s.front, sideOf(side, rounded([[0.3, 0.6], [0.7, 0.6], [0.76, 0.7], [0.32, 0.7]], 1)), LAMP.head, { dome: 0.004 });
      k.lamp(s.rear, sideOf(side, roundRect(0.4, 0.78, 0.72, 0.9, 0.02)), LAMP.tail, { dome: 0.004 });
    });
    k.patch(s.front, roundRect(-0.28, 0.6, 0.28, 0.7, 0.02), "trim", "#141416", { off: 0.004 });
    k.patch(s.front, roundRect(-0.5, 0.26, 0.5, 0.36, 0.03), "trim", "#141416", { off: 0.004 });
  },
};

// Kombi (a "corujinha"): pão de forma de duas cores, o "V" branco na frente,
// janelas em fila e o motor atrás com as grelhas.
TRAFFIC.kombi = {
  length: 4.2,
  width: 1.74,
  wheels: { front: 1.35, rear: -1.05, radius: 0.33, width: 0.185, rim: "steel", rimColor: "#ecebe6", rimRatio: 0.58, caliper: null, gap: 0.06 },
  body: {
    top: [[-2.1, 0.92], [-2.07, 1.04], [-2.0, 1.07], [2.0, 1.07], [2.08, 1.03], [2.1, 0.9]],
    bottom: [[-2.1, 0.46], [-1.9, 0.36], [1.9, 0.34], [2.1, 0.44]],
    plan: [[-2.1, 0.78], [-2.0, 0.86], [-1.5, 0.87], [1.6, 0.87], [2.0, 0.85], [2.1, 0.8]],
    shoulder: [[-2.1, 0.8], [2.1, 0.8]],
    shape: { nTop: 6, nBot: 6, tumble: 0.03, tuck: 0.05, crown: 0.02 },
  },
  cabin: {
    top: [[-2.05, 1.05], [-2.03, 1.6], [-1.96, 1.85], [-1.78, 1.93], [1.5, 1.94], [1.86, 1.89], [1.99, 1.7], [2.07, 1.1]],
    shape: { nTop: 5, nBot: 8, tumble: 0.1, tuck: 0, crown: 0.03 },
    sink: 0.05,
    inset: 0.004,
    ws: [2.0, 1.7],
    auto: false,
    mat: "accent",
    color: "#f2efe4",
  },
  plates: { front: 0.6, rear: 0.62 },
  details: (k) => {
    const { s } = k;
    const cab = k.cabin!;
    const front = Surf.front(cab);
    const rear = Surf.rear(cab);
    // Para-brisa largo, janelas em fila e a de trás.
    k.glass(front, roundRect(-0.64, 1.2, 0.64, 1.66, 0.14), "trim", 0.02);
    k.glass(rear, roundRect(-0.6, 1.32, 0.6, 1.72, 0.06), "trim", 0.02);
    k.both((side) => {
      const ss = Surf.side(cab, side);
      for (const [z0, z1] of [[1.72, 1.08], [0.98, 0.38], [0.28, -0.32], [-0.42, -1.02], [-1.12, -1.66]]) k.glass(ss, roundRect(z1, 1.2, z0, 1.72, 0.05), "trim", 0.02);
      // Grelhas do motor (as "guelras") atrás.
      for (let i = 0; i < 5; i++) k.rect(s.side(side), -1.85 + i * 0.07, -1.82 + i * 0.07, 0.86, 1.02, "trim", "#141414", { off: 0.004, na: 1, nb: 1 });
      // Faróis redondos, piscas e as lanternas em pé atrás.
      k.lamp(s.front, sideOf(side, ellipse(0.6, 0.8, 0.09, 0.09, 18)), LAMP.head, { bezel: "chrome", dome: 0.02 });
      k.lamp(s.front, sideOf(side, ellipse(0.62, 1.0, 0.05, 0.03, 12)), LAMP.turn, { bezel: "chrome" });
      k.lamp(s.rear, sideOf(side, roundRect(0.68, 0.72, 0.8, 0.96, 0.03)), LAMP.tail, { bezel: "chrome" });
    });
    // O "V" branco na frente e o emblema redondo.
    k.patch(s.front, [[-0.86, 1.07], [0.86, 1.07], [0.86, 1.0], [0.14, 0.62], [-0.14, 0.62], [-0.86, 1.0]], "accent", "#f2efe4", { off: 0.004, rings: 3 });
    k.patch(s.front, ellipse(0, 0.86, 0.14, 0.14, 24), "chrome", null, { off: 0.008, dome: 0.01 });
    for (const front2 of [true, false]) k.box("chrome", null, [1.7, 0.08, 0.06], [0, 0.48, (front2 ? 1 : -1) * 2.14], { r: 0.025 });
  },
};

// Picape pequena (tipo Saveiro/Strada): cabine simples e a caçamba com a capota marítima.
TRAFFIC.picape = {
  length: 4.3,
  width: 1.72,
  wheels: { front: 1.3, rear: -1.45, radius: 0.3, width: 0.185, rim: "five", rimColor: "#9ea3a8", rimRatio: 0.6, caliper: null },
  body: {
    top: [[-2.15, 0.6], [-2.13, 0.92], [-2.08, 0.98], [-0.2, 0.98], [0.6, 0.94], [1.2, 0.88], [1.75, 0.8], [2.05, 0.7], [2.15, 0.52]],
    bottom: [[-2.15, 0.42], [-1.95, 0.3], [1.9, 0.27], [2.15, 0.33]],
    plan: [[-2.15, 0.76], [-2.08, 0.84], [-1.5, 0.86], [0, 0.86], [1.5, 0.85], [1.95, 0.78], [2.15, 0.66]],
    shoulder: [[-2.15, 0.8], [2.15, 0.7]],
    shape: { nTop: 4.5, nBot: 4, tumble: 0.06, tuck: 0.1, crown: 0.05 },
  },
  cabin: {
    top: [[-0.32, 0.96], [-0.3, 1.3], [-0.24, 1.47], [-0.08, 1.52], [0.38, 1.52], [0.68, 1.4], [0.98, 1.15], [1.22, 0.9]],
    shape: { nTop: 5, nBot: 8, tumble: 0.2, tuck: 0, crown: 0.05 },
    ws: [1.14, 0.42],
    bl: [-0.12, -0.3],
    b: null,
    c: [[-0.16, 0.95], [-0.1, 1.46]],
  },
  mirror: { z: 1.0, rise: 0.06, mat: "trim", size: 0.9 },
  plates: { front: 0.4, rear: 0.55 },
  details: (k) => {
    const { s } = k;
    // Capota marítima preta sobre a caçamba e a borda das laterais.
    k.rect(s.hood, -0.78, 0.78, -2.06, -0.4, "trim", "#1c1c1e", { off: 0.008, step: 0.2 });
    k.both((side) => {
      k.lamp(s.front, sideOf(side, rounded([[0.32, 0.62], [0.72, 0.62], [0.76, 0.72], [0.34, 0.72]], 1)), LAMP.head, { dome: 0.004 });
      k.lamp(s.rear, sideOf(side, roundRect(0.62, 0.62, 0.8, 0.92, 0.02)), LAMP.tail, { dome: 0.004 });
    });
    k.patch(s.front, roundRect(-0.3, 0.62, 0.3, 0.72, 0.02), "trim", "#141416", { off: 0.004 });
    k.patch(s.front, roundRect(-0.6, 0.3, 0.6, 0.42, 0.03), "trim", "#26272a", { off: 0.004 });
    k.patch(s.rear, roundRect(-0.6, 0.36, 0.6, 0.46, 0.03), "trim", "#26272a", { off: 0.004 });
  },
};


/** Carroceria de um carro do trânsito (rodas já fundidas: elas não giram). */
export function trafficGeometry(kind: TrafficKind): BuiltBody {
  const hit = trafficCache.get(kind);
  if (hit) return hit;
  const d = TRAFFIC[kind] ?? { ...DESIGNS.sedan!, length: 4.3, width: 1.8 };
  const built = assemble(d, false);
  // Rodas fundidas na carroceria (dezenas de carros: uma malha por material).
  const bin = new Bin();
  for (const [mat, g] of built.parts) bin.absorb(new Map([[mat, g]]), new THREE.Matrix4());
  const wheel = wheelGeometry(d.wheels, false);
  for (const w of built.wheels) {
    const m = new THREE.Matrix4().makeTranslation(w.x, w.radius, w.z);
    if (w.x < 0) m.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    bin.absorb(wheel, m);
  }
  const parts = bin.build();
  for (const g of built.parts.values()) g.dispose();
  for (const g of parts.values()) g.userData.shared = true;
  const out = { ...built, parts };
  trafficCache.set(kind, out);
  return out;
}

export { wheelGeometry };
export type { WheelSpec };
