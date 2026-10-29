// Toca a trilha (tracks.ts) como um rádio: cada clima (cidade, corrida,
// perseguição, duelo) tem algumas faixas que se revezam, e cada faixa que
// começa aparece no aviso "tocando agora". O jukebox (jukebox.ts) usa o mesmo
// toca-discos para tocar a faixa que o jogador escolher.
//
// As faixas não tocam nota por nota em tempo real. Cada seção (uns 8
// compassos) é gravada antes num OfflineAudioContext (band.ts) e depois só
// tocada como um buffer. Assim cabe uma produção caprichada (guitarras com
// amplificador, bateria sintetizada amostra por amostra, compressão) sem pesar
// no celular: enquanto uma seção toca, a próxima é gravada. Só as últimas
// seções ficam guardadas na memória.
//
// Emenda sem estouro: cada seção é gravada com a cauda (reverberação, prato
// soando). Na hora de tocar, a cauda da seção anterior é somada ao começo da
// seguinte e passa por um limitador (aqui em JavaScript, olhando à frente). A
// anterior é cortada no tempo exato. A soma nunca passa do teto.
//
// Nas cinemáticas do modo história, a música do jogo sai e entram os temas
// próprios de cada plano (CUES), que abaixam sozinhos quando alguém fala.
import { Band, LITE, SR, useLiteRendering } from "./band.ts";
import { CUES, MOOD_LABELS, TRACKS, type CueName, type Mood, type TrackDef } from "./tracks.ts";

export type SongName = Mood;
export type { CueName };

export interface TrackInfo {
  id: string;
  artist: string;
  title: string;
  mood: Mood;
  bpm: number;
  key: string;
  style: string;
}

export const trackInfo = (t: TrackDef): TrackInfo => ({
  id: t.id, artist: t.artist, title: t.title, mood: t.mood as Mood, bpm: t.bpm, key: t.key ?? "", style: t.style ?? "",
});

/** Cauda gravada depois de cada seção (reverberação, prato soando): somada ao começo da seguinte. */
const TAIL = 2.5;
/** Quantas seções gravadas ficam guardadas. */
const KEEP = 5;
/** Teto da emenda (o limitador em JavaScript): -0,6 dBFS. */
const CEILING = 0.93;

/** "refrao:2+2" → seção "refrao", variação 2, transposta +2 semitons. */
export function parseEntry(entry: string) {
  const m = /^([^:+]+)(?::(\d+))?(?:\+(-?\d+))?$/.exec(entry)!;
  return { name: m[1], variant: Number(m[2] ?? 0), shift: Number(m[3] ?? 0) };
}

export const sectionLength = (track: TrackDef, entry: string) => (track.sections[parseEntry(entry).name].bars * 240) / track.bpm;

/** Duração total da forma (s). */
export const trackLength = (track: TrackDef) => track.form.reduce((sum, e) => sum + sectionLength(track, e), 0);

/** Seções já gravadas (ou gravando), da mais antiga para a mais nova. */
const rendered = new Map<string, Promise<AudioBuffer | null>>();
/**
 * Modo econômico: o aparelho grava devagar demais (o jogo e a gravação brigam
 * pela CPU). Nas músicas do jogo, as seções que faltam são trocadas por seções
 * já gravadas da mesma faixa, em vez de gravar mais. O jukebox grava tudo.
 */
let economy = false;
const isCached = (track: TrackDef, entry: string) => rendered.has(`${track.id}/${entry}`);
const cachedOf = (track: TrackDef) => [...rendered.keys()].filter((k) => k.startsWith(`${track.id}/`)).map((k) => k.slice(track.id.length + 1));

/** Uma gravação de cada vez (não engasga o celular). */
let queue: Promise<unknown> = Promise.resolve();

