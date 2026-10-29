// A "banda" da trilha: instrumentos que tocam dentro de um OfflineAudioContext
// para gravar trechos de música (ver music.ts). Como é gravado fora do tempo
// real, dá para caprichar: bateria sintetizada amostra por amostra (bumbo com
// estalo e corpo, caixa com esteira, chimbal metálico de verdade), guitarras
// por corda dedilhada (Karplus-Strong) passando por distorção e por uma caixa
// de amplificador (resposta ao impulso gerada no código), baixo, sintetizadores,
// orquestra de cinema, mais compressão e limitador no fim.

export let SR = 44100;
/** Modo leve (celular): taxa menor, menos vozes por acorde, menos superamostragem. */
export let LITE = false;

/**
 * Liga o modo leve. Pode ser no meio do caminho (o aparelho se mostrou lento):
 * as amostras já feitas continuam valendo (cada buffer sabe a própria taxa).
 */
export function useLiteRendering() {
  SR = 24000;
  LITE = true;
}

export const freqOf = (note: number) => 440 * 2 ** ((note - 69) / 12);

/** Sorteio com semente (as amostras saem sempre iguais). */
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

/** Biquad em JavaScript (fórmulas do RBJ) para fabricar amostras. */
class Filter {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(type: "lowpass" | "highpass" | "bandpass" | "peaking", freq: number, q = 0.707, gainDb = 0) {
    const w = (2 * Math.PI * Math.min(freq, SR * 0.45)) / SR;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    if (type === "lowpass") {
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
    } else if (type === "highpass") {
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
    } else if (type === "bandpass") {
      b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
    } else {
      const A = 10 ** (gainDb / 40);
      b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }

  run(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

function toBuffer(channels: Float32Array[]) {
  const buffer = new AudioBuffer({ numberOfChannels: channels.length, length: channels[0].length, sampleRate: SR });
  channels.forEach((data, i) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, i));
  return buffer;
}

/** Amostras já fabricadas (valem para todas as gravações). */
const samples = new Map<string, AudioBuffer>();
function sample(name: string, make: () => Float32Array | Float32Array[]) {
  // A taxa entra na chave: no modo leve as amostras são refeitas em 24 kHz
  // (a resposta ao impulso de uma reverberação precisa ter a taxa do gravador).
  const key = `${name}@${SR}`;
  let buffer = samples.get(key);
  if (!buffer) {
    const data = make();
    buffer = toBuffer(Array.isArray(data) ? data : [data]);
    samples.set(key, buffer);
  }
  return buffer;
}

// --- Bateria -------------------------------------------------------------------

export type Kit = "rock" | "break" | "boom" | "crunk" | "cine" | "synth" | "baile";

interface KickVoice { from: number; to: number; bend: number; decay: number; click: number; drive: number; crush?: number }
const KICKS: Record<Kit, KickVoice> = {
  rock: { from: 120, to: 52, bend: 0.025, decay: 0.28, click: 0.7, drive: 2 },
  break: { from: 150, to: 50, bend: 0.03, decay: 0.22, click: 0.5, drive: 3, crush: 10 },
  boom: { from: 105, to: 46, bend: 0.04, decay: 0.42, click: 0.35, drive: 2.4 },
  crunk: { from: 95, to: 44, bend: 0.05, decay: 0.7, click: 0.3, drive: 1.6 },
  cine: { from: 80, to: 36, bend: 0.06, decay: 0.9, click: 0.2, drive: 1.4 },
  // Bateria eletrônica dos anos 80: bumbo curto e gordo, com ataque marcado.
  synth: { from: 140, to: 48, bend: 0.028, decay: 0.26, click: 0.65, drive: 2.4 },
  // Baile (funk, brega funk, phonk): bumbo curto, seco e estalado; o grave fica com o 808.
  baile: { from: 210, to: 64, bend: 0.014, decay: 0.085, click: 1, drive: 3.5 },
};

function kickSample(kit: Kit, variant: number) {
  const v = KICKS[kit];
  const rand = seeded(11 + variant * 7 + kit.length);
  const len = Math.floor(SR * (v.decay * 3 + 0.05));
  const out = new Float32Array(len);
  const clickFilter = new Filter("bandpass", 3200, 0.8);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = v.to + (v.from - v.to) * Math.exp(-t / v.bend);
    phase += (2 * Math.PI * f) / SR;
    const body = Math.sin(phase) * Math.exp(-t / v.decay) * Math.min(1, t / 0.0015);
    const click = clickFilter.run((rand() * 2 - 1) * Math.exp(-t / 0.004)) * v.click * 3;
    let x = Math.tanh((body + click) * v.drive) / Math.tanh(v.drive);
    if (v.crush) x = Math.round(x * v.crush) / v.crush;
    out[i] = x * 0.95;
  }
  return out;
}

function snareSample(kit: Kit, variant: number) {
  const rand = seeded(23 + variant * 13 + kit.length * 3);
  const wires = kit === "rock" ? 0.2 : kit === "break" ? 0.14 : kit === "cine" ? 0.3 : kit === "synth" ? 0.12 : kit === "baile" ? 0.09 : 0.16;
  const len = Math.floor(SR * (wires * 4 + 0.05));
  const out = new Float32Array(len);
  const band = new Filter("bandpass", kit === "break" ? 2400 : 3600, 0.6);
  const high = new Filter("highpass", 1200, 0.7);
  const tone = kit === "boom" ? [200, 340] : kit === "break" ? [230, 400] : kit === "synth" ? [210, 290] : kit === "baile" ? [250, 440] : [185, 330];
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const shell = (Math.sin(2 * Math.PI * tone[0] * t) * 0.8 + Math.sin(2 * Math.PI * tone[1] * t) * 0.5) * Math.exp(-t / 0.06);
    const n = rand() * 2 - 1;
    const noise = (band.run(n) * 1.4 + high.run(n) * 0.6) * Math.exp(-t / wires) * Math.min(1, t / 0.0008);
    const drive = kit === "break" ? 2.5 : 1.6;
    out[i] = (Math.tanh((shell * 0.9 + noise * 1.3) * drive) / Math.tanh(drive)) * 0.9;
  }
  return out;
}

function clapSample(variant: number) {
  const rand = seeded(31 + variant * 5);
  const len = Math.floor(SR * 0.45);
  const out = new Float32Array(len);
  const band = new Filter("bandpass", 1300, 0.9);
  const hits = [0, 0.009, 0.019, 0.028];
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    let env = 0;
    for (const h of hits) if (t >= h) env = Math.max(env, Math.exp(-(t - h) / (h === 0.028 ? 0.11 : 0.006)));
    out[i] = Math.tanh(band.run(rand() * 2 - 1) * env * 3) * 0.85;
  }
  return out;
}

