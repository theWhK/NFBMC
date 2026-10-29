// Mesa de som do jogo. Motores, pneus, vento, sirene, buzinas e efeitos são
// sintetizados com Web Audio (engine-sound.ts e sfx.ts); as locuções vêm de
// arquivos pequenos gravados por scripts/vozes.py (client/public/vozes). Uma
// reverberação gerada no código dá o "ar" de rua aos sons.
//
// O navegador só libera o som depois de um clique, por isso `unlock()` é
// chamado no botão de entrar. Qualquer erro aqui só deixa o jogo mudo.
import { carSpec, wheelRpm, type EngineSound, type FoodKind, type TrafficKind } from "@nfbmc/shared";

import { EngineVoice, PlayerEngine, engineBank, type EngineBank } from "./engine-sound.ts";
import { Music, prefetchMood, type CueName, type SongName, type TrackInfo } from "./music.ts";
import * as fx from "./sfx.ts";
import { Voices, type VoiceLine } from "./voices.ts";

const PREFS_KEY = "nfbmc:audio";

interface Prefs {
  music: boolean;
  sfx: boolean;
  /** Volume (0 a 1) da música e dos efeitos (inclui as vozes), nas Opções. */
  musicVolume: number;
  sfxVolume: number;
}

const DEFAULT_PREFS: Prefs = { music: true, sfx: true, musicVolume: 1, sfxVolume: 1 };

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return { ...DEFAULT_PREFS };
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

/** Motores do trânsito (o desenho de cada tipo fica no cliente). */
const TRAFFIC_ENGINES: Record<TrafficKind, { engine: EngineSound; idle: number; redline: number }> = {
  sedan: { engine: { cylinders: 4, layout: "linha", liters: 1.6, aspiration: "aspirado", exhaust: "fabrica" }, idle: 800, redline: 6000 },
  kombi: { engine: { cylinders: 4, layout: "boxer", liters: 1.6, aspiration: "aspirado", exhaust: "fabrica", airCooled: true }, idle: 850, redline: 4600 },
  picape: { engine: { cylinders: 4, layout: "linha", liters: 2.8, aspiration: "turbo", exhaust: "fabrica", diesel: true }, idle: 750, redline: 4200 },
};

/** Que motor tem um carro da cena: garagem/viatura pelo id, trânsito pelo tipo. */
function engineOf(car: { car?: string; traffic?: TrafficKind }) {
  if (car.traffic) return { key: `npc:${car.traffic}`, ...TRAFFIC_ENGINES[car.traffic] };
  const spec = carSpec(car.car);
  return { key: spec.id, engine: spec.engine, idle: spec.idleRpm, redline: spec.redline };
}

/** Giro provável de quem não manda o giro (viaturas, trânsito): a marcha que um automático escolheria. */
function estimateRpm(car: { car?: string; traffic?: TrafficKind }, speed: number) {
  if (car.traffic) {
    const { idle, redline } = TRAFFIC_ENGINES[car.traffic];
    return idle + gearFor(speed).rpm * (redline * 0.7 - idle);
  }
  const spec = carSpec(car.car);
  let gear = 1;
  while (gear < spec.gears.length && wheelRpm(spec, speed, gear) > spec.redline * 0.72) gear++;
  return Math.max(spec.idleRpm, Math.min(spec.redline, wheelRpm(spec, speed, gear)));
}

/** Buzina de cada carro: notas (Hz), timbre e, para alguns, uma melodia. */
interface HornProfile {
  notes: number[];
  /** Brilho do "trompete" da buzina (Hz). */
  formant: number;
  /** Sequência de notas (buzina musical) em vez de um toque só. */
  melody?: { note: number; at: number; dur: number }[];
}

const CUCARACHA = [392, 392, 392, 523, 659].map((note, i) => ({ note, at: [0, 0.13, 0.26, 0.42, 0.68][i], dur: i < 3 ? 0.1 : 0.22 }));

