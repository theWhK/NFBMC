// Modo história: "Need for Burgers: Most Calories". Paródia do Most Wanted
// (2005): você perde o seu carro para o #1 da Lista Gorda e precisa subir a
// lista, do #10 ao #1, para recuperá-lo. Para desafiar cada rival é preciso
// cumprir os requisitos dele (vitórias, calorias acumuladas e fugas da
// Vigilância Sanitária); vencendo o duelo, você ganha a "nota fiscal" do carro.
//
// O antagonista é o Sargento Cross-fit, chefe da Força-Tarefa Detox da
// Vigilância Sanitária (paródia do Sargento Cross): te autua no prólogo, manda
// recados pelo rádio entre um rival e outro, entra pessoalmente nas
// perseguições conforme você sobe na lista e, depois do Bruno, comanda a fuga
// final até a ponte inacabada do Cais.
import { carSpec } from "./cars.ts";
import type { RaceId } from "./world.ts";

/**
 * Cenas 3D (cinemáticas) que o cliente sabe montar. Todo quadro do modo
 * história tem a sua: com WebGL, tudo é cinemática na cidade (com voz); sem 3D,
 * os quadros aparecem como quadrinhos.
 */
export type CineShot =
  | "aereo" | "chegada" | "sirene" | "abordagem" | "sabotagem" | "cerco"
  | "radio" | "rival" | "duelo" | "fuga" | "ponte" | "beira"
  | "lista" | "bruno" | "aposta" | "mia" | "sozinho" | "apresenta" | "entrega" | "nota" | "tv" | "fim";

export interface ComicPanel {
  /** Quem fala (vazio = narrador). */
  speaker?: string;
  /** "Arte" do quadrinho: emojis grandes. */
  art: string;
  text: string;
  /** Cor de fundo do quadro. */
  color?: string;
  /** Efeito animado do quadro. */
  fx?: "shake" | "zoom" | "speed" | "flash" | "slam";
  /** Onomatopeia carimbada no quadro ("VRUUUM!"). */
  sfx?: string;
  /** Cena 3D deste quadro (com WebGL; sem ele, vale o quadrinho). */
  shot?: CineShot;
  /** Id da fala: o arquivo de voz é client/public/vozes/historia/<id>.mp3. */
  id?: string;
  /** Texto para a voz, quando for diferente do escrito (números por extenso...). */
  say?: string;
  /** Como a fala é dita (a voz gravada segue isto). Ver VOICE_DIRECTION. */
  emotion?: Emotion;
  /** Trecho da fala antes do qual vem uma pausa dramática (o "tempo" da piada). */
  beat?: string;
}

/**
 * Intenção de cada fala gravada: o scripts/vozes.py usa para escolher a
 * expressividade, o ritmo, as pausas e o tratamento da voz.
 */
export type Emotion =
  | "neutro" | "calmo" | "bravo" | "debochado" | "comico" | "triste" | "assustado"
  | "empolgado" | "sussurro" | "oficial" | "ameaca" | "triunfante" | "cansado" | "epico";

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
  /** O que acontece depois (o Cross-fit no rádio, a Mia...), antes do próximo rival. */
  interlude?: ComicPanel[];
}

/** Carros com que você começa a carreira. */
export const STARTER_CARS = ["uno", "fusca"];
/** O seu carro, roubado no prólogo e recuperado no final. */
export const HERO_CAR = "m3";

/** O antagonista. */
export const CROSSFIT = "Sargento Cross-fit";
/** A aliada (paródia da Mia): traz marmita, paga fiança e esconde um segredo. */
export const MIA = "Mia Marmita";
/** Você (o jogador), quando fala. */
export const YOU = "Você";
/** A repórter do Jornal da Gordura (interlúdio na TV). */
export const REPORTER = "Repórter";

