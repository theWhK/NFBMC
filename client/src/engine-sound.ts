// Ronco dos motores, sintetizado a partir do perfil de cada carro
// (`engine` em shared/src/cars.ts).
//
// Como funciona: para algumas faixas de giro, o código "liga o motor" fora do
// tempo real e grava alguns ciclos (duas voltas do virabrequim cada): cada
// cilindro que explode solta um pulso de pressão no escapamento, que passa pelo
// cano (um filtro pente, com as ressonâncias do tubo), pelo abafador (passa-
// baixa) e por uma saturação leve. Junto vem o ronco da admissão (ruído pulsando
// no ritmo das explosões) e o barulho mecânico (válvulas, ventoinha do Fusca,
// batida do diesel). Cada faixa tem uma versão "acelerando" e outra "aliviando"
// (pulsos fracos, abafados e falhando).
//
// No jogo, cada faixa toca em laço com a velocidade de reprodução acompanhando o
// giro, e o som cruza de uma faixa para a vizinha. Assim o timbre do cano fica
// no lugar (não vira voz de esquilo lá em cima) e o custo é só tocar buffers:
// roda em celular. Turbina, válvula de alívio, estalos no alívio, limitador e
// troca de marcha são camadas de tempo real por cima (ver `PlayerEngine`).
import type { EngineSound } from "@nfbmc/shared";

import { blowOff, exhaustPop, type Kit } from "./sfx.ts";

/** Taxa dos buffers do motor: metade da do navegador basta e gera o dobro de rápido. */
const RATE = 24000;

/** Sorteio com semente: o mesmo carro soa sempre igual. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Filtro biquad (fórmulas do RBJ) para gerar os buffers fora do Web Audio. */
class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(type: "lowpass" | "highpass" | "bandpass" | "peaking", freq: number, q: number, gainDb = 0) {
    const w = (2 * Math.PI * Math.min(freq, RATE * 0.45)) / RATE;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    if (type === "lowpass") {
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
    } else if (type === "highpass") {
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
    } else if (type === "bandpass") {
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
    } else {
      const A = 10 ** (gainDb / 40);
      b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = a1 / a0; this.a2 = a2 / a0;
  }

