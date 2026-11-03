// Aeroporto do Pastel completo: taxiway, pátio com os aviões nos portões,
// terminal de passageiros (sala de embarque envidraçada e pontes de embarque),
// torre de controle, hangares, estacionamento, terminal de cargas com os
// tanques de combustível e as birutas.
//
// Tudo é posto a partir da pista de pouso que existir no mapa (a rua mais
// comprida do tipo `pista`), num referencial dela: u ao longo da pista e n
// para o lado do terminal (o lado com mais espaço livre até a rua mais perto).
// O que é sólido (terminal, torre, hangares, tanques, aviões parados) entra na
// colisão e o pátio, a taxiway e o estacionamento contam como rua (`addSolids`).
import * as MAP from "./map.ts";
import { addSolids, ROADS, type Building } from "./world.ts";
import { frameBox, frameSolid, insideWorld, roadClearance, toWorld, type Box, type Frame, type Point } from "./lots.ts";

/** Retângulo no referencial do aeroporto: [u0, u1, n0, n1]. */
export type Rect = [number, number, number, number];

export interface Gate {
  u: number;
  /** n do nariz do avião (encostado na ponte de embarque). */
  nose: number;
  /** Companhia aérea (índice; o cliente tem as pinturas). */
  airline: number;
  /** Avião grande (dois corredores) ou de um corredor. */
  wide: boolean;
}

export interface Airport {
  /** Origem no meio da pista; u ao longo dela, n para o lado do terminal. */
  frame: Frame;
  runway: { length: number; width: number };
  taxiway: { n: number; width: number; u0: number; u1: number; exits: number[] };
  apron: Rect;
  terminal: Rect;
  gates: Gate[];
  /** Hangares: retângulo e para que lado abre a porta (−1 = para o lado da pista). */
  hangars: { rect: Rect; door: 1 | -1; label: string }[];
  tower: { u: number; n: number; height: number };
  parking: Rect | null;
  /** Acesso do estacionamento até a rua: u e o trecho de n. */
  access: { u: number; n0: number; n1: number } | null;
  /** Pátio de cargas do outro lado da pista (n negativo). */
  cargo: Rect | null;
  tanks: { u: number; n: number; r: number; h: number }[];
  windsocks: { u: number; n: number }[];
  /** Aviões pequenos parados na frente dos hangares. */
  smallPlanes: { u: number; n: number; heading: number }[];
  /** Cargueiro (avião grande) parado no pátio de cargas, de nariz para +u. */
  freighter: { u: number; n: number } | null;
}

/** Ponto do mundo a partir do referencial do aeroporto. */
export const airportPoint = (a: Airport, u: number, n: number): Point => toWorld(a.frame, u, n);

