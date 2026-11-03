// Planta de Porto Gordo, desenhada à mão: cruzamentos, ruas, bairros, o rio,
// as rotatórias e as obras de arte (pontes, viadutos e túneis). O resto da
// cidade (cruzamentos no meio das ruas, ruas de ligação, prédios, casas,
// árvores, comida) é gerado a partir disto em world.ts. Coordenadas em metros
// no plano XZ (+Z é o norte).
//
// As ruas podem se cruzar no desenho sem cruzamento marcado: o world.ts acha
// os encontros e cria o cruzamento sozinho (`planarize`). A exceção são as
// obras de arte (`structure`): elas passam por cima (ponte, viaduto) ou por
// baixo (túnel) das outras ruas, sem cruzamento.

export type DistrictId =
  | "centro" | "porto" | "vila" | "jardim" | "parque" | "autodromo"
  | "praia" | "morro" | "industrial" | "picanha" | "liberdade" | "aeroporto" | "serra" | "roca";

export interface District {
  id: DistrictId;
  name: string;
  /** Contorno do bairro (polígono). */
  polygon: [number, number][];
  /** Cor do chão do bairro (fora das ruas). */
  ground: string;
}

type Point = [number, number];

/** Limites da cidade (o cais é a borda sul). */
export const BOUNDS = { minX: -1900, maxX: 2200, maxZ: 2800 } as const;

/** Muro do cais: ao sul dele é mar. */
export const QUAY_Z = -500;

// Contornos dos bairros: pontos compartilhados entre vizinhos, para não sobrar
// buraco. As divisas seguem o rio, as avenidas e o relevo (nada de quadrado).
const W = BOUNDS.minX;
const E = BOUNDS.maxX;
const N = BOUNDS.maxZ;
const S = QUAY_Z;

/** Margem leste do rio, de norte (nascente) a sul (foz): divisa dos bairros. */

export const DISTRICTS: District[] = [
  {
    id: "porto",
    name: "Porto Gordo",
    polygon: [[-705, S], [700, S], [700, -330], [520, -300], [300, -330], [80, -310], [-160, -322], [-330, -305], [-520, -330], [-680, -280], [-700, -420]],
    ground: "#7a7468",
  },
  {
    id: "centro",
    name: "Centro",
    polygon: [[-330, -305], [-160, -322], [80, -310], [300, -330], [285, -150], [262, 40], [250, 200], [150, 290], [-30, 300], [-200, 300], [-330, 230], [-345, 40]],
    ground: "#8d8478",
  },
  {
    id: "vila",
    name: "Vila do Pastel",
    polygon: [[-680, -280], [-520, -330], [-330, -305], [-345, 40], [-330, 230], [-420, 330], [-595, 300], [-585, 200], [-600, 40], [-640, -120]],
    ground: "#7d8a45",
  },
  {
    id: "jardim",
    name: "Jardim das Frituras",
    polygon: [[-595, 300], [-420, 330], [-330, 230], [-200, 300], [-30, 300], [150, 290], [250, 200], [270, 330], [250, 520], [190, 690], [-80, 700], [-360, 680], [-660, 700], [-645, 560], [-605, 380]],
    ground: "#76913f",
  },
  {
    id: "parque",
    name: "Parque da Barriga",
    polygon: [[300, -330], [520, -300], [700, -330], [700, 180], [560, 230], [250, 200], [262, 40], [285, -150]],
    ground: "#5f8f3a",
  },
  {
    id: "autodromo",
    name: "Autódromo do Colesterol",
    polygon: [[250, 200], [560, 230], [700, 180], [690, 470], [640, 660], [430, 690], [190, 690], [250, 520], [270, 330]],
    ground: "#6f8a3a",
  },
  // --- Porto Gordo cresceu: os bairros em volta da cidade velha ---
  {
    id: "praia",
    name: "Praia da Batata Frita",
    polygon: [[W, S], [-705, S], [-700, -420], [-680, -280], [-900, -250], [-1150, -290], [-1420, -240], [-1650, -300], [W, -260]],
    ground: "#d8c38c",
  },
  {
    id: "morro",
    name: "Morro do Torresmo",
    polygon: [[W, -260], [-1650, -300], [-1420, -240], [-1150, -290], [-900, -250], [-680, -280], [-640, -120], [-600, 40], [-585, 200], [-605, 380], [-645, 560], [-675, 760], [-900, 700], [-1200, 760], [-1500, 690], [W, 740]],
    ground: "#8a6f50",
  },
  {
    id: "industrial",
    name: "Distrito da Gordura Trans",
    polygon: [[700, S], [E, S], [E, 900], [1700, 960], [1200, 930], [880, 960], [690, 900], [640, 660], [690, 470], [700, 180], [700, -330]],
    ground: "#6f6a60",
  },
  {
    id: "picanha",
    name: "Alto da Picanha",
    polygon: [[W, 740], [-1500, 690], [-1200, 760], [-900, 700], [-675, 760], [-695, 950], [-735, 1150], [-805, 1350], [-905, 1540], [-990, 1700], [-1250, 1640], [-1550, 1720], [W, 1660]],
    ground: "#5d8c3c",
  },
  {
    id: "liberdade",
    name: "Liberdade do Yakisoba",
    polygon: [[-675, 760], [-660, 700], [-360, 680], [-80, 700], [190, 690], [430, 690], [640, 660], [690, 900], [700, 1250], [640, 1560], [420, 1720], [100, 1760], [-300, 1720], [-620, 1640], [-905, 1540], [-805, 1350], [-735, 1150], [-695, 950]],
    ground: "#867c70",
  },
  {
    id: "aeroporto",
    name: "Aeroporto do Pastel",
    polygon: [[690, 900], [880, 960], [1200, 930], [1700, 960], [E, 900], [E, 1760], [1700, 1800], [1300, 1760], [900, 1780], [640, 1560], [700, 1250]],
    ground: "#7b8452",
  },
  {
    id: "serra",
    name: "Serra do Açúcar",
    polygon: [[W, 1660], [-1550, 1720], [-1250, 1640], [-990, 1700], [-905, 1540], [-620, 1640], [-300, 1720], [100, 1760], [420, 1720], [640, 1560], [900, 1780], [860, 2100], [980, 2450], [900, N], [W, N]],
    ground: "#4f6d36",
  },
  {
    id: "roca",
    name: "Roça do Milho",
    polygon: [[900, 1780], [1300, 1760], [1700, 1800], [E, 1760], [E, N], [900, N], [980, 2450], [860, 2100]],
    ground: "#a39b4c",
  },
];