  run(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** Parâmetros de síntese tirados do perfil (o "desenho" do som de cada motor). */
interface Voicing {
  cylinders: number;
  /** Ângulo de cada explosão no ciclo (0 a 1) e para qual cano ela vai. */
  firing: { at: number; bank: number; weight: number }[];
  /** Frequência fundamental do cano de cada bancada (Hz) e quanto ele ressoa. */
  pipeHz: number[];
  pipeFeedback: number;
  /** Corte do abafador (Hz). */
  muffler: number;
  /** Ruído rasgado junto do pulso (0 a 1). */
  rasp: number;
  /** Quanto o pulso satura (o "grão" do ronco). */
  grit: number;
  /** Sobra do pulso na saída: mais = mais grave e "redondo". */
  thump: number;
  /** Variação de um cilindro para outro e de um ciclo para outro. */
  spread: number;
  jitter: number;
  intakeHz: number;
  intake: number;
  /** Ventoinha (Fusca), batida de válvula e batida do diesel. */
  fan: number;
  tick: number;
  knock: number;
  /** Ganho final: motor grande e escapamento aberto soam mais alto. */
  loudness: number;
}

function voicing(engine: EngineSound, seed: number, hot = false): Voicing {
  const rand = seeded(seed);
  const n = engine.cylinders;
  const perCyl = engine.liters / n;
  const turbo = engine.aspiration !== "aspirado";
  const exhaust = { fabrica: 0, esportivo: 1, corrida: 2 }[engine.exhaust];
  const spread = engine.airCooled ? 0.28 : engine.diesel ? 0.12 : 0.07;
  const firing: Voicing["firing"] = [];
  // V8 de virabrequim cruzado: explosões a cada 90°, mas cada bancada recebe
  // um ritmo irregular (ordem 1-5-4-8-6-3-7-2): é daí que sai o "blub-blub".
  const crossBanks = [0, 1, 0, 1, 1, 0, 1, 0];
  for (let i = 0; i < n; i++) {
    firing.push({
      at: i / n + (rand() - 0.5) * (engine.airCooled ? 0.012 : 0.003),
      bank: engine.crossplane ? crossBanks[i % 8] : 0,
      weight: 1 + (rand() - 0.5) * 2 * spread + (engine.crossplane && crossBanks[i % 8] ? -0.12 : 0),
    });
  }
  // Cano mais longo em motor maior: ressonância mais grave.
  const pipe = Math.max(55, Math.min(190, 175 / Math.sqrt(engine.liters)));
  return {
    cylinders: n,
    firing,
    pipeHz: engine.crossplane ? [pipe, pipe * 1.17] : [pipe],
    pipeFeedback: [0.45, 0.58, 0.66][exhaust],
    muffler: ([1500, 2600, 4600][exhaust] * (turbo ? 0.8 : 1)) * (hot ? 1.5 : 1),
    // Muitos cilindros somam pulsos e alisam o som; poucos e pequenos soam mais ásperos.
    rasp: ([0.2, 0.32, 0.5][exhaust] * (turbo ? 0.6 : 1) * Math.sqrt(4 / n) + (engine.airCooled ? 0.08 : 0)) * (hot ? 1.6 : 1),
    grit: [1.3, 1.9, 2.8][exhaust] + (hot ? 0.8 : 0) + Math.max(0, 0.45 - perCyl) * 3,
    thump: 0.4 + Math.min(0.5, perCyl * 0.7),
    spread,
    jitter: engine.airCooled ? 0.14 : engine.diesel ? 0.1 : 0.05,
    intakeHz: (hot ? 1500 : 380 + 260 / Math.sqrt(engine.liters)),
    intake: turbo ? 0.1 : hot ? 0.75 : [0.22, 0.32, 0.4][exhaust],
    fan: engine.airCooled ? 0.03 : 0,
    tick: engine.airCooled ? 0.09 : engine.diesel ? 0.04 : 0.012,
    knock: engine.diesel ? 0.35 : 0,
    loudness: (0.85 + 0.08 * Math.log2(engine.liters * 2)) * [0.9, 1, 1.1][exhaust],
  };
}

/**
 * Grava um laço de `cycles` ciclos do motor girando a `rpm` (com carga ou
 * aliviando). Devolve as amostras e o giro exato do laço.
 */
function renderLoop(v: Voicing, rpm: number, load: boolean, seed: number) {
  const rand = seeded(seed);
  const cycleSec = 120 / rpm;
  const cycles = Math.max(4, Math.ceil(0.32 / cycleSec));
  const length = Math.round(cycles * cycleSec * RATE);
  const cycleLen = length / cycles;
  const banks = v.pipeHz.length;

  // Excitação: os pulsos de cada cano, periódicos no laço (ele emenda sem estalo).
  const pulses = Array.from({ length: banks }, () => new Float32Array(length));
  const envelope = new Float32Array(length);
  const clicks = new Float32Array(length);
  // Largura do pulso: uma fração do intervalo entre explosões. Com muitos
  // cilindros os pulsos ficam curtos e colados, e o som vira um uivo afinado (V12, W16).
  const width = Math.max(3, (cycleLen / v.cylinders) * (load ? 0.36 : 0.26));
  for (let c = 0; c < cycles; c++) {
    for (const f of v.firing) {
      // Aliviando, a mistura pobre falha de vez em quando (o "pipoco" baixo).
      let amp = f.weight * (1 + (rand() - 0.5) * 2 * v.jitter);
      if (!load) amp *= rand() < 0.15 ? 0.05 + rand() * 0.2 : 0.22 + rand() * 0.12;
      const start = (c + f.at) * cycleLen;
      const span = Math.ceil(width * 4);
      for (let k = 0; k < span; k++) {
        const x = k / width;
        // Sobe rápido (meio cosseno), cai em exponencial e "puxa" de volta (a lavagem do cilindro).
        const shape = x < 1 ? 0.5 - 0.5 * Math.cos(Math.PI * x) : Math.exp(-(x - 1) * 2.2) - 0.35 * Math.exp(-(x - 1) * 0.9) * Math.min(1, x - 1);
        const i = Math.floor(start + k) % length;
        pulses[f.bank][i] += amp * shape;
        envelope[i] += amp * Math.max(0, shape);
      }
      if (v.tick > 0 || v.knock > 0) {
        const i = Math.floor(start + width * 0.2) % length;
        clicks[i] += (v.knock + v.tick * (0.6 + rand() * 0.8)) * (load ? 1 : 0.6);
      }
    }
  }
  const noise = new Float32Array(length);
  for (let i = 0; i < length; i++) noise[i] = rand() * 2 - 1;

  // Duas passadas: a primeira só aquece os filtros (o laço fica contínuo).
  const out = new Float32Array(length);
  const pipeLen = v.pipeHz.map((hz) => Math.max(8, Math.round(RATE / hz / 2)));
  const pipeBuf = pipeLen.map((len) => new Float32Array(len));
  const pipePos = pipeLen.map(() => 0);
  const pipeDamp = pipeLen.map(() => 0);
  const raspBand = new Biquad("bandpass", 1800 + (load ? 600 : 0), 0.7);
  const muffler1 = new Biquad("lowpass", load ? v.muffler : v.muffler * 0.55, 0.7);
  const muffler2 = new Biquad("lowpass", load ? v.muffler * 1.4 : v.muffler * 0.7, 0.6);
  const body = new Biquad("peaking", v.pipeHz[0] * 2, 1.2, 4);
  const intakeBand = new Biquad("bandpass", v.intakeHz, 2.2);
  const clickBand = new Biquad("bandpass", v.knock > 0 ? 2600 : 4200, 1.5);
  const dc = new Biquad("highpass", 28, 0.7);
  const envSmooth = { y: 0 };
  // Ventoinha do Fusca: gira 1,8× o virabrequim e tem 14 pás (o assobio); arredonda para fechar o laço.
  const fanPeriods = Math.round(cycles * 2 * 1.8 * 14);
  const drive = load ? v.grit : v.grit * 0.6;
  const norm = Math.tanh(drive);

  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < length; i++) {
      envSmooth.y += (envelope[i] - envSmooth.y) * 0.02;
      const rasp = raspBand.run(noise[i]) * envelope[i] * v.rasp * 3;
      let exhaust = 0;
      for (let b = 0; b < banks; b++) {
        // Cano: linha de atraso com realimentação e um pouco de perda nos agudos.
        const len = pipeLen[b];
        const delayed = pipeBuf[b][pipePos[b]];
        pipeDamp[b] += (delayed - pipeDamp[b]) * 0.45;
        const y = pulses[b][i] + (b === 0 ? rasp : rasp * 0.7) - v.pipeFeedback * pipeDamp[b];
        pipeBuf[b][pipePos[b]] = y;
        pipePos[b] = (pipePos[b] + 1) % len;
        exhaust += y * (b === 0 ? 1 : 0.9) + pulses[b][i] * v.thump;
      }
      let x = muffler2.run(muffler1.run(body.run(exhaust)));
      x = Math.tanh(x * drive) / norm;
      // Admissão: ruído pulsando no ritmo das explosões (some aliviando).
      if (load) x += intakeBand.run(noise[(i + 7919) % length]) * envSmooth.y * v.intake * 2.4;
      if (v.fan > 0) x += Math.sin((2 * Math.PI * fanPeriods * i) / length) * v.fan * (0.6 + 0.4 * envSmooth.y);
      if (clicks[i] !== 0 || v.tick > 0) x += clickBand.run(clicks[i] * 4 + noise[(i * 7) % length] * clicks[i]) * 1.2;
      out[i] = dc.run(x);
    }
  }
  return { data: out, rpm: (120 * cycles * RATE) / length };
}

