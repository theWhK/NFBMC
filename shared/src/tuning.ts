// Tunagem e economia de Porto Gordo. Cada carro tem as suas peças (motor,
// turbina, câmbio, suspensão, freios, pneus, redução de peso e nitro), em
// níveis de 0 (de fábrica) a 3 (corrida). O dinheiro sai das corridas, das
// fugas da Vigilância e dos duelos; a carteira e as peças ficam no aparelho
// (client/src/economy.ts), como o progresso da carreira, e o carro chega às
// salas com a tunagem nas opções (o servidor confere e aplica com `tunedSpec`).
import { CARS, type CarCategory, type CarSpec } from "./cars.ts";

export const PARTS = ["engine", "turbo", "transmission", "suspension", "brakes", "tires", "weight", "nos"] as const;
export type Part = (typeof PARTS)[number];

/** Nível de cada peça (0 = de fábrica). */
export type Tune = Record<Part, number>;

export const MAX_LEVEL = 3;
export const LEVEL_NAMES = ["Fábrica", "Rua", "Pro", "Corrida"] as const;

export const PART_INFO: Record<Part, { name: string; icon: string; what: string; price: number }> = {
  engine: { name: "Motor", icon: "🔩", what: "Comando, cabeçote e injeção: mais torque e giro mais alto.", price: 450 },
  turbo: { name: "Turbina", icon: "🌀", what: "Mais ar no motor: força extra que entra forte no giro alto.", price: 650 },
  transmission: { name: "Câmbio", icon: "⚙️", what: "Engates mais rápidos: menos tempo sem força nas trocas.", price: 300 },
  suspension: { name: "Suspensão", icon: "🪝", what: "Molas e amortecedores: o carro vira mais e sai menos de frente em alta.", price: 350 },
  brakes: { name: "Freios", icon: "🛑", what: "Discos e pinças maiores: para em menos espaço.", price: 250 },
  tires: { name: "Pneus", icon: "🛞", what: "Composto mais mole: mais aderência na curva.", price: 300 },
  weight: { name: "Redução de peso", icon: "🪶", what: "Tira banco de trás, estepe e o isopor da marmita: mais leve, mais rápido em tudo.", price: 400 },
  nos: { name: "Nitro", icon: "🧪", what: "Cilindro de NOS: segure Shift acelerando e o motor ganha força enquanto durar o cilindro.", price: 550 },
};

/** Quanto custa cada nível (multiplica o preço da peça e o da categoria). */
const LEVEL_PRICE = [0, 1, 2, 3.5];
const CATEGORY_PRICE: Record<CarCategory, number> = {
  popular: 0.7, hatch: 1, sedan: 1, muscle: 1.3, esportivo: 1.7, super: 2.4, hiper: 3.2, lenda: 2.8,
};

/** Nitro: segundos de cilindro cheio e quanto o motor ganha (fração do torque) em cada nível. */
export const NOS_LEVELS = [
  { seconds: 0, power: 0 },
  { seconds: 4, power: 0.4 },
  { seconds: 6, power: 0.55 },
  { seconds: 8, power: 0.7 },
] as const;
/** O cilindro enche sozinho, do vazio ao cheio, neste tempo (sem estar usando). */
export const NOS_REFILL_SECONDS = 25;

export const emptyTune = (): Tune => ({ engine: 0, turbo: 0, transmission: 0, suspension: 0, brakes: 0, tires: 0, weight: 0, nos: 0 });

/** Lê uma tunagem vinda de fora (do cliente ou do aparelho): só níveis válidos. */
export function sanitizeTune(raw: unknown): Tune {
  const tune = emptyTune();
  if (!raw || typeof raw !== "object") return tune;
  for (const part of PARTS) {
    const level = (raw as Record<string, unknown>)[part];
    if (typeof level === "number" && Number.isFinite(level)) tune[part] = Math.max(0, Math.min(MAX_LEVEL, Math.round(level)));
  }
  return tune;
}

export const isStock = (tune: Tune) => PARTS.every((p) => tune[p] === 0);

/** Preço de um nível de uma peça num carro (comprar o nível 2 já tendo o 1 custa só o 2). */
export function partPrice(car: string, part: Part, level: number) {
  const spec = CARS[car];
  const category = spec ? CATEGORY_PRICE[spec.category] : 1;
  return Math.round((PART_INFO[part].price * LEVEL_PRICE[Math.max(0, Math.min(MAX_LEVEL, level))] * category) / 50) * 50;
}

