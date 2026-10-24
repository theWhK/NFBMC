// Constantes e tipos usados tanto pelo servidor quanto pelo cliente.

export * from "./track.ts";
export * from "./physics.ts";
export * from "./world.ts";

export const ROOM_NAME = "race";
export const WORLD_ROOM_NAME = "world";

export const MAX_PLAYERS = 8;
export const NAME_MAX_LENGTH = 16;

export const COUNTDOWN_SECONDS = 3;
/** Depois que o primeiro cruza a chegada, quanto tempo os outros têm para terminar. */
export const FINISH_GRACE_SECONDS = 45;
/** Quanto tempo a tela de resultado fica antes de voltar para o lobby. */
export const RESULTS_SECONDS = 15;

/** Bônus de calorias pela colocação (1º, 2º, 3º...). Ganha quem somar mais calorias. */
export const PLACE_BONUS = [1000, 600, 300, 150, 100, 50, 50, 50] as const;

export type Phase = "lobby" | "countdown" | "racing" | "results";

export type FoodKind = "burger" | "fries" | "soda";

export const FOOD: Record<FoodKind, { calories: number; boostSeconds: number; label: string }> = {
  burger: { calories: 500, boostSeconds: 0.5, label: "Hambúrguer" },
  fries: { calories: 300, boostSeconds: 1, label: "Batata frita" },
  soda: { calories: 150, boostSeconds: 2.5, label: "Refri" },
};

export const FOOD_PICKUP_RADIUS = 3;
export const FOOD_RESPAWN_SECONDS = 8;
/** No mundo aberto a comida das barraquinhas demora mais para voltar. */
export const STAND_RESPAWN_SECONDS = 25;
/** Corrida de evento (saindo do mundo aberto): espera a galera entrar até este tempo. */
export const EVENT_JOIN_SECONDS = 8;

export type Difficulty = "facil" | "medio" | "dificil";

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  facil: "Fácil",
  medio: "Médio",
  dificil: "Difícil",
};

/** Quantos bots a sala solo começa tendo. */
export const SOLO_DEFAULT_BOTS = 5;

/**
 * Vigilância Sanitária (a "polícia" do mundo aberto). Comer nas barraquinhas
 * esquenta o jogador (nível de procurado, 0 a 5); com 1 ou mais, viaturas saem
 * atrás dele. Fugir para longe delas por um tempo = escapou (ganha calorias);
 * ficar parado colado numa viatura = autuado (perde parte das calorias).
 */
export const POLICE = {
  maxHeat: 5,
  /** Quanto cada comida de barraquinha esquenta. */
  heatPerStand: 0.4,
  /** Batida numa viatura. */
  heatPerHit: 0.75,
  /** Em perseguição o calor sobe devagar sozinho (a coisa vai ficando séria). */
  heatPerSecondChased: 0.04,
  /** Sem perseguição, o calor baixa devagar. */
  heatDecayPerSecond: 0.05,
  /** Viatura a menos que isto "está vendo" o jogador. */
  sightRadius: 140,
  /** Durante a fuga, se uma viatura chegar a isto, volta a ser perseguição. */
  reacquireRadius: 100,
  /** Segundos longe das viaturas para escapar (mais 1 s por nível). */
  escapeSeconds: 8,
  /** Viatura colada e jogador quase parado, por este tempo = autuado. */
  bustRadius: 9,
  bustSpeed: 5,
  bustSeconds: 3,
  /** Parte das calorias da sessão que a Vigilância confisca na autuação. */
  bustPenalty: 0.25,
  /** Calorias de prêmio por nível ao escapar. */
  escapeBonusPerStar: 300,
} as const;

/** Viaturas atrás de um jogador, conforme o nível de procurado. */
export const copsForStars = (stars: number) => (stars <= 0 ? 0 : Math.min(3, 1 + Math.floor(stars / 2)));

/** Intenção do jogador; o servidor é quem move o carro. */
export interface InputMessage {
  throttle: number;
  steer: number;
}

export interface JoinOptions {
  name?: string;
}

export interface CreateOptions extends JoinOptions {
  /** Corrida sozinho contra bots, numa sala privada. */
  solo?: boolean;
}

/** Entrar no mundo aberto. */
export interface WorldJoinOptions extends JoinOptions {
  /** Mundo só seu (privado). */
  solo?: boolean;
  /** Ficha do jogador nesta sessão (guarda as calorias entre o mundo e as corridas). */
  token?: string;
  /** Voltando de uma corrida: nasce no ponto de encontro dela. */
  spawn?: string;
}

/** Corrida disparada de um ponto do mundo aberto. */
export interface EventRaceOptions {
  raceId: string;
  /** Quantos jogadores vêm do mundo (a contagem começa quando todos entrarem). */
  expected: number;
  bots: number;
  difficulty: Difficulty;
}

/** Mensagem do mundo para o cliente: vá para esta sala de corrida. */
export interface GoRaceMessage {
  roomId: string;
  raceId: string;
}

export const PLAYER_COLORS = [
  "#e63946", // ketchup
  "#f4a261", // batata frita
  "#2a9d8f", // alface
  "#e9c46a", // queijo
  "#8d5524", // hambúrguer
  "#9b5de5", // refri de uva
  "#4cc9f0", // milk-shake de menta
  "#ff70a6", // sorvete de morango
] as const;
