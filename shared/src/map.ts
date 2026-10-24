// Planta de Porto Gordo, desenhada à mão: cruzamentos, ruas e bairros.
// O resto da cidade (prédios, casas, árvores, comida) é gerado a partir disto
// em world.ts. Coordenadas em metros no plano XZ.

export type DistrictId = "centro" | "porto" | "vila" | "jardim" | "parque" | "autodromo";

export interface District {
  id: DistrictId;
  name: string;
  /** Contorno do bairro (polígono). */
  polygon: [number, number][];
  /** Cor do chão do bairro (fora das ruas). */
  ground: string;
}

export const DISTRICTS: District[] = [
  {
    id: "porto",
    name: "Porto Gordo",
    polygon: [[-600, -500], [600, -500], [600, -320], [210, -320], [-260, -320], [-600, -330]],
    ground: "#7a7468",
  },
  {
    id: "centro",
    name: "Centro",
    polygon: [[-260, -320], [210, -320], [210, 205], [-260, 205]],
    ground: "#8d8478",
  },
  {
    id: "vila",
    name: "Vila do Pastel",
    polygon: [[-600, -330], [-260, -320], [-260, 205], [-310, 300], [-600, 300]],
    ground: "#7d8a45",
  },
  {
    id: "jardim",
    name: "Jardim das Frituras",
    polygon: [[-600, 300], [-310, 300], [-260, 205], [228, 205], [228, 600], [-600, 600]],
    ground: "#76913f",
  },
  {
    id: "parque",
    name: "Parque da Barriga",
    polygon: [[210, -320], [600, -320], [600, 205], [210, 205]],
    ground: "#5f8f3a",
  },
  {
    id: "autodromo",
    name: "Autódromo do Colesterol",
    polygon: [[228, 205], [600, 205], [600, 600], [228, 600]],
    ground: "#6f8a3a",
  },
];

/** Cruzamentos e pontas de rua. */
export const NODES: Record<string, [number, number]> = {
  // Avenida do Porto (beira-mar)
  P0: [-570, -420], P1: [-300, -430], P2: [-60, -415], P3: [180, -430], P4: [420, -420], P5: [570, -405],
  // Rua do Cais (entre os galpões e o mar)
  X0: [-450, -478], X1: [-60, -480], X2: [300, -478],
  // Avenida Central (norte–sul)
  C1: [-50, -200], C5: [-45, -100], C2: [-40, 0], C3: [-30, 200], C6: [-25, 400], C7: [-22, 500], C4: [-20, 575],
  // Avenida Diagonal
  D1: [-150, -200], D2: [90, 130], D3: [215, 215],
  // Rua do Parque (leste do centro)
  R1: [200, -200], Q0: [205, -100], R2: [210, 0], R4: [212, 400], R5: [212, 500],
  // Avenida Norte e ruas do centro
  N0: [-570, 235], N1: [-300, 220], M2: [-150, 212],
  W0: [-300, 0], M1: [-150, 0], M4: [80, 0],
  S0: [-300, -200], M3: [80, -200], M5: [-150, -100], M6: [80, -100],
  // Vila do Pastel
  V0: [-300, -300], V1: [-450, -320], V2: [-535, -160], V3: [-430, -40], V4: [-420, -175], V5: [-450, 90], V6: [-545, 190],
  // Jardim das Frituras
  J0: [-305, 400], J1: [-150, 360], J4: [100, 330], J7: [-308, 500], K0: [-570, 480], K1: [-160, 505], K2: [100, 480],
  // Parque da Barriga
  Q1: [370, -210], Q2: [545, -80], Q3: [470, 125], Q4: [300, 105],
  // Entrada do autódromo
  T0: [338, 326],
  // Avenida Oeste (ponta norte)
  A9: [-310, 575],
};

/** Tipos de rua: largura em metros. */
export const ROAD_WIDTH = { avenida: 22, rua: 15, viela: 12 } as const;
export type RoadKind = keyof typeof ROAD_WIDTH;

export interface EdgeSpec {
  a: string;
  b: string;
  kind: RoadKind;
  /** Ponto de controle da curva (sem ele, a rua é reta). */
  curve?: [number, number];
}

