// Ferramentas de composição da trilha: tipos das faixas e ajudantes para
// escrever bateria, riffs e melodias em linhas de semicolcheias.
import type { Band, BandOptions } from "./band.ts";

export type Mood = "lobby" | "race" | "pursuit" | "duel" | "trailer";
export type CueName =
  | "chegada" | "cerco" | "sabotagem" | "rival" | "nota" | "radio" | "tv"
  | "fuga" | "ponte" | "fim" | "mia" | "sozinho";

export interface Section {
  bars: number;
  play: (b: Band, v: number) => void;
}

export interface TrackDef {
  id: string;
  artist: string;
  title: string;
  mood: Mood | "cue";
  bpm: number;
  band: Omit<BandOptions, "bpm">;
  sections: Record<string, Section>;
  /** Ordem das seções ("refrao:1" = seção "refrao", variação 1). */
  form: string[];
  /** Ao chegar no fim, volta para esta posição da forma (temas de cinemática, abertura). */
  loopFrom?: number;
  /** Tom (para o jukebox): "Mi menor", "Ré maior → Mi maior"... */
  key?: string;
  /** Estilo (para o jukebox): "darksynth", "boom bap"... */
  style?: string;
}

export const MOOD_LABELS: Record<Mood, string> = {
  pursuit: "Perseguição",
  race: "Corrida",
  lobby: "Cidade e menu",
  duel: "Duelo da Lista Gorda",
  trailer: "Abertura",
};

// --- Ajudantes de escrita -------------------------------------------------------------

/** Posições marcadas numa linha de 16 semicolcheias: "x" normal, "X" forte, "g" fantasma. */
export function hits(line: string) {
  const out: { step: number; vel: number }[] = [];
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "x") out.push({ step: i, vel: 0.85 });
    else if (c === "X") out.push({ step: i, vel: 1 });
    else if (c === "g") out.push({ step: i, vel: 0.35 });
  }
  return out;
}

export interface Groove {
  k?: string;
  s?: string;
  c?: string;
  h?: string;
  o?: string;
  r?: string;
  t?: string;
}

/** Toca um compasso de bateria (k bumbo, s caixa, c palma, h chimbal, o chimbal aberto, r condução, t taiko). */
export function drums(b: Band, bar: number, g: Groove, vel = 1) {
  for (const { step, vel: v } of hits(g.k ?? "")) b.kick(b.at(bar, step), v * vel);
  for (const { step, vel: v } of hits(g.s ?? "")) b.snare(b.at(bar, step), v * vel);
  for (const { step, vel: v } of hits(g.c ?? "")) b.clap(b.at(bar, step), v * vel);
  for (const { step, vel: v } of hits(g.h ?? "")) b.hat(b.at(bar, step), v * vel);
  for (const { step, vel: v } of hits(g.o ?? "")) b.hat(b.at(bar, step), v * vel, true);
  for (const { step, vel: v } of hits(g.r ?? "")) b.ride(b.at(bar, step), v * vel);
  for (const { step, vel: v } of hits(g.t ?? "")) b.taiko(b.at(bar, step), 36, v * vel);
}

/** Virada de caixa e tons nas últimas `steps` semicolcheias do compasso. */
export function fill(b: Band, bar: number, steps = 8, toms = [50, 47, 43, 40]) {
  for (let i = 16 - steps; i < 16; i++) {
    const k = i - (16 - steps);
    if (k < steps / 2) b.snare(b.at(bar, i), 0.5 + (k / steps) * 0.6);
    else b.tom(b.at(bar, i), toms[Math.min(toms.length - 1, Math.floor(((k - steps / 2) / (steps / 2)) * toms.length))], 0.9);
  }
}

/** Rufo de caixa acelerando (antes do refrão / drop). */
export function roll(b: Band, fromBar: number, bars: number) {
  for (let bar = 0; bar < bars; bar++) {
    const per = bar < bars - 1 ? 4 : 8;
    for (let i = 0; i < 16; i += 16 / (per * 2)) {
      b.snare(b.at(fromBar + bar, 0) + b.len(i), 0.3 + ((bar * 16 + i) / (bars * 16)) * 0.7);
    }
  }
}

/** Riff de guitarra: [semicolcheia, nota (raiz), duração em semicolcheias, abafado?]. */
export type Riff = [number, number, number, boolean?][];
export function riff(b: Band, bar: number, notes: Riff, vel = 1, withBass = true) {
  for (const [step, root, steps, mute] of notes) {
    b.chord(b.at(bar, step), root, b.len(steps) * 0.95, !!mute, vel);
    if (withBass) b.bass(b.at(bar, step), root - 12, b.len(steps) * 0.9, 0.9, !!mute);
  }
}

/** Melodia: [semicolcheia, nota, duração em semicolcheias]. */
export type Line = [number, number, number][];