export const PROLOGUE: ComicPanel[] = [
  { art: "🌇🍔🌭", color: "#e3884a", fx: "zoom", shot: "aereo", text: "Porto Gordo. Fim de tarde, cheiro de fritura no ar e uma cidade inteira de colesterol alto... e de Vigilância Sanitária mais alta ainda." },
  { art: "🏎️🧀💙", color: "#3a5a8a", fx: "speed", sfx: "VRUUUM!", shot: "chegada", text: "Você chega com o carro mais respeitado do país: o M3 Gorgonzola GTR. Prata, veias azuis e um cheiro que se sente a três quarteirões." },
  { speaker: CROSSFIT, art: "🚨🥬🏎️", color: "#1f3d24", fx: "flash", sfx: "UÓÓÓ!", shot: "sirene", text: "Unidade Detox para a central: veículo exalando QUEIJO MOFADO na Avenida Central. Vou abordar. Ninguém entra na minha cidade cheirando a gordura saturada." },
  { speaker: CROSSFIT, art: "🏋️😤📋", color: "#1f3d24", fx: "slam", shot: "abordagem", text: "Sargento Cross-fit, Força-Tarefa Detox da Vigilância Sanitária. Documento do carro, nota fiscal do queijo e o seu percentual de gordura." },
  { speaker: YOU, art: "😐🧀", color: "#16110d", shot: "abordagem", text: "Percentual de gordura? O senhor quer o meu ou o do queijo?" },
  { speaker: CROSSFIT, art: "🏋️🧐💪", color: "#1f3d24", shot: "abordagem", text: "Engraçadinho. Tudo em ordem... por enquanto. Mas eu conheço o seu tipo: hoje é um queijinho, amanhã é rodízio. Eu tô de olho. Sem dor, sem ganho." },
  { art: "📋🍟", color: "#16110d", shot: "lista", text: "Aqui, quem manda é a LISTA GORDA: os dez pilotos mais calóricos da cidade. E no topo dela..." },
  { speaker: "Bruno", art: "🧔🍔🍔🍔", color: "#c1121f", fx: "slam", sfx: "NHAC!", shot: "bruno", text: "Eu sou o Bruno. O Rei do X-Tudo. Número 1 da Lista Gorda. Bonito esse carro aí... Vamos apostar? Quem ganhar, leva o carro do outro." },
  { speaker: "Bruno", art: "🚗💨 A3", color: "#7a7f86", shot: "bruno", text: "Esse aqui é meu A3 2002. Original de fábrica. Mentira. Ninguém sabe o que tem debaixo do capô. Nem eu." },
  { speaker: YOU, art: "😏🔑", color: "#16110d", shot: "aposta", text: "Fechado. Mas vai treinando a cara de quem perdeu." },
  { art: "🏁🤢🛢️", color: "#4a7a2a", fx: "shake", sfx: "PFFRRT!", shot: "sabotagem", text: "A corrida começa. Na metade, o seu motor engasga... Alguém colocou MAIONESE CASEIRA VENCIDA no seu tanque!" },
  { speaker: "Bruno", art: "😏🔑", color: "#c1121f", shot: "aposta", text: "Que pena. Regra é regra: o Gorgonzola agora é meu. Vou transformar ele em food truck." },
  { speaker: CROSSFIT, art: "🚨🚓🚨", color: "#1f3d24", fx: "flash", sfx: "UÓÓÓ!", shot: "cerco", text: "Ora, ora. Maionese vencida no tanque e queijo sem refrigeração? Eu sabia. AUTUADO! Mãos no capô... e encolhe essa barriga." },
  { speaker: MIA, art: "🍱🙋‍♀️", color: "#2a6f97", fx: "zoom", shot: "mia", text: "Oi. Eu sou a Mia. Paguei a sua fiança, não me pergunte como. Toma: uma marmita e a chave de um Uno. Agora me prova que eu não joguei dinheiro fora." },
  { art: "🧾😩", color: "#16110d", shot: "sozinho", text: "Você perde tudo. Sobrou só um Uno Coxinha com trezentos mil quilômetros e um Fusca Pão de Queijo emprestado da sua tia." },
  { speaker: CROSSFIT, art: "📻🏋️", color: "#1f3d24", fx: "shake", shot: "radio", text: "Pode subir essa Lista Gorda à vontade, Coxinha. Cada caloria que você queimar no asfalto, eu vou estar lá contando. Uma por uma." },
  { art: "🔥📋🔥", color: "#ff7a00", fx: "zoom", shot: "lista", text: "Mas ninguém rouba um Gorgonzola impunemente. Suba a Lista Gorda, do número dez ao número um, e pegue o seu carro de volta." },
];

