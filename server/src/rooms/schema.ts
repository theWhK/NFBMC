import { schema, t, type SchemaType } from "@colyseus/schema";

export const Player = schema({
  name: t.string().default(""),
  color: t.string().default("#ffffff"),
  /** Piloto controlado pelo servidor. */
  bot: t.boolean().default(false),
  /** Carro (id em CARS), giro do motor, marcha (-1 = ré) e câmbio manual. */
  car: t.string().default("civic"),
  rpm: t.uint16().default(0),
  gear: t.int8().default(1),
  manual: t.boolean().default(false),
  x: t.number().default(0),
  z: t.number().default(0),
  heading: t.number().default(0),
  speed: t.number().default(0),
  /** Fora da corrida atual (entrou no meio): espera a próxima. */
  racing: t.boolean().default(false),
  /** Volta em que o jogador está (0 = ainda no grid, antes de cruzar a linha). */
  lap: t.uint8().default(0),
  /** Metros percorridos na corrida, para calcular a posição. */
  progress: t.number().default(0),
  /** Posição atual na corrida (1 = primeiro). */
  place: t.uint8().default(0),
  calories: t.uint32().default(0),
  boost: t.number().default(0),
  finished: t.boolean().default(false),
  /** Segundos desde a largada até cruzar a chegada da última volta. */
  finishTime: t.number().default(0),
});
export type Player = SchemaType<typeof Player>;

export const Food = schema({
  kind: t.string().default("burger"),
  x: t.number().default(0),
  z: t.number().default(0),
  active: t.boolean().default(true),
});
export type Food = SchemaType<typeof Food>;

/** Linha do placar final. Fica guardada mesmo se o jogador sair da sala. */
export const Result = schema({
  sessionId: t.string().default(""),
  name: t.string().default(""),
  color: t.string().default("#ffffff"),
  bot: t.boolean().default(false),
  /** Colocação na chegada (0 = não terminou). */
  place: t.uint8().default(0),
  calories: t.uint32().default(0),
  bonus: t.uint32().default(0),
  total: t.uint32().default(0),
});
export type Result = SchemaType<typeof Result>;

export const RaceState = schema({
  phase: t.string().default("lobby"),
  /** Qual corrida de Porto Gordo é esta, e quantas voltas tem. */
  raceId: t.string().default("autodromo"),
  laps: t.uint8().default(3),
  /** Corrida disparada do mundo aberto (larga sozinha e devolve todo mundo ao mundo). */
  event: t.boolean().default(false),
  /** Sala privada de um jogador só, contra bots. */
  solo: t.boolean().default(false),
  /** Quantos bots entram na próxima corrida, e em que dificuldade. */
  botCount: t.uint8().default(0),
  difficulty: t.string().default("medio"),
  /** Segundos restantes da contagem, da tolerância de chegada ou da tela de resultado. */
  timer: t.number().default(0),
  /** Segundos desde a largada. */
  raceTime: t.number().default(0),
  players: t.map(Player),
  foods: t.array(Food),
  /** Placar da última corrida, do mais calórico para o menos. */
  results: t.array(Result),
});
export type RaceState = SchemaType<typeof RaceState>;

// --- Mundo aberto ------------------------------------------------------------

export const WorldPlayer = schema({
  name: t.string().default(""),
  color: t.string().default("#ffffff"),
  car: t.string().default("civic"),
  rpm: t.uint16().default(0),
  gear: t.int8().default(1),
  manual: t.boolean().default(false),
  x: t.number().default(0),
  z: t.number().default(0),
  heading: t.number().default(0),
  speed: t.number().default(0),
  boost: t.number().default(0),
  /** Calorias acumuladas na sessão (mundo + corridas). */
  calories: t.uint32().default(0),
  /** Nível de procurado pela Vigilância Sanitária (0 a 5; a parte inteira são as estrelas). */
  heat: t.number().default(0),
  /** Alguma viatura está vendo o jogador agora. */
  chased: t.boolean().default(false),
  /** Progresso da fuga e da autuação (0 a 1). */
  escape: t.number().default(0),
  bust: t.number().default(0),
});
export type WorldPlayer = SchemaType<typeof WorldPlayer>;

/** Viatura da Vigilância Sanitária. */
export const Cop = schema({
  x: t.number().default(0),
  z: t.number().default(0),
  heading: t.number().default(0),
  speed: t.number().default(0),
  boost: t.number().default(0),
  /** Sessão do jogador perseguido. */
  target: t.string().default(""),
  car: t.string().default("viatura"),
});
export type Cop = SchemaType<typeof Cop>;

export const Stand = schema({
  kind: t.string().default("burger"),
  x: t.number().default(0),
  z: t.number().default(0),
  active: t.boolean().default(true),
});
export type Stand = SchemaType<typeof Stand>;

/** Carro do trânsito (NPC). */
export const Npc = schema({
  x: t.number().default(0),
  z: t.number().default(0),
  heading: t.number().default(0),
  speed: t.number().default(0),
  kind: t.string().default("sedan"),
  color: t.string().default("#888888"),
});
export type Npc = SchemaType<typeof Npc>;

export const WorldState = schema({
  /** Mundo só de um jogador. */
  solo: t.boolean().default(false),
  players: t.map(WorldPlayer),
  cops: t.map(Cop),
  traffic: t.map(Npc),
  stands: t.array(Stand),
});
export type WorldState = SchemaType<typeof WorldState>;
