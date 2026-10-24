// Sons do jogo, todos sintetizados com Web Audio (sem arquivos de áudio).
// O navegador só libera o som depois de um clique, por isso `unlock()` é
// chamado no botão de entrar. Qualquer erro aqui só deixa o jogo mudo.
import type { FoodKind } from "@nfbmc/shared";

import { Music, type SongName } from "./music.ts";

const PREFS_KEY = "nfbmc:audio";

interface Prefs {
  music: boolean;
  sfx: boolean;
}

function loadPrefs(): Prefs {
  try {
    return { music: true, sfx: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return { music: true, sfx: true };
  }
}

/** Marchas fictícias: em cada faixa de velocidade o giro sobe e cai na troca. */
const GEARS = [0, 9, 18, 27, 36, 46, 70];

export function gearFor(speed: number) {
  const s = Math.abs(speed);
  let gear = 1;
  while (gear < GEARS.length - 1 && s > GEARS[gear]) gear++;
  const low = GEARS[gear - 1];
  const high = GEARS[gear];
  return { gear, rpm: Math.min(1, (s - low) / (high - low)) };
}

/** Um laço de ruído branco, base para pneu cantando, vento e terra. */
function noiseBuffer(ctx: AudioContext) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** Ruído contínuo passando por um filtro, com volume controlável. */
function noiseLoop(ctx: AudioContext, buffer: AudioBuffer, out: AudioNode, type: BiquadFilterType, freq: number, q = 1) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(filter).connect(gain).connect(out);
  source.start();
  return { filter, gain };
}

class Engine {
  private osc1: OscillatorNode;
  private osc2: OscillatorNode;
  private filter: BiquadFilterNode;
  readonly gain: GainNode;
  readonly panner: StereoPannerNode;
  private ctx: AudioContext;

  constructor(ctx: AudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = "sawtooth";
    this.osc2 = ctx.createOscillator();
    this.osc2.type = "square";
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.Q.value = 4;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.panner = ctx.createStereoPanner();
    const mix2 = ctx.createGain();
    mix2.gain.value = 0.5;
    this.osc1.connect(this.filter);
    this.osc2.connect(mix2).connect(this.filter);
    this.filter.connect(this.gain).connect(this.panner).connect(out);
    this.osc1.start();
    this.osc2.start();
  }

  /**
   * `rpm` e `redline` do motor: o tom acompanha o giro de verdade. Motores que
   * giram mais alto (faixa vermelha alta) soam mais agudos lá em cima.
   */
  set(rpm: number, redline: number, throttle: number, volume: number, pan = 0) {
    const t = this.ctx.currentTime;
    const ratio = Math.min(1.05, rpm / redline);
    const freq = 26 + ratio * (55 + redline / 90);
    this.osc1.frequency.setTargetAtTime(freq, t, 0.03);
    this.osc2.frequency.setTargetAtTime(freq * 0.5 + 1.5, t, 0.03);
    this.filter.frequency.setTargetAtTime(300 + ratio * 900 + Math.max(0, throttle) * 900, t, 0.08);
    this.gain.gain.setTargetAtTime(volume * (0.5 + 0.5 * Math.max(0.2, throttle)), t, 0.08);
    this.panner.pan.setTargetAtTime(pan, t, 0.1);
  }

  stop() {
    this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    setTimeout(() => {
      this.osc1.stop();
      this.osc2.stop();
      this.panner.disconnect();
    }, 500);
  }
}

export interface CarSound {
  speed: number;
  rpm: number;
  redline: number;
  throttle: number;
  skid: number;
  offroad: boolean;
  boost: boolean;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private engine!: Engine;
  private others = new Map<string, Engine>();
  private skid!: ReturnType<typeof noiseLoop>;
  private dirt!: ReturnType<typeof noiseLoop>;
  private wind!: ReturnType<typeof noiseLoop>;
  private music: Music | null = null;
  private siren: { osc: OscillatorNode; gain: GainNode } | null = null;
  private wantedSong: SongName | null = null;
  readonly prefs = loadPrefs();

  /** Liga o áudio. Precisa ser chamado dentro de um clique ou tecla. */
  unlock() {
    if (this.ctx) {
      this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      const master = ctx.createDynamicsCompressor();
      master.connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.musicBus = ctx.createGain();
      this.sfxBus.connect(master);
      this.musicBus.connect(master);
      this.applyPrefs();

      this.noise = noiseBuffer(ctx);
      this.engine = new Engine(ctx, this.sfxBus);
      this.skid = noiseLoop(ctx, this.noise, this.sfxBus, "bandpass", 1900, 6);
      this.dirt = noiseLoop(ctx, this.noise, this.sfxBus, "lowpass", 260);
      this.wind = noiseLoop(ctx, this.noise, this.sfxBus, "bandpass", 700, 0.6);
      this.music = new Music(ctx, this.musicBus, this.noise);
      if (this.wantedSong) this.music.play(this.wantedSong);
    } catch (err) {
      console.error("Áudio indisponível", err);
      this.ctx = null;
    }
  }