/** Depois do Bruno: o M3 volta, e o Cross-fit fecha a cidade. Em seguida começa a fuga final. */
export const FINALE_INTRO: ComicPanel[] = [
  { speaker: "Bruno", art: "😭🍔", color: "#c1121f", shot: "entrega", text: "N-não pode ser... Perdi pro cara do Uno Coxinha... Tá bom, tá bom. Toma as chaves do Gorgonzola. Eu nem consegui fazer o food truck." },
  { speaker: "Bruno", art: "🔑🚗 A3", color: "#7a7f86", shot: "bruno", text: "E leva o A3 também. Mas cuidado: o remap foi feito por um cara que eu conheci na fila do pastel." },
  { art: "🏎️🧀💙✨", color: "#3a5a8a", fx: "speed", sfx: "VRUUUM!", shot: "chegada", text: "O M3 Gorgonzola GTR está de volta. O motor ronca, o queijo cheira e Porto Gordo inteira escuta." },
  { speaker: CROSSFIT, art: "🚨🥬🚨", color: "#1f3d24", fx: "flash", sfx: "UÓÓÓ!", shot: "cerco", text: "Unidade Detox para TODAS as viaturas: o novo Número 1 está no M3. Fechem a cidade. Esperei a carreira inteira por isso. Hoje é dia de perna." },
  { speaker: MIA, art: "🍱📱", color: "#2a6f97", fx: "shake", shot: "mia", text: "Me escuta: todas as saídas estão bloqueadas, menos uma. A ponte inacabada do Cais. Ela acaba no meio do mar... quer dizer, QUASE no meio. Pisa fundo e não freia!" },
];

/** Autuado na fuga final: dá para tentar de novo. */
export const FINALE_BUSTED: ComicPanel[] = [
  { speaker: CROSSFIT, art: "🏋️😏🚨", color: "#1f3d24", fx: "slam", sfx: "MAIS UMA!", shot: "cerco", text: "Cansou? Isso aqui é só o aquecimento. Mais uma série, Número 1: eu tenho o dia inteiro e um galão de whey." },
];

/** Chegou na ponte: o salto e a última palavra do Cross-fit. */
export const FINALE_ESCAPE: ComicPanel[] = [
  { art: "🏎️🚨🚨🚨", color: "#3a5a8a", fx: "speed", sfx: "VRAAAP!", shot: "fuga", text: "A Vigilância Sanitária inteira atrás de você. Lá na frente, só a ponte inacabada do Cais... e o pôr do sol." },
  { art: "🏎️🌉🌊", color: "#ff7a00", fx: "zoom", sfx: "VOOOOOU!", shot: "ponte", text: "Sem freio. Sem dieta. Sem volta." },
  { speaker: CROSSFIT, art: "🏋️😠🌉", color: "#1f3d24", fx: "slam", shot: "beira", text: "...Pode correr. Pode pular. Mas uma hora você vai ter que parar pra comer. E nesse dia eu vou estar lá. Contando as calorias." },
];

export const EPILOGUE: ComicPanel[] = [
  { speaker: MIA, art: "🍱🕶️", color: "#2a6f97", fx: "zoom", shot: "mia", text: "Sabe aquela fiança? Eu sou da Vigilância. Infiltrada desde o começo. Mas ninguém nunca disse que eu não podia gostar de um bom X-Tudo. Seu segredo tá seguro comigo." },
  { speaker: CROSSFIT, art: "📻🥬", color: "#1f3d24", fx: "flash", shot: "beira", text: "Atenção, todas as viaturas: o Número 1 da Lista Gorda continua à solta. Cancelem o meu almoço. Frango com batata-doce, só depois que eu pegar ele." },
  { art: "👑🍔", color: "#ff7a00", fx: "slam", sfx: "FIM!", shot: "fim", text: "Você é o Número 1 da Lista Gorda. O piloto mais calórico de Porto Gordo. Fim. Ou será só a sobremesa?" },
];