/** Grava uma seção (com a cauda). Os nós são criados compasso a compasso, sem travar a tela. */
export async function renderRaw(track: TrackDef, entry: string): Promise<AudioBuffer> {
  const { name, variant, shift } = parseEntry(entry);
  const seconds = sectionLength(track, entry) + TAIL;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
  const band = new Band(ctx, { ...track.band, bpm: track.bpm });
  band.shift = shift;
  band.queue = [];
  track.sections[name].play(band, variant);
  const events = band.queue;
  band.queue = null;
  // Em pedaços de um compasso: o gravador para no começo de cada pedaço e só
  // então os nós daquele trecho são criados (cada pedaço é uma tarefa curta).
  const chunk = band.barTime;
  const groups = new Map<number, (() => void)[]>();
  for (const e of events) {
    const k = Math.max(0, Math.floor(e.t / chunk));
    let list = groups.get(k);
    if (!list) groups.set(k, (list = []));
    list.push(e.run);
  }
  for (const [k, list] of groups) {
    if (k === 0) {
      await runSliced(list);
      continue;
    }
    // Para um pouquinho antes do pedaço (o gravador anda em blocos de 128 amostras).
    const at = (Math.floor(((k * chunk) * SR) / 128) - 2) * 128 / SR;
    void ctx.suspend(at).then(async () => {
      await runSliced(list);
      void ctx.resume();
    });
  }
  return ctx.startRendering();
}

/** Até quantos ms seguidos o gravador usa a tela antes de devolver a vez (o jogo segue fluido). */
const SLICE_MS = 6;
const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Cria os nós de um pedaço em fatias curtas, devolvendo a vez para o jogo entre elas. */
async function runSliced(list: (() => void)[]) {
  let start = performance.now();
  for (const run of list) {
    run();
    if (performance.now() - start > SLICE_MS) {
      await yieldToMain();
      start = performance.now();
    }
  }
}

function renderSection(track: TrackDef, entry: string): Promise<AudioBuffer | null> {
  const key = `${track.id}/${entry}`;
  const cached = rendered.get(key);
  if (cached) {
    // Usada de novo: vai para o fim da fila de descarte.
    rendered.delete(key);
    rendered.set(key, cached);
    return cached;
  }
  const job = queue.then(async () => {
    try {
      const started = performance.now();
      const buffer = await renderRaw(track, entry);
      // Aparelho lento (gravou a menos de 4x o tempo real): daqui em diante, modo leve.
      const speed = (sectionLength(track, entry) * 1000) / Math.max(1, performance.now() - started);
      if (speed < 4 && !LITE) useLiteRendering();
      // Muito lento (menos de 2,5x): no jogo, a trilha passa a reaproveitar o que já gravou.
      if (speed < 2.5) economy = true;
      return buffer;
    } catch (err) {
      console.error("Trilha: não deu para gravar", key, err);
      return null;
    }
  });
  queue = job;
  rendered.set(key, job);
  while (rendered.size > KEEP) rendered.delete(rendered.keys().next().value!);
  return job;
}

/**
 * Emenda: os primeiros `frames` quadros da seção `body` mais a cauda de `prev`
 * (o que ela gravou depois de `prevFrames`), com um limitador que olha 1,5 ms à
 * frente e solta em ~60 ms. Escreve em `out` (estéreo).
 */
export function stitch(out: Float32Array[], body: Float32Array[], prev: Float32Array[] | null, prevFrames: number, rate: number) {
  const frames = out[0].length;
  for (let c = 0; c < 2; c++) out[c].set(body[c].subarray(0, frames));
  if (!prev) return;
  const tail = Math.min(frames, prev[0].length - prevFrames);
  if (tail <= 0) return;
  for (let c = 0; c < 2; c++) {
    const o = out[c];
    const p = prev[c];
    for (let i = 0; i < tail; i++) o[i] += p[prevFrames + i];
  }
  // Limitador: ganho necessário em cada quadro, o mínimo à frente e soltura suave.
  const look = Math.ceil(rate * 0.0015);
  const span = Math.min(frames, tail + look * 4);
  const need = new Float32Array(span + look);
  need.fill(1);
  for (let i = 0; i < span; i++) {
    const peak = Math.max(Math.abs(out[0][i]), Math.abs(out[1][i]));
    if (peak > CEILING) need[i] = CEILING / peak;
  }
  const release = 1 - Math.exp(-1 / (rate * 0.06));
  let gain = 1;
  // Mínimo da janela [i, i + look) com uma fila de índices em ordem crescente de ganho.
  const window = new Int32Array(span + look);
  let head = 0;
  let tailIdx = 0;
  let filled = 0;
  for (let i = 0; i < span; i++) {
    while (filled < i + look) {
      while (tailIdx > head && need[window[tailIdx - 1]] >= need[filled]) tailIdx--;
      window[tailIdx++] = filled++;
    }
    while (window[head] < i) head++;
    const target = need[window[head]];
    gain = target < gain ? target : gain + (target - gain) * release;
    if (gain < 1) {
      out[0][i] *= gain;
      out[1][i] *= gain;
    }
  }
}

