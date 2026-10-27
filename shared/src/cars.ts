// Garagem de Porto Gordo: os carros do jogo, inspirados em carros de verdade
// (de popular a hipercarro), cada um com um toque de comida. Os números são
// próximos dos reais (massa, torque, marchas, aerodinâmica); a física em
// physics.ts tira deles a aceleração, o giro do motor e a velocidade final.

export type CarCategory = "popular" | "hatch" | "sedan" | "muscle" | "esportivo" | "super" | "hiper" | "lenda";

export const CATEGORY_LABELS: Record<CarCategory, string> = {
  popular: "Popular",
  hatch: "Hatch",
  sedan: "Sedã",
  muscle: "Muscle",
  esportivo: "Esportivo",
  super: "Superesportivo",
  hiper: "Hipercarro",
  lenda: "Lenda",
};

/** Formato da carroceria: o cliente desenha cada um de um jeito. */
export type BodyStyle =
  | "fusca" | "uno" | "gol" | "sedan" | "hatch" | "opala" | "muscle"
  | "supra" | "skyline" | "porsche" | "wedge" | "ferrari" | "veyron" | "hyper" | "a3" | "m3";

/** Comprimento e largura (m) de cada carroceria: o desenho e a colisão usam os mesmos. */
export const BODY_SIZE: Record<BodyStyle, { length: number; width: number }> = {
  fusca: { length: 4.05, width: 1.55 },
  uno: { length: 3.65, width: 1.55 },
  gol: { length: 3.8, width: 1.6 },
  sedan: { length: 4.5, width: 1.75 },
  hatch: { length: 4.2, width: 1.78 },
  opala: { length: 4.8, width: 1.8 },
  muscle: { length: 4.8, width: 1.9 },
  supra: { length: 4.5, width: 1.81 },
  skyline: { length: 4.6, width: 1.79 },
  porsche: { length: 4.45, width: 1.85 },
  wedge: { length: 4.6, width: 2.0 },
  ferrari: { length: 4.7, width: 2.0 },
  veyron: { length: 4.46, width: 2.0 },
  hyper: { length: 4.3, width: 2.0 },
  m3: { length: 4.5, width: 1.86 },
  a3: { length: 4.2, width: 1.76 },
};

/** Medidas dos carros do trânsito (o desenho deles fica no cliente). */
export const TRAFFIC_SIZE = { length: 4.3, width: 2.0 };

/**
 * Como o motor soa (o cliente sintetiza o ronco a partir disto): quantos
 * cilindros e em que arranjo, se respira por turbina e que escapamento tem.
 */
export interface EngineSound {
  cylinders: number;
  /** Em linha, boxer (cilindros deitados), em V ou em W (dois V juntos). */
  layout: "linha" | "boxer" | "v" | "w";
  /** Cilindrada (litros): motor grande tem pulso mais grave e encorpado. */
  liters: number;
  aspiration: "aspirado" | "turbo" | "biturbo" | "quadriturbo";
  /** Escapamento: de fábrica (abafado), esportivo ou de corrida (direto, estala). */
  exhaust: "fabrica" | "esportivo" | "corrida";
  /** V8 de virabrequim cruzado: cada bancada pulsa irregular, o "blub-blub" americano. */
  crossplane?: boolean;
  /** Refrigerado a ar (Fusca): ventoinha assobiando e batida de válvula aparecendo. */
  airCooled?: boolean;
  /** Diesel: a batida seca da combustão por compressão. */
  diesel?: boolean;
  /** Comando variável (VTEC): acima deste giro o motor muda de voz e grita. */
  camRpm?: number;
  /** Turbina grande e preparada: demora a encher e faz a válvula de alívio cantar. */
  bigTurbo?: boolean;
}