  toggle(kind: keyof Prefs) {
    this.prefs[kind] = !this.prefs[kind];
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      // Sem localStorage: a preferência vale só nesta aba.
    }
    this.applyPrefs();
  }

  private applyPrefs() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(this.prefs.music ? 0.32 : 0, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(this.prefs.sfx ? 0.9 : 0, t, 0.1);
  }

  song(name: SongName | null) {
    if (name === this.wantedSong) return;
    this.wantedSong = name;
    if (!this.music) return;
    if (name) this.music.play(name);
    else this.music.stop();
  }

  /** Atualiza os sons contínuos do carro do jogador. */
  updateMine(car: CarSound | null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (!car) {
      this.engine.set(0, 1, 0, 0);
      for (const loop of [this.skid, this.dirt, this.wind]) loop.gain.gain.setTargetAtTime(0, t, 0.1);
      return;
    }
    const speed = Math.abs(car.speed);
    this.engine.set(car.rpm, car.redline, car.boost ? 1 : car.throttle, 0.22);
    this.skid.gain.gain.setTargetAtTime(Math.min(1, car.skid) * 0.35, t, 0.04);
    this.skid.filter.frequency.setTargetAtTime(1600 + Math.random() * 600, t, 0.02);
    this.dirt.gain.gain.setTargetAtTime(car.offroad ? Math.min(1, speed / 15) * 0.5 : 0, t, 0.08);
    this.wind.gain.gain.setTargetAtTime(Math.min(1, speed / 55) * (car.boost ? 0.35 : 0.15), t, 0.15);
  }

  /** Motores dos outros carros, mais baixos conforme a distância. `pan`: -1 esquerda, 1 direita. */
  updateOthers(cars: Map<string, { speed: number; distance: number; pan: number; rpm?: number; redline?: number }>) {
    if (!this.ctx) return;
    for (const [id, engine] of this.others) {
      if (!cars.has(id)) {
        engine.stop();
        this.others.delete(id);
      }
    }
    for (const [id, car] of cars) {
      let engine = this.others.get(id);
      if (!engine) {
        engine = new Engine(this.ctx, this.sfxBus);
        this.others.set(id, engine);
      }
      const volume = 0.12 * Math.max(0, 1 - car.distance / 70);
      // Sem o giro (viatura, trânsito), estima pela velocidade com marchas fictícias.
      const estimated = gearFor(car.speed).rpm * 0.75 + 0.2;
      engine.set(car.rpm ?? estimated * 6000, car.redline ?? 6000, 0.6, volume, car.pan);
    }
  }

  /** Sirene da viatura mais próxima (null = nenhuma por perto). Sobe e desce, mais alta quanto mais perto. */
  updateSiren(distance: number | null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (!this.siren) {
      const osc = this.ctx.createOscillator();
      osc.type = "square";
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 2200;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(this.sfxBus);
      osc.start();
      this.siren = { osc, gain };
    }
    const volume = distance === null ? 0 : 0.1 * Math.max(0, 1 - distance / 170);
    this.siren.gain.gain.setTargetAtTime(volume, t, 0.1);
    // "Uóóó-uóóó": a frequência vai e volta a cada 1,4 s.
    this.siren.osc.frequency.setTargetAtTime(650 + 450 * (0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 1.4)), t, 0.02);
  }

  /** Escapou da Vigilância: fanfarra curta. */
  escaped() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, "square", 0.15, i * 0.1));
  }

  /** Autuado: "buá buá" descendo. */
  busted() {
    [392, 330, 262].forEach((f, i) => this.tone(f, 0.35, "sawtooth", 0.15, i * 0.25, f * 0.9));
  }

  // --- Sons curtos -----------------------------------------------------------

  private tone(freq: number, duration: number, type: OscillatorType = "square", volume = 0.2, delay = 0, slideTo?: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  private burst(duration: number, type: BiquadFilterType, freq: number, volume = 0.4, delay = 0, freqTo?: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (freqTo) filter.frequency.exponentialRampToValueAtTime(freqTo, t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(gain).connect(this.sfxBus);
    source.start(t, Math.random());
    source.stop(t + duration + 0.05);
  }

  /** Bipe da contagem; o último (VAI!) é mais agudo e longo. */
  beep(go = false) {
    this.tone(go ? 880 : 440, go ? 0.6 : 0.25, "square", 0.18);
  }

  /** Nhac! E um "plim" que muda com a comida. */
  eat(kind: FoodKind | undefined) {
    this.burst(0.08, "lowpass", 900, 0.6);
    this.burst(0.1, "lowpass", 700, 0.5, 0.11);
    const base = kind === "burger" ? 523 : kind === "fries" ? 659 : 784;
    this.tone(base, 0.12, "triangle", 0.2, 0.05);
    this.tone(base * 1.5, 0.2, "triangle", 0.2, 0.12);
  }

  boost() {
    this.burst(0.9, "bandpass", 300, 0.7, 0, 3000);
    this.tone(90, 0.6, "sawtooth", 0.15, 0, 260);
  }

  bump() {
    this.tone(70, 0.25, "sine", 0.6, 0, 35);
    this.burst(0.15, "lowpass", 500, 0.6);
  }

  lap() {
    [659, 784, 988].forEach((f, i) => this.tone(f, 0.18, "square", 0.14, i * 0.09));
  }

  finish() {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.25, "square", 0.14, i * 0.12));
  }

  click() {
    this.tone(1200, 0.05, "square", 0.08);
  }
}