export interface EngineBand {
  rpm: number;
  on: AudioBuffer;
  off: AudioBuffer;
}

export interface EngineBank {
  engine: EngineSound;
  idle: number;
  redline: number;
  bands: EngineBand[];
  loudness: number;
}

/** Leva o laço para um RMS fixo e garante que não estoura. */
function normalize(data: Float32Array, rms: number) {
  let sum = 0;
  for (const x of data) sum += x * x;
  const current = Math.sqrt(sum / data.length) || 1;
  const gain = rms / current;
  // Picos acima de ~0,6 são arredondados (tanh) em vez de baixar o laço inteiro.
  for (let i = 0; i < data.length; i++) {
    const x = data[i] * gain;
    data[i] = Math.abs(x) < 0.6 ? x : Math.sign(x) * (0.6 + 0.35 * Math.tanh((Math.abs(x) - 0.6) / 0.35));
  }
}

/** Faixas de giro gravadas: espaçadas em proporção (o ouvido escuta assim). */
export function bandRpms(engine: EngineSound, idle: number, redline: number) {
  const top = redline * 1.02;
  const count = 5;
  const list: { rpm: number; hot: boolean }[] = [];
  for (let i = 0; i < count; i++) list.push({ rpm: idle * (top / idle) ** (i / (count - 1)), hot: false });
  if (engine.camRpm) {
    // VTEC: duas faixas coladas no ponto em que o comando "vira", uma de cada lado.
    const cam = engine.camRpm;
    const kept = list.filter((b) => Math.abs(b.rpm - cam) > cam * 0.12);
    kept.push({ rpm: cam * 0.97, hot: false }, { rpm: cam * 1.02, hot: true });
    for (const b of kept) b.hot = b.rpm >= cam;
    return kept.sort((a, b) => a.rpm - b.rpm);
  }
  return list;
}