const HORNS: Record<string, HornProfile> = {
  fusca: { notes: [470], formant: 2400 },
  uno: { notes: [440, 554], formant: 2000 },
  gol: { notes: [415, 523], formant: 1900 },
  civic: { notes: [466, 587], formant: 2100 },
  golf: { notes: [440, 554], formant: 2000 },
  opala: { notes: [330, 415], formant: 1500 },
  viatura: { notes: [330, 415], formant: 1500 },
  mustang: { notes: [294, 370], formant: 1400 },
  supra: { notes: [494, 622], formant: 2200 },
  skyline: { notes: [494, 622], formant: 2200 },
  porchetta: { notes: [415, 494], formant: 1900 },
  lasanha: { notes: [392], formant: 2000, melody: CUCARACHA },
  farofa: { notes: [523, 659], formant: 2300 },
  brigadeiro: { notes: [349, 440], formant: 1700 },
  kibe: { notes: [370, 466], formant: 1800 },
  m3: { notes: [415, 523], formant: 2000 },
  // "Turbina de navio": o A3 do Bruno buzina igual navio.
  a3bruno: { notes: [98, 123, 147], formant: 700 },
};
const DEFAULT_HORN: HornProfile = { notes: [415, 523], formant: 1900 };

export interface CarSound {
  speed: number;
  rpm: number;
  redline: number;
  throttle: number;
  skid: number;
  offroad: boolean;
  boost: boolean;
  /** Carro (id em CARS): de onde sai o perfil do ronco. */
  car?: string;
  gear?: number;
}

export interface OtherCarSound {
  speed: number;
  distance: number;
  pan: number;
  rpm?: number;
  car?: string;
  traffic?: TrafficKind;
  /** Velocidade de aproximação (m/s, positiva chegando): dá o efeito Doppler. */
  closing?: number;
}

/** Laço de ruído filtrado com volume controlável (pneu, vento, terra). */
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
  source.start(0, Math.random() * buffer.duration);
  return { filter, gain };
}

/**
 * Cascalho: grãozinhos (estalos curtos de alturas e forças diferentes)
 * espalhados ao acaso. Tocado em laço sob o carro na terra/grama.
 */
function gravelBuffer(ctx: AudioContext) {
  const rate = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, rate * 2, rate);
  const data = buffer.getChannelData(0);
  for (let g = 0; g < 900; g++) {
    const start = Math.floor(Math.random() * data.length);
    const len = Math.floor(rate * (0.001 + Math.random() * 0.004));
    const amp = Math.random() ** 2;
    const freq = 1500 + Math.random() * 5000;
    for (let i = 0; i < len; i++) {
      const k = (start + i) % data.length;
      data[k] += Math.sin((2 * Math.PI * freq * i) / rate) * amp * Math.exp((-i / len) * 4) * (Math.random() * 0.6 + 0.4);
    }
  }
  return buffer;
}

/**
 * Sirene da Vigilância: corneta de alto-falante (onda rica, saturada e com o
 * "funil" do alto-falante), subindo e descendo pelo LFO. Perto, troca o
 * "uóóó" lento pelo "iú-iú" rápido.
 */
class Siren {
  private osc: OscillatorNode;
  private lfo: OscillatorNode;
  private depth: GainNode;
  private gain: GainNode;
  private panner: StereoPannerNode;
  private tone: BiquadFilterNode;
  private ctx: AudioContext;
  private yelp = false;

  constructor(ctx: AudioContext, out: AudioNode, reverb: AudioNode) {
    this.ctx = ctx;
    this.osc = ctx.createOscillator();
    // Quase quadrada, com harmônicos pares fracos (corneta de verdade não é pura).
    const real = new Float32Array(16);
    const imag = new Float32Array(16);
    for (let k = 1; k < 16; k++) imag[k] = (k % 2 ? 1 : 0.25) / k;
    this.osc.setPeriodicWave(ctx.createPeriodicWave(real, imag));
    this.osc.frequency.value = 900;
    this.lfo = ctx.createOscillator();
    this.lfo.type = "triangle";
    this.lfo.frequency.value = 0.3;
    this.depth = ctx.createGain();
    this.depth.gain.value = 380;
    this.lfo.connect(this.depth).connect(this.osc.frequency);
    const shaper = ctx.createWaveShaper();
    shaper.curve = fx.saturation(3);
    const horn = ctx.createBiquadFilter();
    horn.type = "bandpass";
    horn.frequency.value = 1500;
    horn.Q.value = 0.7;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = "lowpass";
    this.tone.frequency.value = 6000;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.panner = ctx.createStereoPanner();
    this.osc.connect(shaper).connect(horn).connect(this.tone).connect(this.gain).connect(this.panner).connect(out);
    const send = ctx.createGain();
    send.gain.value = 0.5;
    this.panner.connect(send).connect(reverb);
    this.osc.start();
    this.lfo.start();
  }