/** Recados do Cross-fit pelo rádio nas perseguições do modo história. */
export const CROSSFIT_RADIO = {
  /** Começou uma perseguição. */
  start: [
    "Unidade Detox: alvo comendo na rua. Iniciar perseguição. Sem dor, sem ganho!",
    "Central, temos um carboidrato em fuga. Repito: carboidrato em fuga!",
    "Atenção, viaturas: suspeito com cheiro de fritura. Cerquem as saídas.",
    "Já comeu? Então corre. Eu adoro um cardio.",
  ],
  /** O próprio Cross-fit entrou na perseguição. */
  crossfit: [
    "Aqui é o Cross-fit. Agora é pessoal. Saindo com o Couve-vette.",
    "Deixa esse comigo. Hoje eu pulei o pré-treino, então tô de mau humor.",
    "Couve-vette na pista. Vou te fazer suar mais que aula de spinning.",
  ],
  escaped: [
    "Perdemos o alvo... Tudo bem. Faltou só uma repetição.",
    "Ele sumiu. Alguém me traz um shake. De preferência de couve.",
    "Escapou hoje. Amanhã é dia de perna, e eu não falto.",
  ],
  busted: [
    "Pegamos! Confisca essas calorias e manda direto pra balança.",
    "Autuado! Viu? Constância vence talento.",
    "Mais um pra conta. Anota aí: excesso de gordura trans em via pública.",
  ],
} as const;

export type RadioEvent = keyof typeof CROSSFIT_RADIO;
/** Arquivo de voz de um recado do rádio (client/public/vozes/historia/). */
export const radioLineId = (event: RadioEvent, index: number) => `radio-${event}-${index + 1}`;

/**
 * Ponte inacabada do Cais (fim da Rua do Cais, a oeste): chegar aqui na fuga
 * final é escapar. Fica no muro do cais, de frente para o mar (sul).
 */
export const FINALE_BRIDGE = { x: -450, z: -484, radius: 24, heading: Math.PI } as const;

/** Fala de um personagem; a cena 3D sai pelo nome dele quando não vem `shot`. */
const line = (speaker: string, art: string, text: string, color = "#16110d", fx: ComicPanel["fx"] = "slam", sfx?: string, shot?: CineShot): ComicPanel =>
  ({ speaker, art, text, color, fx, sfx, shot });
/** O Cross-fit falando pelo rádio, encostado no Couve-vette. */
const radio = (text: string, art = "📻🏋️", fx: ComicPanel["fx"] = "shake", sfx?: string): ComicPanel =>
  ({ speaker: CROSSFIT, art, text, color: "#1f3d24", fx, sfx, shot: "radio" });
const mia = (text: string, art = "🍱🙋‍♀️"): ComicPanel => ({ speaker: MIA, art, text, color: "#2a6f97", fx: "zoom", shot: "mia" });
const you = (text: string, art = "😤", sfx?: string): ComicPanel => ({ speaker: YOU, art, text, color: "#16110d", fx: "shake", sfx, shot: "duelo" });