const banks = new Map<string, EngineBank>();

/** Gera (uma vez por perfil) os laços do motor. Leva poucos milissegundos. */
export function engineBank(ctx: BaseAudioContext, key: string, engine: EngineSound, idle: number, redline: number): EngineBank {
  const cached = banks.get(key);
  if (cached && cached.bands[0].on.sampleRate === RATE) return cached;
  const seed = hash(key);
  const cold = voicing(engine, seed);
  const hot = engine.camRpm ? voicing(engine, seed, true) : cold;
  const bands = bandRpms(engine, idle, redline).map(({ rpm, hot: isHot }, i) => {
    const v = isHot ? hot : cold;
    const make = (load: boolean) => {
      const { data, rpm: exact } = renderLoop(v, rpm, load, seed + i * 31 + (load ? 0 : 7));
      normalize(data, load ? 0.28 : 0.2);
      const buffer = ctx.createBuffer(1, data.length, RATE);
      buffer.getChannelData(0).set(data);
      return { buffer, exact };
    };
    const on = make(true);
    const off = make(false);
    return { rpm: on.exact, on: on.buffer, off: off.buffer };
  });
  const bank = { engine, idle, redline, bands, loudness: cold.loudness };
  banks.set(key, bank);
  return bank;
}

/**
 * Um motor tocando: as faixas em laço, cruzando conforme o giro e a carga,
 * mais um passa-baixa (distância, carga), um "corte" (limitador, troca) e o pan.
 */
export class EngineVoice {
  private output: GainNode;
  /** Ganho separado para os cortes rápidos (não briga com o volume). */
  private cut: GainNode;
  private sources: { node: AudioBufferSourceNode; gain: GainNode; band: number; load: boolean }[] = [];
  private filter: BiquadFilterNode;
  private panner: StereoPannerNode;
  private ctx: BaseAudioContext;
  private hasOff: boolean;
  readonly bank: EngineBank;
  private stopped = false;