  set(distance: number | null, pan: number) {
    const t = this.ctx.currentTime;
    const volume = distance === null ? 0 : 0.14 * Math.max(0, 1 - distance / 170);
    this.gain.gain.setTargetAtTime(volume, t, 0.15);
    if (distance === null) return;
    // Longe, a sirene chega abafada (o ar e os prédios comem os agudos).
    this.tone.frequency.setTargetAtTime(7000 / (1 + distance / 30), t, 0.2);
    this.panner.pan.setTargetAtTime(pan * 0.8, t, 0.15);
    const yelp = distance < 45;
    if (yelp !== this.yelp) {
      this.yelp = yelp;
      this.lfo.frequency.setTargetAtTime(yelp ? 3.6 : 0.3, t, 0.1);
      this.depth.gain.setTargetAtTime(yelp ? 300 : 380, t, 0.1);
    }
  }

  /** Uma subida só ("uóóó"), para a abertura. */
  wail() {
    const t = this.ctx.currentTime;
    this.lfo.frequency.cancelScheduledValues(t);
    this.lfo.frequency.setValueAtTime(0.35, t);
    this.panner.pan.setValueAtTime(0, t);
    this.tone.frequency.setValueAtTime(6000, t);
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(0.12, t, 0.05);
    this.gain.gain.setTargetAtTime(0, t + 1.6, 0.2);
  }
}

export class Sound {
  private ctx: AudioContext | null = null;
  private kit!: fx.Kit;
  private sfxBus!: GainNode;
  /**
   * Sons do jogo (motores, pneus, sirene, buzinas, efeitos): passam por aqui
   * para as cinemáticas calarem tudo menos as vozes e a trilha delas.
   */
  private gameBus!: GainNode;
  private gameSend!: GainNode;
  private cine = false;
  private jukeboxOn = false;
  private musicBus!: GainNode;
  private engine: PlayerEngine | null = null;
  private engineKey = "";
  private others = new Map<string, EngineVoice>();
  private otherLoad = new Map<string, { speed: number; load: number }>();
  /** Perfis de motor esperando para serem gerados (um por quadro, para não engasgar). */
  private pendingBanks = new Map<string, () => EngineBank>();
  private squeal!: ReturnType<typeof noiseLoop>[];
  private scrub!: ReturnType<typeof noiseLoop>;
  private road!: ReturnType<typeof noiseLoop>;
  private gravel!: ReturnType<typeof noiseLoop>;
  private dirt!: ReturnType<typeof noiseLoop>;
  private wind!: ReturnType<typeof noiseLoop>;
  private nitroHiss!: ReturnType<typeof noiseLoop>;
  private siren: Siren | null = null;
  private music: Music | null = null;
  private voices = new Voices();
  private wantedSong: SongName | null = null;
  private wantedCue: CueName | null = null;
  /** Começou uma faixa (o aviso "tocando agora"). */
  onTrack: ((info: TrackInfo) => void) | null = null;
  private lastFrame = 0;
  private hornWave: PeriodicWave | null = null;
  private preview: { engine: PlayerEngine; timer: ReturnType<typeof setInterval> } | null = null;
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
      // Mestre: compressor segurando o conjunto e um limitador no fim (nada estoura).
      const glue = ctx.createDynamicsCompressor();
      glue.threshold.value = -16;
      glue.knee.value = 10;
      glue.ratio.value = 3;
      glue.attack.value = 0.005;
      glue.release.value = 0.2;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.1;
      glue.connect(limiter).connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.musicBus = ctx.createGain();
      this.sfxBus.connect(glue);
      this.musicBus.connect(glue);
      this.applyPrefs();