// --- Água ---------------------------------------------------------------------

/** Lago do Parque da Barriga (não dá para dirigir dentro). */
export const LAKE = { x: 470, z: -70, rx: 120, rz: 82 } as const;

/**
 * Rio Banha: nasce na Serra do Açúcar e desce entre a cidade velha e o Morro do
 * Torresmo até o mar. Eixo (de norte para sul), largura em cada ponto e a
 * altura da várzea (o vale por onde ele corre; a água fica um pouco abaixo).
 */
export const RIVER = {
  points: [
    [-1020, 1760], [-950, 1560], [-848, 1350], [-776, 1150], [-735, 950], [-712, 760], [-680, 560],
    [-640, 380], [-618, 200], [-632, 40], [-670, -120], [-708, -280], [-726, -420], [-730, -560],
  ] as Point[],
  width: [26, 32, 36, 40, 42, 44, 46, 48, 50, 52, 54, 58, 62, 66],
  floor: [9, 8, 7, 6, 5, 4.2, 3.5, 2.8, 2.2, 1.6, 1.1, 0.6, 0.2, 0],
} as const;


// --- Rotatórias ------------------------------------------------------------------

export interface Roundabout {
  id: string;
  name: string;
  x: number;
  z: number;
  /** Raio do eixo da pista da rotatória. */
  r: number;
  /** Ângulo (graus, a partir de +X para +Z) de cada saída. */
  exits: number[];
  kind: RoadKind;
}

export const ROUNDABOUTS: Roundabout[] = [
  { id: "RT", name: "Rotatória do Hambúrguer", x: -20, z: -20, r: 38, exits: [82, 18, -52, -112, 168], kind: "avenida" },
  { id: "LR", name: "Praça do Yakisoba", x: 0, z: 1180, r: 44, exits: [90, 28, -32, -90, -148, 152], kind: "avenida" },
  { id: "RJ", name: "Rotatória da Coxinha", x: -150, z: 470, r: 26, exits: [95, 5, -85, 185], kind: "rua" },
];

/** Nó da saída `k` de uma rotatória. */
const ringNode = (ra: Roundabout, k: number): Point => {
  const a = (ra.exits[k] * Math.PI) / 180;
  return [ra.x + Math.cos(a) * ra.r, ra.z + Math.sin(a) * ra.r];
};

// --- Aeroporto ---------------------------------------------------------------------

/**
 * Aeroporto do Pastel (traçado; os prédios ficam por conta do cliente): pista
 * de pouso leste–oeste (a aresta `pista` AE5–AE4), a pista de táxi paralela ao
 * norte, o pátio dos aviões e o terminal com a rua de embarque na frente.
 * `area` é a área cercada: lá dentro o world.ts não gera prédio nem árvore.
 */
export const AIRPORT = {
  runway: { a: [720, 1180] as Point, b: [2020, 1180] as Point, width: 46 },
  taxiway: { a: [820, 1310] as Point, b: [1920, 1310] as Point, width: 23 },
  /** Pátio dos aviões (retângulo alinhado aos eixos): x e z mínimos e máximos. */
  apron: { minX: 1060, maxX: 1700, minZ: 1318, maxZ: 1480 },
  /** Terreno do terminal (o prédio fica aqui, de frente para o pátio ao sul e para o embarque ao norte). */
  terminal: { minX: 1140, maxX: 1620, minZ: 1496, maxZ: 1566 },
  /** Hangares: faixa ao sul da pista. */
  hangars: { minX: 820, maxX: 1500, minZ: 1035, maxZ: 1120 },
  /** Área cercada (sem prédios gerados). */
  area: { minX: 690, maxX: 2060, minZ: 1025, maxZ: 1580 },
} as const;

// --- Cruzamentos -------------------------------------------------------------------