/** Pratos e chimbal: seis osciladores quadrados em frequências desencontradas (o metal) mais ruído. */
function metalSample(kind: "hat" | "open" | "ride" | "crash", variant: number) {
  const rand = seeded(41 + variant * 17 + kind.length * 101);
  const decay = { hat: 0.045, open: 0.35, ride: 1.1, crash: 1.7 }[kind];
  const len = Math.floor(SR * Math.min(3.2, decay * 3.2 + 0.03));
  const out = new Float32Array(len);
  const ratios = [2.0, 3.0, 4.16, 5.43, 6.79, 8.21];
  const base = (kind === "ride" ? 380 : 330) * (1 + (rand() - 0.5) * 0.04);
  const phases = ratios.map(() => rand());
  const hp = new Filter("highpass", kind === "ride" ? 4500 : 6500, 0.7);
  const hp2 = new Filter("highpass", kind === "ride" ? 4500 : 6500, 0.7);
  const peak = new Filter("peaking", kind === "ride" ? 5500 : 10000, 1, 5);
  const noiseHp = new Filter("highpass", 7000, 0.7);
  const metalMix = kind === "crash" ? 0.35 : kind === "ride" ? 0.7 : 0.55;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    let metal = 0;
    for (let k = 0; k < ratios.length; k++) {
      const p = (phases[k] + (base * ratios[k] * i) / SR) % 1;
      metal += p < 0.5 ? 1 : -1;
    }
    metal /= ratios.length;
    const env = Math.exp(-t / decay) * Math.min(1, t / (kind === "crash" ? 0.004 : 0.0005));
    const ping = kind === "ride" ? Math.sin(2 * Math.PI * 2900 * t) * Math.exp(-t / 0.25) * 0.15 : 0;
    const x = hp2.run(hp.run(metal * metalMix + noiseHp.run(rand() * 2 - 1) * (1 - metalMix)));
    out[i] = (peak.run(x) * env + ping) * (kind === "hat" ? 1.3 : 1);
  }
  return out;
}

/** Atabaque do tamborzão: couro grave com o tapa (ruído na região do estalo) no ataque. */
function tamborSample(note: number, slap: boolean, variant: number) {
  const rand = seeded(61 + variant * 3 + note * 7 + (slap ? 1 : 0));
  const len = Math.floor(SR * (slap ? 0.25 : 0.45));
  const out = new Float32Array(len);
  const f0 = freqOf(note);
  const crack = new Filter("bandpass", slap ? 1900 : 900, 1.2);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    phase += (2 * Math.PI * f0 * (1 + 0.35 * Math.exp(-t / 0.012))) / SR;
    const skin = Math.sin(phase) * Math.exp(-t / (slap ? 0.06 : 0.16));
    const hit = crack.run(rand() * 2 - 1) * Math.exp(-t / (slap ? 0.018 : 0.008)) * (slap ? 2.6 : 1.2);
    out[i] = Math.tanh((skin + hit) * 1.8) * 0.85;
  }
  return out;
}

/** Cowbell de bateria eletrônica (o do phonk): duas quadradas na razão ~1,48, filtradas e saturadas. */
function cowbellSample(note: number) {
  const len = Math.floor(SR * 0.6);
  const out = new Float32Array(len);
  const f = freqOf(note);
  const band = new Filter("bandpass", f * 1.9, 1.4);
  const low = new Filter("lowpass", 6500, 0.7);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const a = ((f * i) / SR) % 1 < 0.5 ? 1 : -1;
    const b = ((f * 1.48 * i) / SR) % 1 < 0.5 ? 1 : -1;
    // Ataque estalado e a "cauda" curta do metal.
    const env = Math.exp(-t / 0.035) * 0.65 + Math.exp(-t / 0.18) * 0.35;
    out[i] = Math.tanh(low.run(band.run((a + b) * 0.5)) * env * 3.2) * 0.8;
  }
  return out;
}

function tomSample(note: number, variant: number) {
  const rand = seeded(53 + variant + note);
  const len = Math.floor(SR * 0.7);
  const out = new Float32Array(len);
  const f0 = freqOf(note);
  const low = new Filter("lowpass", 1500, 0.7);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    phase += (2 * Math.PI * f0 * (1 + 0.6 * Math.exp(-t / 0.03))) / SR;
    out[i] = Math.tanh((Math.sin(phase) * Math.exp(-t / 0.22) + low.run(rand() * 2 - 1) * Math.exp(-t / 0.03) * 0.5) * 1.6) * 0.9;
  }
  return out;
}

/** Tambor japonês grande / tímpano (cinema). */
function taikoSample(note: number, variant: number) {
  const rand = seeded(61 + variant + note);
  const len = Math.floor(SR * 2.2);
  const out = new Float32Array(len);
  const f0 = freqOf(note);
  const low = new Filter("lowpass", 900, 0.8);
  let phase = 0;
  let phase2 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    phase += (2 * Math.PI * f0 * (1 + 0.35 * Math.exp(-t / 0.05))) / SR;
    phase2 += (2 * Math.PI * f0 * 1.58) / SR;
    const skin = Math.sin(phase) * Math.exp(-t / 0.55) + Math.sin(phase2) * Math.exp(-t / 0.25) * 0.3;
    const slap = low.run(rand() * 2 - 1) * Math.exp(-t / 0.05);
    out[i] = Math.tanh((skin + slap * 0.8) * 1.8) * 0.9;
  }
  return out;
}

// --- Cordas (Karplus-Strong) ---------------------------------------------------------

/**
 * Corda dedilhada: um pedaço de ruído (a palhetada) circulando numa linha de
 * atraso do tamanho do período, perdendo agudos a cada volta. `mute` é o
 * abafado com a palma da mão (morre rápido e fica grave).
 */
function pluck(note: number, seconds: number, mute: boolean, seed: number, bright = 0.6) {
  const rand = seeded(seed);
  const f = freqOf(note);
  const period = SR / f;
  const size = Math.ceil(period) + 2;
  const line = new Float32Array(size);
  // Palhetada: ruído suavizado (menos brilho, menos agudo) e "posição da palheta" (pente).
  let smooth = 0;
  const pick = Math.max(1, Math.floor(period * 0.13));
  const burst = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    smooth += (rand() * 2 - 1 - smooth) * bright;
    burst[i] = smooth;
  }
  for (let i = 0; i < size; i++) line[i] = burst[i] - (i >= pick ? burst[i - pick] : 0);
  const len = Math.floor(SR * seconds);
  const out = new Float32Array(len);
  const loss = mute ? 0.86 : 0.9965;
  const damp = mute ? 0.28 : 0.5;
  let write = 0;
  let last = 0;
  for (let i = 0; i < len; i++) {
    // Leitura fracionária (interpolação linear) para a afinação certa.
    const readPos = write - period;
    const r = ((readPos % size) + size) % size;
    const i0 = Math.floor(r);
    const frac = r - i0;
    const y = line[i0] * (1 - frac) + line[(i0 + 1) % size] * frac;
    const filtered = (y * (1 - damp) + last * damp) * loss;
    last = filtered;
    line[write % size] = filtered;
    write++;
    out[i] = y;
  }
  return out;
}

/** Power chord (tônica, quinta e oitava) já somado, com as cordas um tiquinho atrasadas (palhetada para baixo). */
function powerChordSample(root: number, mute: boolean, variant: number, intervals: number[]) {
  const seconds = mute ? 0.3 : 2.4;
  const len = Math.floor(SR * seconds);
  const out = new Float32Array(len);
  intervals.forEach((interval, k) => {
    const offset = Math.floor(SR * 0.0035 * k);
    const string = pluck(root + interval, seconds, mute, 1000 + root * 31 + k * 7 + variant * 131 + (mute ? 5 : 0), mute ? 0.45 : 0.7);
    for (let i = 0; i + offset < len; i++) out[i + offset] += string[i] * (k === 0 ? 1 : 0.8);
  });
  return out;
}

