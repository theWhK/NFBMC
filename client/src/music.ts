// Trilha sonora original, tocada por um sequenciador simples em Web Audio.
// Cada música é uma função chamada a cada semicolcheia (16 passos por compasso)
// que decide o que tocar naquele instante.

import { impulseResponse } from "./sfx.ts";

export type SongName = "lobby" | "race" | "pursuit" | "trailer";

const midiToFreq = (note: number) => 440 * 2 ** ((note - 69) / 12);

/** Curva de distorção para a "guitarra" do rock. */
function distortionCurve(amount: number) {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

/**
 * Os instrumentos da banda. Cada um tem um timbre montado (não é só uma onda
 * crua): bumbo com estalo e queda de afinação, caixa com corpo e esteira,
 * guitarra dobrada em estéreo passando por "amplificador" e "caixa", baixo com
 * sub, solo com vibrato e eco, e uma sala (reverberação gerada no código).
 */
class Instruments {
  private guitars: GainNode[] = [];
  private ctx: AudioContext;
  private out: AudioNode;
  private noise: AudioBuffer;
  private room: GainNode;
  private echo: GainNode;

  constructor(ctx: AudioContext, out: AudioNode, noise: AudioBuffer) {
    this.ctx = ctx;
    this.out = out;
    this.noise = noise;

    // Sala: reverberação curta e escura para a banda soar "num lugar".
    const reverb = ctx.createConvolver();
    reverb.buffer = impulseResponse(ctx, 1.6, 3.2, 0.45);
    this.room = ctx.createGain();
    const roomOut = ctx.createGain();
    roomOut.gain.value = 0.8;
    this.room.connect(reverb).connect(roomOut).connect(out);

    // Eco do solo (pingue-pongue esquerda/direita).
    this.echo = ctx.createGain();
    const left = ctx.createDelay(1);
    const right = ctx.createDelay(1);
    left.delayTime.value = 0.3;
    right.delayTime.value = 0.3;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.35;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 2500;
    const panL = ctx.createStereoPanner();
    panL.pan.value = -0.7;
    const panR = ctx.createStereoPanner();
    panR.pan.value = 0.7;
    this.echo.connect(left);
    left.connect(panL).connect(out);
    left.connect(right);
    right.connect(panR).connect(out);
    right.connect(damp).connect(feedback).connect(left);

    // Guitarra: duas tomadas (esquerda e direita), cada uma com distorção em
    // dois estágios e a "caixa" do amplificador (corta grave e agudo, cava o médio).
    for (const pan of [-0.65, 0.65]) {
      const input = ctx.createGain();
      const pre = ctx.createBiquadFilter();
      pre.type = "highpass";
      pre.frequency.value = 120;
      const drive1 = ctx.createWaveShaper();
      drive1.curve = distortionCurve(12);
      const drive2 = ctx.createWaveShaper();
      drive2.curve = distortionCurve(30);
      const mid = ctx.createBiquadFilter();
      mid.type = "peaking";
      mid.frequency.value = 750;
      mid.Q.value = 1;
      mid.gain.value = -6;
      const cab = ctx.createBiquadFilter();
      cab.type = "lowpass";
      cab.frequency.value = 3400;
      cab.Q.value = 0.9;
      const cab2 = ctx.createBiquadFilter();
      cab2.type = "lowpass";
      cab2.frequency.value = 5000;
      const level = ctx.createGain();
      level.gain.value = 0.16;
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      input.connect(pre).connect(drive1).connect(drive2).connect(mid).connect(cab).connect(cab2).connect(level).connect(panner).connect(out);
      const send = ctx.createGain();
      send.gain.value = 0.15;
      panner.connect(send).connect(this.room);
      this.guitars.push(input);
    }
  }

  private envelope(t: number, volume: number, attack: number, duration: number) {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    return gain;
  }

  private osc(type: OscillatorType, freq: number, t: number, duration: number, dest: AudioNode) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.connect(dest);
    osc.start(t);
    osc.stop(t + duration + 0.05);
    return osc;
  }

  private noiseHit(t: number, duration: number, type: BiquadFilterType, freq: number, volume: number, dest: AudioNode = this.out, q = 1) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = this.envelope(t, volume, 0.002, duration);
    source.connect(filter).connect(env).connect(dest);
    source.start(t, Math.random());
    source.stop(t + duration + 0.05);
    return env;
  }

  private send(node: AudioNode, amount: number, dest: AudioNode = this.room) {
    const gain = this.ctx.createGain();
    gain.gain.value = amount;
    node.connect(gain).connect(dest);
  }

  /** Bumbo: senoide caindo de 160 para 45 Hz, mais o estalo da baqueta. */
  kick(t: number, volume = 1) {
    const gain = this.envelope(t, volume, 0.002, 0.4);
    gain.connect(this.out);
    const osc = this.osc("sine", 160, t, 0.4, gain);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.11);
    this.noiseHit(t, 0.012, "highpass", 3000, volume * 0.25);
  }

  /** Caixa: corpo afinado, esteira (ruído) e um pouco de sala. */
  snare(t: number, volume = 0.6) {
    const wire = this.noiseHit(t, 0.2, "bandpass", 2200, volume, this.out, 0.6);
    this.send(wire, 0.35);
    this.noiseHit(t, 0.08, "highpass", 5000, volume * 0.4);
    const gain = this.envelope(t, volume * 0.6, 0.002, 0.12);
    gain.connect(this.out);
    const body = this.osc("triangle", 200, t, 0.12, gain);
    body.frequency.exponentialRampToValueAtTime(165, t + 0.1);
  }

  /** Chimbal: ruído bem agudo, um pouco para a direita. */
  hat(t: number, open = false, volume = 0.18) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const peak = this.ctx.createBiquadFilter();
    peak.type = "peaking";
    peak.frequency.value = 10000;
    peak.gain.value = 6;
    const env = this.envelope(t, volume, 0.001, open ? 0.25 : 0.045);
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = 0.3;
    source.connect(hp).connect(peak).connect(env).connect(pan).connect(this.out);
    source.start(t, Math.random());
    source.stop(t + 0.3);
  }

  /** Baixo: dente de serra com o filtro fechando, mais um sub (senoide uma oitava abaixo). */
  bass(t: number, note: number, duration: number, volume = 0.45) {
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 3;
    filter.frequency.setValueAtTime(1200, t);
    filter.frequency.exponentialRampToValueAtTime(160, t + duration);
    const gain = this.envelope(t, volume, 0.005, duration);
    filter.connect(gain).connect(this.out);
    this.osc("sawtooth", midiToFreq(note), t, duration, filter);
    const sub = this.envelope(t, volume * 0.6, 0.005, duration);
    sub.connect(this.out);
    this.osc("sine", midiToFreq(note) / 2, t, duration, sub);
  }

  /** Power chord distorcido (tônica, quinta e oitava), tocado nas duas guitarras. */
  power(t: number, root: number, duration: number) {
    this.guitars.forEach((guitar, side) => {
      const gain = this.envelope(t, 1, 0.004, duration);
      gain.connect(guitar);
      for (const interval of [0, 7, 12]) {
        // Cada lado levemente desafinado e atrasado: soa como duas gravações.
        const osc = this.osc("sawtooth", midiToFreq(root + interval) * (1 + (side ? 0.003 : -0.003)), t + side * 0.008, duration, gain);
        osc.detune.value = (Math.random() - 0.5) * 6;
      }
    });
  }

  /** Solo: duas ondas quadradas desafinadas, vibrato, sala e eco. */
  lead(t: number, note: number, duration: number, volume = 0.09) {
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 3200;
    const gain = this.envelope(t, volume * 0.8, 0.01, duration);
    filter.connect(gain).connect(this.out);
    this.send(gain, 0.3);
    this.send(gain, 0.35, this.echo);
    const vibrato = this.ctx.createOscillator();
    vibrato.frequency.value = 5.8;
    const depth = this.ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(midiToFreq(note) * 0.008, t + Math.min(0.3, duration));
    vibrato.connect(depth);
    vibrato.start(t);
    vibrato.stop(t + duration + 0.05);
    for (const detune of [-7, 7]) {
      const osc = this.osc("square", midiToFreq(note), t, duration, filter);
      osc.detune.value = detune;
      depth.connect(osc.frequency);
    }
  }

  /** Teclado de fundo: serras desafinadas, filtro fechado, abertas em estéreo e com bastante sala. */
  pad(t: number, notes: number[], duration: number, volume = 0.05) {
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(700, t);
    filter.frequency.linearRampToValueAtTime(1800, t + duration * 0.5);
    filter.frequency.linearRampToValueAtTime(900, t + duration);
    const gain = this.envelope(t, volume, duration * 0.3, duration);
    filter.connect(gain).connect(this.out);
    this.send(gain, 0.6);
    notes.forEach((note, i) => {
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = ((i % 3) - 1) * 0.6;
      pan.connect(filter);
      this.osc("triangle", midiToFreq(note), t, duration, pan);
      this.osc("sawtooth", midiToFreq(note), t, duration, pan).detune.value = 9;
      this.osc("sawtooth", midiToFreq(note), t, duration, pan).detune.value = -9;
    });
  }
}