/** Cruzamentos e pontas de rua. */
export const NODES: Record<string, Point> = {
  // --- Beira-mar: Avenida Beira-Mar (praia), Ponte da Foz e Avenida do Porto ---
  BM0: [-1760, -400], BM1: [-1480, -410], BM2: [-1200, -425], BM3: [-930, -428],
  BM4: [-520, -430], P1: [-310, -436], P2: [-60, -418], P3: [180, -434], P4: [430, -420], P5: [660, -404],
  PE0: [960, -410], PE1: [1260, -398], PE2: [1580, -404], PE3: [1880, -402],
  // Rua do Cais (entre os galpões e o mar)
  X0: [-560, -478], X1: [-60, -481], X2: [300, -479], X3: [620, -477],
  // Rua do Bacalhau (atrás dos galpões, divisa com o centro)
  PA0: [-560, -345], PA1: [-330, -330], PA2: [-120, -345], PA3: [80, -330], PA4: [300, -352], PA5: [520, -320], PA6: [690, -350],

  // --- Centro (a rotatória RT* vem de ROUNDABOUTS) ---
  // Av. Central norte, Av. do Parque (leste), Av. Diagonal (sudeste), Av. Central sul e Av. Oeste
  C3: [-8, 215], E1: [120, 30], R2: [262, 42], SE1: [95, -160], R1: [282, -232], C1: [-72, -215], W1: [-180, 4], W0: [-338, 30],
  // Avenida Norte (curva) e a Rua do Parque
  N0: [-440, 262], N1: [-322, 228], M2: [-170, 268], NE1: [130, 262], D3: [262, 232],
  R4: [262, 430], R5: [235, 620],
  // Miolo do centro: ruas tortas, cada uma num ângulo
  CA1: [-250, -230], CA2: [-160, -255], CA3: [-20, -270], CA4: [150, -262],
  CB1: [-260, -120], CB2: [-150, -110], CB3: [60, -90], CB4: [175, -110],
  CC1: [-250, 120], CC2: [-120, 130], CC3: [70, 140], CC4: [185, 150],
  CD1: [-110, 210], CD2: [90, 205],
  // Elevado Costelão (passa por cima do centro, de oeste para leste)
  EL0: [-520, -168], EL1: [580, -278],

  // --- Vila do Pastel ---
  V0: [-330, -300], V1: [-470, -300], V2: [-560, -140], V3: [-440, -40], V4: [-440, -232], V5: [-460, 110], V6: [-530, 220],
  V7: [-400, 190], V8: [-540, 20],

  // --- Jardim das Frituras ---
  J0: [-345, 420], J1: [-250, 360], J2: [-40, 360], J3: [110, 390], J4: [-300, 560], J5: [-60, 560], J6: [100, 540],
  J7: [-470, 470], K0: [-520, 640], K1: [-200, 660], C4: [-10, 660], K2: [150, 650],

  // --- Parque da Barriga: alameda em volta do lago e a Ponte do Lago ---
  Q0: [300, -130], Q1: [380, -215], Q2: [620, -190], Q3: [640, 40], Q4: [520, 120], Q5: [340, 70],
  QS: [470, -205], QN: [470, 105],

  // --- Autódromo ---
  T0: [330, 300],

  // --- Morro do Torresmo: ladeiras tortas e o túnel ---
  MB0: [-860, -170], MA: [-820, -40], MC: [-800, 260], MD: [-820, 520],
  ME: [-1000, -200], MF: [-1010, 30], MG: [-1040, 240], MH: [-1010, 450],
  MI: [-1300, -170], MJ: [-1280, 20], MK: [-1320, 240], ML: [-1300, 480],
  MM: [-1560, -120], MN: [-1570, 160], MO: [-1560, 450],
  // Túnel do Torresmo: atravessa o morro de leste a oeste
  TT0: [-870, 120], TT1: [-1480, 60],

  // --- Praia da Batata Frita ---
  PR0: [-1640, -330], PR1: [-1350, -320], PR2: [-1100, -330], PR3: [-900, -300],

  // --- Rodoanel de Cebola: o anel em volta de tudo ---
  HW1: [-1790, 100], HW2: [-1800, 700], HW3: [-1770, 1300], HW4: [-1740, 1900],
  HN0: [-1400, 2620], HN1: [-760, 2680], HN2: [80, 2660], HN3: [760, 2690], HN4: [1460, 2630],
  HE4: [2110, 2000], HE3: [2130, 1400], HE2: [2120, 800], HE1: [2100, 250],

  // --- Distrito da Gordura Trans: quadras grandes, tortas, e dois viadutos ---
  I00: [760, -250], I10: [1010, -280], I20: [1280, -240], I30: [1560, -270], I40: [1840, -230],
  I01: [740, 0], I11: [1000, -10], I21: [1290, 20], I31: [1580, -10], I41: [1880, 30],
  I02: [770, 250], I12: [1030, 230], I22: [1300, 270], I32: [1600, 240], I42: [1900, 300],
  I03: [760, 520], I13: [1010, 500], I23: [1290, 540], I33: [1580, 520], I43: [1880, 560],
  I04: [790, 820], I14: [1040, 800], I24: [1320, 830], I34: [1620, 810],
  // Viaduto da Gordura (Avenida do Aeroporto passando por cima da Avenida da Gordura)
  VG0: [1140, 90], VG1: [1180, 425],

  // --- Alto da Picanha: mansões em ruas sinuosas ---
  AP0: [-860, 660], AP1: [-1100, 800], AP2: [-1400, 760], AP3: [-940, 1060], AP4: [-1180, 1080], AP5: [-1470, 1080],
  AP6: [-1050, 1440], AP7: [-1300, 1380], AP8: [-1560, 1440],

  // --- Liberdade do Yakisoba: a Praça do Yakisoba (LR*) no meio, anel interno e externo ---
  L0: [0, 1420], L1: [215, 1300], L2: [210, 1040], L3: [0, 920], L4: [-215, 1050], L5: [-220, 1310],
  O0: [10, 1620], O1: [300, 1560], O2: [450, 1380], O3: [470, 1130], O4: [430, 900], O5: [250, 760], O6: [0, 730],
  O7: [-250, 770], O8: [-430, 910], O9: [-480, 1150], O10: [-450, 1400], O11: [-260, 1570],
  Y00: [-560, 1030],

  // --- Aeroporto do Pastel ---
  AE5: [720, 1180], AE4: [2020, 1180], AW: [660, 1180], AEE: [2120, 1180],
  AE0: [680, 1010], AE1: [1300, 1000], AE2: [2110, 1010],
  TW0: [820, 1310], TW1: [1920, 1310],
  AT0: [880, 1620], AT1: [1120, 1610], AT2: [1660, 1610], AT3: [1880, 1560],

  // --- Serra do Açúcar ---
  SA: [0, 1820], SB: [-380, 1900], SC: [-760, 2030], SD: [-460, 2260], SE: [360, 1940], SF: [170, 2260], SG: [-1100, 1820],
  SZ1: [-900, 2200], SZ2: [-1100, 2300], SZ3: [-1440, 2440],
  // Túnel do Açúcar (a Estrada da Serra atravessa o Pico do Açúcar)
  TS0: [-120, 2080], TS1: [-330, 2600], HNm: [-330, 2708],

  // --- Roça do Milho ---
  RO0: [1000, 1880], RO1: [1380, 1900], RO2: [1420, 2240], RO3: [960, 2250], RO4: [1800, 2050], RO5: [1750, 2400],
};