/** Onde a faixa está: seção tocando e segundos desde o começo da faixa. */
export interface Position {
  index: number;
  elapsed: number;
  total: number;
  loading: boolean;
}

/**
 * Um "toca-discos": toca uma faixa seção por seção, emendando no tempo exato.
 * `stop` faz o fade e larga tudo; um novo `start` usa um volume novo (os fades
 * não se atropelam).
 */
class Deck {
  private ctx: AudioContext;
  private out: AudioNode;
  private gain: GainNode | null = null;
  private token = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Quando cada seção começa (no relógio do áudio) e em que segundo da faixa. */
  private marks: { at: number; index: number; offset: number }[] = [];
  private loading = false;
  track: TrackDef | null = null;

  constructor(ctx: AudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.out = out;
  }

  /**
   * Toca `track` desde a seção `from`. `onStart` quando o som começa de fato;
   * `onEnd` no fim da forma (sem loop).
   */
  start(track: TrackDef, o: { fadeIn?: number; from?: number; thrifty?: boolean; onStart?: () => void; onEnd?: () => void } = {}) {
    this.stop(0.6);
    const token = ++this.token;
    this.track = track;
    this.marks = [];
    this.loading = true;
    const gain = this.ctx.createGain();
    gain.connect(this.out);
    this.gain = gain;
    let index = Math.max(0, Math.min(track.form.length - 1, o.from ?? 0));
    let offset = track.form.slice(0, index).reduce((s, e) => s + sectionLength(track, e), 0);
    let nextAt = 0;
    let busy = false;
    let started = false;
    let previous: { raw: AudioBuffer; frames: number } | null = null;
    let failures = 0;
    void renderSection(track, track.form[index]);
    if (index + 1 < track.form.length && !(o.thrifty && economy)) void renderSection(track, track.form[index + 1]);

    const pump = async () => {
      if (busy || token !== this.token) return;
      if (started && nextAt - this.ctx.currentTime > 4) return;
      busy = true;
      if (index >= track.form.length) {
        if (track.loopFrom === undefined) {
          // Acabou a forma: avisa quando a última seção terminar de soar.
          const wait = Math.max(0, nextAt - this.ctx.currentTime) * 1000;
          if (this.timer) clearInterval(this.timer);
          this.timer = null;
          setTimeout(() => token === this.token && o.onEnd?.(), wait);
          return;
        }
        index = track.loopFrom;
      }
      let entry = track.form[index];
      if (o.thrifty && economy && !isCached(track, entry)) {
        // Econômico: uma seção já gravada (de preferência a mesma parte, noutra variação).
        const cached = cachedOf(track);
        const base = parseEntry(entry).name;
        const same = cached.filter((e) => parseEntry(e).name === base);
        const pick = same.length ? same : cached;
        if (pick.length) entry = pick[index % pick.length];
      }
      const raw = await renderSection(track, entry);
      busy = false;
      if (token !== this.token) return;
      // Gravando a seguinte enquanto esta toca.
      const following = index + 1 < track.form.length ? index + 1 : track.loopFrom;
      if (following !== undefined && !(o.thrifty && economy)) void renderSection(track, track.form[following]);
      if (!raw) {
        // Seção que não gravou: pula; três seguidas, desiste (não fica girando à toa).
        index++;
        if (++failures >= 3 && this.timer) {
          clearInterval(this.timer);
          this.timer = null;
        }
        return;
      }
      failures = 0;
      const length = sectionLength(track, entry);
      const last = index === track.form.length - 1 && track.loopFrom === undefined;
      // A última seção toca com a cauda inteira; as outras são cortadas no tempo
      // exato, e a cauda delas entra somada no começo da seguinte.
      const frames = last ? raw.length : Math.min(raw.length, Math.round(length * raw.sampleRate));
      const buffer = new AudioBuffer({ numberOfChannels: 2, length: frames, sampleRate: raw.sampleRate });
      const outData = [buffer.getChannelData(0), buffer.getChannelData(1)];
      stitch(
        outData,
        [raw.getChannelData(0), raw.getChannelData(1)],
        // (Se o modo leve entrou no meio, as taxas diferem: aí a cauda anterior fica de fora.)
        previous && previous.raw.sampleRate === raw.sampleRate ? [previous.raw.getChannelData(0), previous.raw.getChannelData(1)] : null,
        previous?.frames ?? 0,
        raw.sampleRate,
      );
      previous = { raw, frames: Math.round(length * raw.sampleRate) };
      const now = this.ctx.currentTime;
      if (!started) {
        nextAt = now + 0.05;
        started = true;
        this.loading = false;
        const fade = o.fadeIn ?? 0;
        gain.gain.setValueAtTime(fade ? 0.0001 : 1, nextAt);
        if (fade) gain.gain.exponentialRampToValueAtTime(1, nextAt + fade);
        o.onStart?.();
      } else if (nextAt < now) {
        // Atrasou (aba em segundo plano, celular lento): retoma agora, sem empilhar.
        nextAt = now + 0.05;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(gain);
      src.start(nextAt);
      this.sources.add(src);
      src.onended = () => this.sources.delete(src);
      this.marks.push({ at: nextAt, index, offset });
      if (this.marks.length > 4) this.marks.shift();
      nextAt += length;
      offset += length;
      index++;
      void pump();
    };
    this.timer = setInterval(() => void pump(), 250);
    void pump();
  }

  /** Posição na faixa (para a barra de progresso do jukebox). */
  position(): Position | null {
    if (!this.track) return null;
    const total = trackLength(this.track);
    const now = this.ctx.currentTime;
    const mark = [...this.marks].reverse().find((m) => m.at <= now) ?? null;
    if (!mark) return { index: this.marks[0]?.index ?? 0, elapsed: this.marks[0]?.offset ?? 0, total, loading: this.loading };
    return { index: mark.index, elapsed: Math.min(total, mark.offset + (now - mark.at)), total, loading: false };
  }

  stop(fade = 1) {
    this.token++;
    this.track = null;
    this.marks = [];
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const gain = this.gain;
    if (!gain) return;
    this.gain = null;
    const t = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + Math.max(0.02, fade));
    const sources = [...this.sources];
    this.sources.clear();
    for (const s of sources) {
      try {
        s.stop(t + fade + 0.05);
      } catch {
        // Ainda não tinha começado.
      }
    }
    setTimeout(() => gain.disconnect(), (fade + 0.2) * 1000);
  }
}

