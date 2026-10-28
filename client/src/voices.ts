// Locuções gravadas (client/public/vozes/*.mp3, geradas por scripts/vozes.py).
// Baixadas sob demanda e guardadas decodificadas; sem rede ou sem áudio, a
// fala só não acontece. As falas do modo história ficam em vozes/historia/,
// uma por fala do roteiro (o id da fala em shared/src/story.ts).

export type VoiceLine =
  | "eat" | "nham" | "trailer-cidade" | "trailer-vigilancia" | "trailer-calorico"
  | "tres" | "dois" | "um" | "vai" | "ultima-volta" | "vitoria" | "chegada"
  | "radio-perseguicao" | "radio-escapou" | "radio-autuado"
  | `historia/${string}`;

const url = (line: VoiceLine) => `${import.meta.env.BASE_URL}vozes/${line}.mp3`;

export class Voices {
  private ctx: AudioContext | null = null;
  private out!: AudioNode;
  private reverb!: AudioNode;
  private files = new Map<VoiceLine, Promise<ArrayBuffer | null>>();
  private decoded = new Map<VoiceLine, Promise<AudioBuffer | null>>();
  private playing = new Set<AudioBufferSourceNode>();
  /** Fala pedida depois deste instante é ignorada se um `stopAll` veio no meio. */
  private generation = 0;
  /** Começou uma fala: daqui a `delay` s, durando `seconds` (a trilha abaixa). */
  onPlay: ((delay: number, seconds: number) => void) | null = null;

  attach(ctx: AudioContext, out: AudioNode, reverb: AudioNode) {
    this.ctx = ctx;
    this.out = out;
    this.reverb = reverb;
  }

  private fetchFile(line: VoiceLine) {
    let file = this.files.get(line);
    if (!file) {
      file = fetch(url(line))
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null);
      this.files.set(line, file);
    }
    return file;
  }

  /** Baixa os arquivos (não precisa do áudio liberado). */
  preload(lines: VoiceLine[]) {
    for (const line of lines) void this.fetchFile(line);
  }

  private buffer(line: VoiceLine) {
    let buffer = this.decoded.get(line);
    if (!buffer) {
      const ctx = this.ctx!;
      buffer = this.fetchFile(line).then((data) =>
        // `slice`: o decodificador "consome" o ArrayBuffer.
        data ? ctx.decodeAudioData(data.slice(0)).catch(() => null) : null,
      );
      this.decoded.set(line, buffer);
    }
    return buffer;
  }

  /** Toca uma fala daqui a `delay` s. `onEnd` recebe quanto falta (s) para ela acabar. */
  play(line: VoiceLine, delay = 0, options: { wet?: number; gain?: number; onEnd?: (remaining: number) => void } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const generation = this.generation;
    const asked = ctx.currentTime;
    void this.buffer(line).then((buffer) => {
      if (!buffer || generation !== this.generation) return;
      // Se a decodificação demorou, fala assim que der (não atrasa à toa).
      const start = Math.max(ctx.currentTime + 0.01, asked + delay);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = options.gain ?? 0.9;
      source.connect(gain).connect(this.out);
      if (options.wet) {
        const send = ctx.createGain();
        send.gain.value = options.wet;
        gain.connect(send).connect(this.reverb);
      }
      source.start(start);
      this.playing.add(source);
      source.onended = () => this.playing.delete(source);
      this.onPlay?.(start - ctx.currentTime, buffer.duration);
      options.onEnd?.(start - ctx.currentTime + buffer.duration);
    });
  }

  stopAll() {
    this.generation++;
    for (const source of this.playing) {
      try {
        source.stop();
      } catch {
        // Já tinha parado.
      }
    }
    this.playing.clear();
  }
}