/** Piano elétrico/acústico simplificado: parciais com leve desarmonia e decaimentos diferentes, mais o martelo. */
function pianoSample(note: number) {
  const rand = seeded(note * 97);
  const f = freqOf(note);
  const len = Math.floor(SR * 3);
  const out = new Float32Array(len);
  const partials = 10;
  const hammer = new Filter("bandpass", Math.min(4000, f * 6), 1);
  for (let k = 1; k <= partials; k++) {
    const fk = f * k * Math.sqrt(1 + 0.0004 * k * k);
    if (fk > SR * 0.45) break;
    const amp = (1 / k ** 1.3) * (k === 1 ? 1 : 0.8);
    const decay = 2.2 / (1 + k * 0.45) * (f > 600 ? 0.6 : 1);
    const detune = 1 + (rand() - 0.5) * 0.0008;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      out[i] += Math.sin(2 * Math.PI * fk * detune * t) * amp * Math.exp(-t / decay);
    }
  }
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    out[i] = (out[i] + hammer.run(rand() * 2 - 1) * Math.exp(-t / 0.01) * 0.3) * Math.min(1, t / 0.002) * 0.35;
  }
  return out;
}

/** Estalos de vinil (cama dos beats de hip-hop). */
function crackleSample() {
  const rand = seeded(7);
  const len = SR * 4;
  const out = new Float32Array(len);
  const hiss = new Filter("bandpass", 5000, 0.5);
  for (let i = 0; i < len; i++) out[i] = hiss.run(rand() * 2 - 1) * 0.02;
  for (let k = 0; k < 140; k++) {
    const at = Math.floor(rand() * (len - 200));
    const amp = rand() ** 3 * 0.6;
    for (let j = 0; j < 30; j++) out[at + j] += (rand() * 2 - 1) * amp * Math.exp(-j / 6);
  }
  return out;
}

/** Caixa de amplificador 4x12 (resposta ao impulso): grave ressonante, médio presente, corta acima de ~5 kHz. */
function cabinetIR() {
  const len = 1536;
  const out = new Float32Array(len);
  const chain = [
    new Filter("highpass", 85, 0.8),
    new Filter("peaking", 115, 1.3, 5),
    new Filter("peaking", 420, 1, -3),
    new Filter("peaking", 2300, 1.6, 4),
    new Filter("lowpass", 4800, 0.9),
    new Filter("lowpass", 5600, 0.7),
  ];
  for (let i = 0; i < len; i++) {
    // Impulso mais duas reflexões curtas dentro da caixa.
    let x = i === 0 ? 1 : i === 37 ? 0.32 : i === 89 ? -0.18 : 0;
    for (const f of chain) x = f.run(x);
    out[i] = x * Math.min(1, (len - i) / 300);
  }
  return out;
}

/** Sala/placa de reverberação (estéreo, cauda escurecendo). */
function reverbIR(seconds: number, decay: number) {
  const rand = seeded(99);
  const len = Math.floor(SR * seconds);
  const channels = [new Float32Array(len), new Float32Array(len)];
  for (const data of channels) {
    let low = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      low += (rand() * 2 - 1 - low) * (0.55 * Math.exp(-t * 2.5) + 0.06);
      data[i] = low * Math.exp(-t * decay) * Math.min(1, t / 0.008);
    }
  }
  return channels;
}

/**
 * Reverberação com portão: uma sala grande que corta seca em ~0,24 s (a caixa
 * dos anos 80). Ruído denso e quase plano, com a queda brusca no fim.
 */
function gatedIR() {
  const rand = seeded(77);
  const len = Math.floor(SR * 0.26);
  const channels = [new Float32Array(len), new Float32Array(len)];
  for (const data of channels) {
    let low = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      low += (rand() * 2 - 1 - low) * 0.5;
      const env = Math.min(1, t / 0.006) * (t < 0.2 ? 1 - t * 1.2 : Math.max(0, 0.76 * (1 - (t - 0.2) / 0.06)));
      data[i] = low * env * 0.5;
    }
  }
  return channels;
}

function distortionCurve(drive: number, asym = 0.1) {
  const curve = new Float32Array(2048);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * (x + asym * x * x)) / Math.tanh(drive);
  }
  return curve;
}

/** Linear até 0,7; acima, curva até no máximo 0,98 (entrada até 2, ou seja, +6 dB). */
function softClipCurve() {
  const curve = new Float32Array(4097);
  for (let i = 0; i < curve.length; i++) {
    const x = ((i / (curve.length - 1)) * 2 - 1) * 2;
    const a = Math.abs(x);
    curve[i] = Math.sign(x) * (a < 0.7 ? a : 0.7 + 0.28 * Math.tanh((a - 0.7) / 0.28));
  }
  return curve;
}

// --- A banda ------------------------------------------------------------------------

export interface BandOptions {
  bpm: number;
  /** 0 = reto, 0,5 = bem suingado (nas semicolcheias pares). */
  swing?: number;
  kit: Kit;
  /** Bombeamento do sidechain (eletrônicas): quanto o bumbo "abaixa" teclados e baixo. */
  pump?: number;
  /** Ganho de distorção das guitarras. */
  drive?: number;
  /** Ganho final (acerta a altura de cada faixa: todas soam igualmente altas). */
  trim?: number;
  /** "Fita": saturação leve e agudos arredondados no mestre (o calor do synthwave). */
  tape?: number;
  /** Mestre escuro (Hz): corta o agudo de tudo, como o som abafado do phonk e do funk de paredão. */
  lowpass?: number;
}

type Out = AudioNode;

/** Instrumentos (todos recebem o instante como primeiro argumento). */
const DEFERRED = [
  "kick", "snare", "clap", "hat", "ride", "crash", "tom", "taiko", "crackle", "chord", "guitarLead", "bass", "sub",
  "acid", "reese", "saws", "lead", "stab", "strings", "spiccato", "brass", "braam", "choir", "piano", "pizz", "bell",
  "riser", "hit", "scratch", "arp", "ep", "simmons", "pad", "tambor", "cowbell", "boom", "vox",
] as const;

export class Band {
  readonly ctx: OfflineAudioContext;
  readonly bpm: number;
  readonly beat: number;
  readonly barTime: number;
  private swing: number;
  private kit: Kit;
  private pump: number;
  private master: GainNode;
  private drums: GainNode;
  private bassBus: GainNode;
  private keys: GainNode;
  private pumped: GainNode;
  /** Amplificadores, coro e portão só existem se a faixa usar (convolvers custam CPU mesmo em silêncio). */
  private amps: [GainNode, GainNode] | null = null;
  private chorusBus: GainNode | null = null;
  private gateBus: GainNode | null = null;
  private drive: number;
  private clean: GainNode;
  private reverb: GainNode;
  private delay: GainNode;
  private noise: AudioBuffer;
  private variant = 0;
  /** Coro/ensemble analógico (teclados, metais e solos do synthwave). */

  /** Envio para a reverberação com portão. */

  /** Transposição em semitons (troca de tom no último refrão, por exemplo). */
  shift = 0;
  /**
   * Com uma fila, os instrumentos não criam os nós na hora: só anotam o que
   * tocar e quando. O gravador cria os nós compasso a compasso (music.ts), para
   * não travar a tela montando milhares de nós de uma vez.
   */
  queue: { t: number; run: () => void }[] | null = null;