  /** `withOff`: toca também as faixas aliviando (o carro do jogador). */
  constructor(ctx: BaseAudioContext, dest: AudioNode, bank: EngineBank, withOff: boolean, reverb?: { node: AudioNode; amount: number }) {
    this.ctx = ctx;
    this.bank = bank;
    this.hasOff = withOff;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 6000;
    this.filter.Q.value = 0.5;
    this.cut = ctx.createGain();
    this.output = ctx.createGain();
    this.output.gain.value = 0;
    this.panner = ctx.createStereoPanner();
    this.filter.connect(this.cut).connect(this.output).connect(this.panner).connect(dest);
    if (reverb) {
      const send = ctx.createGain();
      send.gain.value = reverb.amount;
      this.panner.connect(send).connect(reverb.node);
    }
    const start = ctx.currentTime + 0.01;
    bank.bands.forEach((band, i) => {
      for (const load of withOff ? [true, false] : [true]) {
        const node = ctx.createBufferSource();
        node.buffer = load ? band.on : band.off;
        node.loop = true;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        node.connect(gain).connect(this.filter);
        // Começa cada laço num ponto diferente para não somarem em fase.
        node.start(start, (i * 0.137) % node.buffer.duration);
        this.sources.push({ node, gain, band: i, load });
      }
    });
  }

  /**
   * `rpm` do motor, `load` de 0 (aliviando) a 1 (pé no fundo), `volume`,
   * `pan` (-1 a 1), `cutoff` do passa-baixa e `pitch` extra (efeito Doppler).
   */
  set(rpm: number, load: number, volume: number, pan = 0, cutoff = 9000, pitch = 1, glide = 0.035) {
    if (this.stopped) return;
    const t = this.ctx.currentTime;
    const bands = this.bank.bands;
    const r = Math.max(bands[0].rpm * 0.6, Math.min(bands[bands.length - 1].rpm * 1.15, rpm));
    // Peso de cada faixa: cruzamento de potência constante entre as duas vizinhas.
    const weights = bands.map(() => 0);
    if (r <= bands[0].rpm) weights[0] = 1;
    else if (r >= bands[bands.length - 1].rpm) weights[bands.length - 1] = 1;
    else {
      let i = 0;
      while (r > bands[i + 1].rpm) i++;
      const x = Math.log(r / bands[i].rpm) / Math.log(bands[i + 1].rpm / bands[i].rpm);
      weights[i] = Math.cos((x * Math.PI) / 2);
      weights[i + 1] = Math.sin((x * Math.PI) / 2);
    }
    const l = Math.max(0, Math.min(1, load));
    for (const s of this.sources) {
      const mix = this.hasOff ? (s.load ? Math.sqrt(l) : Math.sqrt(1 - l) * 0.85) : 1;
      s.gain.gain.setTargetAtTime(weights[s.band] * mix, t, glide);
      s.node.playbackRate.setTargetAtTime(Math.max(0.25, Math.min(3, (r / bands[s.band].rpm) * pitch)), t, glide);
    }
    // Sem as faixas aliviando, a carga só abre ou fecha o som.
    const loadGain = this.hasOff ? 0.75 + 0.25 * l : 0.55 + 0.45 * l;
    // Mais giro, mais alto.
    const rev = 0.5 + 0.5 * Math.min(1.1, r / this.bank.redline);
    this.output.gain.setTargetAtTime(volume * this.bank.loudness * loadGain * rev, t, 0.05);
    this.filter.frequency.setTargetAtTime(cutoff * (this.hasOff ? 1 : 0.5 + 0.5 * l), t, 0.08);
    this.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.1);
  }

  /** Corta o som por um instante: `depth` 0 = mudo, 1 = nada. */
  dip(depth: number, hold: number) {
    const t = this.ctx.currentTime;
    const g = this.cut.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(depth, t + 0.008);
    g.setValueAtTime(depth, t + 0.008 + hold);
    g.linearRampToValueAtTime(1, t + 0.04 + hold);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    const t = this.ctx.currentTime;
    this.output.gain.cancelScheduledValues(t);
    this.output.gain.setTargetAtTime(0, t, 0.08);
    for (const s of this.sources) s.node.stop(t + 0.5);
    setTimeout(() => this.panner.disconnect(), 700);
  }
}

