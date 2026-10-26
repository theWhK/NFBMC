// Constantes e tipos usados tanto pelo servidor quanto pelo cliente.

export * from "./track.ts";
export * from "./physics.ts";
export * from "./cars.ts";
export * from "./collision.ts";
export * from "./story.ts";
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
  /** Batida forte num carro do trânsito. */
  heatPerTrafficHit: 0.3,
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

/** Tipos de carro do trânsito (o cliente desenha cada um de um jeito). */
export const TRAFFIC_KINDS = ["sedan", "kombi", "picape"] as const;
export type TrafficKind = (typeof TRAFFIC_KINDS)[number];

/** Viaturas atrás de um jogador, conforme o nível de procurado. */
export const copsForStars = (stars: number) => (stars <= 0 ? 0 : Math.min(3, 1 + Math.floor(stars / 2)));

/** Intenção do jogador; o servidor é quem move o carro. */
export interface InputMessage {
  throttle: number;
  steer: number;
  /** Freio de mão (Espaço). */
  handbrake?: boolean;
}

export interface JoinOptions {
  name?: string;
  /** Cor preferida do carrinho (escolhida na Garagem); vale se ninguém na sala estiver com ela. */
  color?: string;
  /** Carro escolhido na Garagem (id de CARS) e se o câmbio é manual. */
  car?: string;
  manual?: boolean;
}

/** Troca de marcha no câmbio manual (+1 sobe, -1 desce). */
export interface ShiftMessage {
  direction: number;
}

/** Escolhe a cor do jogador: a preferida, se estiver livre; senão, a primeira livre. */
export function pickColor(preferred: unknown, used: Set<string>, fallbackIndex = 0) {
  if (typeof preferred === "string" && (PLAYER_COLORS as readonly string[]).includes(preferred) && !used.has(preferred)) {
    return preferred;
  }
  return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[fallbackIndex % PLAYER_COLORS.length];
}

/**
 * Os rivais da Lista Gorda (os bots), em ordem de "perigo", com o apelido e a
 * frase que aparecem no menu. Paródia da Blacklist, versão lanchonete.
 */
export const RIVALS = [
  { name: "Razor Bacon", title: "O mais procurado", quote: "Eu não freio. Eu frito." },
  { name: "Bull Bauru", title: "Rei da avenida", quote: "Pão francês, rosbife e zero paciência." },
  { name: "Kaze Coxinha", title: "Mestre do drift", quote: "Crocante por fora, cantando pneu por dentro." },
  { name: "Ronnie Rocambole", title: "Enrola todo mundo", quote: "Te vejo no retrovisor... de novo." },
  { name: "Ming Miojo", title: "Pronto em 3 minutos", quote: "Cheguei antes da água ferver." },
  { name: "Earl Esfiha", title: "Aberta ou fechada?", quote: "Na curva eu sou fechada." },
  { name: "Baron Brigadeiro", title: "Doce e perigoso", quote: "Granulado na pista, adversário no muro." },
  { name: "JV Pastel", title: "Vento de feira", quote: "Quanto mais vento, mais rápido." },
  { name: "Izzy Iogurte", title: "Light, mas nem tanto", quote: "Zero lactose, zero piedade." },
  { name: "Vic Virado", title: "Virado à paulista", quote: "Tutu, couve e ultrapassagem." },
  { name: "Taz Torresmo", title: "Pururuca total", quote: "Estalou? Passei." },
  { name: "Big Lanche", title: "O tanque", quote: "Não desvio. Os outros desviam de mim." },
] as const;

export interface CreateOptions extends JoinOptions {
  /** Corrida sozinho contra bots, numa sala privada. */
  solo?: boolean;
  /** Pista da corrida (padrão: autódromo). */
  raceId?: string;
  /** Duelo do modo história: um rival só, com o carro e a habilidade dele. */
  rival?: { name: string; car: string; skill: number };
}

/** Entrar no mundo aberto. */
export interface WorldJoinOptions extends JoinOptions {
  /** Mundo só seu (privado). */
  solo?: boolean;
  /** Ficha do jogador nesta sessão (guarda as calorias entre o mundo e as corridas). */
  token?: string;
  /** Voltando de uma corrida: nasce no ponto de encontro dela. */
  spawn?: string;
  /** Mundo do modo história (só muda o que a lista de online mostra). */
  story?: boolean;
}

/** Corrida disparada de um ponto do mundo aberto. */
export interface EventRaceOptions {
  raceId: string;
  /** Quantos jogadores vêm do mundo (a contagem começa quando todos entrarem). */
  expected: number;
  bots: number;
  difficulty: Difficulty;
}

// --- Co-op: quem está online e desafios entre pilotos --------------------------

/** Onde um piloto online está agora. */
export type PresenceWhere = "world" | "solo" | "story" | "race" | "event" | "duel";

/** Uma linha de `GET /api/online` (o menu e o mapa mostram). */
export interface OnlinePilot {
  name: string;
  color: string;
  car: string;
  where: PresenceWhere;
  /** Pista, quando está numa corrida. */
  raceId?: string;
  calories: number;
}

/** Quanto tempo o desafiado tem para responder. */
export const CHALLENGE_SECONDS = 20;

/** Cliente → mundo: desafiar outro piloto da mesma cidade para um pega. */
export interface ChallengeMessage {
  to: string;
  raceId: string;
}

/** Mundo → desafiado: alguém chamou você para um pega. */
export interface ChallengeInvite {
  id: string;
  fromName: string;
  color: string;
  raceId: string;
  seconds: number;
}

/** Desafiado → mundo: aceita ou amarela. */
export interface ChallengeReply {
  id: string;
  accept: boolean;
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
