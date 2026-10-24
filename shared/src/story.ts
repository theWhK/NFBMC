// Modo história: "Need for Burgers: Most Calories". Paródia do Most Wanted
// (2005): você perde o seu carro para o #1 da Lista Gorda e precisa subir a
// lista, do #10 ao #1, para recuperá-lo. Para desafiar cada rival é preciso
// cumprir os requisitos dele (vitórias, calorias acumuladas e fugas da
// Vigilância Sanitária); vencendo o duelo, você ganha a "nota fiscal" do carro.
import type { RaceId } from "./world.ts";

export interface ComicPanel {
  /** Quem fala (vazio = narrador). */
  speaker?: string;
  /** "Arte" do quadrinho: emojis grandes. */
  art: string;
  text: string;
  /** Cor de fundo do quadro. */
  color?: string;
}

export interface Rival {
  rank: number;
  name: string;
  title: string;
  car: string;
  race: RaceId;
  /** Requisitos para poder desafiar. */
  wins: number;
  /** Calorias acumuladas na carreira (soma de tudo que você comeu e ganhou). */
  bounty: number;
  /** Fugas da Vigilância com pelo menos este nível (0 = não precisa). */
  escapes: number;
  escapeStars: number;
  /**
   * Habilidade do piloto (0 a 1) no duelo. Calibrada por simulação: um bom
   * jogador, no melhor carro que já liberou, vence por ~4% no começo da
   * carreira e por um triz contra o Bruno (o rival sempre tem carro melhor).
   */
  skill: number;
  /** Carro extra liberado ao vencer (além do carro do rival). */
  bonusCar?: string;
  /** O que ele diz antes do duelo e ao perder. */
  taunt: ComicPanel[];
  defeat: ComicPanel[];
}

/** Carros com que você começa a carreira. */
export const STARTER_CARS = ["uno", "fusca"];
/** O seu carro, roubado no prólogo e recuperado no final. */
export const HERO_CAR = "m3";

export const PROLOGUE: ComicPanel[] = [
  { art: "🌇🍔🌭", color: "#e3884a", text: "Porto Gordo. A cidade onde o colesterol é alto... e a Vigilância Sanitária é mais alta ainda." },
  { art: "🏎️🧀💙", color: "#3a5a8a", text: "Você chega na cidade com o carro mais respeitado do país: o M3 Gorgonzola GTR. Prata, veias azuis e um cheiro que se sente a três quarteirões." },
  { art: "📋🍟", color: "#16110d", text: "Aqui, quem manda é a LISTA GORDA: os dez pilotos mais calóricos da cidade. E no topo dela..." },
  { speaker: "Bruno", art: "🧔🍔🍔🍔", color: "#c1121f", text: "Eu sou o Bruno. O Rei do X-Tudo. Número 1 da Lista Gorda. Bonito esse carro aí... Vamos apostar? Quem ganhar, leva o carro do outro." },
  { speaker: "Bruno", art: "🚗💨 A3", color: "#7a7f86", text: "Esse aqui é meu A3 2002. Original de fábrica. (Mentira. Ninguém sabe o que tem debaixo do capô. Nem eu.)" },
  { art: "🏁🤢🛢️", color: "#4a7a2a", text: "A corrida começa. Na metade, o seu motor engasga... Alguém colocou MAIONESE CASEIRA VENCIDA no seu tanque!" },
  { speaker: "Bruno", art: "😏🔑", color: "#c1121f", text: "Que pena. Regra é regra: o Gorgonzola agora é meu. Vou transformar ele em food truck." },
  { speaker: "Vigilância Sanitária", art: "🚨🚓🚨", color: "#2a9d4a", text: "PARADO AÍ! Carro com cheiro de queijo forte e maionese vencida no tanque? AUTUADO!" },
  { art: "🧾😩", color: "#16110d", text: "Você perde tudo. Sobrou só um Uno Coxinha com 300 mil km e um Fusca Pão de Queijo emprestado da sua tia." },
  { art: "🔥📋🔥", color: "#ff7a00", text: "Mas ninguém rouba um Gorgonzola impunemente. Suba a Lista Gorda, do #10 ao #1, e pegue o seu carro de volta." },
];