interface Song {
  bpm: number;
  step: (i: number, t: number, s: number, inst: Instruments) => void;
}

const triad = (root: number, minor: boolean) => [root, root + (minor ? 3 : 4), root + 7];

/** Rock eletrônico para a corrida: Mi menor, i–VI–VII–V. */
const RACE: Song = {
  bpm: 150,
  step(i, t, s, inst) {
    const bar = Math.floor(i / 16) % 8;
    const pos = i % 16;
    const chords: [number, boolean][] = [[40, true], [36, false], [38, false], [35, false]];
    const [root, minor] = chords[bar % 4];

    // Bateria: bumbo reto, caixa no 2 e no 4, chimbal no contratempo, virada no fim.
    if (pos % 4 === 0) inst.kick(t);
    if (pos === 4 || pos === 12) inst.snare(t);
    if (bar === 7 && pos >= 12) inst.snare(t, 0.35 + (pos - 12) * 0.1);
    if (pos % 4 === 2) inst.hat(t, true, 0.12);
    else if (pos % 2 === 1) inst.hat(t);

    // Baixo em colcheias, com oitava pulando.
    const bassLine = [0, 0, 12, 0, 0, 12, 0, 10];
    if (pos % 2 === 0) inst.bass(t, root + bassLine[pos / 2], s * 1.8);

    // Riff de guitarra sincopado.
    const hits: Record<number, number> = { 0: 3, 3: 3, 6: 4, 10: 2, 12: 4 };
    if (pos in hits) inst.power(t, root + 12, s * hits[pos]);

    // Na segunda metade do ciclo entra um arpejo agudo.
    if (Math.floor(i / 128) % 2 === 1) {
      const notes = triad(root + 36, minor);
      inst.lead(t, notes[[0, 1, 2, 1][pos % 4]] + (pos >= 8 ? 12 : 0), s * 0.9);
    }
  },
};