const shuffle = <T,>(list: T[]) => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/** Começa a gravar a primeira seção de um clima antes de precisar dele (a abertura); não precisa do áudio liberado. */
export function prefetchMood(mood: Mood) {
  const track = TRACKS.find((t) => t.mood === mood);
  if (track) void renderSection(track, track.form[0]);
}

/** As faixas do jukebox (todas menos a abertura), na ordem dos álbuns. */
export const JUKEBOX_TRACKS = TRACKS.filter((t) => t.mood !== "trailer");
export { MOOD_LABELS };

export class Music {
  private ctx: AudioContext;
  private game: Deck;
  private cues: Deck;
  /** Abaixa a música quando alguém fala. */
  private duckGain: GainNode;
  /** O que sai da música, para o visualizador do jukebox. */
  readonly analyser: AnalyserNode;
  private mood: Mood | null = null;
  private cue: CueName | null = null;
  private enabled = true;
  private jukebox = false;
  private playlists = new Map<Mood, TrackDef[]>();
  private lastByMood = new Map<Mood, string>();
  private duckUntil = 0;
  /** Faixa que começou (para o aviso "tocando agora"). */
  onTrack: ((info: TrackInfo) => void) | null = null;
  /** Faixa tocando agora (para os testes e o aviso). */
  current: TrackInfo | null = null;

  constructor(ctx: AudioContext, out: AudioNode) {
    this.ctx = ctx;
    // Celular: grava em taxa menor e com menos vozes (cabe no tempo do aparelho).
    if (typeof document !== "undefined" && document.body.classList.contains("touch")) useLiteRendering();
    this.duckGain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.78;
    this.duckGain.connect(this.analyser).connect(out);
    this.game = new Deck(ctx, this.duckGain);
    this.cues = new Deck(ctx, this.duckGain);
  }

  /** A fila do clima, como um rádio: embaralhada e sem repetir a última faixa. */
  private playlist(mood: Mood) {
    let list = this.playlists.get(mood);
    if (!list?.length) {
      list = shuffle(TRACKS.filter((t) => t.mood === mood));
      if (list.length > 1 && list[0].id === this.lastByMood.get(mood)) list.push(list.shift()!);
      this.playlists.set(mood, list);
    }
    return list;
  }