export const EPILOGUE: ComicPanel[] = [
  { speaker: "Bruno", art: "😭🍔", color: "#c1121f", text: "N-não pode ser... Perdi pro cara do Uno Coxinha... Tá bom, tá bom. Toma as chaves do Gorgonzola. Eu nem consegui fazer o food truck." },
  { speaker: "Bruno", art: "🔑🚗 A3", color: "#7a7f86", text: "E leva o A3 também. Mas cuidado: o remap foi feito por um cara que eu conheci na fila do pastel." },
  { art: "🏎️🧀💙✨", color: "#3a5a8a", text: "O M3 Gorgonzola GTR está de volta. E o A3 do Bruno agora é seu. Ninguém sabe o que tem debaixo do capô. Agora, nem você." },
  { speaker: "Vigilância Sanitária", art: "🚨📋", color: "#2a9d4a", text: "Atenção, todas as viaturas: o novo Número 1 da Lista Gorda está à solta. Repito: o novo Número 1..." },
  { art: "👑🍔", color: "#ff7a00", text: "Você é o Número 1 da Lista Gorda. O piloto mais calórico de Porto Gordo. FIM. (Ou será só a sobremesa?)" },
];

const line = (speaker: string, art: string, text: string, color = "#16110d"): ComicPanel => ({ speaker, art, text, color });

export const RIVALS_LADDER: Rival[] = [
  {
    rank: 10, name: "Izzy Iogurte", title: "Light, mas nem tanto", car: "gol", race: "pastel",
    wins: 1, bounty: 3000, escapes: 0, escapeStars: 0, skill: 0.61,
    taunt: [line("Izzy Iogurte", "🥛😤", "Zero lactose, zero piedade. Você nem devia estar aqui com esse Uno.", "#9bd3ff")],
    defeat: [line("Izzy Iogurte", "🥛😵", "Talhei... Leva o Gol. E me esquece.", "#9bd3ff")],
  },
  {
    rank: 9, name: "Ming Miojo", title: "Pronto em 3 minutos", car: "civic", race: "centro",
    wins: 2, bounty: 8000, escapes: 0, escapeStars: 0, skill: 0.53,
    taunt: [line("Ming Miojo", "🍜⏱️", "Eu termino a corrida antes da água ferver. Tempero incluso.", "#f2c14e")],
    defeat: [line("Ming Miojo", "🍜💧", "Passei do ponto... O Civic é seu.", "#f2c14e")],
  },
  {
    rank: 8, name: "JV Pastel", title: "Vento de feira", car: "golf", race: "pastel",
    wins: 2, bounty: 15000, escapes: 1, escapeStars: 1, skill: 0.77,
    taunt: [line("JV Pastel", "🥟💨", "Na minha feira, quem não corre vira recheio. Quer de carne ou de queijo?", "#e9c46a")],
    defeat: [line("JV Pastel", "🥟😩", "Murchei igual pastel frio. Fica com o Golf.", "#e9c46a")],
  },
  {
    rank: 7, name: "Vic Virado", title: "Virado à paulista", car: "opala", race: "porto",
    wins: 2, bounty: 25000, escapes: 1, escapeStars: 2, skill: 1.0,
    taunt: [line("Vic Virado", "🍳🥓🥬", "Tutu, couve, linguiça, ovo e um Opala seis cilindros. Isso é que é almoço.", "#7a1f1f")],
    defeat: [line("Vic Virado", "🍳😪", "Bateu aquele sono depois do almoço... O Opala é seu.", "#7a1f1f")],
  },
  {
    rank: 6, name: "Earl Esfiha", title: "Aberta ou fechada?", car: "mustang", race: "centro",
    wins: 3, bounty: 35000, escapes: 1, escapeStars: 2, skill: 0.61,
    taunt: [line("Earl Esfiha", "🫓🐎", "Na reta eu sou aberta. Na curva, fechada. E o Mustang é mostarda.", "#f2b705")],
    defeat: [line("Earl Esfiha", "🫓💔", "Fui... aberto demais. Pega o Mustang.", "#f2b705")],
  },
  {
    rank: 5, name: "Ronnie Rocambole", title: "Enrola todo mundo", car: "supra", race: "parque",
    wins: 3, bounty: 50000, escapes: 2, escapeStars: 2, skill: 0.68, bonusCar: "porchetta",
    taunt: [
      line("Ronnie Rocambole", "🍥😈", "Sabe aquela maionese no seu tanque? Fui eu. O Bruno pagou em X-Tudo.", "#d98a2b"),
      line("Você", "😠🔧", "Então é pessoal. Liga esse Supra."),
    ],
    defeat: [line("Ronnie Rocambole", "🍥😱", "Me desenrolou... Leva o Supra. E de brinde a Porchetta que eu guardava na garagem.", "#d98a2b")],
  },
  {
    rank: 4, name: "Kaze Coxinha", title: "Mestre do drift", car: "skyline", race: "porto",
    wins: 3, bounty: 65000, escapes: 2, escapeStars: 3, skill: 0.74, bonusCar: "lasanha",
    taunt: [line("Kaze Coxinha", "🍗🌀", "Crocante por fora, cantando pneu por dentro. Vou te deixar no catupiry.", "#2b2d42")],
    defeat: [line("Kaze Coxinha", "🍗🫠", "Desmanchei... O Skyline é seu. E a Lasanha também, eu nunca soube estacionar ela.", "#2b2d42")],
  },
  {
    rank: 3, name: "Baron Brigadeiro", title: "Doce e perigoso", car: "brigadeiro", race: "parque",
    wins: 3, bounty: 80000, escapes: 2, escapeStars: 3, skill: 0.72, bonusCar: "farofa",
    taunt: [line("Baron Brigadeiro", "🍫🎩", "Granulado na pista, adversário no muro. Dezesseis cilindros de açúcar.", "#4a2c1d")],
    defeat: [line("Baron Brigadeiro", "🍫🫠", "Derreti no sol... O Bugatti é seu. A Ferrari Farofa também, que eu já tava cansado de limpar.", "#4a2c1d")],
  },
  {
    rank: 2, name: "Razor Bacon", title: "O braço direito do Bruno", car: "kibe", race: "porto",
    wins: 4, bounty: 100000, escapes: 3, escapeStars: 4, skill: 0.69,
    taunt: [line("Razor Bacon", "🥓🔪", "Eu não freio. Eu frito. O Bruno só chega em você passando por cima de mim.", "#c1442e")],
    defeat: [line("Razor Bacon", "🥓😖", "Torrou... Leva o Kibe-segg. O Bruno te espera no autódromo.", "#c1442e")],
  },
  {
    rank: 1, name: "Bruno", title: "O Rei do X-Tudo", car: "a3bruno", race: "autodromo",
    wins: 4, bounty: 120000, escapes: 3, escapeStars: 4, skill: 0.78,
    taunt: [
      line("Bruno", "🧔🍔", "Olha só quem chegou. O cara do Uno Coxinha. Veio buscar seu queijo?", "#c1121f"),
      line("Bruno", "🚗💨 A3", "Esse A3 tem turbina de navio, remap no talo e meio X-Tudo debaixo do banco. Boa sorte.", "#7a7f86"),
      line("Você", "😤🧀", "Hoje eu como você no café da manhã."),
    ],
    defeat: [],
  },
];

