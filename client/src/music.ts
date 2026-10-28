// Toca a trilha (tracks.ts) como um rádio: cada clima (cidade, corrida,
// perseguição, duelo) tem algumas faixas que se revezam, e cada faixa que
// começa aparece no aviso "tocando agora".
//
// As faixas não tocam nota por nota em tempo real: cada seção (uns 8
// compassos) é gravada antes num OfflineAudioContext (band.ts) e depois só
// tocada como um buffer. Assim cabe uma produção caprichada (guitarras com
// amplificador, bateria sintetizada amostra por amostra, compressão) sem pesar
// no celular: enquanto uma seção toca, a próxima é gravada. Só as últimas
// seções ficam guardadas na memória.
//
// Nas cinemáticas do modo história, a música do jogo sai e entram os temas
// próprios de cada plano (CUES), que abaixam sozinhos quando alguém fala.
import { Band, SR } from "./band.ts";
import { CUES, TRACKS, type CueName, type Mood, type TrackDef } from "./tracks.ts";

export type SongName = Mood;
export type { CueName };

export interface TrackInfo {
  id: string;
  artist: string;
  title: string;
  mood: Mood;
}

/** Cauda gravada depois de cada seção (reverberação, prato soando): toca por baixo da seguinte. */
const TAIL = 2.5;
/** Quantas seções gravadas ficam guardadas. */
const KEEP = 5;

const sectionLength = (track: TrackDef, name: string) => (track.sections[name].bars * 240) / track.bpm;

/** Seções já gravadas (ou gravando), da mais antiga para a mais nova. */
const rendered = new Map<string, Promise<AudioBuffer | null>>();
/** Uma gravação de cada vez (não engasga o celular). */
let queue: Promise<unknown> = Promise.resolve();

function renderSection(track: TrackDef, entry: string): Promise<AudioBuffer | null> {
  const key = `${track.id}/${entry}`;
  const cached = rendered.get(key);
  if (cached) {
    // Usada de novo: vai para o fim da fila de descarte.
    rendered.delete(key);
    rendered.set(key, cached);
    return cached;
  }
  const [name, variant] = entry.split(":");
  const job = queue.then(async () => {
    try {
      const seconds = sectionLength(track, name) + TAIL;
      const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
      const band = new Band(ctx, { ...track.band, bpm: track.bpm });
      track.sections[name].play(band, Number(variant ?? 0));
      return await ctx.startRendering();
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
  track: TrackDef | null = null;

  constructor(ctx: AudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.out = out;
  }

  /** Toca `track` do começo. `onStart` quando o som começa de fato; `onEnd` no fim da forma (sem loop). */
  start(track: TrackDef, o: { fadeIn?: number; onStart?: () => void; onEnd?: () => void } = {}) {
    this.stop(0.6);
    const token = ++this.token;
    this.track = track;
    const gain = this.ctx.createGain();
    gain.connect(this.out);
    this.gain = gain;
    let index = 0;
    let nextAt = 0;
    let busy = false;
    let started = false;
    const entryAt = (i: number) => track.form[i];
    // Já pede as duas primeiras seções.
    void renderSection(track, entryAt(0));
    if (track.form.length > 1) void renderSection(track, entryAt(1));

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
      const entry = entryAt(index);
      const buffer = await renderSection(track, entry);
      busy = false;
      if (token !== this.token) return;
      // Gravando a seguinte enquanto esta toca.
      const following = index + 1 < track.form.length ? index + 1 : track.loopFrom;
      if (following !== undefined) void renderSection(track, entryAt(following));
      if (!buffer) {
        index++;
        return;
      }
      const now = this.ctx.currentTime;
      if (!started) {
        nextAt = now + 0.05;
        started = true;
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
      nextAt += sectionLength(track, entry.split(":")[0]);
      index++;
      void pump();
    };
    this.timer = setInterval(() => void pump(), 250);
    void pump();
  }

  stop(fade = 1) {
    this.token++;
    this.track = null;
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

/** Começa a gravar a primeira seção de um clima antes de precisar dele (a abertura); não precisa do áudio liberado. */
export function prefetchMood(mood: Mood) {
  const track = TRACKS.find((t) => t.mood === mood);
  if (track) void renderSection(track, track.form[0]);
}

const shuffle = <T,>(list: T[]) => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

export class Music {
  private ctx: AudioContext;
  private game: Deck;
  private cues: Deck;
  /** Abaixa a música quando alguém fala. */
  private duckGain: GainNode;
  private mood: Mood | null = null;
  private cue: CueName | null = null;
  private enabled = true;
  private playlists = new Map<Mood, TrackDef[]>();
  private lastByMood = new Map<Mood, string>();
  private duckUntil = 0;
  /** Faixa que começou (para o aviso "tocando agora"). */
  onTrack: ((info: TrackInfo) => void) | null = null;
  /** Faixa tocando agora (para os testes e o aviso). */
  current: TrackInfo | null = null;

  constructor(ctx: AudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.duckGain = ctx.createGain();
    this.duckGain.connect(out);
    this.game = new Deck(ctx, this.duckGain);
    this.cues = new Deck(ctx, this.duckGain);
  }

  /** Próxima faixa do clima, como um rádio: embaralha e não repete a última. */
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
    if (!this.enabled || mood === this.mood) return;
    const track = this.playlist(mood)[0];
    void renderSection(track, track.form[0]);
  }

  private startMood(mood: Mood, fadeIn = 0) {
    const track = this.nextTrack(mood);
    this.current = null;
    this.game.start(track, {
      fadeIn,
      onStart: () => {
        this.current = { id: track.id, artist: track.artist, title: track.title, mood };
        if (mood !== "trailer") this.onTrack?.(this.current);
      },
      // Fim da faixa: entra a próxima do mesmo clima.
      onEnd: () => {
        if (this.mood === mood && !this.cue && this.enabled) this.startMood(mood, 0.5);
      },
    });
  }

  play(mood: Mood) {
    if (mood === this.mood) return;
    this.mood = mood;
    if (this.cue || !this.enabled) return;
    this.startMood(mood);
  }

  stop() {
    this.mood = null;
    this.current = null;
    this.game.stop(1.2);
  }

  /** Música ligada/desligada nas opções: desligada, nem grava as seções. */
  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
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
    this.cues.start(CUES[name], { fadeIn: 0.15 });
  }

  /**
   * Tema da cinemática (null = acabou a cena e a música do jogo volta).
   * Trocando de plano dentro do mesmo tema, a cama continua.
   */
  setCue(name: CueName | null) {
    if (name === this.cue) return;
    const was = this.cue;
    this.cue = name;
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
    return { mood: this.mood, cue: this.cue, track: this.current?.id ?? null, enabled: this.enabled };
  }
}