export interface DriveSound {
  rpm: number;
  /** Pé no acelerador, de 0 a 1. */
  throttle: number;
  gear: number;
}

/**
 * O motor do jogador, com tudo o que o ouvido percebe de perto: turbina
 * enchendo e assobiando, válvula de alívio ao tirar o pé, estalos do
 * escapamento aliviando, o limitador "picotando" e o corte na troca de marcha.
 */
export class PlayerEngine {
  readonly voice: EngineVoice;
  private kit: Kit;
  private engine: EngineSound;
  private redline: number;
  private load = 0;
  private lastThrottle = 0;
  private lastGear = 1;
  private shiftUntil = 0;
  private blipUntil = 0;
  private limiterNext = 0;
  private crackleUntil = 0;
  private crackleNext = 0;
  private wobble = 0;
  private spool = 0;
  private turbo: { gain: GainNode; whistles: OscillatorNode[]; air: BiquadFilterNode; source: AudioBufferSourceNode } | null = null;

  constructor(kit: Kit, bank: EngineBank) {
    this.kit = kit;
    this.engine = bank.engine;
    this.redline = bank.redline;
    this.voice = new EngineVoice(kit.ctx, kit.out, bank, true, { node: kit.reverb, amount: 0.06 });
    if (bank.engine.aspiration !== "aspirado") this.turbo = this.buildTurbo();
  }