const step = (levels: readonly number[], level: number) => levels[Math.max(0, Math.min(MAX_LEVEL, level))];

const tunedCache = new Map<string, CarSpec>();

/**
 * Ficha do carro com as peças instaladas. O id continua o mesmo (desenho,
 * colisão e som são do carro), mas os números mudam. Em cache por combinação.
 */
export function tunedSpec(base: CarSpec, tune: Tune | undefined): CarSpec {
  if (!tune || isStock(tune)) return base;
  const key = `${base.id}|${PARTS.map((p) => tune[p]).join("")}`;
  const cached = tunedCache.get(key);
  if (cached) return cached;
  const engine = tune.engine;
  const turbo = tune.turbo;
  const spec: CarSpec = {
    ...base,
    torque: base.torque * step([1, 1.06, 1.12, 1.18], engine),
    redline: base.redline + step([0, 200, 400, 600], engine),
    // Turbina: força extra que cresce com o giro (enche a partir do meio do conta-giros).
    turboGain: (base.turboGain ?? 0) + step([0, 0.1, 0.2, 0.3], turbo),
    shiftTime: (base.shiftTime ?? 1) * step([1, 0.8, 0.6, 0.42], tune.transmission),
    turn: base.turn * step([1, 1.03, 1.06, 1.1], tune.suspension),
    understeer: base.understeer * step([1, 0.85, 0.7, 0.55], tune.suspension),
    brake: base.brake * step([1, 1.1, 1.2, 1.32], tune.brakes),
    grip: (base.grip ?? 1) * step([1, 1.05, 1.1, 1.16], tune.tires),
    mass: Math.round(base.mass * step([1, 0.97, 0.94, 0.9], tune.weight)),
    engine: {
      ...base.engine,
      // Aspirado com turbina ganha o assobio; turbina de corrida, o "psssh" da válvula.
      aspiration: turbo > 0 && base.engine.aspiration === "aspirado" ? "turbo" : base.engine.aspiration,
      bigTurbo: base.engine.bigTurbo || turbo >= MAX_LEVEL,
      exhaust: engine >= 2 ? "corrida" : engine >= 1 && base.engine.exhaust === "fabrica" ? "esportivo" : base.engine.exhaust,
    },
  };
  tunedCache.set(key, spec);
  return spec;
}

/**
 * Rivais da Lista Gorda também mexem nos carros: do #10 ao #8 de fábrica, do #7
 * ao #5 nível Rua, do #4 ao #2 nível Pro e o Bruno com tudo de corrida.
 */
export function rivalTune(rank: number): Tune {
  const level = rank >= 8 ? 0 : rank >= 5 ? 1 : rank >= 2 ? 2 : 3;
  return { ...emptyTune(), engine: level, turbo: level, transmission: level, suspension: level, brakes: level, tires: level, weight: level };
}

// --- Dinheiro ------------------------------------------------------------------

/** Dinheiro de quem começa a carreira (dá para comprar umas primeiras peças). */
export const STARTING_CASH = 2000;

/** Parte do prêmio de cada colocação (1º leva tudo). */
const PLACE_CASH = [1, 0.6, 0.4, 0.28, 0.2, 0.15, 0.12, 0.1];

const round10 = (value: number) => Math.round(value / 10) * 10;

/** Prêmio em dinheiro de uma corrida: cresce com a distância total (voltas × volta). */
export function raceCash(place: number, distance: number) {
  if (place < 1) return 0;
  return round10((350 + (distance / 1000) * 230) * (PLACE_CASH[place - 1] ?? 0.1));
}

/**
 * Calorias "queimadas" numa corrida (sem comida na pista, é daqui que vem a
 * conta da Lista Gorda): 2 kcal por metro corrido, mais para quem chega na frente.
 */
export function raceCalories(place: number, distance: number) {
  if (place < 1) return 0;
  return round10(distance * 2 * (PLACE_CASH[place - 1] ?? 0.1) ** 0.5);
}

/** Fuga da Vigilância: dinheiro por nível. */
export const escapeCash = (stars: number) => 300 * Math.max(1, stars);
/** Autuação: a multa da Vigilância (sai da carteira, até zerar). */
export const bustFine = (stars: number) => 150 * Math.max(1, stars);
/** Duelo vencido contra um rival da Lista Gorda (#10 paga menos que o #1). */
export const duelCash = (rank: number) => 1500 + (10 - rank) * 600;