export const RIVALS_LADDER: Rival[] = [
  {
    rank: 10, name: "Izzy Iogurte", title: "Light, mas nem tanto", car: "gol", race: "pastel",
    wins: 1, bounty: 3000, escapes: 0, escapeStars: 0, skill: 0.61,
    taunt: [
      line("Izzy Iogurte", "🥛😤", "Zero lactose, zero piedade. Você nem devia estar aqui com esse Uno.", "#9bd3ff"),
      you("Fala isso pro Uno. Ele é sensível."),
    ],
    defeat: [line("Izzy Iogurte", "🥛😵", "Talhei... Leva o Gol. E me esquece. Vou fazer um detox de você.", "#9bd3ff", "shake", "SPLOFT!")],
    interlude: [
      radio("Atenção, todas as unidades: um tal de Uno Coxinha derrubou a Izzy Iogurte. Quero esse piloto no espeto... de frango grelhado, claro."),
      mia("Ouviu o rádio? Parabéns: você entrou no caderninho do Cross-fit. Ele anota tudo. Até o que ele mesmo come."),
    ],
  },
  {
    rank: 9, name: "Ming Miojo", title: "Pronto em 3 minutos", car: "civic", race: "centro",
    wins: 2, bounty: 8000, escapes: 0, escapeStars: 0, skill: 0.53,
    taunt: [line("Ming Miojo", "🍜⏱️", "Eu termino a corrida antes da água ferver. Tempero incluso. Três minutos, cronometrado!", "#f2c14e")],
    defeat: [line("Ming Miojo", "🍜💧", "Passei do ponto... Virei papa. O Civic é seu.", "#f2c14e")],
  },
  {
    rank: 8, name: "JV Pastel", title: "Vento de feira", car: "golf", race: "pastel",
    wins: 2, bounty: 15000, escapes: 1, escapeStars: 1, skill: 0.77,
    taunt: [line("JV Pastel", "🥟💨", "Olha o pastel! Na minha feira, quem não corre vira recheio. Quer de carne ou de queijo?", "#e9c46a")],
    defeat: [line("JV Pastel", "🥟😩", "Murchei igual pastel frio de fim de feira. Fica com o Golf, freguês.", "#e9c46a")],
    interlude: [
      radio("Pedi reforço ao comando: a Força-Tarefa Detox está oficialmente nas ruas. Cinco estrelas e eu mesmo saio com o Couve-vette pra te buscar.", "📻🥬🏎️", "flash", "UÓÓÓ!"),
      mia("O Cross-fit não persegue por dinheiro. Persegue por proteína. Se ouvir sirene verde, nem olha pra trás."),
    ],
  },
  {
    rank: 7, name: "Vic Virado", title: "Virado à paulista", car: "opala", race: "porto",
    wins: 2, bounty: 25000, escapes: 1, escapeStars: 2, skill: 1.0,
    taunt: [line("Vic Virado", "🍳🥓🥬", "Tutu, couve, linguiça, ovo e um Opala seis cilindros. Isso é que é almoço. Depois eu cochilo na reta.", "#7a1f1f")],
    defeat: [line("Vic Virado", "🍳😪", "Bateu aquele sono depois do almoço... Pode levar o Opala. Só não me acorda.", "#7a1f1f")],
  },
  {
    rank: 6, name: "Earl Esfiha", title: "Aberta ou fechada?", car: "mustang", race: "centro",
    wins: 3, bounty: 35000, escapes: 1, escapeStars: 2, skill: 0.61,
    taunt: [line("Earl Esfiha", "🫓🐎", "Senhoras e senhores! Na reta eu sou aberta. Na curva, fechada. E o Mustang é mostarda!", "#f2b705")],
    defeat: [line("Earl Esfiha", "🫓💔", "Fui... aberto demais. O show acabou. Pega o Mustang.", "#f2b705")],
    interlude: [
      { speaker: REPORTER, art: "📺🎤", color: "#16110d", fx: "zoom", shot: "tv", text: "Jornal da Gordura, ao vivo. Sargento, a cidade engordou doze por cento este ano. De quem é a culpa?" },
      { speaker: CROSSFIT, art: "📺🏋️", color: "#1f3d24", fx: "slam", shot: "tv", text: "De UM piloto. E de uns quarenta mil pastéis. Mas principalmente do piloto. Próxima pergunta. Ou melhor: próxima série." },
    ],
  },
  {
    rank: 5, name: "Ronnie Rocambole", title: "Enrola todo mundo", car: "supra", race: "parque",
    wins: 3, bounty: 50000, escapes: 2, escapeStars: 2, skill: 0.68, bonusCar: "porchetta",
    taunt: [
      line("Ronnie Rocambole", "🍥😈", "Sabe aquela maionese no seu tanque? Fui eu. O Bruno pagou em X-Tudo. Valeu cada mordida.", "#d98a2b", "zoom", "HÁ HÁ!"),
      you("Então é pessoal. Liga esse Supra.", "😠🔧", "GRRR!"),
    ],
    defeat: [line("Ronnie Rocambole", "🍥😱", "Me desenrolou... Leva o Supra. E de brinde a Porchetta que eu guardava na garagem.", "#d98a2b")],
    interlude: [
      mia("Então foi o Ronnie, a mando do Bruno. Agora você sabe por que eu tô te ajudando: o Bruno me deve uma marmita. E juros.", "🍱😠"),
      radio("Sei que foi sabotagem, Coxinha. Não muda nada: maionese vencida é maionese vencida. Lei é lei, macro é macro."),
    ],
  },
  {
    rank: 4, name: "Kaze Coxinha", title: "Mestre do drift", car: "skyline", race: "porto",
    wins: 3, bounty: 65000, escapes: 2, escapeStars: 3, skill: 0.74, bonusCar: "lasanha",
    taunt: [line("Kaze Coxinha", "🍗🌀", "Crocante por fora, cantando pneu por dentro. Relaxa. Vou te deixar no catupiry.", "#2b2d42")],
    defeat: [line("Kaze Coxinha", "🍗🫠", "Desmanchei... O Skyline é seu. E a Lasanha também, eu nunca soube estacionar ela.", "#2b2d42")],
  },
  {
    rank: 3, name: "Baron Brigadeiro", title: "Doce e perigoso", car: "brigadeiro", race: "parque",
    wins: 3, bounty: 80000, escapes: 2, escapeStars: 3, skill: 0.72, bonusCar: "farofa",
    taunt: [line("Baron Brigadeiro", "🍫🎩", "Meu caro, granulado na pista e adversário no muro. Dezesseis cilindros de puro açúcar.", "#4a2c1d")],
    defeat: [line("Baron Brigadeiro", "🍫🫠", "Derreti no sol... Que deselegante. O Bugatti é seu. A Ferrari Farofa também, que eu já tava cansado de limpar.", "#4a2c1d")],
    interlude: [
      radio("Subi a meta, Coxinha. Agora com QUATRO estrelas o Couve-vette sai da garagem. Vou te fazer suar mais que aula de spinning.", "📻🏋️🔥", "flash", "UÓÓÓ!"),
    ],
  },
  {
    rank: 2, name: "Razor Bacon", title: "O braço direito do Bruno", car: "kibe", race: "porto",
    wins: 4, bounty: 100000, escapes: 3, escapeStars: 4, skill: 0.69,
    taunt: [line("Razor Bacon", "🥓🔪", "Eu não freio. Eu frito. O Bruno só chega em você passando por cima de mim.", "#c1442e")],
    defeat: [line("Razor Bacon", "🥓😖", "Torrou... Leva o Kibe-segg. O Bruno te espera no autódromo. E ele não tá sozinho.", "#c1442e")],
    interlude: [
      mia("O Bruno tá no autódromo, com o seu M3. E o Cross-fit montou bloqueio em todas as saídas da cidade. Se você ganhar, vai ter que fugir com o carro.", "🍱🗺️"),
      radio("Sei onde você vai. Sei o que você quer. E sei quantas calorias tem um X-Tudo: mil e oitocentas. Te espero lá fora.", "📻🏋️🍔"),
    ],
  },
  {
    rank: 1, name: "Bruno", title: "O Rei do X-Tudo", car: "a3bruno", race: "autodromo",
    wins: 4, bounty: 120000, escapes: 3, escapeStars: 4, skill: 0.78,
    taunt: [
      line("Bruno", "🧔🍔", "Olha só quem chegou. O cara do Uno Coxinha. Veio buscar seu queijo?", "#c1121f"),
      line("Bruno", "🚗💨 A3", "Esse A3 tem turbina de navio, remap no talo e meio X-Tudo debaixo do banco. Boa sorte.", "#7a7f86", "speed", "VRAAAP!"),
      you("Hoje eu como você no café da manhã.", "😤🧀", "TÁ VALENDO!"),
    ],
    defeat: [],
  },
];