/** Boom-bap de garagem para o lobby: Lá menor, i–VI–III–VII. */
const LOBBY: Song = {
  bpm: 92,
  step(i, t, s, inst) {
    const bar = Math.floor(i / 16) % 4;
    const pos = i % 16;
    const chords: [number, boolean][] = [[45, true], [41, false], [48, false], [43, false]];
    const [root, minor] = chords[bar];

    if (pos === 0 || pos === 7 || pos === 10) inst.kick(t, 0.9);
    if (pos === 4 || pos === 12) inst.snare(t, 0.5);
    if (pos % 2 === 0) inst.hat(t, pos === 14, 0.1);

    if (pos === 0) inst.bass(t, root - 12, s * 6);
    if (pos === 7) inst.bass(t, root - 5, s * 2);
    if (pos === 10) inst.bass(t, root - 12, s * 4);

    if (pos === 0) inst.pad(t, triad(root + 12, minor), s * 16);

    // Melodia pentatônica curta, que se repete a cada 4 compassos.
    const melody: (number | null)[] = [
      76, null, null, 74, null, 72, null, null, 69, null, 72, null, null, null, null, null,
      77, null, null, 76, null, 72, null, null, 72, null, 69, null, null, null, null, null,
      76, null, 79, null, 76, null, 74, null, 72, null, null, null, 74, null, 76, null,
      74, null, null, 71, null, 67, null, null, 69, null, null, null, null, null, null, null,
    ];
    const note = melody[(i % 64)];
    if (note !== null && Math.floor(i / 64) % 2 === 1) inst.lead(t, note, s * 2.5, 0.06);
  },
};