// Nós das rotatórias.
for (const ra of ROUNDABOUTS) ra.exits.forEach((_, k) => (NODES[`${ra.id}${k}`] = ringNode(ra, k)));

/** Tipos de rua: largura em metros. */
export const ROAD_WIDTH = { rodovia: 26, avenida: 22, rua: 15, viela: 12, pista: 46, taxiway: 23 } as const;
export type RoadKind = keyof typeof ROAD_WIDTH;

/** Obras de arte: ponte (sobre água), viaduto (sobre outras ruas) e túnel (por dentro do morro). */
export type StructureKind = "ponte" | "viaduto" | "tunel";

export interface EdgeSpec {
  a: string;
  b: string;
  kind: RoadKind;
  /** Ponto de controle da curva (sem ele, a rua é reta). */
  curve?: [number, number];
  /** Obra de arte: a rua tem o próprio perfil de altura e não cruza as outras. */
  structure?: StructureKind;
  /** Nome da obra (aparece na boca do túnel e no mapa). */
  name?: string;
  /** Ponte/viaduto: quanto o tabuleiro sobe acima da linha entre as pontas (m). */
  lift?: number;
  /** Comprimento de cada rampa (m). */
  ramp?: number;
}

const chain = (ids: string[], kind: RoadKind): EdgeSpec[] =>
  ids.slice(1).map((b, i) => ({ a: ids[i], b, kind }));

/** Rua curva: ponto de controle empurrado `bend` (fração do comprimento) para a esquerda de A→B. */
const bent = (a: string, b: string, kind: RoadKind, bend: number): EdgeSpec => {
  const [ax, az] = NODES[a];
  const [bx, bz] = NODES[b];
  const len = Math.hypot(bx - ax, bz - az);
  return { a, b, kind, curve: [(ax + bx) / 2 - ((bz - az) / len) * bend * len, (az + bz) / 2 + ((bx - ax) / len) * bend * len] };
};

/** Arcos de uma rotatória (pontos de controle no círculo, para a curva ficar redonda). */
function ring(ra: Roundabout): EdgeSpec[] {
  const out: EdgeSpec[] = [];
  const order = ra.exits.map((deg, k) => ({ deg, k })).sort((p, q) => p.deg - q.deg);
  for (let i = 0; i < order.length; i++) {
    const from = order[i];
    const to = order[(i + 1) % order.length];
    const a0 = (from.deg * Math.PI) / 180;
    let a1 = (to.deg * Math.PI) / 180;
    if (a1 <= a0) a1 += Math.PI * 2;
    const mid = (a0 + a1) / 2;
    const reach = ra.r / Math.cos((a1 - a0) / 2);
    out.push({ a: `${ra.id}${from.k}`, b: `${ra.id}${to.k}`, kind: ra.kind, curve: [ra.x + Math.cos(mid) * reach, ra.z + Math.sin(mid) * reach] });
  }
  return out;
}