const RANK_WORDS = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez"];

/** Apresentação do rival antes do duelo (o narrador lê o cartão da Lista Gorda). */
export function rivalIntroPanel(rival: Rival): ComicPanel {
  return {
    id: `r${rival.rank}-apresenta`, art: "📋🔥", color: "#16110d", fx: "zoom", shot: "apresenta",
    text: `Número ${RANK_WORDS[rival.rank]} da Lista Gorda: ${rival.name}. ${rival.title}${/[.!?]$/.test(rival.title) ? "" : "."}`,
  };
}

/** Cena antes do duelo: apresentação e a provocação. */
export const rivalTauntScene = (rival: Rival): ComicPanel[] => [rivalIntroPanel(rival), ...rival.taunt];

/** Cena depois de vencer: o rival entrega a chave e a nota fiscal do carro (e, depois, o interlúdio). */
export function rivalDefeatScene(rival: Rival): ComicPanel[] {
  if (rival.rank === 1) return [];
  const car = carSpec(rival.car).name;
  const bonus = rival.bonusCar ? ` E de brinde: ${carSpec(rival.bonusCar).name}.` : "";
  const nota: ComicPanel = {
    id: `r${rival.rank}-nota`, art: "🧾✍️", color: "#ff7a00", fx: "slam", sfx: "CARIMBO!", shot: "nota",
    text: `Nota fiscal assinada. ${car} agora é seu.${bonus} Próximo alvo: número ${RANK_WORDS[rival.rank - 1]}.`,
  };
  return [...rival.defeat, nota, ...(rival.interlude ?? [])];
}

// Cada fala ganha um id (o nome do arquivo de voz) e, se não tiver, a cena 3D.
const name = (prefix: string, panels: ComicPanel[], shot?: (p: ComicPanel) => CineShot) =>
  panels.forEach((p, i) => {
    p.id ??= `${prefix}-${i + 1}`;
    if (!p.shot && shot) p.shot = shot(p);
  });
