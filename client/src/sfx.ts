// Efeitos sonoros curtos, montados com ruído filtrado, ressonadores e envelopes
// (nada de bipe de oscilador puro). Cada função recebe o `Kit`: o contexto de
// áudio, a saída de efeitos, o envio para a reverberação e um ruído pronto.
import type { FoodKind } from "@nfbmc/shared";

export interface Kit {
  ctx: BaseAudioContext;
  /** Saída seca (o bus de efeitos). */
  out: AudioNode;
  /** Envio para a reverberação (a "sala"/a rua). */
  reverb: AudioNode;
  /** Ruído branco de 2 s, base de quase tudo. */
  noise: AudioBuffer;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Ruído branco (mono) de `seconds` segundos. */
export function noiseBuffer(ctx: BaseAudioContext, seconds = 2) {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/**
 * Resposta ao impulso de uma sala, gerada no código: reflexões iniciais
 * espalhadas e uma cauda de ruído que cai em exponencial e escurece com o tempo
 * (o ar e as paredes comem os agudos primeiro). Estéreo, com os lados diferentes.
 */
export function impulseResponse(ctx: BaseAudioContext, seconds: number, decay: number, brightness = 0.6) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      // O filtro fecha conforme a cauda avança.
      const k = brightness * Math.exp(-t * 3) + 0.04;
      low += (Math.random() * 2 - 1 - low) * k;
      const fadeIn = Math.min(1, t / 0.012);
      data[i] = low * Math.exp(-t * decay) * fadeIn * 1.6;
    }
    // Reflexões iniciais (prédios, parede da garagem).
    for (let r = 0; r < 9; r++) {
      const i = Math.floor(rate * rand(0.008, 0.07));
      data[i] += rand(-0.7, 0.7) * (1 - r / 10);
    }
  }
  return buffer;
}

/** Curva de saturação suave (tanh). */
export function saturation(amount: number) {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

interface BurstOptions {
  delay?: number;
  dur: number;
  type?: BiquadFilterType;
  freq: number;
  freqTo?: number;
  q?: number;
  gain: number;
  attack?: number;
  pan?: number;
  /** Quanto vai para a reverberação (0 a 1). */
  wet?: number;
}

/** Rajada de ruído filtrado com envelope (a base de pancadas, chiados e estalos). */
export function burst(kit: Kit, o: BurstOptions) {
  const { ctx } = kit;
  const t = ctx.currentTime + (o.delay ?? 0);
  const source = ctx.createBufferSource();
  source.buffer = kit.noise;
  const filter = ctx.createBiquadFilter();
  filter.type = o.type ?? "bandpass";
  filter.frequency.setValueAtTime(o.freq, t);
  if (o.freqTo) filter.frequency.exponentialRampToValueAtTime(o.freqTo, t + o.dur);
  filter.Q.value = o.q ?? 1;
  const gain = ctx.createGain();
  const attack = o.attack ?? 0.002;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + o.dur);
  const panner = ctx.createStereoPanner();
  panner.pan.value = o.pan ?? 0;
  source.connect(filter).connect(gain).connect(panner).connect(kit.out);
  if (o.wet) {
    const send = ctx.createGain();
    send.gain.value = o.wet;
    panner.connect(send).connect(kit.reverb);
  }
  source.start(t, Math.random() * (kit.noise.duration - o.dur - attack - 0.1));
  source.stop(t + attack + o.dur + 0.05);
}

interface ToneOptions {
  delay?: number;
  dur: number;
  freq: number;
  freqTo?: number;
  type?: OscillatorType;
  wave?: PeriodicWave;
  gain: number;
  attack?: number;
  pan?: number;
  wet?: number;
  /** Passa-baixa no som (Hz). */
  lowpass?: number;
}

/** Nota com envelope; aceita forma de onda própria (`wave`). */
export function tone(kit: Kit, o: ToneOptions) {
  const { ctx } = kit;
  const t = ctx.currentTime + (o.delay ?? 0);
  const osc = ctx.createOscillator();
  if (o.wave) osc.setPeriodicWave(o.wave);
  else osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.freqTo) osc.frequency.exponentialRampToValueAtTime(o.freqTo, t + o.dur);
  const gain = ctx.createGain();
  const attack = o.attack ?? 0.003;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + o.dur);
  let node: AudioNode = osc;
  if (o.lowpass) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = o.lowpass;
    node = node.connect(filter);
  }
  const panner = ctx.createStereoPanner();
  panner.pan.value = o.pan ?? 0;
  node.connect(gain).connect(panner).connect(kit.out);
  if (o.wet) {
    const send = ctx.createGain();
    send.gain.value = o.wet;
    panner.connect(send).connect(kit.reverb);
  }
  osc.start(t);
  osc.stop(t + attack + o.dur + 0.05);
}