  private nextTrack(mood: Mood) {
    const track = this.playlist(mood).shift()!;
    this.lastByMood.set(mood, track.id);
    return track;
  }

  /** Grava já o começo da próxima faixa do clima (a contagem da largada, por exemplo). */
  prefetch(mood: Mood) {
    if (!this.enabled || mood === this.mood || this.jukebox) return;
    const track = this.playlist(mood)[0];
    void renderSection(track, track.form[0]);
  }

  private startMood(mood: Mood, fadeIn = 0) {
    const track = this.nextTrack(mood);
    this.current = null;
    this.game.start(track, {
      thrifty: true,
      fadeIn,
      onStart: () => {
        this.current = trackInfo(track);
        if (mood !== "trailer") this.onTrack?.(this.current);
      },
      // Fim da faixa: entra a próxima do mesmo clima.
      onEnd: () => {
        if (this.mood === mood && !this.cue && this.enabled && !this.jukebox) this.startMood(mood, 0.5);
      },
    });
  }

  play(mood: Mood) {
    if (mood === this.mood) return;
    this.mood = mood;
    if (this.cue || !this.enabled || this.jukebox) return;
    this.startMood(mood);
  }

  stop() {
    this.mood = null;
    if (this.jukebox) return;
    this.current = null;
    this.game.stop(1.2);
  }

  /** Música ligada/desligada nas opções: desligada, nem grava as seções. */
  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (this.jukebox) return;
    if (!on) {
      this.game.stop(0.3);
      this.cues.stop(0.3);
      this.current = null;
      return;
    }
    if (this.cue) this.startCue(this.cue);
    else if (this.mood) this.startMood(this.mood, 1);
  }

  private startCue(name: CueName) {
    this.cues.start(CUES[name], { fadeIn: 0.15, thrifty: true });
  }

  /**
   * Tema da cinemática (null = acabou a cena e a música do jogo volta).
   * Trocando de plano dentro do mesmo tema, a cama continua.
   */
  setCue(name: CueName | null) {
    if (name === this.cue) return;
    const was = this.cue;
    this.cue = name;
    if (this.jukebox) return;
    if (name) {
      if (!was) {
        this.game.stop(0.8);
        this.current = null;
      }
      if (this.enabled) this.startCue(name);
      return;
    }
    this.cues.stop(1.5);
    if (this.mood && this.enabled) this.startMood(this.mood, 2);
  }

  // --- Jukebox ---

  /** Entra no jukebox (a música do jogo sai) ou sai dele (a do clima volta). */
  setJukebox(on: boolean) {
    if (on === this.jukebox) return;
    this.jukebox = on;
    if (on) {
      this.game.stop(0.6);
      this.cues.stop(0.6);
      this.current = null;
      return;
    }
    this.game.stop(0.6);
    this.current = null;
    if (this.enabled && this.mood) this.startMood(this.mood, 1.5);
  }

  /** Toca uma faixa no jukebox, desde a seção `from`. `onEnd` quando ela acabar. */
  playTrack(id: string, from = 0, onEnd?: () => void) {
    const track = TRACKS.find((t) => t.id === id);
    if (!track || !this.jukebox) return;
    this.current = trackInfo(track);
    this.game.start(track, { from, fadeIn: from ? 0.3 : 0, onEnd });
  }

  stopTrack() {
    this.game.stop(0.3);
    this.current = null;
  }

  /** Começa a gravar o começo de uma faixa (a próxima da fila do jukebox). */
  prefetchTrack(id: string) {
    const track = TRACKS.find((t) => t.id === id);
    if (track) void renderSection(track, track.form[0]);
  }

  position() {
    return this.game.position();
  }

  /** Abaixa a música (a fala de alguém) por `seconds` a partir de `delay`. */
  duck(seconds: number, delay = 0) {
    const now = this.ctx.currentTime;
    const t = now + delay;
    const g = this.duckGain.gain;
    this.duckUntil = Math.max(this.duckUntil, t + seconds);
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(this.cue ? 0.4 : 0.55, t, 0.08);
    g.setTargetAtTime(1, this.duckUntil, 0.35);
  }

  state() {
    return { mood: this.mood, cue: this.cue, track: this.current?.id ?? null, enabled: this.enabled, jukebox: this.jukebox, lite: LITE, economy };
  }
}