export interface CarSpec {
  id: string;
  /** Nome no jogo (a paródia). */
  name: string;
  /** Em quem ele se inspira. */
  inspired: string;
  category: CarCategory;
  body: BodyStyle;
  /** A piada de comida, para a garagem. */
  food: string;
  /** Cor de fábrica (a pintura da garagem pode trocar). */
  color: string;
  /** Massa em kg. */
  mass: number;
  /** Torque máximo (N·m) e o giro em que ele acontece. */
  torque: number;
  peakRpm: number;
  idleRpm: number;
  redline: number;
  /** Relações das marchas (1ª, 2ª, ...) e do diferencial. */
  gears: number[];
  finalDrive: number;
  /** Raio da roda (m). */
  wheelRadius: number;
  /** Área frontal × coeficiente de arrasto (m²): quanto o ar segura o carro. */
  dragArea: number;
  /** Desaceleração máxima no freio (m/s²). */
  brake: number;
  /** Velocidade de giro do volante (rad/s) em baixa velocidade. */
  turn: number;
  /** Quanto o carro perde de esterço em alta (0 = nada, 1 = muito). */
  understeer: number;
  /** Perfil do ronco (o som de cada carro sai daqui). */
  engine: EngineSound;
}

const CARS_LIST: CarSpec[] = [
  {
    id: "uno", name: "Uno Coxinha", inspired: "Fiat Uno Mille", category: "popular", body: "uno",
    food: "Quadradinho por fora, recheio de frango por dentro. Vem com uma coxinha gigante no teto.",
    color: "#e9c46a", mass: 820, torque: 82, peakRpm: 3000, idleRpm: 900, redline: 6000,
    gears: [3.91, 2.16, 1.41, 1.03, 0.82], finalDrive: 4.07, wheelRadius: 0.28, dragArea: 0.62, brake: 8, turn: 2.6, understeer: 0.3,
    engine: { cylinders: 4, layout: "linha", liters: 1.0, aspiration: "aspirado", exhaust: "fabrica" },
  },
  {
    id: "fusca", name: "Fusca Pão de Queijo", inspired: "VW Fusca 1300", category: "popular", body: "fusca",
    food: "Redondinho, quentinho e sempre saindo do forno (do motor traseiro).",
    color: "#f2c46d", mass: 800, torque: 95, peakRpm: 2600, idleRpm: 850, redline: 4800,
    gears: [3.8, 2.06, 1.32, 0.89], finalDrive: 4.125, wheelRadius: 0.3, dragArea: 0.72, brake: 7.5, turn: 2.5, understeer: 0.35,
    engine: { cylinders: 4, layout: "boxer", liters: 1.3, aspiration: "aspirado", exhaust: "fabrica", airCooled: true },
  },
  {
    id: "gol", name: "Gol Bolinha de Queijo", inspired: "VW Gol G2", category: "popular", body: "gol",
    food: "O carro mais vendido da padaria. Bolinhas de queijo no bagageiro.",
    color: "#c1121f", mass: 900, torque: 128, peakRpm: 3000, idleRpm: 850, redline: 6200,
    gears: [3.45, 1.94, 1.29, 0.97, 0.8], finalDrive: 4.24, wheelRadius: 0.29, dragArea: 0.66, brake: 8.5, turn: 2.6, understeer: 0.3,
    engine: { cylinders: 4, layout: "linha", liters: 1.8, aspiration: "aspirado", exhaust: "esportivo" },
  },
  {
    id: "civic", name: "Civic Sushi", inspired: "Honda Civic Si", category: "sedan", body: "sedan",
    food: "Arroz por fora, alga no meio e o VTEC de salmão. Gira até o hashi tremer.",
    color: "#f4f1e8", mass: 1200, torque: 190, peakRpm: 6200, idleRpm: 950, redline: 8200,
    gears: [3.27, 2.13, 1.52, 1.15, 0.92, 0.74], finalDrive: 4.76, wheelRadius: 0.31, dragArea: 0.62, brake: 9, turn: 2.5, understeer: 0.3,
    engine: { cylinders: 4, layout: "linha", liters: 2.0, aspiration: "aspirado", exhaust: "esportivo", camRpm: 5800 },
  },
  {
    id: "golf", name: "Golf GTI Goiabada", inspired: "VW Golf GTI", category: "hatch", body: "hatch",
    food: "Romeu e Julieta sobre rodas: goiabada vermelha com faixa de queijo.",
    color: "#9d1c2f", mass: 1280, torque: 280, peakRpm: 2400, idleRpm: 800, redline: 6600,
    gears: [3.36, 2.09, 1.47, 1.1, 0.88, 0.73], finalDrive: 3.94, wheelRadius: 0.32, dragArea: 0.66, brake: 9.5, turn: 2.45, understeer: 0.3,
    engine: { cylinders: 4, layout: "linha", liters: 2.0, aspiration: "turbo", exhaust: "esportivo" },
  },
  {
    id: "opala", name: "Opala Picanha", inspired: "Chevrolet Opala SS 4.1", category: "muscle", body: "opala",
    food: "Seis cilindros de churrasco com a capa de gordura por cima. Ronca que nem a churrasqueira.",
    color: "#7a1f1f", mass: 1180, torque: 295, peakRpm: 2200, idleRpm: 700, redline: 4900,
    gears: [2.85, 1.68, 1.0, 0.81], finalDrive: 3.08, wheelRadius: 0.33, dragArea: 0.78, brake: 8, turn: 2.2, understeer: 0.45,
    engine: { cylinders: 6, layout: "linha", liters: 4.1, aspiration: "aspirado", exhaust: "esportivo" },
  },
  {
    id: "mustang", name: "Mustang Mostarda", inspired: "Ford Mustang GT", category: "muscle", body: "muscle",
    food: "Amarelo mostarda com faixas pretas. Combina com qualquer cachorro-quente.",
    color: "#f2b705", mass: 1650, torque: 530, peakRpm: 4250, idleRpm: 750, redline: 7000,
    gears: [3.66, 2.43, 1.69, 1.32, 1.0, 0.65], finalDrive: 3.55, wheelRadius: 0.34, dragArea: 0.78, brake: 9.5, turn: 2.2, understeer: 0.45,
    engine: { cylinders: 8, layout: "v", liters: 5.0, aspiration: "aspirado", exhaust: "esportivo", crossplane: true },
  },
  {
    id: "supra", name: "Supra Salsicha", inspired: "Toyota Supra MK4", category: "esportivo", body: "supra",
    food: "Pão por fora, salsicha turbinada por dentro. O aerofólio segura até o vinagrete.",
    color: "#e76f2a", mass: 1510, torque: 600, peakRpm: 4200, idleRpm: 850, redline: 7200,
    gears: [3.83, 2.36, 1.69, 1.31, 1.0, 0.79], finalDrive: 3.27, wheelRadius: 0.33, dragArea: 0.6, brake: 10, turn: 2.35, understeer: 0.35,
    engine: { cylinders: 6, layout: "linha", liters: 3.0, aspiration: "biturbo", exhaust: "esportivo" },
  },
  {
    id: "skyline", name: "Skyline Shoyu", inspired: "Nissan Skyline GT-R R34", category: "esportivo", body: "skyline",
    food: "Tração integral e molho de soja no cárter. Salgado de rápido.",
    color: "#2b2d42", mass: 1560, torque: 610, peakRpm: 4400, idleRpm: 900, redline: 8000,
    gears: [3.83, 2.36, 1.69, 1.31, 1.0, 0.79], finalDrive: 3.55, wheelRadius: 0.33, dragArea: 0.62, brake: 10.5, turn: 2.45, understeer: 0.25,
    engine: { cylinders: 6, layout: "linha", liters: 2.6, aspiration: "biturbo", exhaust: "corrida" },
  },
  {
    id: "porchetta", name: "Porchetta 911", inspired: "Porsche 911 Turbo", category: "esportivo", body: "porsche",
    food: "Pururuca alemã com motor atrás, igual leitoa no espeto.",
    color: "#a35b2a", mass: 1470, torque: 650, peakRpm: 2700, idleRpm: 850, redline: 7100,
    gears: [3.91, 2.32, 1.61, 1.28, 1.08, 0.88], finalDrive: 3.1, wheelRadius: 0.34, dragArea: 0.6, brake: 11, turn: 2.45, understeer: 0.25,
    engine: { cylinders: 6, layout: "boxer", liters: 3.6, aspiration: "biturbo", exhaust: "esportivo" },
  },
  {
    id: "lasanha", name: "Lambo Lasanha", inspired: "Lamborghini Murciélago", category: "super", body: "wedge",
    food: "Camadas de massa, molho e queijo em formato de cunha. Portas que abrem para cima, igual o forno.",
    color: "#f4a300", mass: 1650, torque: 660, peakRpm: 5400, idleRpm: 900, redline: 8000,
    gears: [2.94, 2.06, 1.52, 1.21, 1.0, 0.86], finalDrive: 3.54, wheelRadius: 0.35, dragArea: 0.62, brake: 11.5, turn: 2.35, understeer: 0.3,
    engine: { cylinders: 12, layout: "v", liters: 6.2, aspiration: "aspirado", exhaust: "corrida" },
  },
  {
    id: "farofa", name: "Ferrari Farofa", inspired: "Ferrari Enzo", category: "super", body: "ferrari",
    food: "Vermelha, italiana e espalhando farofa por toda a pista.",
    color: "#d00000", mass: 1365, torque: 657, peakRpm: 5500, idleRpm: 1000, redline: 8200,
    gears: [3.15, 2.18, 1.64, 1.3, 1.07, 0.9], finalDrive: 3.45, wheelRadius: 0.35, dragArea: 0.6, brake: 12, turn: 2.45, understeer: 0.25,
    engine: { cylinders: 12, layout: "v", liters: 6.0, aspiration: "aspirado", exhaust: "corrida" },
  },
  {
    id: "brigadeiro", name: "Bugatti Brigadeiro", inspired: "Bugatti Veyron", category: "hiper", body: "veyron",
    food: "Duas cores de chocolate e granulado colorido. Dezesseis cilindros de açúcar.",
    color: "#4a2c1d", mass: 1890, torque: 1250, peakRpm: 3000, idleRpm: 900, redline: 6600,
    gears: [3.18, 2.26, 1.68, 1.29, 1.02, 0.81, 0.69], finalDrive: 3.3, wheelRadius: 0.36, dragArea: 0.55, brake: 12, turn: 2.3, understeer: 0.3,
    engine: { cylinders: 16, layout: "w", liters: 8.0, aspiration: "quadriturbo", exhaust: "fabrica" },
  },
  {
    id: "kibe", name: "Kibe-segg", inspired: "Koenigsegg Agera", category: "hiper", body: "hyper",
    food: "Sueco de nascença, árabe de coração. Recheio de hortelã e fibra de carbono.",
    color: "#6b4a2b", mass: 1435, torque: 1100, peakRpm: 4100, idleRpm: 950, redline: 7800,
    gears: [2.98, 2.15, 1.6, 1.24, 1.0, 0.82, 0.7], finalDrive: 3.36, wheelRadius: 0.36, dragArea: 0.6, brake: 12.5, turn: 2.4, understeer: 0.28,
    engine: { cylinders: 8, layout: "v", liters: 5.0, aspiration: "biturbo", exhaust: "corrida" },
  },
  {
    id: "m3", name: "M3 Gorgonzola GTR", inspired: "BMW M3 GTR (E46)", category: "lenda", body: "m3",
    food: "Prata com veias azuis, igual ao queijo. O carro do protagonista: forte, fedido e lendário. Foi roubado pelo Bruno no prólogo.",
    color: "#c9ced6", mass: 1350, torque: 620, peakRpm: 6200, idleRpm: 1000, redline: 8600,
    gears: [3.2, 2.2, 1.65, 1.3, 1.07, 0.88], finalDrive: 3.3, wheelRadius: 0.34, dragArea: 0.58, brake: 12, turn: 2.55, understeer: 0.22,
    engine: { cylinders: 8, layout: "v", liters: 4.0, aspiration: "aspirado", exhaust: "corrida" },
  },
  {
    id: "a3bruno", name: "A3 do Bruno", inspired: "Audi A3 1.8T 2002 (todo mexido)", category: "lenda", body: "a3",
    food: "Um hatch de 2002 com turbina de navio, remap no talo e cheiro de X-Tudo no banco. Ninguém sabe o que tem debaixo do capô. O Bruno também não.",
    color: "#b8bcc2", mass: 1250, torque: 1150, peakRpm: 4500, idleRpm: 1000, redline: 8800,
    gears: [3.36, 2.12, 1.56, 1.2, 0.97, 0.78], finalDrive: 3.05, wheelRadius: 0.33, dragArea: 0.58, brake: 12, turn: 2.5, understeer: 0.25,
    engine: { cylinders: 4, layout: "linha", liters: 1.8, aspiration: "turbo", exhaust: "corrida", bigTurbo: true },
  },
];

