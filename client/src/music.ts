// Trilha sonora original, tocada por um sequenciador simples em Web Audio.
// Cada música é uma função chamada a cada semicolcheia (16 passos por compasso)
// que decide o que tocar naquele instante.

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

class Instruments {
  private distortion: WaveShaperNode;
  private guitarBus: GainNode;
  private ctx: AudioContext;
  private out: AudioNode;
  private noise: AudioBuffer;

  constructor(ctx: AudioContext, out: AudioNode, noise: AudioBuffer) {
    this.ctx = ctx;
    this.out = out;
    this.noise = noise;
    this.distortion = ctx.createWaveShaper();
    this.distortion.curve = distortionCurve(40);
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2600;
    this.guitarBus = ctx.createGain();
    this.guitarBus.gain.value = 0.22;
    this.distortion.connect(tone).connect(this.guitarBus).connect(out);
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

  private noiseHit(t: number, duration: number, type: BiquadFilterType, freq: number, volume: number) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    source.connect(filter).connect(this.envelope(t, volume, 0.002, duration)).connect(this.out);
    source.start(t, Math.random());
    source.stop(t + duration + 0.05);
  }

  kick(t: number, volume = 1) {
    const gain = this.envelope(t, volume, 0.002, 0.35);
    gain.connect(this.out);
    const osc = this.osc("sine", 150, t, 0.35, gain);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  }

  snare(t: number, volume = 0.6) {
    this.noiseHit(t, 0.18, "highpass", 1400, volume);
    const gain = this.envelope(t, volume * 0.5, 0.002, 0.1);
    gain.connect(this.out);
    this.osc("triangle", 190, t, 0.1, gain);
  }

  hat(t: number, open = false, volume = 0.18) {
    this.noiseHit(t, open ? 0.22 : 0.045, "highpass", 7500, volume);
  }

  bass(t: number, note: number, duration: number, volume = 0.45) {
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(180, t + duration);
    const gain = this.envelope(t, volume, 0.005, duration);
    filter.connect(gain).connect(this.out);
    this.osc("sawtooth", midiToFreq(note), t, duration, filter);
  }

  /** Power chord distorcido: tônica, quinta e oitava. */
  power(t: number, root: number, duration: number) {
    const gain = this.envelope(t, 1, 0.005, duration);
    gain.connect(this.distortion);
    for (const interval of [0, 7, 12]) {
      this.osc("sawtooth", midiToFreq(root + interval) * (1 + (Math.random() - 0.5) * 0.004), t, duration, gain);
    }
  }

  lead(t: number, note: number, duration: number, volume = 0.09) {
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 3200;
    const gain = this.envelope(t, volume, 0.01, duration);
    filter.connect(gain).connect(this.out);
    this.osc("square", midiToFreq(note), t, duration, filter);
  }

  pad(t: number, notes: number[], duration: number, volume = 0.05) {
    const gain = this.envelope(t, volume, duration * 0.3, duration);
    gain.connect(this.out);
    for (const note of notes) {
      this.osc("triangle", midiToFreq(note), t, duration, gain);
      this.osc("sawtooth", midiToFreq(note) * 1.003, t, duration, gain).detune.value = 8;
    }
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