  constructor(ctx: OfflineAudioContext, o: BandOptions) {
    this.ctx = ctx;
    this.bpm = o.bpm;
    this.beat = 60 / o.bpm;
    this.barTime = this.beat * 4;
    this.swing = o.swing ?? 0;
    this.kit = o.kit;
    this.pump = o.pump ?? 0;

    // Mestre: compressor "cola" e limitador.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -14;
    glue.knee.value = 8;
    glue.ratio.value = 2.5;
    glue.attack.value = 0.012;
    glue.release.value = 0.15;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.08;
    this.master = ctx.createGain();
    const trim = ctx.createGain();
    trim.gain.value = o.trim ?? 1;
    // Por último, um corte suave: o que passar de ~-3 dBFS é arredondado, nunca estoura.
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = "none";
    // (O WaveShaper lê a entrada de -1 a 1: metade antes, e a curva cobre de -2 a 2.)
    trim.gain.value = (o.trim ?? 1) * 0.5;
    const chain: AudioNode[] = [glue, limiter, trim, clip, ctx.destination];
    if (o.tape) {
      // Fita: um pouco de saturação e o agudo caindo devagar acima de ~13 kHz.
      const warm = ctx.createWaveShaper();
      warm.curve = distortionCurve(1 + o.tape, 0.04);
      const roll = ctx.createBiquadFilter();
      roll.type = "lowpass";
      roll.frequency.value = 13500;
      roll.Q.value = 0.5;
      chain.unshift(warm, roll);
    }
    if (o.lowpass) {
      const dark = ctx.createBiquadFilter();
      dark.type = "lowpass";
      dark.frequency.value = o.lowpass;
      dark.Q.value = 0.6;
      chain.unshift(dark);
    }
    chain.reduce((from, to) => from.connect(to), this.master as AudioNode);

    this.reverb = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = sample("reverb", () => reverbIR(LITE ? 1.1 : 2.2, LITE ? 3.2 : 2.6));
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.55;
    this.reverb.connect(conv).connect(reverbReturn).connect(this.master);


    // Eco pingue-pongue em colcheia pontuada.
    this.delay = ctx.createGain();
    const left = ctx.createDelay(2);
    const right = ctx.createDelay(2);
    left.delayTime.value = right.delayTime.value = this.beat * 0.75;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 3000;
    const pl = ctx.createStereoPanner();
    pl.pan.value = -0.7;
    const pr = ctx.createStereoPanner();
    pr.pan.value = 0.7;
    this.delay.connect(left);
    left.connect(pl).connect(this.master);
    left.connect(right);
    right.connect(pr).connect(this.master);
    right.connect(damp).connect(feedback).connect(left);

    // Bateria com compressão própria (soco).
    this.drums = ctx.createGain();
    const drumComp = ctx.createDynamicsCompressor();
    drumComp.threshold.value = -16;
    drumComp.ratio.value = 4;
    drumComp.attack.value = 0.006;
    drumComp.release.value = 0.1;
    drumComp.knee.value = 4;
    this.drums.connect(drumComp).connect(this.master);

    // Baixo e teclados passam pelo "pumped" (sidechain do bumbo).
    this.pumped = ctx.createGain();
    this.pumped.connect(this.master);
    this.bassBus = ctx.createGain();
    this.bassBus.connect(this.pumped);
    this.keys = ctx.createGain();
    this.keys.connect(this.pumped);
    this.clean = ctx.createGain();
    this.clean.connect(this.master);

    this.drive = o.drive ?? 18;
    this.noise = sample("noise", () => {
      const rand = seeded(5);
      const data = new Float32Array(SR * 2);
      for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;
      return data;
    });

    // Todos os instrumentos passam pela fila (ver `queue`).
    for (const name of DEFERRED) {
      const original = (this as unknown as Record<string, (...a: unknown[]) => void>)[name];
      (this as unknown as Record<string, unknown>)[name] = (t: number, ...rest: unknown[]) => {
        if (this.queue) this.queue.push({ t, run: () => original.call(this, t, ...rest) });
        else original.call(this, t, ...rest);
      };
    }
  }

  private get chorus(): GainNode {
    if (this.chorusBus) return this.chorusBus;
    const ctx = this.ctx;
    // Coro analógico: o som seco mais duas cópias com atraso curto oscilando
    // devagar (uma de cada lado). Sai pelo "pumped" (respira com o bumbo).
    const chorus = ctx.createGain();
    chorus.connect(this.pumped);
    for (const [pan, base, rate] of (LITE ? [[0, 0.013, 0.6]] : [[-0.8, 0.011, 0.53], [0.8, 0.016, 0.71]]) as [number, number, number][]) {
      const delay = ctx.createDelay(0.05);
      delay.delayTime.value = base;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const depth = ctx.createGain();
      depth.gain.value = 0.0028;
      lfo.connect(depth).connect(delay.delayTime);
      lfo.start(0);
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      const g = ctx.createGain();
      g.gain.value = 0.8;
      chorus.connect(delay).connect(g).connect(p).connect(this.pumped);
    }

    return (this.chorusBus = chorus);
  }

  private get gate(): GainNode {
    if (this.gateBus) return this.gateBus;
    const gate = this.ctx.createGain();
    const gated = this.ctx.createConvolver();
    gated.buffer = sample("gated", gatedIR);
    gate.connect(gated).connect(this.master);
    return (this.gateBus = gate);
  }

  private get guitarL(): GainNode {
    return (this.amps ??= this.buildAmps())[0];
  }

  private get guitarR(): GainNode {
    return (this.amps ??= this.buildAmps())[1];
  }

  private buildAmps(): [GainNode, GainNode] {
    const ctx = this.ctx;
    // Duas guitarras (esquerda e direita), cada uma com amplificador e caixa.
    const drive = this.drive;
    const cab = sample("cabinet", cabinetIR);
    const makeAmp = (pan: number) => {
      const input = ctx.createGain();
      const tight = ctx.createBiquadFilter();
      tight.type = "highpass";
      tight.frequency.value = 110;
      const pre = ctx.createBiquadFilter();
      pre.type = "peaking";
      pre.frequency.value = 900;
      pre.gain.value = 6;
      const shaper = ctx.createWaveShaper();
      shaper.curve = distortionCurve(drive);
      shaper.oversample = LITE ? "none" : "4x";
      const scoop = ctx.createBiquadFilter();
      scoop.type = "peaking";
      scoop.frequency.value = 650;
      scoop.Q.value = 0.9;
      scoop.gain.value = -5;
      const box = ctx.createConvolver();
      box.normalize = true;
      box.buffer = cab;
      const air = ctx.createBiquadFilter();
      air.type = "lowpass";
      air.frequency.value = 7500;
      const level = ctx.createGain();
      level.gain.value = 5;
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      input.connect(tight).connect(pre).connect(shaper).connect(scoop).connect(box).connect(air).connect(level).connect(panner).connect(this.master);
      const send = ctx.createGain();
      send.gain.value = 0.08;
      panner.connect(send).connect(this.reverb);
      return input;
    };
    return [makeAmp(-0.8), makeAmp(0.8)] as [GainNode, GainNode];
  }

  /** Nota com a transposição do momento. */
  private p(note: number) {
    return note + this.shift;
  }