const chain = (ids: string[], kind: RoadKind): EdgeSpec[] =>
  ids.slice(1).map((b, i) => ({ a: ids[i], b, kind }));

export const EDGES: EdgeSpec[] = [
  // Avenidas
  ...chain(["P0", "P1", "P2", "P3", "P4", "P5"], "avenida"),
  ...chain(["P2", "C1", "C5", "C2", "C3", "C6", "C7", "C4"], "avenida"),
  ...chain(["P1", "D1", "C2", "D2", "D3"], "avenida"),
  ...chain(["P3", "R1", "Q0", "R2", "D3", "R4", "R5"], "avenida"),
  ...chain(["N0", "N1", "M2", "C3", "D3"], "avenida"),
  ...chain(["P1", "V0", "S0", "W0", "N1", "J0", "J7", "A9"], "avenida"),

  // Centro
  ...chain(["W0", "M1", "C2", "M4", "R2"], "rua"),
  ...chain(["S0", "D1", "C1", "M3", "R1"], "rua"),
  ...chain(["D1", "M5", "M1", "M2"], "rua"),
  ...chain(["M3", "M6", "M4", "D2"], "rua"),
  ...chain(["M5", "C5", "M6"], "rua"),

  // Porto
  ...chain(["X0", "X1", "X2"], "rua"),
  { a: "X0", b: "P1", kind: "rua" },
  { a: "X1", b: "P2", kind: "rua" },
  { a: "X2", b: "P4", kind: "rua" },

  // Vila do Pastel: ruas curvas
  { a: "V0", b: "V1", kind: "viela", curve: [-380, -365] },
  { a: "V1", b: "V2", kind: "viela", curve: [-545, -290] },
  { a: "V2", b: "V3", kind: "viela", curve: [-520, -50] },
  { a: "V3", b: "W0", kind: "viela", curve: [-360, -35] },
  { a: "S0", b: "V4", kind: "viela", curve: [-360, -215] },
  { a: "V4", b: "V2", kind: "viela", curve: [-480, -130] },
  { a: "V4", b: "V3", kind: "viela" },
  { a: "W0", b: "V5", kind: "viela", curve: [-390, 70] },
  { a: "V5", b: "V6", kind: "viela", curve: [-520, 100] },
  { a: "V6", b: "N0", kind: "viela" },
  { a: "V5", b: "N1", kind: "viela", curve: [-360, 160] },

  // Jardim das Frituras
  { a: "J0", b: "J1", kind: "viela", curve: [-230, 410] },
  { a: "M2", b: "J1", kind: "viela", curve: [-120, 290] },
  { a: "J1", b: "C6", kind: "viela", curve: [-80, 330] },
  { a: "C6", b: "J4", kind: "viela", curve: [40, 410] },
  { a: "J4", b: "R4", kind: "viela", curve: [160, 360] },
  { a: "J4", b: "D3", kind: "viela", curve: [160, 260] },
  { a: "K0", b: "J7", kind: "viela", curve: [-440, 520] },
  { a: "J7", b: "K1", kind: "viela", curve: [-230, 540] },
  { a: "K1", b: "C7", kind: "viela", curve: [-90, 470] },
  { a: "C7", b: "K2", kind: "viela", curve: [40, 520] },
  { a: "K2", b: "R5", kind: "viela", curve: [160, 470] },

  // Parque da Barriga: alameda em volta do lago
  { a: "Q0", b: "Q1", kind: "rua", curve: [280, -220] },
  { a: "Q1", b: "Q2", kind: "rua", curve: [500, -230] },
  { a: "Q2", b: "Q3", kind: "rua", curve: [580, 60] },
  { a: "Q3", b: "Q4", kind: "rua", curve: [390, 170] },
  { a: "Q4", b: "R2", kind: "rua", curve: [250, 30] },
  { a: "Q1", b: "P4", kind: "rua", curve: [420, -300] },

  // Entrada do autódromo
  { a: "D3", b: "T0", kind: "rua", curve: [300, 240] },
];

/** Lago do Parque da Barriga (não dá para dirigir dentro). */
export const LAKE = { x: 400, z: -45, rx: 85, rz: 60 } as const;

/** Muro do cais: ao sul dele é mar. */
export const QUAY_Z = -500;