name("prologo", PROLOGUE);
name("final-intro", FINALE_INTRO);
name("final-autuado", FINALE_BUSTED);
name("final-fuga", FINALE_ESCAPE);
name("epilogo", EPILOGUE);
for (const r of RIVALS_LADDER) {
  name(`r${r.rank}-provoca`, r.taunt, (p) => (p.speaker === YOU ? "duelo" : "rival"));
  name(`r${r.rank}-perde`, r.defeat, () => "entrega");
  name(`r${r.rank}-depois`, r.interlude ?? []);
}

/** Todas as falas do modo história (o scripts/vozes.py grava uma voz para cada). */
/**
 * Direção de voz: a intenção de cada fala (lida no contexto de quem fala e do
 * que acabou de acontecer) e, nas piadas e nos momentos dramáticos, o trecho
 * antes do qual vem a pausa. Apresentações saem "epico" e notas fiscais
 * "triunfante"; o que não está aqui fica "neutro".
 */
const VOICE_DIRECTION: Record<string, [Emotion, string?]> = {
  // Prólogo
  "prologo-1": ["epico", "e de Vigilância"],
  "prologo-2": ["empolgado", "Prata"],
  "prologo-3": ["oficial", "Ninguém entra"],
  "prologo-4": ["ameaca", "e o seu percentual"],
  "prologo-5": ["comico", "O senhor quer"],
  "prologo-6": ["debochado", "por enquanto"],
  "prologo-7": ["epico", "E no topo dela"],
  "prologo-8": ["debochado", "Vamos apostar"],
  "prologo-9": ["comico", "Mentira"],
  "prologo-10": ["debochado", "Mas vai treinando"],
  "prologo-11": ["assustado", "Alguém colocou"],
  "prologo-12": ["debochado", "Vou transformar"],
  "prologo-13": ["bravo", "Eu sabia"],
  "prologo-14": ["calmo", "Agora me prova"],
  "prologo-15": ["triste", "Sobrou só"],
  "prologo-16": ["ameaca", "Uma por uma"],
  "prologo-17": ["epico", "Suba a Lista Gorda"],
  // Depois do Bruno e a fuga final
  "final-intro-1": ["triste", "Tá bom"],
  "final-intro-2": ["comico", "na fila do pastel"],
  "final-intro-3": ["triunfante", "O motor ronca"],
  "final-intro-4": ["bravo", "Hoje é dia de perna"],
  "final-intro-5": ["assustado", "quer dizer"],
  "final-autuado-1": ["debochado", "Mais uma série"],
  "final-fuga-1": ["empolgado", "e o pôr do sol"],
  "final-fuga-2": ["epico", "Sem volta"],
  "final-fuga-3": ["ameaca", "Contando as calorias"],
  "epilogo-1": ["sussurro", "Seu segredo"],
  "epilogo-2": ["oficial", "Cancelem o meu almoço"],
  "epilogo-3": ["triunfante", "Ou será"],
  // Rivais
  "r10-provoca-1": ["debochado", "Você nem devia"],
  "r10-provoca-2": ["comico", "Ele é sensível"],
  "r10-perde-1": ["triste", "Vou fazer um detox"],
  "r10-depois-1": ["oficial", "de frango grelhado"],
  "r10-depois-2": ["comico", "Até o que"],
  "r9-provoca-1": ["empolgado"],
  "r9-perde-1": ["triste", "Virei papa"],
  "r8-provoca-1": ["empolgado", "Quer de carne"],
  "r8-perde-1": ["cansado", "Fica com o Golf"],
  "r8-depois-1": ["ameaca", "Cinco estrelas"],
  "r8-depois-2": ["calmo", "Persegue por proteína"],
  "r7-provoca-1": ["calmo", "Depois eu cochilo"],
  "r7-perde-1": ["cansado", "Só não me acorda"],
  "r6-provoca-1": ["empolgado", "E o Mustang"],
  "r6-perde-1": ["triste", "O show acabou"],
  "r6-depois-1": ["oficial", "De quem é a culpa"],
  "r6-depois-2": ["bravo", "Mas principalmente"],
  "r5-provoca-1": ["debochado", "Fui eu"],
  "r5-provoca-2": ["bravo"],
  "r5-perde-1": ["assustado", "E de brinde"],
  "r5-depois-1": ["comico", "E juros"],
  "r5-depois-2": ["ameaca", "Lei é lei"],
  "r4-provoca-1": ["calmo", "Relaxa"],
  "r4-perde-1": ["comico", "eu nunca soube"],
  "r3-provoca-1": ["debochado", "Dezesseis cilindros"],
  "r3-perde-1": ["triste", "Que deselegante"],
  "r3-depois-1": ["ameaca", "Vou te fazer suar"],
  "r2-provoca-1": ["bravo", "Eu frito"],
  "r2-perde-1": ["cansado", "E ele não tá sozinho"],
  "r2-depois-1": ["calmo", "Se você ganhar"],
  "r2-depois-2": ["ameaca", "Te espero lá fora"],
  "r1-provoca-1": ["debochado", "Veio buscar"],
  "r1-provoca-2": ["debochado", "Boa sorte"],
  "r1-provoca-3": ["bravo"],
};
/** Recados do rádio: a intenção por momento da perseguição. */
const RADIO_DIRECTION: Record<RadioEvent, Emotion> = { start: "oficial", crossfit: "ameaca", escaped: "cansado", busted: "triunfante" };