/** Sino FM (portadora + moduladora): o "plim" de recompensa, rico e brilhante. */
export function bell(kit: Kit, freq: number, gain: number, delay = 0, dur = 0.6, ratio = 3.5, pan = 0) {
  const { ctx } = kit;
  const t = ctx.currentTime + delay;
  const carrier = ctx.createOscillator();
  carrier.frequency.value = freq;
  const mod = ctx.createOscillator();
  mod.frequency.value = freq * ratio;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(freq * 2.2, t);
  depth.gain.exponentialRampToValueAtTime(freq * 0.05, t + dur);
  mod.connect(depth).connect(carrier.frequency);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  carrier.connect(amp).connect(panner).connect(kit.out);
  const send = ctx.createGain();
  send.gain.value = 0.35;
  panner.connect(send).connect(kit.reverb);
  for (const o of [carrier, mod]) {
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

/** Metais: sopro em dente de serra com o filtro abrindo no ataque (fanfarra). */
export function brass(kit: Kit, notes: number[], dur: number, gain: number, delay = 0) {
  const { ctx } = kit;
  const t = ctx.currentTime + delay;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 2;
  filter.frequency.setValueAtTime(300, t);
  filter.frequency.exponentialRampToValueAtTime(2600, t + 0.06);
  filter.frequency.exponentialRampToValueAtTime(1200, t + dur);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.03);
  amp.gain.setValueAtTime(gain * 0.8, t + dur * 0.7);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  filter.connect(amp).connect(kit.out);
  const send = ctx.createGain();
  send.gain.value = 0.3;
  amp.connect(send).connect(kit.reverb);
  for (const note of notes) {
    for (const detune of [-6, 6]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = note;
      osc.detune.value = detune;
      // Vibrato leve entrando depois do ataque.
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.5;
      const vibDepth = ctx.createGain();
      vibDepth.gain.setValueAtTime(0, t);
      vibDepth.gain.linearRampToValueAtTime(note * 0.006, t + dur * 0.6);
      vib.connect(vibDepth).connect(osc.frequency);
      osc.connect(filter);
      for (const o of [osc, vib]) {
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }
}

/** Estalo do escapamento (carro aliviando, troca de marcha, limitador). */
export function exhaustPop(kit: Kit, size: number, pan = 0, volume = 1) {
  const g = volume * (0.5 + size * 0.5);
  burst(kit, { dur: rand(0.025, 0.06), type: "bandpass", freq: rand(700, 2200), q: 0.9, gain: 0.5 * g, pan, wet: 0.25 });
  tone(kit, { dur: 0.06, freq: rand(90, 140), freqTo: 45, gain: 0.45 * g, pan });
  if (size > 0.7 && Math.random() < 0.5) burst(kit, { delay: 0.02, dur: 0.05, type: "highpass", freq: 3000, gain: 0.15 * g, pan });
}

/** Válvula de alívio da turbina: "psssh"; a grande ainda "tutututu" (flutter). */
export function blowOff(kit: Kit, amount: number, flutter: boolean, volume = 1) {
  const { ctx } = kit;
  const g = volume * Math.min(1, amount);
  burst(kit, { dur: 0.32 + amount * 0.2, type: "bandpass", freq: 4200, freqTo: 1600, q: 1.4, gain: 0.22 * g, attack: 0.008, wet: 0.2 });
  burst(kit, { dur: 0.2, type: "highpass", freq: 6000, gain: 0.08 * g, attack: 0.005 });
  if (!flutter) return;
  // Compressor "batendo": ruído grave picotado ~22 vezes por segundo.
  const t = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = kit.noise;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 700;
  filter.Q.value = 1.2;
  const chop = ctx.createGain();
  chop.gain.value = 0;
  const lfo = ctx.createOscillator();
  lfo.type = "square";
  lfo.frequency.setValueAtTime(24, t);
  lfo.frequency.linearRampToValueAtTime(14, t + 0.45);
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.5;
  lfo.connect(lfoDepth).connect(chop.gain);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(0.5 * g, t + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  source.connect(filter).connect(chop).connect(amp).connect(kit.out);
  const offset = ctx.createConstantSource();
  offset.offset.value = 0.5;
  offset.connect(chop.gain);
  for (const node of [source, lfo, offset]) {
    node.start(t);
    node.stop(t + 0.55);
  }
}

/** Pancada: grave de carroceria, chapa amassando, ressonância de metal e caquinhos. */
export function impact(kit: Kit, intensity: number, pan = 0) {
  const i = Math.max(0.1, Math.min(1, intensity));
  tone(kit, { dur: 0.18 + i * 0.25, freq: 95 - i * 20, freqTo: 32, gain: 0.5 + i * 0.3, pan });
  burst(kit, { dur: 0.08 + i * 0.25, type: "lowpass", freq: 2200 + i * 2500, freqTo: 300, q: 0.8, gain: 0.45 + i * 0.35, pan, wet: 0.3 });
  // Chapa: três modos de vibração do metal, tocados por um estalo curto.
  const { ctx } = kit;
  const t = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = kit.noise;
  const hit = ctx.createGain();
  hit.gain.setValueAtTime(1, t);
  hit.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
  source.connect(hit);
  const ring = ctx.createGain();
  ring.gain.value = 0.25 * i;
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  ring.connect(panner).connect(kit.out);
  const send = ctx.createGain();
  send.gain.value = 0.35;
  panner.connect(send).connect(kit.reverb);
  for (const base of [380, 1050, 2350]) {
    const mode = ctx.createBiquadFilter();
    mode.type = "bandpass";
    mode.frequency.value = base * rand(0.85, 1.2);
    mode.Q.value = 30;
    hit.connect(mode).connect(ring);
  }
  source.start(t, Math.random());
  source.stop(t + 0.7);
  // Batida forte: pedaços de plástico e vidro caindo.
  if (i > 0.55) {
    for (let k = 0; k < 6; k++) {
      burst(kit, { delay: rand(0.05, 0.4), dur: rand(0.01, 0.03), type: "bandpass", freq: rand(2500, 7000), q: 4, gain: rand(0.05, 0.15) * i, pan: pan + rand(-0.3, 0.3) });
    }
  }
}

/** Mordida crocante (vários grãozinhos de ruído) mais o "plim" de cada comida. */
export function bite(kit: Kit, kind: FoodKind | undefined) {
  tone(kit, { dur: 0.07, freq: 180, freqTo: 90, gain: 0.5 });
  for (let k = 0; k < 7; k++) {
    burst(kit, { delay: k * 0.016 + rand(0, 0.01), dur: rand(0.01, 0.03), type: "bandpass", freq: rand(1800, 5200), q: 1.6, gain: rand(0.22, 0.45) });
  }
  burst(kit, { delay: 0.13, dur: 0.06, type: "bandpass", freq: 900, q: 1.2, gain: 0.35 });
  // Hambúrguer: grave e cheio; batata: médio, rápido; o resto (doce): agudo e brilhante.
  const notes = kind === "burger" ? [523, 659, 784] : kind === "fries" ? [659, 880] : [784, 988, 1319];
  notes.forEach((f, i) => bell(kit, f, 0.13, 0.06 + i * 0.06, 0.5, kind === "burger" ? 2 : 3.5));
}

/** Turbo de comida: "fuuuum" subindo, com um jato de ar e o grave empurrando. */
export function nitro(kit: Kit) {
  burst(kit, { dur: 0.9, type: "bandpass", freq: 300, freqTo: 3200, q: 1.2, gain: 0.6, attack: 0.05, wet: 0.25 });
  burst(kit, { dur: 1.1, type: "highpass", freq: 5000, gain: 0.08, attack: 0.1 });
  tone(kit, { dur: 0.7, freq: 55, freqTo: 140, type: "sawtooth", gain: 0.25, lowpass: 400, attack: 0.04 });
}

/** Clique de menu: um "tic" curto e seco. */
export function tick(kit: Kit) {
  burst(kit, { dur: 0.012, type: "highpass", freq: 3500, gain: 0.12 });
  tone(kit, { dur: 0.03, freq: 2100, freqTo: 1200, gain: 0.05 });
}

/** Bipe da largada (estilo semáforo de corrida); o "VAI" é mais agudo, cheio e longo. */
export function startBeep(kit: Kit, go: boolean) {
  const f = go ? 1046.5 : 523.25;
  tone(kit, { dur: go ? 0.7 : 0.22, freq: f, gain: 0.26, wet: 0.25 });
  tone(kit, { dur: go ? 0.7 : 0.22, freq: f * 2, gain: 0.08, wet: 0.25 });
  tone(kit, { dur: go ? 0.7 : 0.22, freq: f, type: "square", gain: 0.05, lowpass: 2500 });
  if (go) bell(kit, f * 1.5, 0.1, 0, 0.8, 2);
}

/** "Fuuush" de vinheta: ruído varrendo do grave para o agudo e passando de um lado para o outro. */
export function whoosh(kit: Kit) {
  const { ctx } = kit;
  const t = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = kit.noise;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 1.5;
  filter.frequency.setValueAtTime(200, t);
  filter.frequency.exponentialRampToValueAtTime(4500, t + 0.7);
  filter.frequency.exponentialRampToValueAtTime(1500, t + 1.0);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(0.7, t + 0.55);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(-0.8, t);
  panner.pan.linearRampToValueAtTime(0.8, t + 1.0);
  source.connect(filter).connect(amp).connect(panner).connect(kit.out);
  const send = ctx.createGain();
  send.gain.value = 0.4;
  panner.connect(send).connect(kit.reverb);
  source.start(t, Math.random() * 0.5);
  source.stop(t + 1.05);
}

/** Pancada grave de trailer: sub caindo, estrondo e cauda longa na reverberação. */
export function boom(kit: Kit) {
  tone(kit, { dur: 1.6, freq: 72, freqTo: 26, gain: 0.75, wet: 0.3 });
  tone(kit, { dur: 0.3, freq: 160, freqTo: 50, type: "triangle", gain: 0.3 });
  burst(kit, { dur: 0.9, type: "lowpass", freq: 1400, freqTo: 70, gain: 0.55, wet: 0.7 });
  burst(kit, { dur: 0.05, type: "highpass", freq: 2000, gain: 0.25, wet: 0.5 });
}

/** Brilho de logo: sinos subindo em acorde. */
export function shimmer(kit: Kit) {
  [784, 988, 1175, 1568, 1976].forEach((f, i) => bell(kit, f, 0.09, i * 0.06, 1.2 - i * 0.12, 3.01, (i - 2) * 0.3));
}

/** Lancheira de plástico caindo e quicando. */
export function lunchbox(kit: Kit) {
  [0, 0.16, 0.26].forEach((d, i) => {
    const g = [1, 0.45, 0.2][i];
    tone(kit, { delay: d, dur: 0.08, freq: 150, freqTo: 70, gain: 0.5 * g });
    burst(kit, { delay: d, dur: 0.07, type: "bandpass", freq: 900, q: 3, gain: 0.45 * g, wet: 0.3 });
    burst(kit, { delay: d, dur: 0.04, type: "bandpass", freq: 2600, q: 5, gain: 0.25 * g });
  });
}

/** Escapou da Vigilância: fanfarra de metais. */
export function fanfare(kit: Kit) {
  brass(kit, [392, 494], 0.16, 0.06, 0);
  brass(kit, [440, 554], 0.16, 0.06, 0.15);
  brass(kit, [523, 659, 784], 0.7, 0.07, 0.3);
  burst(kit, { delay: 0.3, dur: 1.0, type: "highpass", freq: 6000, gain: 0.08, wet: 0.5 });
}

/** Autuado: metais caindo ("uón-uón-uóóón") e um bumbo. */
export function sadTrombone(kit: Kit) {
  [[392, 380], [370, 356], [349, 330]].forEach(([a, b], i) => {
    brass(kit, [a / 2, a], 0.3, 0.06, i * 0.3);
    void b;
  });
  tone(kit, { delay: 0.9, dur: 0.9, freq: 330 / 2, freqTo: 280 / 2, type: "sawtooth", gain: 0.1, lowpass: 900, wet: 0.3 });
  tone(kit, { delay: 0.9, dur: 0.4, freq: 80, freqTo: 40, gain: 0.5 });
}

/** Volta completada: sinos subindo. */
export function lapChime(kit: Kit) {
  [659, 784, 988, 1319].forEach((f, i) => bell(kit, f, 0.14, i * 0.07, 0.6, 2));
}

/** Chegada: fanfarra + prato. */
export function finishFanfare(kit: Kit) {
  brass(kit, [523], 0.12, 0.06, 0);
  brass(kit, [523], 0.12, 0.06, 0.13);
  brass(kit, [523], 0.12, 0.06, 0.26);
  brass(kit, [523, 659, 784, 1047], 1.0, 0.07, 0.4);
  burst(kit, { delay: 0.4, dur: 1.4, type: "highpass", freq: 5000, gain: 0.12, wet: 0.6 });
  tone(kit, { delay: 0.4, dur: 0.4, freq: 90, freqTo: 40, gain: 0.5 });
}