  /** Instante (s) da semicolcheia `step` (0-15) do compasso `bar`, com suingue. */
  at(bar: number, step = 0) {
    const sixteenth = this.beat / 4;
    const swing = step % 2 === 1 ? this.swing * sixteenth * 0.5 : 0;
    return bar * this.barTime + step * sixteenth + swing;
  }

  /** Duração de `steps` semicolcheias. */
  len(steps: number) {
    return (this.beat / 4) * steps;
  }

  private next() {
    return (this.variant = (this.variant + 1) % 4);
  }

  private play(buffer: AudioBuffer, t: number, gain: number, dest: Out, opts: { pan?: number; rate?: number; dur?: number; send?: number } = {}) {
    if (t < 0) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    if (opts.rate) src.playbackRate.value = opts.rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    let node: AudioNode = src.connect(g);
    if (opts.pan) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = opts.pan;
      node = node.connect(p);
    }
    node.connect(dest);
    if (opts.send) {
      const s = this.ctx.createGain();
      s.gain.value = opts.send;
      node.connect(s).connect(this.reverb);
    }
    if (opts.dur !== undefined) {
      g.gain.setValueAtTime(gain, t + opts.dur);
      g.gain.linearRampToValueAtTime(0, t + opts.dur + 0.03);
      src.start(t);
      src.stop(t + opts.dur + 0.05);
    } else src.start(t);
  }

  /** Sidechain: o bumbo "puxa" baixo e teclados para baixo e eles voltam no tempo de uma colcheia. */
  private duck(t: number) {
    if (!this.pump) return;
    const g = this.pumped.gain;
    g.setValueAtTime(1 - this.pump, t);
    g.linearRampToValueAtTime(1, t + this.beat * 0.55);
  }

  // --- Bateria ---
  kick(t: number, vel = 1) {
    const v = this.next() % 2;
    this.play(sample(`kick:${this.kit}:${v}`, () => kickSample(this.kit, v)), t, 0.95 * vel, this.drums);
    this.duck(t);
  }

  snare(t: number, vel = 1) {
    const v = this.next() % 3;
    this.play(sample(`snare:${this.kit}:${v}`, () => snareSample(this.kit, v)), t, 0.75 * vel, this.drums, { send: this.kit === "boom" ? 0.35 : this.kit === "synth" ? 0.05 : 0.2 });
    if (this.kit === "synth") this.play(sample(`snare:${this.kit}:${v}`, () => snareSample(this.kit, v)), t, 0.6 * vel, this.gate);
  }

  clap(t: number, vel = 1) {
    const v = this.next() % 2;
    this.play(sample(`clap:${v}`, () => clapSample(v)), t, 0.9 * vel, this.drums, { send: 0.25, pan: 0.05 });
  }

  hat(t: number, vel = 0.6, open = false) {
    const v = this.next() % 3;
    const kind = open ? "open" : "hat";
    this.play(sample(`${kind}:${v}`, () => metalSample(kind, v)), t, 0.5 * vel, this.drums, { pan: 0.25, dur: open ? undefined : 0.12 });
  }

  ride(t: number, vel = 0.6) {
    const v = this.next() % 2;
    this.play(sample(`ride:${v}`, () => metalSample("ride", v)), t, 0.22 * vel, this.drums, { pan: -0.3 });
  }

  crash(t: number, vel = 0.8, pan = 0.4) {
    const v = this.next() % 2;
    this.play(sample(`crash:${v}`, () => metalSample("crash", v)), t, 0.3 * vel, this.drums, { pan, send: 0.2 });
  }

  tom(t: number, note: number, vel = 0.8) {
    this.play(sample(`tom:${note}`, () => tomSample(note, 0)), t, 0.4 * vel, this.drums, { pan: (note - 45) / 20, send: 0.15 });
  }

  taiko(t: number, note = 38, vel = 1) {
    this.play(sample(`taiko:${note}`, () => taikoSample(note, 0)), t, 0.8 * vel, this.drums, { send: 0.4 });
  }

  crackle(t: number, dur: number) {
    const buffer = sample("crackle", crackleSample);
    for (let at = t; at < t + dur; at += buffer.duration) this.play(buffer, at, 0.5, this.clean, { dur: Math.min(buffer.duration, t + dur - at) });
  }

  // --- Guitarras ---
  /**
   * Power chord nas duas guitarras (esquerda e direita, palhetadas diferentes).
   * `mute`: abafado com a palma (o "tchug"). `dur` em segundos.
   */
  chord(t: number, root: number, dur: number, mute = false, vel = 1, intervals = [0, 7, 12]) {
    root = this.p(root);
    const notes = mute ? intervals.slice(0, 2) : intervals;
    for (const [side, out] of [[0, this.guitarL], [1, this.guitarR]] as const) {
      const v = (this.next() + side * 2) % 4;
      const key = `pc:${root}:${notes.join(",")}:${mute}:${v}`;
      const buffer = sample(key, () => powerChordSample(root, mute, v, notes));
      this.play(buffer, t + side * 0.006, (mute ? 0.9 : 0.75) * vel, out, { dur: Math.min(dur, buffer.duration - 0.05) });
    }
  }

  /** Nota única de guitarra solo (lado `pan`), com eco e sala. */
  guitarLead(t: number, note: number, dur: number, vel = 1) {
    note = this.p(note);
    const key = `lead:${note}`;
    const buffer = sample(key, () => pluck(note, 2.5, false, note * 17, 0.8));
    // O solo passa pela guitarra da esquerda e da direita, mais o eco.
    for (const out of [this.guitarL, this.guitarR]) this.play(buffer, t, 0.22 * vel, out, { dur: Math.min(dur, 2.4) });
    const s = this.ctx.createGain();
    s.gain.value = 0.5 * vel;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(s).connect(this.delay);
    src.start(t);
    src.stop(t + Math.min(dur, 2.4));
  }

  // --- Baixos ---
  /** Baixo elétrico de palheta (corda dedilhada grave, saturada). */
  bass(t: number, note: number, dur: number, vel = 1, mute = false) {
    note = this.p(note);
    const v = this.next() % 2;
    const buffer = sample(`bass:${note}:${mute}:${v}`, () => {
      const raw = pluck(note, mute ? 0.4 : 2, mute, note * 7 + v, 0.85);
      const low = new Filter("lowpass", 2200, 0.7);
      return raw.map((x) => Math.tanh(low.run(x) * 2.2) * 0.7);
    });
    this.play(buffer, t, 0.75 * vel, this.bassBus, { dur: Math.min(dur, buffer.duration - 0.05) });
  }

  /** 808: senoide grave longa, com deslizada opcional desde `from`. */
  sub(t: number, note: number, dur: number, vel = 1, from?: number) {
    note = this.p(note);
    if (from !== undefined) from = this.p(from);
    const osc = this.ctx.createOscillator();
    const f = freqOf(note);
    osc.frequency.setValueAtTime(from !== undefined ? freqOf(from) : f * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(f, t + (from !== undefined ? 0.09 : 0.03));
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = distortionCurve(2.2, 0);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.45 * vel, t + 0.005);
    g.gain.setTargetAtTime(0.3 * vel, t + 0.05, 0.25);
    g.gain.setValueAtTime(0.3 * vel, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.06);
    osc.connect(shaper).connect(g).connect(this.bassBus);
    osc.start(t);
    osc.stop(t + dur + 0.1);
  }

  /** Baixo ácido (303): serra no passa-baixa ressonante, com envelope e acento. */
  acid(t: number, note: number, dur: number, accent = false, cutoff = 900, slideTo?: number) {
    note = this.p(note);
    if (slideTo !== undefined) slideTo = this.p(slideTo);
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freqOf(note), t);
    if (slideTo !== undefined) osc.frequency.setTargetAtTime(freqOf(slideTo), t + dur * 0.6, 0.03);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = accent ? 16 : 11;
    const peak = cutoff * (accent ? 3.2 : 2);
    f.frequency.setValueAtTime(peak, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.5), t + dur + 0.08);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = distortionCurve(3, 0);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(accent ? 0.32 : 0.22, t + 0.004);
    g.gain.setValueAtTime(accent ? 0.28 : 0.2, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
    osc.connect(f).connect(shaper).connect(g).connect(this.bassBus);
    const s = this.ctx.createGain();
    s.gain.value = 0.12;
    g.connect(s).connect(this.delay);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** "Reese": duas serras quase iguais (batimento), sub e filtro. */
  reese(t: number, note: number, dur: number, vel = 1, cutoff = 800) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12 * vel, t + 0.01);
    g.gain.setValueAtTime(0.12 * vel, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 2;
    f.frequency.setValueAtTime(cutoff * 0.6, t);
    f.frequency.linearRampToValueAtTime(cutoff * 1.5, t + dur);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = distortionCurve(2, 0);
    f.connect(shaper).connect(g).connect(this.bassBus);
    for (const cents of [-14, 14]) {
      const o = this.ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freqOf(this.p(note));
      o.detune.value = cents;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
    this.sub(t, note - 12, dur, vel * 0.6);
  }

  // --- Teclados e sintetizadores ---
  /** Serras empilhadas e desafinadas (supersaw), abertas em estéreo. */
  saws(t: number, notes: number[], dur: number, o: { vel?: number; cutoff?: number; attack?: number; release?: number; voices?: number; detune?: number; send?: number; echo?: number; pump?: boolean; sweep?: number; chorus?: boolean; q?: number } = {}) {
    const vel = o.vel ?? 1;
    const attack = o.attack ?? 0.01;
    const release = o.release ?? 0.2;
    const voices = LITE ? Math.min(2, o.voices ?? 4) : o.voices ?? 4;
    notes = notes.map((n) => this.p(n));
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = o.q ?? 0.8;
    f.frequency.setValueAtTime(o.cutoff ?? 3000, t);
    if (o.sweep) f.frequency.exponentialRampToValueAtTime(o.sweep, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime((0.2 * vel) / Math.sqrt(notes.length), t + attack);
    g.gain.setValueAtTime((0.2 * vel) / Math.sqrt(notes.length), t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + release);
    f.connect(g).connect(o.chorus ? this.chorus : o.pump === false ? this.clean : this.keys);
    if (o.send) {
      const s = this.ctx.createGain();
      s.gain.value = o.send;
      g.connect(s).connect(this.reverb);
    }
    if (o.echo) {
      const s = this.ctx.createGain();
      s.gain.value = o.echo;
      g.connect(s).connect(this.delay);
    }
    for (const note of notes) {
      for (let v = 0; v < voices; v++) {
        const osc = this.ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = freqOf(note);
        osc.detune.value = voices > 1 ? ((v / (voices - 1)) * 2 - 1) * (o.detune ?? 14) : 0;
        const p = this.ctx.createStereoPanner();
        p.pan.value = voices > 1 ? ((v / (voices - 1)) * 2 - 1) * 0.7 : 0;
        osc.connect(p).connect(f);
        osc.start(t);
        osc.stop(t + dur + release + 0.05);
      }
    }
  }

  /** Solo de sintetizador: quadrada + serra, vibrato, eco. */
  lead(t: number, note: number, dur: number, o: { vel?: number; glideFrom?: number; cutoff?: number; echo?: number; type?: OscillatorType; porta?: number; chorus?: boolean; vibrato?: number; vibratoRate?: number } = {}) {
    note = this.p(note);
    const glideFrom = o.glideFrom !== undefined ? this.p(o.glideFrom) : undefined;
    const vel = o.vel ?? 1;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.13 * vel, t + 0.01);
    g.gain.setValueAtTime(0.12 * vel, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.08);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = o.cutoff ?? 3500;
    f.connect(g).connect(o.chorus ? this.chorus : this.clean);
    const echo = this.ctx.createGain();
    echo.gain.value = o.echo ?? 0.3;
    g.connect(echo).connect(this.delay);
    const rev = this.ctx.createGain();
    rev.gain.value = 0.2;
    g.connect(rev).connect(this.reverb);
    const vib = this.ctx.createOscillator();
    vib.frequency.value = o.vibratoRate ?? 5.6;
    const depth = this.ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(freqOf(note) * 0.007 * (o.vibrato ?? 1), t + Math.min(0.35, dur));
    vib.connect(depth);
    vib.start(t);
    vib.stop(t + dur + 0.1);
    for (const [type, cents] of [[o.type ?? "square", -6], ["sawtooth", 6]] as const) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      // Portamento: a nota escorrega desde a anterior (o solo "cantado" dos anos 80).
      osc.frequency.setValueAtTime(freqOf(glideFrom ?? note), t);
      if (glideFrom !== undefined) osc.frequency.setTargetAtTime(freqOf(note), t, o.porta ?? 0.03);
      osc.detune.value = cents;
      depth.connect(osc.frequency);
      osc.connect(f);
      osc.start(t);
      osc.stop(t + dur + 0.1);
    }
  }

  /** Acorde curto de metais/sintetizador ("stab"), com o filtro fechando rápido. */
  stab(t: number, notes: number[], dur = 0.18, vel = 1, bright = 4000) {
    this.saws(t, notes, dur, { vel: vel * 1.6, cutoff: bright, sweep: 600, release: 0.08, voices: 3, send: 0.25, echo: 0.12 });
  }

  /** Cordas de orquestra: serras com ataque lento, vibrato leve e muita sala. */
  strings(t: number, notes: number[], dur: number, vel = 1, attack = 0.4) {
    this.saws(t, notes, dur, { vel: vel * 0.8, cutoff: 2200, attack, release: 0.6, voices: 3, detune: 10, send: 0.6, pump: false });
  }

  /** Cordas curtas (staccato/ostinato). */
  spiccato(t: number, note: number, vel = 1) {
    this.saws(t, [note, note + 12], this.len(1) * 0.8, { vel: vel * 1.3, cutoff: 2600, sweep: 900, attack: 0.004, release: 0.05, voices: 2, send: 0.3, pump: false });
  }

  /** Metais: serras com o filtro abrindo no ataque e fechando. */
  brass(t: number, notes: number[], dur: number, vel = 1, chorus = false) {
    notes = notes.map((n) => this.p(n));
    const g = this.ctx.createGain();
    const peak = 0.17 * vel / Math.sqrt(notes.length);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.04);
    g.gain.setValueAtTime(peak * 0.85, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.15);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 1.5;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2800, t + 0.07);
    f.frequency.exponentialRampToValueAtTime(1300, t + Math.max(0.1, dur));
    f.connect(g).connect(chorus ? this.chorus : this.clean);
    const s = this.ctx.createGain();
    s.gain.value = 0.45;
    g.connect(s).connect(this.reverb);
    for (const note of notes) {
      for (const cents of [-7, 7]) {
        const osc = this.ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = freqOf(note);
        osc.detune.value = cents;
        osc.connect(f);
        osc.start(t);
        osc.stop(t + dur + 0.2);
      }
    }
  }

  /** "Braam" de trailer: metais graves saturados abrindo devagar. */
  braam(t: number, notes: number[], dur: number, vel = 1) {
    notes = notes.map((n) => this.p(n));
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 3;
    f.frequency.setValueAtTime(180, t);
    f.frequency.exponentialRampToValueAtTime(1600, t + 0.35);
    f.frequency.exponentialRampToValueAtTime(500, t + dur);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = distortionCurve(4, 0.05);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16 * vel, t + 0.05);
    g.gain.setValueAtTime(0.14 * vel, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.4);
    f.connect(shaper).connect(g).connect(this.clean);
    const s = this.ctx.createGain();
    s.gain.value = 0.6;
    g.connect(s).connect(this.reverb);
    for (const note of notes) {
      for (const cents of [-10, 0, 10]) {
        const osc = this.ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = freqOf(note);
        osc.detune.value = cents;
        osc.connect(f);
        osc.start(t);
        osc.stop(t + dur + 0.5);
      }
    }
  }

  /** Coro sem letra ("aaah"): pulso estreito passando por três formantes de vogal. */
  choir(t: number, notes: number[], dur: number, vel = 1) {
    notes = notes.map((n) => this.p(n));
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.8 * vel / Math.sqrt(notes.length), t + 0.6);
    g.gain.setValueAtTime(0.8 * vel / Math.sqrt(notes.length), t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.8);
    g.connect(this.clean);
    const s = this.ctx.createGain();
    s.gain.value = 0.9;
    g.connect(s).connect(this.reverb);
    const formants = [[700, 6, 1], [1150, 8, 0.5], [2600, 10, 0.25]];
    const mix = this.ctx.createGain();
    mix.gain.value = 1;
    for (const [freq, q, amp] of formants) {
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = freq;
      bp.Q.value = q;
      const a = this.ctx.createGain();
      a.gain.value = amp;
      mix.connect(bp).connect(a).connect(g);
    }
    for (const note of notes) {
      for (const cents of LITE ? [-9, 9] : [-9, 0, 9]) {
        const osc = this.ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = freqOf(note);
        osc.detune.value = cents;
        const vib = this.ctx.createOscillator();
        vib.frequency.value = 4.6 + cents * 0.03;
        const depth = this.ctx.createGain();
        depth.gain.value = freqOf(note) * 0.006;
        vib.connect(depth).connect(osc.frequency);
        const p = this.ctx.createStereoPanner();
        p.pan.value = cents / 14;
        osc.connect(p).connect(mix);
        for (const o of [osc, vib]) {
          o.start(t);
          o.stop(t + dur + 1);
        }
      }
    }
  }

  piano(t: number, notes: number[], dur: number, vel = 1, send = 0.35) {
    for (const note of notes.map((n) => this.p(n))) {
      const buffer = sample(`piano:${note}`, () => pianoSample(note));
      this.play(buffer, t, 0.55 * vel, this.clean, { dur: Math.min(dur, buffer.duration - 0.05), send, pan: (note - 60) / 40 });
    }
  }

  /** Pizzicato: corda curta e limpa (o "plim" de comédia). */
  pizz(t: number, note: number, vel = 1) {
    note = this.p(note);
    const buffer = sample(`pizz:${note}`, () => pluck(note, 0.6, false, note * 3 + 1, 0.9).map((x, i) => x * Math.exp(-i / (SR * 0.12))));
    this.play(buffer, t, 2.5 * vel, this.clean, { send: 0.35, pan: (note - 60) / 30 });
  }

  // --- Baile (funk, brega funk e phonk) ---
  /** Atabaque do tamborzão: `slap` é o tapa (agudo e estalado). */
  tambor(t: number, note: number, vel = 1, slap = false) {
    const v = this.next() % 2;
    this.play(sample(`tambor:${note}:${slap}:${v}`, () => tamborSample(note, slap, v)), t, 0.8 * vel, this.drums, { pan: slap ? -0.2 : 0.15, send: 0.08 });
  }

  /** Cowbell afinado (a melodia do phonk), com um pouco de eco. */
  cowbell(t: number, note: number, dur = 0.25, vel = 1) {
    note = this.p(note);
    this.play(sample(`cowbell:${note}`, () => cowbellSample(note)), t, 0.8 * vel, this.clean, { dur: Math.min(dur, 0.55), send: 0.12, pan: 0.1 });
  }

  /**
   * 808 de paredão: senoide bem grave com a saturação que dá os harmônicos (o
   * grave "aparece" até no alto-falante do celular), soco no ataque e deslize
   * de nota: desde `from` no começo e/ou para `to` no fim.
   */
  boom(t: number, note: number, dur: number, o: { vel?: number; from?: number; to?: number; drive?: number } = {}) {
    note = this.p(note);
    const vel = o.vel ?? 1;
    const f = freqOf(note);
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(o.from !== undefined ? freqOf(this.p(o.from)) : f * 1.25, t);
    osc.frequency.exponentialRampToValueAtTime(f, t + (o.from !== undefined ? 0.12 : 0.025));
    if (o.to !== undefined) {
      osc.frequency.setValueAtTime(f, t + dur * 0.55);
      osc.frequency.exponentialRampToValueAtTime(freqOf(this.p(o.to)), t + dur * 0.95);
    }
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = distortionCurve(o.drive ?? 4, 0);
    shaper.oversample = LITE ? "none" : "2x";
    // O que sobra de agudo da saturação é cortado: fica grave e encorpado, sem chiado.
    const low = this.ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 1200;
    low.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32 * vel, t + 0.004);
    g.gain.setTargetAtTime(0.22 * vel, t + 0.03, 0.18);
    g.gain.setValueAtTime(0.22 * vel, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    osc.connect(shaper).connect(low).connect(g).connect(this.bassBus);
    osc.start(t);
    osc.stop(t + dur + 0.08);
  }

  /**
   * Voz sintética (sem palavra): serra passando por três formantes de vogal, o
   * "ô", "ê", "ai" do baile; grave e com eco, como as vozes de fundo do phonk.
   */
  vox(t: number, note: number, dur: number, vowel: "a" | "e" | "o" | "u" | "ai" = "o", vel = 1) {
    note = this.p(note);
    const FORMANTS: Record<string, [number, number, number]> = { a: [800, 1150, 2900], e: [420, 1900, 2600], o: [460, 820, 2800], u: [330, 720, 2500] };
    const from = FORMANTS[vowel === "ai" ? "a" : vowel];
    const to = vowel === "ai" ? [320, 2200, 2900] : from;
    const src = this.ctx.createOscillator();
    src.type = "sawtooth";
    src.frequency.setValueAtTime(freqOf(note) * 0.97, t);
    src.frequency.exponentialRampToValueAtTime(freqOf(note), t + 0.06);
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 5;
    const depth = this.ctx.createGain();
    depth.gain.value = freqOf(note) * 0.012;
    vib.connect(depth).connect(src.frequency);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.34 * vel, t + 0.03);
    g.gain.setValueAtTime(0.3 * vel, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0, t + dur);
    from.forEach((freq, k) => {
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 9;
      bp.frequency.setValueAtTime(freq, t);
      if (to !== from) bp.frequency.linearRampToValueAtTime(to[k], t + dur * 0.8);
      const level = this.ctx.createGain();
      level.gain.value = [1, 0.6, 0.25][k];
      src.connect(bp).connect(level).connect(g);
    });
    g.connect(this.clean);
    const echo = this.ctx.createGain();
    echo.gain.value = 0.3;
    g.connect(echo).connect(this.delay);
    const rev = this.ctx.createGain();
    rev.gain.value = 0.35;
    g.connect(rev).connect(this.reverb);
    for (const o of [src, vib]) {
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  /** Sino FM (glockenspiel). */
  bell(t: number, note: number, dur = 1.2, vel = 1) {
    note = this.p(note);
    const carrier = this.ctx.createOscillator();
    carrier.frequency.value = freqOf(note);
    const mod = this.ctx.createOscillator();
    mod.frequency.value = freqOf(note) * 3.5;
    const depth = this.ctx.createGain();
    depth.gain.setValueAtTime(freqOf(note) * 2, t);
    depth.gain.exponentialRampToValueAtTime(freqOf(note) * 0.05, t + dur);
    mod.connect(depth).connect(carrier.frequency);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2 * vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    carrier.connect(g).connect(this.clean);
    const s = this.ctx.createGain();
    s.gain.value = 0.4;
    g.connect(s).connect(this.reverb);
    for (const o of [carrier, mod]) {
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  // --- Synthwave ---
  /**
   * Baixo de sintetizador (o "pulso" do synthwave): serra e quadrada juntas,
   * filtro ressonante fechando a cada nota. Tocado em semicolcheias vira arpejo.
   */
  arp(t: number, note: number, dur: number, o: { vel?: number; cutoff?: number; res?: number; decay?: number } = {}) {
    note = this.p(note);
    const vel = o.vel ?? 1;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = o.res ?? 6;
    const cutoff = o.cutoff ?? 900;
    f.frequency.setValueAtTime(cutoff * 3, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(100, cutoff * 0.5), t + (o.decay ?? 0.12));
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.24 * vel, t + 0.003);
    g.gain.setValueAtTime(0.2 * vel, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
    f.connect(g).connect(this.bassBus);
    for (const [type, cents] of [["sawtooth", 0], ["square", -8]] as const) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freqOf(note);
      osc.detune.value = cents;
      osc.connect(f);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
  }

  /** Piano elétrico FM (o teclado "de vidro" dos anos 80): portadora e moduladora, mais o "tine" agudo. */
  ep(t: number, notes: number[], dur: number, vel = 1) {
    for (const raw of notes) {
      const note = this.p(raw);
      const f = freqOf(note);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime((0.16 * vel) / Math.sqrt(notes.length), t + 0.004);
      g.gain.exponentialRampToValueAtTime((0.05 * vel) / Math.sqrt(notes.length), t + Math.min(dur, 1.2));
      g.gain.setValueAtTime((0.05 * vel) / Math.sqrt(notes.length), t + dur);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
      g.connect(this.chorus);
      const send = this.ctx.createGain();
      send.gain.value = 0.3;
      g.connect(send).connect(this.reverb);
      const carrier = this.ctx.createOscillator();
      carrier.frequency.value = f;
      const mod = this.ctx.createOscillator();
      mod.frequency.value = f;
      const index = this.ctx.createGain();
      index.gain.setValueAtTime(f * 1.6, t);
      index.gain.exponentialRampToValueAtTime(f * 0.15, t + 0.6);
      mod.connect(index).connect(carrier.frequency);
      carrier.connect(g);
      const tine = this.ctx.createOscillator();
      tine.frequency.value = f * 14;
      const tg = this.ctx.createGain();
      tg.gain.setValueAtTime(0.25, t);
      tg.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      tine.connect(tg).connect(g);
      for (const o of [carrier, mod, tine]) {
        o.start(t);
        o.stop(t + dur + 0.35);
      }
    }
  }

  /** Teclado de fundo analógico: serras largas com o coro, ataque lento. */
  pad(t: number, notes: number[], dur: number, vel = 1, cutoff = 2200) {
    this.saws(t, notes, dur, { vel: vel * 0.85, cutoff, attack: Math.min(0.6, dur * 0.3), release: 0.8, voices: 3, detune: 16, send: 0.45, chorus: true });
  }

  /** Tom eletrônico (o "piu" dos anos 80): senoide caindo de altura, com a sala de portão. */
  simmons(t: number, note: number, vel = 1) {
    const osc = this.ctx.createOscillator();
    const f = freqOf(note);
    osc.frequency.setValueAtTime(f * 2.2, t);
    osc.frequency.exponentialRampToValueAtTime(f, t + 0.16);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * vel, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(g).connect(this.drums);
    const s = this.ctx.createGain();
    s.gain.value = 0.5;
    g.connect(s).connect(this.gate);
    osc.start(t);
    osc.stop(t + 0.55);
  }

  // --- Efeitos de produção ---
  /** Subida de ruído (antes da explosão do refrão/drop). */
  riser(t: number, dur: number, vel = 1) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(8000, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25 * vel, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
    src.connect(f).connect(g).connect(this.clean);
    const s = this.ctx.createGain();
    s.gain.value = 0.4;
    g.connect(s).connect(this.reverb);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** Pancada de cinema: sub caindo, estrondo e cauda longa. */
  hit(t: number, vel = 1) {
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 1.4);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * vel, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    osc.connect(g).connect(this.clean);
    osc.start(t);
    osc.stop(t + 1.9);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(3000, t);
    f.frequency.exponentialRampToValueAtTime(80, t + 1);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.5 * vel, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    src.connect(f).connect(ng).connect(this.clean);
    const s = this.ctx.createGain();
    s.gain.value = 0.8;
    ng.connect(s).connect(this.reverb);
    src.start(t);
    src.stop(t + 1.2);
    this.taiko(t, 31, vel * 0.8);
  }

  /** "Arranhado" de toca-discos: um trecho de som indo e voltando. */
  scratch(t: number, note: number, pattern: number[]) {
    note = this.p(note);
    const buffer = sample(`scratch:${note}`, () => {
      // Um "aah" de sintetizador gravado (o disco que o DJ arranha).
      const len = SR;
      const out = new Float32Array(len);
      const bp = new Filter("bandpass", 1100, 1.5);
      const bp2 = new Filter("bandpass", 2400, 3);
      const f = freqOf(note);
      for (let i = 0; i < len; i++) {
        const saw = ((i * f) / SR) % 1 * 2 - 1;
        out[i] = (bp.run(saw) * 1.5 + bp2.run(saw)) * Math.min(1, i / 200);
      }
      return out;
    });
    // `pattern`: velocidades (positivo para frente, negativo para trás) em pedaços de 1/32.
    const piece = this.len(0.5);
    pattern.forEach((speed, k) => {
      if (speed === 0) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = Math.abs(speed);
      const g = this.ctx.createGain();
      const at = t + k * piece;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.35, at + 0.005);
      g.gain.setValueAtTime(0.35, at + piece * 0.8);
      g.gain.linearRampToValueAtTime(0, at + piece);
      const hp = this.ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 300;
      src.connect(hp).connect(g).connect(this.clean);
      src.start(at, speed > 0 ? 0.1 : 0.4);
      src.stop(at + piece + 0.01);
    });
  }
}