      // Reverberação de rua (prédios perto, cauda curta e escura).
      const reverb = ctx.createConvolver();
      reverb.buffer = fx.impulseResponse(ctx, 1.4, 4.2, 0.5);
      const reverbIn = ctx.createGain();
      reverbIn.connect(reverb).connect(this.sfxBus);
      this.gameBus = ctx.createGain();
      this.gameBus.connect(this.sfxBus);
      this.gameSend = ctx.createGain();
      this.gameSend.connect(reverbIn);

      const noise = fx.noiseBuffer(ctx);
      this.kit = { ctx, out: this.gameBus, reverb: this.gameSend, noise };
      this.voices.attach(ctx, this.sfxBus, reverbIn);
      // Fala alguém: a música abaixa enquanto durar a fala.
      this.voices.onPlay = (delay, seconds) => this.music?.duck(seconds, delay);

      // Pneu cantando: dois ressonadores estreitos no ruído (o chiado afinado do pneu).
      this.squeal = [noiseLoop(ctx, noise, this.gameBus, "bandpass", 1100, 18), noiseLoop(ctx, noise, this.gameBus, "bandpass", 2300, 14)];
      this.scrub = noiseLoop(ctx, noise, this.gameBus, "bandpass", 2400, 0.8);
      this.road = noiseLoop(ctx, noise, this.gameBus, "lowpass", 380, 0.7);
      this.gravel = noiseLoop(ctx, gravelBuffer(ctx), this.gameBus, "highpass", 900, 0.7);
      this.dirt = noiseLoop(ctx, noise, this.gameBus, "lowpass", 180, 1);
      this.wind = noiseLoop(ctx, noise, this.gameBus, "bandpass", 700, 0.5);
      this.nitroHiss = noiseLoop(ctx, noise, this.gameBus, "bandpass", 1600, 0.7);
      this.music = new Music(ctx, this.musicBus);
      this.music.onTrack = (info) => this.onTrack?.(info);
      this.music.setEnabled(this.prefs.music);
      if (this.wantedCue) this.music.setCue(this.wantedCue);
      if (this.wantedSong) this.music.play(this.wantedSong);
    } catch (err) {
      console.error("Áudio indisponível", err);
      this.ctx = null;
    }
  }

  toggle(kind: "music" | "sfx") {
    this.prefs[kind] = !this.prefs[kind];
    this.savePrefs();
  }

  /** Volume da música ou dos efeitos (0 a 1). */
  setVolume(kind: "music" | "sfx", value: number) {
    this.prefs[kind === "music" ? "musicVolume" : "sfxVolume"] = Math.max(0, Math.min(1, value));
    this.savePrefs();
  }

  private savePrefs() {
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
    // Curva ao quadrado: o controle "soa" linear para o ouvido. No jukebox a música
    // toca mesmo com ela desligada nas opções (é para ouvir), no volume escolhido.
    this.musicBus.gain.setTargetAtTime(this.prefs.music || this.jukeboxOn ? 0.3 * this.prefs.musicVolume ** 2 : 0, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(this.prefs.sfx ? 0.9 * this.prefs.sfxVolume ** 2 : 0, t, 0.1);
    this.music?.setEnabled(this.prefs.music);
  }

  song(name: SongName | null) {
    if (name === this.wantedSong) return;
    this.wantedSong = name;
    if (!this.music) return;
    if (name) this.music.play(name);
    else this.music.stop();
  }

  /** Começa a gravar o começo de uma trilha antes de ela tocar (a abertura). */
  prefetchSong(name: SongName) {
    if (this.music) this.music.prefetch(name);
    else if (this.prefs.music) prefetchMood(name);
  }

  /**
   * Cinemática: `cue` é o tema do plano (null = acabou a cena). Durante a cena
   * os sons do jogo calam (as vozes continuam) e a música do jogo dá lugar ao tema.
   */
  cinematic(cue: CueName | null) {
    this.wantedCue = cue;
    this.music?.setCue(cue);
    const on = cue !== null;
    if (on !== this.cine && this.ctx) {
      const t = this.ctx.currentTime;
      for (const g of [this.gameBus.gain, this.gameSend.gain]) g.setTargetAtTime(on ? 0 : 1, t, on ? 0.15 : 0.5);
    }
    this.cine = on;
  }

  /** Liga ou desliga o jukebox: a música do jogo sai, os sons do jogo calam (como na cinemática). */
  jukebox(on: boolean) {
    this.jukeboxOn = on;
    if (!this.ctx || !this.music) return;
    if (!on) this.jukeboxPause(false);
    this.music.setJukebox(on);
    const t = this.ctx.currentTime;
    const mute = on || this.cine;
    for (const g of [this.gameBus.gain, this.gameSend.gain]) g.setTargetAtTime(mute ? 0 : 1, t, 0.2);
    this.applyPrefs();
  }

  jukeboxPlay(id: string, from = 0, onEnd?: () => void) {
    this.music?.playTrack(id, from, onEnd);
  }

  jukeboxStop() {
    this.music?.stopTrack();
  }

  jukeboxPrefetch(id: string) {
    this.music?.prefetchTrack(id);
  }

  /** Pausa de verdade: o relógio do áudio para (no jukebox não toca mais nada). */
  jukeboxPause(paused: boolean) {
    if (!this.ctx) return;
    if (paused) void this.ctx.suspend().catch(() => {});
    else void this.ctx.resume().catch(() => {});
  }

  jukeboxPosition() {
    return this.music?.position() ?? null;
  }

  /** O analisador da música (o visualizador do jukebox). */
  musicAnalyser() {
    return this.music?.analyser ?? null;
  }

  /** Corte de plano dentro do mesmo tema: uma pancada leve (na trilha, não nos efeitos). */
  cineCut(strength = 1) {
    if (!this.ctx || !this.prefs.music) return;
    const kit = { ...this.kit, out: this.musicBus, reverb: this.musicBus };
    fx.tone(kit, { dur: 0.7, freq: 62, freqTo: 30, gain: 0.8 * strength });
    fx.burst(kit, { dur: 0.5, type: "bandpass", freq: 300, freqTo: 2500, q: 1, gain: 0.25 * strength, attack: 0.25 });
  }

  /** Estado da trilha (para os testes). */
  audioState() {
    return { ...(this.music?.state() ?? { mood: this.wantedSong, cue: this.wantedCue, track: null, enabled: this.prefs.music }), cinematic: this.cine };
  }

  /** Segundos desde o último quadro de som (para as contas de tempo dos motores). */
  private frameDt() {
    const now = this.ctx!.currentTime;
    const dt = Math.min(0.1, Math.max(0.001, now - this.lastFrame));
    this.lastFrame = now;
    return dt;
  }

  /** Gera os perfis pendentes, um por chamada. */
  private bakeOne() {
    const next = this.pendingBanks.entries().next();
    if (next.done) return;
    const [key, make] = next.value;
    this.pendingBanks.delete(key);
    make();
  }

  private bankFor(car: { car?: string; traffic?: TrafficKind }, now: boolean): EngineBank | null {
    const { key, engine, idle, redline } = engineOf(car);
    const make = () => engineBank(this.ctx!, key, engine, idle, redline);
    if (now) return make();
    // Os outros esperam a vez (gerar leva alguns milissegundos).
    if (!this.pendingBanks.has(key)) this.pendingBanks.set(key, make);
    return null;
  }

  /** Atualiza os sons contínuos do carro do jogador. */
  updateMine(car: CarSound | null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const dt = this.frameDt();
    this.bakeOne();
    if (!car) {
      this.engine?.silence();
      for (const loop of [...this.squeal, this.scrub, this.road, this.gravel, this.dirt, this.wind, this.nitroHiss]) loop.gain.gain.setTargetAtTime(0, t, 0.1);
      return;
    }
    const key = car.car ?? "";
    if (!this.engine || key !== this.engineKey) {
      this.engine?.stop();
      const bank = this.bankFor({ car: car.car }, true)!;
      this.engine = new PlayerEngine(this.kit, bank);
      this.engineKey = key;
    }
    const speed = Math.abs(car.speed);
    const throttle = car.boost ? 1 : (car.gear ?? 1) < 0 ? Math.abs(car.throttle) : Math.max(0, car.throttle);
    this.engine.update(dt, { rpm: car.rpm, throttle, gear: car.gear ?? 1 }, 0.42);

    // Pneus: no asfalto canta (afinado, oscilando); na terra/grama, arrasta e espirra cascalho.
    const skid = Math.min(1, car.skid);
    const wobble = 1 + Math.sin(t * 7.3) * 0.04 + Math.sin(t * 13.1) * 0.03;
    const squealPitch = (900 + skid * 300 + Math.min(speed, 40) * 4) * wobble;
    this.squeal[0].filter.frequency.setTargetAtTime(squealPitch, t, 0.03);
    this.squeal[1].filter.frequency.setTargetAtTime(squealPitch * 2.07, t, 0.03);
    const squeal = car.offroad ? 0 : skid * Math.min(1, speed / 6);
    this.squeal[0].gain.gain.setTargetAtTime(squeal * 3.2, t, 0.04);
    this.squeal[1].gain.gain.setTargetAtTime(squeal * 1.4, t, 0.04);
    this.scrub.gain.gain.setTargetAtTime(skid * Math.min(1, speed / 8) * (car.offroad ? 0.35 : 0.05), t, 0.05);
    const rolling = Math.min(1, speed / 30);
    this.road.gain.gain.setTargetAtTime(car.offroad ? 0 : rolling * 0.3, t, 0.1);
    this.road.filter.frequency.setTargetAtTime(250 + speed * 6, t, 0.2);
    this.gravel.gain.gain.setTargetAtTime(car.offroad ? Math.min(1, speed / 12) * 0.35 : 0, t, 0.06);
    this.dirt.gain.gain.setTargetAtTime(car.offroad ? Math.min(1, speed / 15) * 0.9 : 0, t, 0.08);
    // Vento: cresce com o quadrado da velocidade e vem em rajadas.
    const gust = 0.8 + 0.2 * Math.sin(t * 0.7) * Math.sin(t * 1.9);
    this.wind.gain.gain.setTargetAtTime(Math.min(1, (speed / 60) ** 2) * 0.3 * gust, t, 0.15);
    this.wind.filter.frequency.setTargetAtTime(500 + speed * 12, t, 0.2);
    this.nitroHiss.gain.gain.setTargetAtTime(car.boost ? 0.15 : 0, t, car.boost ? 0.05 : 0.25);
  }

  /** Motores dos outros carros, cada um com o seu ronco, mais baixos e abafados com a distância. */
  updateOthers(cars: Map<string, OtherCarSound>) {
    if (!this.ctx) return;
    this.bakeOne();
    for (const [id, engine] of this.others) {
      if (!cars.has(id)) {
        engine.stop();
        this.others.delete(id);
        this.otherLoad.delete(id);
      }
    }
    for (const [id, car] of cars) {
      let engine = this.others.get(id);
      if (!engine) {
        const bank = this.bankFor(car, false);
        if (!bank) continue;
        engine = new EngineVoice(this.ctx, this.gameBus, bank, false, { node: this.kit.reverb, amount: 0.12 });
        this.others.set(id, engine);
      }
      // Carga estimada: ganhando velocidade = acelerando.
      const memory = this.otherLoad.get(id) ?? { speed: car.speed, load: 0.6 };
      const accelerating = Math.abs(car.speed) > Math.abs(memory.speed) + 0.02;
      memory.load += ((accelerating ? 1 : Math.abs(car.speed) < 1 ? 0.3 : 0.15) - memory.load) * 0.15;
      memory.speed = car.speed;
      this.otherLoad.set(id, memory);
      const volume = 0.65 / (1 + car.distance / 9) * Math.max(0, 1 - car.distance / 70);
      const rpm = car.rpm || estimateRpm(car, car.speed);
      const doppler = Math.max(0.85, Math.min(1.2, 343 / (343 - Math.max(-60, Math.min(60, car.closing ?? 0)))));
      engine.set(rpm, memory.load, volume, car.pan, 9000 / (1 + car.distance / 25), doppler, 0.06);
    }
  }

  /** Sirene da viatura mais próxima (null = nenhuma por perto). `pan`: de que lado ela está. */
  updateSiren(distance: number | null, pan = 0) {
    if (!this.ctx) return;
    if (!this.siren) {
      if (distance === null) return;
      this.siren = new Siren(this.ctx, this.gameBus, this.kit.reverb);
    }
    this.siren.set(distance, pan);
  }

  /** Ronco de demonstração na garagem: liga, dá duas aceleradas e alivia. */
  revPreview(carId: string) {
    if (!this.ctx || !this.prefs.sfx) return;
    this.stopPreview();
    const spec = carSpec(carId);
    const engine = new PlayerEngine(this.kit, this.bankFor({ car: carId }, true)!);
    const start = this.ctx.currentTime;
    let rpm = spec.idleRpm;
    const timer = setInterval(() => {
      const t = this.ctx!.currentTime - start;
      // Dois "vrum": acelera de 0,3 a 0,9 s e de 1,3 a 1,9 s, mais forte no segundo.
      const throttle = (t > 0.3 && t < 0.9) || (t > 1.3 && t < 1.9) ? 1 : 0;
      const top = t < 1 ? 0.7 : 0.95;
      const target = throttle ? spec.redline * top : spec.idleRpm;
      rpm += (target - rpm) * (throttle ? 0.12 : 0.07);
      engine.update(0.03, { rpm, throttle, gear: 0 }, t > 3.2 ? 0 : 0.42);
      if (t > 3.6) this.stopPreview();
    }, 30);
    this.preview = { engine, timer };
  }

  private stopPreview() {
    if (!this.preview) return;
    clearInterval(this.preview.timer);
    this.preview.engine.stop();
    this.preview = null;
  }

  /**
   * Buzina: corneta de diafragma (onda rica com a nota caindo de leve no
   * ataque) passando pelo "funil". Cada carro tem a sua. `volume` de 0 a 1
   * (a dos outros fica mais baixa com a distância) e `pan` de -1 a 1.
   */
  horn(volume = 1, pan = 0, carId?: string) {
    if (!this.ctx || volume <= 0) return;
    const ctx = this.ctx;
    const profile = (carId && HORNS[carId]) || DEFAULT_HORN;
    if (!this.hornWave) {
      const real = new Float32Array(24);
      const imag = new Float32Array(24);
      for (let k = 1; k < 24; k++) imag[k] = 1 / k ** 0.9;
      this.hornWave = ctx.createPeriodicWave(real, imag);
    }
    const t = ctx.currentTime;
    const notes = profile.melody ?? [{ note: 0, at: 0, dur: 0.42 }];
    const total = Math.max(...notes.map((n) => n.at + n.dur)) + 0.1;
    const funnel = ctx.createBiquadFilter();
    funnel.type = "peaking";
    funnel.frequency.value = profile.formant;
    funnel.Q.value = 1.2;
    funnel.gain.value = 9;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = profile.formant * 2.2;
    const shaper = ctx.createWaveShaper();
    shaper.curve = fx.saturation(2);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    funnel.connect(lowpass).connect(shaper).connect(gain).connect(panner).connect(this.gameBus);
    const send = ctx.createGain();
    send.gain.value = 0.25 + (1 - volume) * 0.4;
    panner.connect(send).connect(this.kit.reverb);
    const level = 0.2 * volume;
    for (const { note, at, dur } of notes) {
      gain.gain.setTargetAtTime(level, t + at, 0.008);
      gain.gain.setTargetAtTime(0, t + at + dur, 0.02);
      const freqs = profile.melody ? [note, note * 1.5] : profile.notes;
      for (const f of freqs) {
        const osc = ctx.createOscillator();
        osc.setPeriodicWave(this.hornWave);
        osc.frequency.setValueAtTime(f * 1.03, t + at);
        osc.frequency.exponentialRampToValueAtTime(f, t + at + 0.04);
        const g = ctx.createGain();
        g.gain.value = 0.5 / freqs.length ** 0.5;
        osc.connect(g).connect(funnel);
        osc.start(t + at);
        osc.stop(t + at + dur + 0.1);
      }
    }
    setTimeout(() => panner.disconnect(), (total + 0.5) * 1000);
  }

  /** Locução gravada (ver scripts/vozes.py). */
  say(line: VoiceLine, delay = 0) {
    if (!this.ctx || !this.prefs.sfx) return;
    if (line.startsWith("radio-")) {
      // Rádio: o "tchk" de apertar o botão antes e depois da fala.
      fx.burst(this.kit, { delay, dur: 0.06, type: "bandpass", freq: 2200, q: 0.8, gain: 0.15 });
      this.voices.play(line, delay + 0.07, { wet: 0.05, onEnd: (late) => fx.burst(this.kit, { delay: late, dur: 0.1, type: "bandpass", freq: 1800, q: 0.6, gain: 0.12 }) });
      return;
    }
    const wet = line === "nham" ? 0.7 : line === "eat" || line.startsWith("trailer") ? 0.4 : 0.15;
    this.voices.play(line, delay, { wet });
  }

  /**
   * Fala do modo história (vozes/historia/<id>.mp3). Resolve com quanto tempo
   * (s) falta para ela acabar, ou null se não vai tocar (efeitos desligados,
   * áudio ainda bloqueado ou arquivo que não carregou).
   */
  sayStory(id: string, radio = false): Promise<number | null> {
    if (!this.ctx || !this.prefs.sfx) return Promise.resolve(null);
    if (radio) fx.burst(this.kit, { delay: 0, dur: 0.06, type: "bandpass", freq: 2200, q: 0.8, gain: 0.15 });
    return new Promise((resolve) => {
      let done = false;
      const finish = (value: number | null) => {
        if (done) return;
        done = true;
        resolve(value);
      };
      this.voices.play(`historia/${id}`, radio ? 0.07 : 0, { wet: radio ? 0.05 : 0.12, gain: 1, onEnd: finish });
      // Arquivo que não chegou a tempo: segue sem voz.
      setTimeout(() => finish(null), 4000);
    });
  }

  /** Para as locuções (pulou a vinheta). */
  hush() {
    this.voices.stopAll();
  }

  /** Baixa as locuções antes de precisar delas (vale também "historia/<id>"). */
  preloadVoices(lines: VoiceLine[]) {
    this.voices.preload(lines);
  }

  /** Escapou da Vigilância: fanfarra e o rádio dela. */
  escaped() {
    if (!this.ctx) return;
    fx.fanfare(this.kit);
    this.say("radio-escapou", 1.0);
  }

  /** Autuado: metais tristes e o rádio. */
  busted() {
    if (!this.ctx) return;
    fx.sadTrombone(this.kit);
    this.say("radio-autuado", 1.4);
  }

  /** Começou uma perseguição. */
  pursuitStarted() {
    this.say("radio-perseguicao", 0.3);
  }

  // --- Sons curtos -----------------------------------------------------------

  /** Bipe da contagem (com a voz do locutor); o último (VAI!) é mais agudo e longo. */
  beep(go = false, count?: number) {
    if (!this.ctx) return;
    fx.startBeep(this.kit, go);
    if (go) this.say("vai");
    else if (count === 3) this.say("tres");
    else if (count === 2) this.say("dois");
    else if (count === 1) this.say("um");
  }

  /** Nhac! E um "plim" que muda com a comida. */
  eat(kind: FoodKind | undefined) {
    if (this.ctx) fx.bite(this.kit, kind);
  }

  boost() {
    if (this.ctx) fx.nitro(this.kit);
  }

  /** Batida: `intensity` de 0 (raspão) a 1 (pancada). */
  bump(intensity = 0.5, pan = 0) {
    if (this.ctx) fx.impact(this.kit, intensity, pan);
  }

  lap(final = false) {
    if (!this.ctx) return;
    fx.lapChime(this.kit);
    if (final) this.say("ultima-volta", 0.25);
  }

  /** Cruzou a chegada; `won` = em primeiro. */
  finish(won?: boolean) {
    if (!this.ctx) return;
    fx.finishFanfare(this.kit);
    if (won !== undefined) this.say(won ? "vitoria" : "chegada", 0.5);
  }

  click() {
    if (this.ctx) fx.tick(this.kit);
  }

  // --- Abertura ----------------------------------------------------------------

  whoosh() {
    if (this.ctx) fx.whoosh(this.kit);
  }

  boom() {
    if (this.ctx) fx.boom(this.kit);
  }

  shimmer() {
    if (this.ctx) fx.shimmer(this.kit);
  }

  /** Lancheira caindo no chão. */
  thud() {
    if (this.ctx) fx.lunchbox(this.kit);
  }

  /** Uma subida de sirene só ("uóóó"). */
  wail() {
    if (!this.ctx) return;
    if (!this.siren) this.siren = new Siren(this.ctx, this.gameBus, this.kit.reverb);
    this.siren.wail();
  }
}