/** Perseguição: drum and bass tenso em Ré menor, com baixo "rasgado" e um alarme de fundo. */
const PURSUIT: Song = {
  bpm: 172,
  step(i, t, s, inst) {
    const bar = Math.floor(i / 16) % 4;
    const pos = i % 16;
    const roots = [38, 38, 34, 36];
    const root = roots[bar];

    // Quebrada clássica: bumbo no 1 e no "e" do 3, caixa no 2 e no 4.
    if (pos === 0 || pos === 10) inst.kick(t);
    if (pos === 4 || pos === 12) inst.snare(t, 0.55);
    if (pos === 7 && bar % 2 === 1) inst.snare(t, 0.25);
    inst.hat(t, false, pos % 2 === 0 ? 0.11 : 0.06);

    // Baixo "reese": duas notas quase iguais, desafinadas entre si.
    if (pos === 0 || pos === 6 || pos === 11) {
      inst.bass(t, root - 12, s * (pos === 0 ? 5 : 3), 0.38);
      inst.bass(t, root - 12.15, s * (pos === 0 ? 5 : 3), 0.25);
    }

    // Alarme: duas notas a meio tom, como uma sirene distante.
    if (pos === 0 && bar % 2 === 0) {
      inst.lead(t, root + 36, s * 3, 0.05);
      inst.lead(t + s * 4, root + 37, s * 3, 0.05);
    }
    if (pos === 8) inst.power(t, root + 12, s * 2);
  },
};

/**
 * Trailer da abertura: começa só com o "coração" e o pad, vai somando chimbal,
 * baixo e caixa, e no 5º compasso entra o riff pesado (Ré menor, i–VI–VII–V).
 */
const TRAILER: Song = {
  bpm: 140,
  step(i, t, s, inst) {
    const bar = Math.floor(i / 16);
    const pos = i % 16;
    const chords: [number, boolean][] = [[38, true], [34, false], [36, false], [33, false]];
    const [root, minor] = chords[bar % 4];
    const full = bar >= 4;

    if (pos === 0) inst.pad(t, triad(root + 12, minor), s * 16, full ? 0.04 : 0.06);
    if (!full) {
      // Batida de coração, cada vez mais presente.
      if (pos === 0 || pos === 3) inst.kick(t, 0.6 + bar * 0.1);
      if (bar >= 2 && pos % 2 === 0) inst.hat(t, false, 0.05 + (bar - 2) * 0.03);
      if (bar >= 2 && pos % 4 === 0) inst.bass(t, root - 12, s * 3, 0.3);
      // Virada de caixa crescendo para a entrada do riff.
      if (bar === 3 && pos >= 8) inst.snare(t, 0.15 + (pos - 8) * 0.07);
      return;
    }
    if (pos % 4 === 0 || pos === 10) inst.kick(t);
    if (pos === 4 || pos === 12) inst.snare(t, 0.55);
    if (pos % 2 === 1) inst.hat(t, pos === 15, 0.08);
    if (pos % 2 === 0) inst.bass(t, root - 12 + (pos === 14 ? 12 : 0), s * 1.8, 0.4);
    const hits: Record<number, number> = { 0: 3, 3: 3, 6: 2, 8: 4, 14: 2 };
    if (pos in hits) inst.power(t, root + 12, s * hits[pos]);
    // Sirene ao fundo, como na perseguição.
    if (pos === 0 && bar % 2 === 1) {
      inst.lead(t, root + 36, s * 3, 0.04);
      inst.lead(t + s * 4, root + 37, s * 3, 0.04);
    }
  },
};

const SONGS: Record<SongName, Song> = { race: RACE, lobby: LOBBY, pursuit: PURSUIT, trailer: TRAILER };

export class Music {
  private instruments: Instruments;
  private song: Song | null = null;
  private step = 0;
  private nextTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private bus: GainNode;
  private ctx: AudioContext;

  constructor(ctx: AudioContext, out: AudioNode, noise: AudioBuffer) {
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.bus.connect(out);
    this.instruments = new Instruments(ctx, this.bus, noise);
  }

  play(name: SongName) {
    const song = SONGS[name];
    if (song === this.song) return;
    this.song = song;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.bus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.bus.gain.setValueAtTime(1, this.ctx.currentTime);
    if (!this.timer) this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    this.song = null;
    this.bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
  }

  /** Agenda as notas dos próximos ~120 ms (o setInterval sozinho não tem precisão). */
  private schedule() {
    if (!this.song) return;
    const stepDuration = 60 / this.song.bpm / 4;
    // Aba em segundo plano: o timer atrasa; pula o que ficou para trás em vez de tocar tudo junto.
    if (this.nextTime < this.ctx.currentTime - 0.2) this.nextTime = this.ctx.currentTime + 0.05;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this.song.step(this.step, this.nextTime, stepDuration, this.instruments);
      this.step++;
      this.nextTime += stepDuration;
    }
  }
}