/**
 * Viaturas da Vigilância Sanitária: uma comum, a "tática" dos níveis altos e o
 * Couve-vette do Sargento Cross-fit (modo história), mais rápido que a tática
 * mas, por pouco, mais lento que o M3 Gorgonzola na reta.
 */
const COP_CARS: CarSpec[] = [
  {
    id: "viatura", name: "Viatura Opala", inspired: "Chevrolet Opala (viatura)", category: "muscle", body: "opala",
    food: "", color: "#f4f4f0", mass: 1200, torque: 340, peakRpm: 2400, idleRpm: 700, redline: 5200,
    gears: [2.85, 1.68, 1.15, 0.85], finalDrive: 3.31, wheelRadius: 0.33, dragArea: 0.74, brake: 9, turn: 2.4, understeer: 0.35,
    engine: { cylinders: 6, layout: "linha", liters: 4.1, aspiration: "aspirado", exhaust: "fabrica" },
  },
  {
    id: "viatura-tatica", name: "Viatura Tática", inspired: "Superesportivo apreendido", category: "super", body: "wedge",
    food: "", color: "#f4f4f0", mass: 1550, torque: 700, peakRpm: 5000, idleRpm: 900, redline: 8000,
    gears: [2.94, 2.06, 1.52, 1.21, 1.0, 0.86], finalDrive: 3.54, wheelRadius: 0.35, dragArea: 0.62, brake: 11.5, turn: 2.45, understeer: 0.3,
    engine: { cylinders: 12, layout: "v", liters: 6.2, aspiration: "aspirado", exhaust: "esportivo" },
  },
  {
    id: "viatura-crossfit", name: "Couve-vette Detox", inspired: "Chevrolet Corvette Z06 (viatura)", category: "super", body: "muscle",
    food: "Suco verde no radiador, couve no para-choque e um halter no teto. Zero carboidrato, zero piedade.",
    color: "#1f3d24", mass: 1420, torque: 640, peakRpm: 4800, idleRpm: 900, redline: 7100,
    gears: [2.97, 2.07, 1.43, 1.0, 0.84, 0.71], finalDrive: 3.42, wheelRadius: 0.34, dragArea: 0.66, brake: 12, turn: 2.5, understeer: 0.25,
    // V8 7.0 aspirado do Z06: o "blub-blub" do virabrequim cruzado, com escape esportivo.
    engine: { cylinders: 8, layout: "v", liters: 7.0, aspiration: "aspirado", exhaust: "esportivo", crossplane: true },
  },
];

/** Viatura do Sargento Cross-fit (modo história). */
export const CROSSFIT_CAR = "viatura-crossfit";

export const CARS: Record<string, CarSpec> = Object.fromEntries([...CARS_LIST, ...COP_CARS].map((c) => [c.id, c]));
/** Carros que os jogadores podem escolher, do mais fraco ao mais forte. */
export const PLAYER_CARS = CARS_LIST.map((c) => c.id);
export const DEFAULT_CAR = "civic";

export const isCarId = (value: unknown): value is string =>
  typeof value === "string" && PLAYER_CARS.includes(value);

export const carSpec = (id: unknown): CarSpec => CARS[typeof id === "string" && id in CARS ? id : DEFAULT_CAR];

/** Meio comprimento e meia largura de um carro da garagem (para colisão). */
export function carHalfSize(id: unknown) {
  const size = BODY_SIZE[carSpec(id).body];
  return { halfLength: size.length / 2, halfWidth: size.width / 2 };
}
