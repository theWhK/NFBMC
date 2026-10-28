// Planta de Porto Gordo, desenhada à mão: cruzamentos, ruas e bairros.
// O resto da cidade (prédios, casas, árvores, comida) é gerado a partir disto
// em world.ts. Coordenadas em metros no plano XZ.

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
  // --- Porto Gordo cresceu: os bairros em volta da cidade velha ---
  {
    id: "praia",
    name: "Praia da Batata Frita",
    polygon: [[-1750, -500], [-600, -500], [-600, -330], [-1750, -300]],
    ground: "#d8c38c",
  },
  {
    id: "morro",
    name: "Morro do Torresmo",
    polygon: [[-1750, -300], [-600, -330], [-600, 600], [-1750, 600]],
    ground: "#8a6f50",
  },
  {
    id: "industrial",
    name: "Distrito da Gordura Trans",
    polygon: [[600, -500], [1750, -500], [1750, 600], [600, 600]],
    ground: "#6f6a60",
  },
  {
    id: "picanha",
    name: "Alto da Picanha",
    polygon: [[-1750, 600], [-600, 600], [-600, 1600], [-1750, 1600]],
    ground: "#5d8c3c",
  },
  {
    id: "liberdade",
    name: "Liberdade do Yakisoba",
    polygon: [[-600, 600], [600, 600], [600, 1600], [-600, 1600]],
    ground: "#867c70",
  },
  {
    id: "aeroporto",
    name: "Aeroporto do Pastel",
    polygon: [[600, 600], [1750, 600], [1750, 1600], [600, 1600]],
    ground: "#7b8452",
  },
  {
    id: "serra",
    name: "Serra do Açúcar",
    polygon: [[-1750, 1600], [600, 1600], [600, 2650], [-1750, 2650]],
    ground: "#4f6d36",
  },
  {
    id: "roca",
    name: "Roça do Milho",
    polygon: [[600, 1600], [1750, 1600], [1750, 2650], [600, 2650]],
    ground: "#a39b4c",
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

  // --- Bairros novos ---
  // Avenida Beira-Mar (continuação da Avenida do Porto para oeste) e a do porto para leste
  BA0: [-900, -410], BA1: [-1250, -400],
  PE0: [980, -410], PE1: [1240, -410],
  // Morro do Torresmo: três ladeiras (norte–sul) cortadas por três ruas
  MA: [-760, -250], MB: [-790, 0], MC: [-780, 235], MD: [-770, 480],
  ME: [-1020, -200], MF: [-1040, 30], MG: [-1030, 235], MH: [-1020, 470],
  MI: [-1280, -150], MJ: [-1300, 60], MK: [-1290, 235], ML: [-1280, 480],
  // Rodoanel de Cebola: o anel em volta de tudo
  HW1: [-1560, 235], HW2: [-1560, 900], HW3: [-1550, 1600],
  HN0: [-1300, 2450], HN1: [-450, 2480], HN2: [450, 2480], HN3: [1300, 2450],
  HE3: [1550, 1600], HE2: [1560, 900], HE1: [1560, 250],
  // Distrito da Gordura Trans: quadras grandes de galpões
  I00: [720, -250], I10: [980, -250], I20: [1240, -250],
  I01: [720, 0], I11: [980, 0], I21: [1240, 0],
  I02: [720, 250], I12: [980, 250], I22: [1240, 250],
  I03: [720, 500], I13: [980, 500], I23: [1240, 500],
  // Alto da Picanha: mansões em ruas sinuosas
  AP0: [-800, 700], AP1: [-1100, 760], AP2: [-1380, 720],
  AP3: [-850, 1000], AP4: [-1150, 1050], AP5: [-1400, 1100],
  AP6: [-800, 1350], AP7: [-1100, 1400], AP8: [-1380, 1450],
  // Liberdade do Yakisoba: o centro novo, em grade (Y<coluna><linha>)
  Y00: [-480, 700], Y10: [-240, 700], Y20: [0, 700], Y30: [240, 700], Y40: [480, 700],
  Y01: [-480, 900], Y11: [-240, 900], Y21: [0, 900], Y31: [240, 900], Y41: [480, 900],
  Y02: [-480, 1100], Y12: [-240, 1100], Y22: [0, 1100], Y32: [240, 1100], Y42: [480, 1100],
  Y03: [-480, 1300], Y13: [-240, 1300], Y23: [0, 1300], Y33: [240, 1300], Y43: [480, 1300],
  Y04: [-480, 1500], Y14: [-240, 1500], Y24: [0, 1500], Y34: [240, 1500], Y44: [480, 1500],
  // Aeroporto do Pastel: rua em volta e a pista no meio
  AE0: [700, 700], AE1: [1400, 700], AE4: [1410, 1120], AE2: [1420, 1550], AE3: [720, 1550], AE5: [710, 1120],
  // Serra do Açúcar
  SA: [0, 1720], SB: [-350, 1870], SC: [-720, 2060], SD: [-450, 2290], SE: [320, 1900], SF: [150, 2250], SG: [-1020, 1760],
  // Serpentina do Açúcar: a estrada cheia de curvas em S até o Rodoanel
  SZ1: [-880, 2190], SZ2: [-1010, 2300], SZ3: [-1150, 2360],
  // Roça do Milho
  RO0: [760, 1760], RO1: [1120, 1820], RO2: [1150, 2170], RO3: [720, 2160],
};