  /** Assobio da turbina: senoides (uma por turbina, levemente desafinadas) e ar filtrado. */
  private buildTurbo() {
    const { ctx } = this.kit;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.kit.out);
    const count = { aspirado: 0, turbo: 1, biturbo: 2, quadriturbo: 3 }[this.engine.aspiration];
    const whistles: OscillatorNode[] = [];
    for (let i = 0; i < count; i++) {
      const osc = ctx.createOscillator();
      osc.frequency.value = 2000;
      const g = ctx.createGain();
      g.gain.value = 0.5 / count;
      osc.connect(g).connect(gain);
      osc.start();
      whistles.push(osc);
    }
    const source = ctx.createBufferSource();
    source.buffer = this.kit.noise;
    source.loop = true;
    const air = ctx.createBiquadFilter();
    air.type = "bandpass";
    air.Q.value = 6;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.9;
    source.connect(air).connect(airGain).connect(gain);
    source.start();
    return { gain, whistles, air, source };
  }

  update(dt: number, input: DriveSound, volume: number) {
    const t = this.kit.ctx.currentTime;
    const e = this.engine;
    const sporty = e.exhaust !== "fabrica" || e.bigTurbo;
    const ratio = input.rpm / this.redline;

    // Troca de marcha: corta a injeção um instante; reduzindo, dá a "punta-taco".
    if (input.gear !== this.lastGear && this.lastGear !== 0) {
      if (input.gear > this.lastGear && input.gear > 1) {
        this.shiftUntil = t + 0.12;
        this.voice.dip(0.45, 0.05);
        if (sporty && Math.random() < (e.exhaust === "corrida" ? 0.9 : 0.5)) exhaustPop(this.kit, 0.8, 0, volume * 2);
        if (this.turbo && this.spool > 0.45) this.releaseTurbo(volume);
      } else if (input.gear < this.lastGear && input.gear >= 1) {
        this.blipUntil = t + 0.14;
        if (sporty) this.crackleUntil = Math.max(this.crackleUntil, t + 0.5);
      }
    }
    this.lastGear = input.gear;

    // Carga que o motor "sente": o pé, menos o corte da troca, mais a punta-taco.
    let target = Math.max(0, Math.min(1, input.throttle));
    if (t < this.shiftUntil) target = 0;
    if (t < this.blipUntil) target = 1;
    this.load += (target - this.load) * Math.min(1, dt * (target > this.load ? 14 : 22));

    // Tirou o pé em giro alto: estalos no escapamento por um tempo.
    if (this.lastThrottle > 0.5 && input.throttle < 0.1 && ratio > 0.5) {
      this.crackleUntil = t + (e.exhaust === "corrida" ? 1.6 : e.exhaust === "esportivo" ? 1.0 : 0.35);
      if (this.turbo && this.spool > 0.45) this.releaseTurbo(volume);
    }
    this.lastThrottle = input.throttle;
    if (t < this.crackleUntil && input.throttle < 0.2 && ratio > 0.3 && t >= this.crackleNext) {
      const busy = e.bigTurbo ? 1.6 : e.exhaust === "corrida" ? 1.3 : e.exhaust === "esportivo" ? 0.8 : 0.4;
      exhaustPop(this.kit, Math.random() * (e.exhaust === "fabrica" ? 0.4 : 1), (Math.random() - 0.5) * 0.3, volume * 1.6);
      this.crackleNext = t + (0.04 + Math.random() * 0.22) / busy;
    }

    // Limitador: o giro bate e a injeção corta várias vezes por segundo.
    if (ratio > 0.965 && input.throttle > 0.5 && t >= this.limiterNext) {
      this.voice.dip(0.2, 0.025);
      if (e.exhaust === "corrida" && Math.random() < 0.35) exhaustPop(this.kit, 0.5, 0, volume);
      this.limiterNext = t + 0.07 + Math.random() * 0.03;
    }

    // Marcha lenta "mexida": o giro oscila um pouco (mais no V8 e no Fusca).
    const lope = (e.crossplane || e.airCooled ? 0.03 : 0.012) * Math.max(0, 1 - ratio * 3);
    this.wobble += ((Math.random() - 0.5) * 2 * lope - this.wobble) * Math.min(1, dt * 6);

    this.voice.set(input.rpm * (1 + this.wobble), this.load, volume, 0, 9000);

    // Turbina: enche com pé fundo e giro, esvazia rápido; grande demora mais.
    if (this.turbo) {
      const want = input.throttle > 0.4 ? Math.max(0, Math.min(1, (ratio - 0.28) / 0.4)) : 0;
      const lag = want > this.spool ? (e.bigTurbo ? 1.2 : 0.5) : 0.15;
      this.spool += (want - this.spool) * Math.min(1, dt / lag);
      const freq = (e.bigTurbo ? 1300 : 2100) + 5200 * this.spool * (0.6 + 0.4 * ratio);
      for (const [i, osc] of this.turbo.whistles.entries()) osc.frequency.setTargetAtTime(freq * (1 + i * 0.045), t, 0.05);
      this.turbo.air.frequency.setTargetAtTime(freq * 0.7, t, 0.05);
      const level = (e.bigTurbo ? 0.04 : 0.025) * this.spool ** 1.6 * (input.throttle > 0.4 ? 1 : 0.3);
      this.turbo.gain.gain.setTargetAtTime(level * volume * 4, t, 0.06);
    }
  }

  /** Cala tudo (pausa, fim de corrida); o próximo `update` volta de onde estava. */
  silence() {
    const t = this.kit.ctx.currentTime;
    this.voice.set(this.redline * 0.15, 0, 0);
    this.turbo?.gain.gain.setTargetAtTime(0, t, 0.05);
    this.crackleUntil = 0;
    this.spool = 0;
  }

  private releaseTurbo(volume: number) {
    blowOff(this.kit, this.spool, Boolean(this.engine.bigTurbo), volume * 3.5);
    this.spool *= 0.15;
  }

  stop() {
    this.voice.stop();
    if (this.turbo) {
      const t = this.kit.ctx.currentTime;
      this.turbo.gain.gain.setTargetAtTime(0, t, 0.05);
      for (const osc of this.turbo.whistles) osc.stop(t + 0.3);
      this.turbo.source.stop(t + 0.3);
    }
  }
}