export const EDGES: EdgeSpec[] = ([
  // ======================= Beira-mar =======================
  ...chain(["BM0", "BM1", "BM2", "BM3"], "avenida"),
  { a: "BM3", b: "BM4", kind: "avenida", structure: "ponte", name: "Ponte da Foz", lift: 7, ramp: 140 },
  ...chain(["BM4", "P1", "P2", "P3", "P4", "P5", "PE0", "PE1", "PE2", "PE3"], "avenida"),
  // Rua do Cais
  ...chain(["X0", "X1", "X2", "X3"], "rua"),
  { a: "X0", b: "BM4", kind: "rua" },
  { a: "X1", b: "P2", kind: "rua" },
  bent("X2", "P4", "rua", 0.15),
  { a: "X3", b: "P5", kind: "rua" },
  // Rua do Bacalhau
  bent("PA0", "PA1", "rua", 0.08), bent("PA1", "PA2", "rua", -0.1), bent("PA2", "PA3", "rua", 0.1), bent("PA3", "PA4", "rua", -0.12),
  bent("PA4", "PA5", "rua", 0.1), bent("PA5", "PA6", "rua", -0.1),
  { a: "BM4", b: "PA0", kind: "rua", curve: [-560, -400] },
  { a: "P2", b: "PA2", kind: "rua" },
  bent("P3", "PA4", "rua", 0.1),

  // ======================= Centro =======================
  ...ring(ROUNDABOUTS[0]),
  // Radiais da Rotatória do Hambúrguer
  bent("RT0", "C3", "avenida", 0.04),
  bent("RT1", "E1", "avenida", -0.05), bent("E1", "R2", "avenida", 0.06),
  bent("RT2", "SE1", "avenida", 0.04), bent("SE1", "R1", "avenida", -0.06),
  bent("RT3", "C1", "avenida", -0.03), bent("C1", "P2", "avenida", 0.04),
  bent("RT4", "W1", "avenida", 0.05), bent("W1", "W0", "avenida", -0.06),
  // Avenida Norte
  bent("N0", "N1", "avenida", -0.05), bent("N1", "M2", "avenida", 0.1), bent("M2", "C3", "avenida", -0.06),
  bent("C3", "NE1", "avenida", 0.07), bent("NE1", "D3", "avenida", -0.05),
  // Rua do Parque (Av. do Parque): do porto ao autódromo
  bent("P4", "R1", "avenida", -0.08), bent("R1", "R2", "avenida", 0.05), bent("R2", "D3", "avenida", -0.04),
  bent("D3", "R4", "avenida", 0.04), bent("R4", "R5", "avenida", -0.05),
  // Avenida Oeste
  bent("P1", "V0", "avenida", 0.05), bent("V0", "W0", "avenida", -0.04), bent("W0", "N1", "avenida", 0.05),
  // Miolo do centro (tortas)
  bent("V0", "CA1", "rua", 0.1), bent("CA1", "CA2", "rua", -0.1), bent("CA2", "CA3", "rua", 0.08), bent("CA3", "CA4", "rua", -0.1), bent("CA4", "R1", "rua", 0.1),
  bent("PA1", "CA1", "rua", 0.1), bent("CA2", "PA2", "rua", -0.1), bent("CA3", "PA3", "rua", 0.08), bent("CA4", "PA4", "rua", -0.1),
  bent("CA1", "CB1", "rua", 0.1), bent("CA2", "CB2", "rua", -0.12), bent("CA3", "C1", "rua", 0.1), bent("CA4", "CB4", "rua", 0.1),
  bent("CB1", "CB2", "rua", -0.1), bent("CB2", "RT3", "rua", 0.12), bent("RT2", "CB3", "rua", -0.1), bent("CB3", "CB4", "rua", 0.1), bent("CB4", "Q0", "rua", -0.08),
  bent("CB1", "W0", "rua", 0.1), bent("CB2", "W1", "rua", -0.12), bent("CB3", "E1", "rua", 0.12), bent("CB4", "R2", "rua", -0.08),
  bent("C1", "CB2", "rua", 0.06), bent("SE1", "CB3", "rua", -0.06), bent("SE1", "CA4", "rua", 0.1),
  bent("W0", "CC1", "rua", 0.1), bent("CC1", "CC2", "rua", -0.1), bent("CC2", "RT0", "rua", 0.1), bent("RT0", "CC3", "rua", -0.08), bent("CC3", "CC4", "rua", 0.1), bent("CC4", "R2", "rua", -0.1),
  bent("W1", "CC1", "rua", -0.1), bent("W1", "CC2", "rua", 0.1), bent("E1", "CC3", "rua", -0.1), bent("E1", "CC4", "rua", 0.1),
  bent("CC1", "N1", "rua", 0.1), bent("CC2", "CD1", "rua", -0.1), bent("CD1", "M2", "rua", 0.1), bent("CD1", "C3", "rua", -0.1),
  bent("CC3", "CD2", "rua", 0.1), bent("CD2", "C3", "rua", -0.1), bent("CD2", "NE1", "rua", 0.1), bent("CC4", "NE1", "rua", -0.1), bent("CC4", "D3", "rua", 0.1),
  // Elevado Costelão: 950 m por cima do centro (o "Minhocão" de Porto Gordo)
  { a: "EL0", b: "EL1", kind: "avenida", curve: [10, -120], structure: "viaduto", name: "Elevado Costelão", lift: 8.5, ramp: 150 },
  bent("V2", "EL0", "avenida", 0.05), bent("EL0", "V4", "avenida", -0.05),
  bent("EL1", "Q2", "avenida", 0.1), bent("EL1", "PA5", "rua", 0.05),

  // ======================= Vila do Pastel =======================
  bent("V0", "V1", "rua", 0.12), bent("V1", "V2", "rua", 0.2), bent("V2", "V3", "rua", -0.2), bent("V3", "W0", "rua", 0.1),
  bent("PA0", "V1", "rua", 0.1), bent("V4", "V0", "viela", 0.15), bent("V4", "V1", "viela", -0.2), bent("V3", "CB1", "viela", 0.15),
  bent("V3", "V8", "viela", 0.2), bent("V8", "V2", "viela", -0.15), bent("V8", "V5", "viela", 0.2), bent("V3", "V5", "viela", -0.15),
  bent("V5", "V6", "viela", 0.2), bent("V6", "N0", "viela", 0.15), bent("V5", "V7", "viela", -0.2), bent("V7", "N1", "viela", 0.15), bent("V7", "W0", "viela", -0.15),
  bent("V7", "CC1", "viela", 0.15),

  // ======================= Pontes sobre o Rio Banha =======================
  { a: "MB0", b: "V2", kind: "avenida", curve: [-700, -170], structure: "ponte", name: "Ponte do Torresmo", lift: 6.5, ramp: 120 },
  { a: "MC", b: "N0", kind: "avenida", curve: [-620, 270], structure: "ponte", name: "Ponte Norte", lift: 6.5, ramp: 120 },
  { a: "AP0", b: "K0", kind: "rua", curve: [-690, 640], structure: "ponte", name: "Ponte da Picanha", lift: 6, ramp: 110 },
  { a: "AP3", b: "Y00", kind: "avenida", curve: [-750, 1060], structure: "ponte", name: "Ponte do Yakisoba", lift: 6, ramp: 110 },
  { a: "AP6", b: "O10", kind: "rua", curve: [-800, 1440], structure: "ponte", name: "Ponte da Nascente", lift: 5.5, ramp: 110 },

  // ======================= Jardim das Frituras =======================
  ...ring(ROUNDABOUTS[2]),
  bent("N1", "J0", "avenida", 0.06), bent("J0", "J4", "avenida", -0.05), bent("J4", "K0", "avenida", 0.06),
  bent("C3", "J2", "avenida", 0.04), bent("J2", "RJ3", "rua", 0.1), bent("J2", "C4", "avenida", -0.05),
  bent("J0", "J1", "viela", 0.15), bent("J1", "M2", "viela", -0.15), bent("J1", "RJ3", "viela", 0.15), bent("RJ1", "J2", "viela", -0.15),
  bent("RJ0", "J5", "viela", 0.15), bent("RJ2", "J4", "viela", -0.15), bent("J5", "C4", "viela", 0.15), bent("J5", "K1", "viela", -0.15),
  bent("J2", "J3", "viela", 0.2), bent("J3", "NE1", "viela", -0.15), bent("J3", "R4", "viela", 0.15), bent("J3", "J6", "viela", -0.2),
  bent("J6", "J5", "viela", 0.15), bent("J6", "K2", "viela", -0.15), bent("K2", "R5", "viela", 0.15), bent("C4", "K2", "rua", -0.1),
  bent("J7", "J0", "viela", 0.15), bent("J7", "N0", "viela", -0.2), bent("J7", "K0", "viela", 0.15),
  bent("K0", "K1", "rua", -0.08), bent("K1", "C4", "rua", 0.08), bent("J4", "K1", "viela", 0.15),

  // ======================= Parque da Barriga =======================
  bent("Q0", "Q1", "rua", 0.1), bent("Q1", "QS", "rua", 0.1), bent("QS", "Q2", "rua", 0.12), bent("Q2", "Q3", "rua", 0.25),
  bent("Q3", "Q4", "rua", 0.15), bent("Q4", "QN", "rua", 0.08), bent("QN", "Q5", "rua", 0.1), bent("Q5", "Q0", "rua", 0.25),
  bent("Q0", "R2", "rua", -0.1), bent("Q5", "R2", "rua", 0.1), bent("Q1", "P4", "rua", -0.1), bent("Q2", "PA6", "rua", 0.1),
  { a: "QS", b: "QN", kind: "rua", structure: "ponte", name: "Ponte do Lago", lift: 3.2, ramp: 60 },
  bent("Q4", "D3", "rua", 0.1),

  // ======================= Autódromo =======================
  bent("D3", "T0", "rua", 0.15),

  // ======================= Praia =======================
  bent("PR0", "PR1", "rua", 0.08), bent("PR1", "PR2", "rua", -0.08), bent("PR2", "PR3", "rua", 0.08),
  bent("BM0", "PR0", "rua", 0.1), bent("BM1", "PR1", "rua", -0.1), bent("BM2", "PR2", "rua", 0.1), bent("BM3", "PR3", "rua", -0.1),

  // ======================= Rodoanel de Cebola =======================
  { a: "BM0", b: "HW1", kind: "rodovia", curve: [-1830, -380] },
  bent("HW1", "HW2", "rodovia", 0.04), bent("HW2", "HW3", "rodovia", -0.04), bent("HW3", "HW4", "rodovia", 0.04),
  { a: "HW4", b: "HN0", kind: "rodovia", curve: [-1760, 2560] },
  bent("HN0", "HN1", "rodovia", -0.05),
  bent("HN1", "HNm", "rodovia", -0.05), bent("HNm", "HN2", "rodovia", -0.05),
  bent("HN2", "HN3", "rodovia", 0.04),
  bent("HN3", "HN4", "rodovia", -0.04),
  { a: "HN4", b: "HE4", kind: "rodovia", curve: [2120, 2620] },
  bent("HE4", "HE3", "rodovia", -0.04), bent("HE3", "AEE", "rodovia", 0.03), bent("AEE", "HE2", "rodovia", -0.03), bent("HE2", "HE1", "rodovia", 0.04),
  // Viaduto da Cebola: o Rodoanel desce em diagonal por cima do Distrito até o mar
  { a: "HE1", b: "PE2", kind: "rodovia", curve: [2010, -230], structure: "viaduto", name: "Viaduto da Cebola", lift: 8.5, ramp: 160 },

  // ======================= Morro do Torresmo =======================
  bent("PR3", "MB0", "rua", 0.1), bent("MB0", "ME", "rua", -0.15), bent("ME", "MI", "rua", 0.12), bent("MI", "MM", "rua", -0.12),
  bent("MB0", "MA", "rua", 0.2), bent("MA", "TT0", "rua", -0.2), bent("TT0", "MC", "rua", 0.2), bent("MC", "MD", "rua", -0.15),
  bent("ME", "MF", "viela", 0.25), bent("MF", "MG", "viela", -0.25), bent("MG", "MH", "viela", 0.25),
  bent("MI", "MJ", "rua", -0.2), bent("MJ", "MK", "rua", 0.2), bent("MK", "ML", "rua", -0.2),
  bent("MM", "MN", "rua", 0.15), bent("MN", "MO", "rua", -0.15),
  bent("MA", "MF", "viela", 0.2), bent("MF", "MJ", "viela", -0.2),
  bent("MC", "MG", "viela", -0.2), bent("MG", "MK", "viela", 0.2), bent("MK", "MN", "viela", -0.2),
  bent("MD", "MH", "rua", 0.15), bent("MH", "ML", "rua", -0.15), bent("ML", "MO", "rua", 0.15),
  bent("MM", "HW1", "rua", 0.1), bent("MO", "HW2", "rua", -0.1), bent("PR0", "MM", "rua", 0.1), bent("PR1", "MI", "rua", -0.12), bent("PR2", "ME", "rua", 0.1),
  // Túnel do Torresmo
  { a: "TT0", b: "TT1", kind: "avenida", curve: [-1180, 120], structure: "tunel", name: "Túnel do Torresmo" },
  bent("TT1", "MN", "avenida", 0.1), bent("TT1", "MJ", "rua", -0.1),

  // ======================= Distrito da Gordura Trans =======================
  bent("I00", "I10", "rua", 0.05), bent("I10", "I20", "rua", -0.05), bent("I20", "I30", "rua", 0.05), bent("I30", "I40", "rua", -0.05),
  bent("I01", "I11", "avenida", 0.04), bent("I11", "I21", "avenida", -0.04), bent("I21", "I31", "avenida", 0.04), bent("I31", "I41", "avenida", -0.04), bent("I41", "HE1", "avenida", 0.06),
  bent("I02", "I12", "rua", -0.05), bent("I12", "I22", "rua", 0.05), bent("I22", "I32", "rua", -0.05), bent("I32", "I42", "rua", 0.05), bent("I42", "HE1", "rua", -0.06),
  bent("I03", "I13", "rua", 0.05), bent("I13", "I23", "rua", -0.05), bent("I23", "I33", "rua", 0.05), bent("I33", "I43", "rua", -0.05),
  bent("I04", "I14", "rua", -0.05), bent("I14", "I24", "rua", 0.05), bent("I24", "I34", "rua", -0.05), bent("I34", "HE2", "rua", 0.06), bent("I43", "HE2", "rua", -0.06),
  bent("I00", "I01", "rua", 0.05), bent("I01", "I02", "rua", -0.05), bent("I02", "I03", "rua", 0.05), bent("I03", "I04", "rua", -0.05),
  bent("I10", "I11", "rua", -0.05), bent("I12", "I13", "rua", -0.05), bent("I13", "I14", "rua", 0.05),
  bent("I20", "I21", "rua", 0.05), bent("I21", "I22", "rua", -0.05), bent("I22", "I23", "rua", 0.05), bent("I23", "I24", "rua", -0.05),
  bent("I30", "I31", "rua", -0.05), bent("I31", "I32", "rua", 0.05), bent("I32", "I33", "rua", -0.05), bent("I33", "I34", "rua", 0.05),
  bent("I40", "I41", "rua", 0.05), bent("I41", "I42", "rua", -0.05), bent("I42", "I43", "rua", 0.05),
  // Avenida do Aeroporto: do porto ao aeroporto, passando por cima da Avenida da Gordura
  bent("PE0", "I10", "avenida", 0.04), bent("I10", "I11", "avenida", 0.04), bent("I11", "VG0", "avenida", -0.06),
  { a: "VG0", b: "VG1", kind: "avenida", structure: "viaduto", name: "Viaduto da Gordura", lift: 7.5, ramp: 120 },
  // Avenida da Fritura: corta o Distrito em diagonal
  { a: "I00", b: "I42", kind: "avenida", curve: [1300, -60] },
  bent("VG1", "I13", "avenida", 0.06), bent("I13", "I14", "avenida", 0.04), bent("I14", "AE1", "avenida", -0.04),
  bent("P5", "I00", "rua", 0.1), bent("PE1", "I20", "rua", -0.1), bent("PE2", "I30", "rua", 0.1), bent("PE3", "I40", "rua", -0.1),
  bent("PA6", "I00", "rua", 0.1), bent("Q2", "I01", "avenida", -0.1), bent("Q3", "I02", "rua", 0.1),
  bent("R5", "O5", "avenida", -0.08),

  // ======================= Alto da Picanha =======================
  bent("MD", "AP0", "rua", 0.15), bent("ML", "AP2", "rua", -0.15), bent("MO", "AP2", "rua", 0.1),
  bent("AP0", "AP1", "rua", 0.2), bent("AP1", "AP2", "rua", -0.2), bent("AP3", "AP4", "rua", 0.2), bent("AP4", "AP5", "rua", -0.2),
  bent("AP6", "AP7", "rua", 0.2), bent("AP7", "AP8", "rua", -0.2),
  bent("AP0", "AP3", "rua", -0.2), bent("AP3", "AP6", "rua", 0.2), bent("AP1", "AP4", "viela", 0.25), bent("AP4", "AP7", "viela", -0.25),
  bent("AP2", "AP5", "rua", 0.2), bent("AP5", "AP8", "rua", -0.2),
  bent("AP2", "HW2", "rua", 0.1), bent("AP5", "HW3", "rua", -0.12), bent("AP8", "HW3", "rua", 0.12), bent("AP8", "HW4", "rua", -0.1),

  // ======================= Liberdade do Yakisoba =======================
  ...ring(ROUNDABOUTS[1]),
  // Radiais da Praça do Yakisoba (até o anel interno)
  bent("LR0", "L0", "avenida", 0.02), bent("LR1", "L1", "avenida", -0.03), bent("LR2", "L2", "avenida", 0.03),
  bent("LR3", "L3", "avenida", -0.02), bent("LR4", "L4", "avenida", 0.03), bent("LR5", "L5", "avenida", -0.03),
  // Anel interno (curvo)
  bent("L0", "L1", "rua", -0.12), bent("L1", "L2", "rua", -0.12), bent("L2", "L3", "rua", -0.12),
  bent("L3", "L4", "rua", -0.12), bent("L4", "L5", "rua", -0.12), bent("L5", "L0", "rua", -0.12),
  // Radiais até o anel externo
  bent("L0", "O0", "avenida", 0.03), bent("L1", "O1", "rua", 0.05), bent("L1", "O2", "avenida", -0.04), bent("L2", "O3", "rua", 0.05),
  bent("L2", "O4", "avenida", -0.04), bent("L3", "O5", "rua", -0.05), bent("L3", "O6", "avenida", 0.03), bent("L4", "O7", "rua", 0.05),
  bent("L4", "O8", "avenida", -0.04), bent("L4", "O9", "rua", 0.05), bent("L5", "O10", "avenida", 0.04), bent("L5", "O11", "rua", -0.05),
  // Anel externo
  bent("O0", "O1", "rua", -0.08), bent("O1", "O2", "rua", -0.08), bent("O2", "O3", "rua", -0.08), bent("O3", "O4", "rua", -0.08),
  bent("O4", "O5", "rua", -0.08), bent("O5", "O6", "rua", -0.08), bent("O6", "O7", "rua", -0.08), bent("O7", "O8", "rua", -0.08),
  bent("O8", "O9", "rua", -0.08), bent("O9", "O10", "rua", -0.08), bent("O10", "O11", "rua", -0.08), bent("O11", "O0", "rua", -0.08),
  // Ligações com a cidade velha, a Picanha e o aeroporto
  bent("C4", "O6", "avenida", 0.05), bent("K1", "O7", "rua", -0.08), bent("K0", "O8", "rua", 0.1), bent("K2", "O5", "rua", -0.08),
  bent("Y00", "O9", "avenida", 0.05), bent("Y00", "O8", "rua", -0.1),
  bent("O4", "AE0", "avenida", -0.06), bent("O3", "AW", "avenida", 0.04), bent("O2", "AT0", "avenida", -0.06),

  // ======================= Aeroporto do Pastel =======================
  { a: "AE5", b: "AE4", kind: "pista" },
  { a: "AW", b: "AE5", kind: "taxiway" },
  { a: "AE4", b: "AEE", kind: "taxiway" },
  { a: "AE5", b: "TW0", kind: "taxiway", curve: [740, 1300] },
  { a: "TW0", b: "TW1", kind: "taxiway" },
  { a: "TW1", b: "AE4", kind: "taxiway", curve: [2000, 1310] },
  // Rua do perímetro (sul da pista) e a rua de embarque do terminal (norte)
  bent("AE0", "AE1", "avenida", -0.02), bent("AE1", "AE2", "avenida", 0.02), bent("AE2", "HE2", "avenida", -0.1),
  bent("AW", "AE0", "rua", -0.1), bent("AE2", "AEE", "rua", 0.1), bent("I04", "AE0", "rua", 0.1), bent("I24", "AE1", "rua", -0.1), bent("I34", "AE2", "rua", 0.1),
  bent("AT0", "AT1", "avenida", 0.04), { a: "AT1", b: "AT2", kind: "avenida" }, bent("AT2", "AT3", "avenida", 0.06), bent("AT3", "HE3", "avenida", -0.06),
  bent("AW", "AT0", "rua", -0.15), bent("O1", "AT0", "rua", 0.1),

  // ======================= Serra do Açúcar =======================
  bent("O0", "SA", "avenida", 0.05), bent("O11", "SB", "rua", 0.1),
  bent("SA", "SB", "rua", 0.15), bent("SB", "SC", "rua", -0.2), bent("SC", "SD", "rua", 0.25), bent("SD", "HN1", "rua", -0.2),
  bent("SA", "SE", "rua", -0.2), bent("SE", "SF", "rua", 0.25), bent("SF", "HN2", "rua", -0.2), bent("SD", "SF", "rua", 0.15),
  bent("AP6", "SG", "rua", 0.2), bent("AP7", "SG", "rua", -0.15), bent("SG", "SC", "rua", 0.15), bent("SG", "HW4", "rua", -0.2),
  bent("SC", "SZ1", "rua", 0.3), bent("SZ1", "SZ2", "rua", -0.35), bent("SZ2", "SZ3", "rua", 0.35), bent("SZ3", "HN0", "rua", -0.3),
  bent("O1", "SE", "rua", -0.1),
  // Túnel do Açúcar: a Estrada da Serra atravessa o Pico
  bent("SA", "TS0", "avenida", 0.1),
  { a: "TS0", b: "TS1", kind: "avenida", curve: [-250, 2330], structure: "tunel", name: "Túnel do Açúcar" },
  { a: "TS1", b: "HNm", kind: "avenida" },

  // ======================= Roça do Milho =======================
  bent("AT3", "RO0", "rua", 0.1), bent("SE", "RO0", "rua", -0.15),
  bent("RO0", "RO1", "rua", 0.2), bent("RO1", "RO4", "rua", -0.2), bent("RO4", "HE4", "rua", 0.15), bent("RO1", "RO2", "rua", 0.25),
  bent("RO2", "RO3", "rua", -0.2), bent("RO3", "RO0", "rua", 0.25), bent("RO2", "RO5", "rua", -0.2), bent("RO5", "HN4", "rua", 0.15),
  bent("RO4", "RO5", "rua", 0.2), bent("RO3", "HN3", "rua", -0.2), bent("RO1", "HE3", "rua", 0.15),
] as EdgeSpec[]);