/** O que a planta (map.ts) pode trazer do aeroporto desenhado; tudo opcional. */
interface DrawnAirport {
  runway?: { a: Point; b: Point; width: number };
  taxiway?: { a: Point; b: Point; width: number };
  terminal?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/** n (com sinal) do meio de um segmento no referencial. */
function sideOf(f: Frame, a: Point, b: Point) {
  const x = (a[0] + b[0]) / 2 - f.x;
  const z = (a[1] + b[1]) / 2 - f.z;
  return x * f.nx + z * f.nz;
}

/** O n mais perto da pista entre os cantos de uma caixa alinhada aos eixos (só do lado +n). */
function nearestN(f: Frame, r: { minX: number; maxX: number; minZ: number; maxZ: number }) {
  const ns = [[r.minX, r.minZ], [r.maxX, r.minZ], [r.minX, r.maxZ], [r.maxX, r.maxZ]].map(([x, z]) => (x - f.x) * f.nx + (z - f.z) * f.nz);
  const n = Math.min(...ns);
  return n > 60 ? n : null;
}

function plan(): { airport: Airport; solids: Building[]; clear: Box[]; paved: Box[] } | null {
  // A planta pode trazer o aeroporto desenhado (AIRPORT em map.ts: pista, taxiway, terminal);
  // sem ele, tudo sai da rua do tipo `pista` mais comprida.
  const drawn = (MAP as Record<string, unknown>).AIRPORT as DrawnAirport | undefined;
  const runways = ROADS.filter((r) => r.kind === "pista").sort((a, b) => b.length - a.length);
  const road = runways[0];
  if (!road && !drawn?.runway) return null;
  const [ax, az] = drawn?.runway?.a ?? road.points[0];
  const [bx, bz] = drawn?.runway?.b ?? road.points[road.points.length - 1];
  const length = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / length;
  const uz = (bz - az) / length;
  const center: Point = [(ax + bx) / 2, (az + bz) / 2];
  const width = drawn?.runway?.width ?? road.width;

  /** Até onde (n) o lado está livre de ruas, entre −halfU e halfU. */
  const freeDepth = (f: Frame, halfU: number) => {
    for (let n = width / 2 + 20; n < 520; n += 5) {
      for (let u = -halfU; u <= halfU; u += 15) {
        const [x, z] = toWorld(f, u, n);
        if (!insideWorld(x, z, 15) || roadClearance(x, z) < 10) return n;
      }
    }
    return 520;
  };
  const frames = [1, -1].map((s): Frame => ({ x: center[0], z: center[1], ux, uz, nx: -uz * s, nz: ux * s }));
  // O mais largo que couber (se as ruas em volta estiverem perto, o aeroporto encolhe).
  let halfU = 0;
  let depths = [0, 0];
  for (const wish of [300, 230, 170]) {
    halfU = Math.min(length / 2 - 45, wish);
    depths = frames.map((f) => freeDepth(f, halfU));
    if (Math.max(...depths) >= 200) break;
  }
  // Com a planta desenhada, o terminal fica do lado da taxiway dela.
  const side = drawn?.taxiway ? sideOf(frames[0], drawn.taxiway.a, drawn.taxiway.b) : 0;
  const best = side > 0 ? 0 : side < 0 ? 1 : depths[0] >= depths[1] ? 0 : 1;
  const f = frames[best];
  const depth = depths[best];
  const otherDepth = depths[1 - best];
  if (depth < 200 || halfU < 150) return null;

  const solids: Building[] = [];
  const clear: Box[] = [];
  const paved: Box[] = [];
  const taxiN = drawn?.taxiway ? Math.abs(sideOf(f, drawn.taxiway.a, drawn.taxiway.b)) : width / 2 + 42;
  const taxiW = drawn?.taxiway?.width ?? 18;
  const tu = length / 2 - 30;
  const taxiway = { n: taxiN, width: taxiW, u0: -tu, u1: tu, exits: [-tu, -length * 0.17, length * 0.17, tu] };
  paved.push(frameBox(f, -tu - taxiW / 2, tu + taxiW / 2, taxiN - taxiW / 2, taxiN + taxiW / 2));

  // Pátio, terminal e estacionamento: o terminal recua até onde der (no máximo n = 182).
  const drawnTerm = drawn?.terminal ? nearestN(f, drawn.terminal) : null;
  const termN0 = drawnTerm ?? Math.max(140, Math.min(182, depth - 110));
  const A = Math.max(90, Math.min(175, halfU - 75));
  const T = Math.max(60, Math.min(105, A - 15));
  const apron: Rect = [-A, A, taxiN + taxiW / 2, termN0 - 3];
  const terminal: Rect = [-T, T, termN0, termN0 + 28];
  const parkN1 = Math.min(termN0 + 95, depth - 14);
  const parking: Rect | null = parkN1 - (termN0 + 34) > 20 ? [-T, T, termN0 + 34, parkN1] : null;
  paved.push(frameBox(f, ...apron));
  if (parking) paved.push(frameBox(f, ...parking));

  // Terminal (em blocos de até ~45 m na colisão).
  const pieces = Math.ceil((2 * T) / 45);
  for (let k = 0; k < pieces; k++) {
    const u0 = -T + (2 * T * k) / pieces;
    const u1 = -T + (2 * T * (k + 1)) / pieces;
    solids.push(frameSolid(f, u0, u1, terminal[2], terminal[3], 14));
  }
  clear.push(frameBox(f, -A - 70, A + 70, taxiN - taxiW, (parking ? parkN1 : termN0 + 30) + 4));
  clear.push(frameBox(f, -length / 2 - 10, length / 2 + 10, -width / 2 - 25, width / 2 + 25));
  clear.push(frameBox(f, -tu - 15, tu + 15, taxiN - taxiW, taxiN + taxiW));

  // Portões: aviões de nariz para o terminal, encostados nas pontes de embarque.
  const gates: Gate[] = [];
  const gateCount = Math.max(2, Math.floor((2 * T) / 50));
  for (let k = 0; k < gateCount; k++) {
    const u = -T + (2 * T * (k + 0.5)) / gateCount;
    const wide = k === 1 && gateCount >= 4;
    const nose = termN0 - (wide ? 20 : 17);
    gates.push({ u, nose, airline: k, wide });
    const len = wide ? 55 : 38;
    const half = wide ? 2.9 : 2.1;
    // Fuselagem e os motores embaixo da asa (a asa fica alta: passa por baixo).
    solids.push(frameSolid(f, u - half, u + half, nose - len, nose, wide ? 16 : 12));
    const wingN = nose - len * 0.47;
    const engineOut = wide ? 8.4 : 5.8;
    for (const s of [-1, 1]) solids.push(frameSolid(f, u + s * engineOut - (wide ? 1.7 : 1.2), u + s * engineOut + (wide ? 1.7 : 1.2), wingN - 2.5, wingN + 2.5, 3));
  }

  // Hangares nas pontas do pátio, de porta para a taxiway.
  const hangars: Airport["hangars"] = [];
  const smallPlanes: Airport["smallPlanes"] = [];
  for (const s of [-1, 1]) {
    const u0 = s < 0 ? -A - 62 : A + 12;
    const u1 = u0 + 50;
    if (Math.abs(s < 0 ? u0 : u1) > halfU + 20) continue;
    const rect: Rect = [u0, u1, taxiN + taxiW / 2 + 22, taxiN + taxiW / 2 + 66];
    hangars.push({ rect, door: -1, label: s < 0 ? "HANGAR 1" : "HANGAR 2" });
    solids.push(frameSolid(f, ...rect, 16));
    paved.push(frameBox(f, u0, u1, taxiN + taxiW / 2, rect[2]));
    const plane = { u: (u0 + u1) / 2 + 6 * s, n: rect[2] - 10, heading: s * 0.5 };
    smallPlanes.push(plane);
    solids.push({ ...frameSolid(f, plane.u - 0.9, plane.u + 0.9, plane.n - 5, plane.n + 5, 3), angle: Math.atan2(-f.uz, f.ux) + plane.heading });
  }

  const tower = { u: -(T + 22), n: termN0 + 14, height: 38 };
  solids.push(frameSolid(f, tower.u - 4.5, tower.u + 4.5, tower.n - 4.5, tower.n + 4.5, tower.height));

  // Acesso: do estacionamento, reto, até a rua mais perto.
  let access: Airport["access"] = null;
  if (parking) {
    for (let n = parkN1; n < parkN1 + 220; n += 2) {
      const [x, z] = toWorld(f, 0, n);
      if (roadClearance(x, z) < -1) {
        access = { u: 0, n0: parkN1, n1: n };
        paved.push(frameBox(f, -6, 6, parkN1, n));
        clear.push(frameBox(f, -8, 8, parkN1, n));
        break;
      }
    }
  }

  // Do outro lado da pista: terminal de cargas (dois hangares) e os tanques de combustível.
  let cargo: Rect | null = null;
  let freighter: Airport["freighter"] = null;
  const tanks: Airport["tanks"] = [];
  if (otherDepth > 170) {
    const c0 = width / 2 + 45;
    cargo = [-110, 110, -(c0 + 50), -c0];
    paved.push(frameBox(f, ...cargo));
    freighter = { u: 45, n: (cargo[2] + cargo[3]) / 2 };
    // Fuselagem (ao longo de u) e os motores embaixo da asa.
    solids.push(frameSolid(f, freighter.u - 27.5, freighter.u + 27.5, freighter.n - 2.9, freighter.n + 2.9, 16));
    for (const s of [-1, 1]) solids.push(frameSolid(f, freighter.u + 1.6 - 2.5, freighter.u + 1.6 + 2.5, freighter.n + s * 8.4 - 1.7, freighter.n + s * 8.4 + 1.7, 3));
    for (const u of [-80, -20]) {
      const rect: Rect = [u - 25, u + 25, -(c0 + 50 + 44), -(c0 + 50)];
      hangars.push({ rect, door: 1, label: "PASTEL CARGO" });
      solids.push(frameSolid(f, ...rect, 15));
    }
    for (const [u, n] of [[60, c0 + 72], [78, c0 + 72], [96, c0 + 72]]) {
      tanks.push({ u, n: -n, r: 7, h: 10 });
      solids.push(frameSolid(f, u - 7, u + 7, -n - 7, -n + 7, 10));
    }
    clear.push(frameBox(f, -120, 120, -(c0 + 50 + 50), -c0 + 2));
  }

  const windsocks = [
    { u: length / 2 - 170, n: -(width / 2 + 26) },
    { u: -(length / 2 - 170), n: width / 2 + 26 },
  ];

  const airport: Airport = {
    frame: f,
    runway: { length, width },
    taxiway,
    apron,
    terminal,
    gates,
    hangars,
    tower,
    parking,
    access,
    cargo,
    tanks,
    windsocks,
    smallPlanes,
    freighter,
  };
  return { airport, solids, clear, paved };
}

const planned = plan();
if (planned) addSolids({ solids: planned.solids, clear: planned.clear, paved: planned.paved });
/** O aeroporto (null se o mapa não tiver pista de pouso). */
export const AIRPORT_LAYOUT: Airport | null = planned?.airport ?? null;