const directionOf = (id: string): [Emotion, string?] =>
  VOICE_DIRECTION[id] ?? [id.endsWith("-apresenta") ? "epico" : id.endsWith("-nota") ? "triunfante" : "neutro"];

// Cada quadro do roteiro fica com a sua direção de voz.
for (const panel of [PROLOGUE, FINALE_INTRO, FINALE_BUSTED, FINALE_ESCAPE, EPILOGUE, ...RIVALS_LADDER.flatMap((r) => [r.taunt, r.defeat, r.interlude ?? []])].flat()) {
  [panel.emotion, panel.beat] = directionOf(panel.id!);
}

/** Uma fala gravada: quem fala, o texto para a voz e a direção. */
export interface VoiceLineSpec {
  id: string;
  speaker: string;
  text: string;
  radio: boolean;
  emotion: Emotion;
  beat?: string;
}

export function storyVoiceLines(): VoiceLineSpec[] {
  const scenes = [
    PROLOGUE, FINALE_INTRO, FINALE_BUSTED, FINALE_ESCAPE, EPILOGUE,
    ...RIVALS_LADDER.flatMap((r) => [rivalTauntScene(r), rivalDefeatScene(r)]),
  ];
  const lines: VoiceLineSpec[] = scenes.flat().map((p) => {
    const [emotion, beat] = p.emotion ? [p.emotion, p.beat] : directionOf(p.id!);

    return { id: p.id!, speaker: p.speaker ?? "", text: p.say ?? p.text, radio: false, emotion, beat };
  });
  for (const event of Object.keys(CROSSFIT_RADIO) as RadioEvent[]) {
    CROSSFIT_RADIO[event].forEach((text, i) => lines.push({ id: radioLineId(event, i), speaker: CROSSFIT, text, radio: true, emotion: RADIO_DIRECTION[event] }));
  }
  // (Os interlúdios aparecem nas duas listas: sem repetir.)
  return [...new Map(lines.map((l) => [l.id, l])).values()];
}

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
  /** Escapou da fuga final (pulou a ponte). */
  finaleDone: boolean;
}

export const newStory = (): StoryProgress => ({
  stage: 0, wins: 0, escapes: 0, bounty: 0, unlocked: [...STARTER_CARS], car: STARTER_CARS[0], seenPrologue: false, finaleDone: false,
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

/** Venceu o #1 (a Lista Gorda acabou; falta a fuga final, se ainda não fez). */
export const storyFinished = (story: StoryProgress) => story.stage >= RIVALS_LADDER.length;
/** Venceu o Bruno, mas ainda não escapou do Cross-fit pela ponte. */
export const finalePending = (story: StoryProgress) => storyFinished(story) && !story.finaleDone;

/**
 * A partir de quantas estrelas o próprio Cross-fit entra nas perseguições do
 * modo história (0 = ainda não entra). Ele vai apertando conforme você sobe:
 * depois do JV Pastel (#8) sai com 5 estrelas; depois do Baron (#3), com 4.
 */
export function crossfitJoinsAt(story: StoryProgress) {
  if (story.stage >= 8) return 4;
  if (story.stage >= 3) return 5;
  return 0;
}