/** Tipos de rua: largura em metros. */
export const ROAD_WIDTH = { rodovia: 26, avenida: 22, rua: 15, viela: 12, pista: 40 } as const;
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
  { a: "V0", b: "V1", kind: "rua", curve: [-380, -365] },
  { a: "V1", b: "V2", kind: "rua", curve: [-545, -290] },
  { a: "V2", b: "V3", kind: "rua", curve: [-520, -50] },
  { a: "V3", b: "W0", kind: "rua", curve: [-360, -35] },
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

  // --- Bairros novos ---

  // Avenida Beira-Mar e a Avenida do Porto até o Distrito
  ...chain(["P0", "BA0", "BA1"], "avenida"),
  ...chain(["P5", "PE0", "PE1"], "avenida"),

  // Rodoanel de Cebola: o anel (as curvas de canto são largas, dá para passar voando)
  { a: "BA1", b: "HW1", kind: "rodovia", curve: [-1560, -400] },
  ...chain(["HW1", "HW2", "HW3"], "rodovia"),
  { a: "HW3", b: "HN0", kind: "rodovia", curve: [-1560, 2450] },
  { a: "HN0", b: "HN1", kind: "rodovia", curve: [-880, 2560] },
  { a: "HN1", b: "HN2", kind: "rodovia" },
  { a: "HN2", b: "HN3", kind: "rodovia", curve: [880, 2560] },
  { a: "HN3", b: "HE3", kind: "rodovia", curve: [1560, 2450] },
  ...chain(["HE3", "HE2", "HE1"], "rodovia"),
  { a: "HE1", b: "PE1", kind: "rodovia", curve: [1560, -410] },

  // Morro do Torresmo
  { a: "V2", b: "MA", kind: "rua", curve: [-650, -230] },
  { a: "MA", b: "BA0", kind: "rua", curve: [-860, -300] },
  { a: "MI", b: "BA1", kind: "rua", curve: [-1240, -280] },
  ...chain(["N0", "MC", "MG", "MK", "HW1"], "avenida"),
  { a: "MA", b: "MB", kind: "rua", curve: [-730, -120] },
  { a: "MB", b: "MC", kind: "rua", curve: [-840, 120] },
  { a: "MC", b: "MD", kind: "rua", curve: [-730, 360] },
  { a: "ME", b: "MF", kind: "viela", curve: [-980, -80] },
  { a: "MF", b: "MG", kind: "viela", curve: [-1090, 130] },
  { a: "MG", b: "MH", kind: "viela", curve: [-980, 350] },
  { a: "MI", b: "MJ", kind: "rua", curve: [-1240, -50] },
  { a: "MJ", b: "MK", kind: "rua", curve: [-1340, 150] },
  { a: "MK", b: "ML", kind: "rua", curve: [-1240, 360] },
  { a: "MA", b: "ME", kind: "rua", curve: [-890, -250] },
  { a: "ME", b: "MI", kind: "rua", curve: [-1150, -150] },
  { a: "MB", b: "MF", kind: "viela", curve: [-910, 40] },
  { a: "MF", b: "MJ", kind: "viela", curve: [-1170, 10] },
  { a: "MD", b: "MH", kind: "rua", curve: [-900, 500] },
  { a: "MH", b: "ML", kind: "rua", curve: [-1150, 450] },
  { a: "MD", b: "K0", kind: "rua" },

  // Distrito da Gordura Trans
  ...chain(["I00", "I10", "I20"], "rua"),
  ...chain(["I01", "I11", "I21"], "avenida"),
  ...chain(["I02", "I12", "I22"], "rua"),
  ...chain(["I03", "I13", "I23"], "rua"),
  ...chain(["I00", "I01", "I02", "I03"], "rua"),
  ...chain(["I10", "I11", "I12", "I13"], "avenida"),
  ...chain(["I20", "I21", "I22", "I23"], "rua"),
  { a: "P5", b: "I00", kind: "rua" },
  { a: "I10", b: "PE0", kind: "avenida" },
  { a: "I20", b: "PE1", kind: "rua" },
  { a: "Q2", b: "I01", kind: "avenida", curve: [640, -40] },
  { a: "Q3", b: "I02", kind: "rua", curve: [600, 210] },
  { a: "I21", b: "HE1", kind: "avenida", curve: [1420, 60] },
  { a: "I22", b: "HE1", kind: "rua" },

  // Liberdade do Yakisoba: grade, com a Avenida Central e a Avenida do Yakisoba no meio
  ...chain(["Y00", "Y10", "Y20", "Y30", "Y40"], "rua"),
  ...chain(["Y01", "Y11", "Y21", "Y31", "Y41"], "rua"),
  ...chain(["Y02", "Y12", "Y22", "Y32", "Y42"], "avenida"),
  ...chain(["Y03", "Y13", "Y23", "Y33", "Y43"], "rua"),
  ...chain(["Y04", "Y14", "Y24", "Y34", "Y44"], "rua"),
  ...chain(["Y00", "Y01", "Y02", "Y03", "Y04"], "rua"),
  ...chain(["Y10", "Y11", "Y12", "Y13", "Y14"], "rua"),
  ...chain(["C4", "Y20", "Y21", "Y22", "Y23", "Y24"], "avenida"),
  ...chain(["Y30", "Y31", "Y32", "Y33", "Y34"], "rua"),
  ...chain(["Y40", "Y41", "Y42", "Y43", "Y44"], "rua"),
  // Avenida do Shopping, em diagonal (passa pelo cruzamento do meio)
  { a: "Y11", b: "Y22", kind: "avenida" },
  { a: "Y22", b: "Y33", kind: "avenida" },
  { a: "A9", b: "Y10", kind: "avenida", curve: [-280, 650] },
  { a: "R5", b: "Y30", kind: "avenida", curve: [230, 620] },
  { a: "K0", b: "Y00", kind: "rua", curve: [-540, 620] },

  // Alto da Picanha
  { a: "MD", b: "AP0", kind: "rua", curve: [-760, 600] },
  { a: "ML", b: "AP2", kind: "rua", curve: [-1300, 610] },
  { a: "AP0", b: "AP1", kind: "rua", curve: [-950, 680] },
  { a: "AP1", b: "AP2", kind: "rua", curve: [-1240, 800] },
  { a: "AP3", b: "AP4", kind: "rua", curve: [-1000, 960] },
  { a: "AP4", b: "AP5", kind: "rua", curve: [-1280, 1110] },
  { a: "AP6", b: "AP7", kind: "rua", curve: [-950, 1300] },
  { a: "AP7", b: "AP8", kind: "rua", curve: [-1240, 1470] },
  { a: "AP0", b: "AP3", kind: "rua", curve: [-760, 860] },
  { a: "AP3", b: "AP6", kind: "rua", curve: [-900, 1180] },
  { a: "AP1", b: "AP4", kind: "viela", curve: [-1060, 900] },
  { a: "AP4", b: "AP7", kind: "viela", curve: [-1180, 1230] },
  { a: "AP2", b: "AP5", kind: "rua", curve: [-1440, 900] },
  { a: "AP5", b: "AP8", kind: "rua", curve: [-1350, 1280] },
  { a: "AP0", b: "Y00", kind: "avenida" },
  { a: "AP3", b: "Y02", kind: "rua", curve: [-650, 1080] },
  { a: "AP6", b: "Y03", kind: "rua", curve: [-640, 1300] },
  { a: "AP5", b: "HW2", kind: "rua", curve: [-1500, 1000] },
  { a: "AP8", b: "HW3", kind: "rua", curve: [-1480, 1560] },

  // Aeroporto do Pastel
  ...chain(["AE0", "AE1", "AE4", "AE2", "AE3", "AE5", "AE0"], "avenida"),
  { a: "AE5", b: "AE4", kind: "pista" },
  { a: "Y40", b: "AE0", kind: "rua" },
  { a: "Y42", b: "AE5", kind: "avenida" },
  { a: "Y44", b: "AE3", kind: "rua" },
  { a: "AE0", b: "I03", kind: "avenida", curve: [700, 600] },
  { a: "AE1", b: "HE2", kind: "rua", curve: [1500, 760] },
  { a: "AE2", b: "HE3", kind: "rua" },

  // Serra do Açúcar: estradas sinuosas no meio do mato
  { a: "Y24", b: "SA", kind: "avenida" },
  { a: "SA", b: "SB", kind: "rua", curve: [-120, 1900] },
  { a: "SB", b: "SC", kind: "rua", curve: [-560, 1880] },
  { a: "SC", b: "SD", kind: "rua", curve: [-720, 2280] },
  { a: "SD", b: "HN1", kind: "rua", curve: [-330, 2400] },
  { a: "SA", b: "SE", kind: "rua", curve: [220, 1740] },
  { a: "SE", b: "SF", kind: "rua", curve: [380, 2120] },
  { a: "SF", b: "HN2", kind: "rua", curve: [260, 2420] },
  { a: "SD", b: "SF", kind: "rua", curve: [-150, 2140] },
  { a: "Y04", b: "SB", kind: "rua", curve: [-470, 1700] },
  { a: "AP7", b: "SG", kind: "rua", curve: [-1150, 1600] },
  { a: "SG", b: "SC", kind: "rua", curve: [-820, 1820] },
  { a: "SG", b: "HW3", kind: "rua", curve: [-1300, 1700] },
  { a: "SC", b: "SZ1", kind: "rua", curve: [-740, 2210] },
  { a: "SZ1", b: "SZ2", kind: "rua", curve: [-1020, 2170] },
  { a: "SZ2", b: "SZ3", kind: "rua", curve: [-1030, 2440] },
  { a: "SZ3", b: "HN0", kind: "rua", curve: [-1260, 2290] },

  // Roça do Milho
  { a: "AE3", b: "RO0", kind: "rua" },
  { a: "SE", b: "RO0", kind: "rua", curve: [560, 1880] },
  { a: "RO0", b: "RO1", kind: "rua", curve: [940, 1740] },
  { a: "RO1", b: "HE3", kind: "rua", curve: [1350, 1760] },
  { a: "RO1", b: "RO2", kind: "rua", curve: [1220, 2000] },
  { a: "RO2", b: "RO3", kind: "rua", curve: [930, 2240] },
  { a: "RO3", b: "RO0", kind: "rua", curve: [660, 1960] },
  { a: "RO2", b: "HN3", kind: "rua", curve: [1220, 2380] },
  { a: "RO3", b: "HN2", kind: "rua", curve: [600, 2380] },
];

/** Lago do Parque da Barriga (não dá para dirigir dentro). */
export const LAKE = { x: 400, z: -45, rx: 85, rz: 60 } as const;

/** Muro do cais: ao sul dele é mar. */
export const QUAY_Z = -500;