export interface StoryProgress {
  /** Índice em RIVALS_LADDER do próximo rival (10 = terminou). */
  stage: number;
  /** Progresso para o rival atual. */
  wins: number;
  escapes: number;
  /** Calorias acumuladas na carreira inteira. */
  bounty: number;
  unlocked: string[];
  car: string;
  seenPrologue: boolean;
}

export const newStory = (): StoryProgress => ({
  stage: 0, wins: 0, escapes: 0, bounty: 0, unlocked: [...STARTER_CARS], car: STARTER_CARS[0], seenPrologue: false,
});

export const currentRival = (story: StoryProgress) => RIVALS_LADDER[story.stage] ?? null;

/** Pode desafiar o rival atual? */
export function canChallenge(story: StoryProgress) {
  const rival = currentRival(story);
  if (!rival) return false;
  return story.wins >= rival.wins && story.bounty >= rival.bounty && story.escapes >= rival.escapes;
}

/** Venceu o duelo: libera os carros e passa para o próximo rival (zerando as vitórias e fugas). */
export function defeatRival(story: StoryProgress): StoryProgress {
  const rival = currentRival(story);
  if (!rival) return story;
  const unlocked = new Set(story.unlocked);
  unlocked.add(rival.car);
  if (rival.bonusCar) unlocked.add(rival.bonusCar);
  if (rival.rank === 1) unlocked.add(HERO_CAR);
  return { ...story, stage: story.stage + 1, wins: 0, escapes: 0, unlocked: [...unlocked] };
}

export const storyFinished = (story: StoryProgress) => story.stage >= RIVALS_LADDER.length;
