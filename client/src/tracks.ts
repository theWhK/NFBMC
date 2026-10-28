// A trilha original do jogo: as faixas (com bandas inventadas) e os temas das
// cinemáticas. Todas as melodias, riffs e progressões foram compostos para o
// NFBMC; o que se aproveita dos jogos de corrida dos anos 2000 é só o gênero e
// a energia (metal alternativo, big beat, hip-hop pesado).
//
// Cada faixa é uma lista de seções (geralmente de 8 compassos) e uma forma
// (introdução, verso, refrão, ponte, solo, final...). Cada seção é uma função
// que toca a banda (band.ts) compasso a compasso; `v` é a variação (o segundo
// refrão ganha solo, o último ganha bumbo duplo etc.).
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
}

// --- Ajudantes de escrita -------------------------------------------------------------

/** Posições marcadas numa linha de 16 semicolcheias: "x" normal, "X" forte, "g" fantasma. */
function hits(line: string) {
  const out: { step: number; vel: number }[] = [];
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "x") out.push({ step: i, vel: 0.85 });
    else if (c === "X") out.push({ step: i, vel: 1 });
    else if (c === "g") out.push({ step: i, vel: 0.35 });
  }
  return out;
}

interface Groove {
  k?: string;
  s?: string;
  c?: string;
  h?: string;
  o?: string;
  r?: string;
  t?: string;
}

/** Toca um compasso de bateria (k bumbo, s caixa, c palma, h chimbal, o chimbal aberto, r condução, t taiko). */
function drums(b: Band, bar: number, g: Groove, vel = 1) {
  for (const { step, vel: v } of hits(g.k ?? "")) b.kick(b.at(bar, step), v * vel);
  for (const { step, vel: v } of hits(g.s ?? "")) b.snare(b.at(bar, step), v * vel);
  for (const { step, vel: v } of hits(g.c ?? "")) b.clap(b.at(bar, step), v * vel);
  for (const { step, vel: v } of hits(g.h ?? "")) b.hat(b.at(bar, step), v * vel);
  for (const { step, vel: v } of hits(g.o ?? "")) b.hat(b.at(bar, step), v * vel, true);
  for (const { step, vel: v } of hits(g.r ?? "")) b.ride(b.at(bar, step), v * vel);
  for (const { step, vel: v } of hits(g.t ?? "")) b.taiko(b.at(bar, step), 36, v * vel);
}

/** Virada de caixa e tons nas últimas `steps` semicolcheias do compasso. */
function fill(b: Band, bar: number, steps = 8, toms = [50, 47, 43, 40]) {
  for (let i = 16 - steps; i < 16; i++) {
    const k = i - (16 - steps);
    if (k < steps / 2) b.snare(b.at(bar, i), 0.5 + (k / steps) * 0.6);
    else b.tom(b.at(bar, i), toms[Math.min(toms.length - 1, Math.floor(((k - steps / 2) / (steps / 2)) * toms.length))], 0.9);
  }
}

/** Rufo de caixa acelerando (antes do refrão / drop). */
function roll(b: Band, fromBar: number, bars: number) {
  for (let bar = 0; bar < bars; bar++) {
    const per = bar < bars - 1 ? 4 : 8;
    for (let i = 0; i < 16; i += 16 / (per * 2)) {
      b.snare(b.at(fromBar + bar, 0) + b.len(i), 0.3 + ((bar * 16 + i) / (bars * 16)) * 0.7);
    }
  }
}

/** Riff de guitarra: [semicolcheia, nota (raiz), duração em semicolcheias, abafado?]. */
type Riff = [number, number, number, boolean?][];
function riff(b: Band, bar: number, notes: Riff, vel = 1, withBass = true) {
  for (const [step, root, steps, mute] of notes) {
    b.chord(b.at(bar, step), root, b.len(steps) * 0.95, !!mute, vel);
    if (withBass) b.bass(b.at(bar, step), root - 12, b.len(steps) * 0.9, 0.9, !!mute);
  }
}

/** Melodia: [semicolcheia, nota, duração em semicolcheias]. */
type Line = [number, number, number][];

// =====================================================================================
// PERSEGUIÇÃO 1: Coxinha Mecânica – "Fritura Total" (metal alternativo, 168 bpm, Mi)
// =====================================================================================
const E = 40;
const FT_RIFF_A: Riff = [[0, E, 2], [2, E, 1, true], [3, E, 1, true], [4, E + 3, 2], [6, E, 1, true], [7, E, 1, true], [8, E + 1, 3], [11, E, 1, true], [12, E, 1, true], [13, E, 1, true], [14, E - 2, 2]];
const FT_RIFF_B: Riff = [[0, E, 2], [2, E, 1, true], [3, E, 1, true], [4, E + 3, 2], [6, E, 1, true], [7, E, 1, true], [8, E + 5, 2], [10, E + 3, 2], [12, E + 1, 3], [15, E, 1, true]];
const FT_KICK = "x.xx..xx..x.xxx.";
const FT_CHORUS_ROOTS = [E, 48, 43, 50, E, 48, 47, 47];
const FT_CHORUS_SPLIT = [false, true, false, false, false, true, false, false];
const FT_MELODY: Line[] = [
  [[0, 71, 6], [6, 74, 2], [8, 72, 4], [12, 71, 4]],
  [[0, 69, 8], [8, 67, 4], [12, 66, 4]],
  [[0, 67, 6], [6, 71, 2], [8, 74, 8]],
  [[0, 72, 8], [8, 71, 4], [12, 69, 4]],
  [[0, 71, 6], [6, 74, 2], [8, 76, 8]],
  [[0, 74, 4], [4, 72, 4], [8, 71, 8]],
  [[0, 66, 8], [8, 69, 8]],
  [[0, 71, 16]],
];

function ftChorusBar(b: Band, bar: number, i: number, v: number) {
  const root = FT_CHORUS_ROOTS[i];
  const second = FT_CHORUS_SPLIT[i] ? root + 2 : root;
  for (const [step, len] of [[0, 3], [3, 3], [6, 2], [8, 3], [11, 3], [14, 2]]) {
    const r = step >= 8 ? second : root;
    b.chord(b.at(bar, step), r, b.len(len) * 0.95, false, 0.95);
    b.bass(b.at(bar, step), r - 12, b.len(len) * 0.9);
  }
  drums(b, bar, { k: v >= 2 ? "xxxxxxxxxxxxxxxx" : "x..x..x.x..x..x.", s: "....X.......X...", r: "x.x.x.x.x.x.x.x." }, v >= 2 ? 0.9 : 1);
  if (i % 4 === 0) b.crash(b.at(bar, 0), 0.9, i % 8 ? -0.4 : 0.4);
  if (v >= 1) for (const [step, note, len] of FT_MELODY[i]) b.guitarLead(b.at(bar, step), note, b.len(len));
}

const FRITURA_TOTAL: TrackDef = {
  id: "fritura-total", artist: "Coxinha Mecânica", title: "Fritura Total", mood: "pursuit", bpm: 168,
  band: { kit: "rock", drive: 22, trim: 0.69 },
  sections: {
    intro: {
      bars: 4,
      play(b) {
        for (let bar = 0; bar < 4; bar++) {
          riff(b, bar, bar % 2 ? FT_RIFF_B : FT_RIFF_A, 1, bar >= 2);
          if (bar >= 2) drums(b, bar, { k: FT_KICK, h: "x.x.x.x.x.x.x.x.", s: "....x.......x..." });
          else drums(b, bar, { h: "x...x...x...x..." }, 0.7);
        }
        fill(b, 3, 4);
      },
    },
    verso: {
      bars: 8,
      play(b, v) {
        for (let bar = 0; bar < 8; bar++) {
          riff(b, bar, bar % 2 ? FT_RIFF_B : FT_RIFF_A);
          drums(b, bar, { k: v ? "x.xxx.xx..xxxxx." : FT_KICK, s: "....X.......X...", h: v ? "xxxxxxxxxxxxxxxx" : "x.x.x.x.x.x.x.x." }, v ? 0.9 : 1);
          if (bar === 0) b.crash(b.at(0, 0));
        }
        fill(b, 7, 4);
      },
    },
    pre: {
      bars: 4,
      play(b) {
        const roots = [48, 50, E, E];
        for (let bar = 0; bar < 4; bar++) {
          for (let s = 0; s < 16; s += 2) {
            const open = s === 0 || s === 6 || s === 12;
            b.chord(b.at(bar, s), roots[bar], b.len(open ? 2 : 1), !open, open ? 0.9 : 0.8);
            b.bass(b.at(bar, s), roots[bar] - 12, b.len(2));
          }
          drums(b, bar, { k: "x.....x.x.....x.", h: "x.x.x.x.x.x.x.x.", s: bar < 2 ? "....x.......x..." : "" });
        }
        roll(b, 2, 2);
        b.riser(b.at(2, 0), b.barTime * 2);
      },
    },
    refrao: {
      bars: 8,
      play(b, v) {
        for (let i = 0; i < 8; i++) ftChorusBar(b, i, i, v);
        fill(b, 7, 4);
      },
    },
    queda: {
      bars: 8,
      play(b) {
        // Ponte pesada em meio-tempo: "tchugs" com respiro e a caixa só no 3.
        const chug: Riff = [[0, E, 1, true], [1, E, 1, true], [3, E, 1, true], [6, E, 3], [10, E, 1, true], [11, E, 1, true], [12, E + 1, 4]];
        for (let bar = 0; bar < 8; bar++) {
          riff(b, bar, bar === 7 ? [[0, E - 2, 16]] : chug, 1);
          drums(b, bar, bar === 7 ? { k: "X..............." } : { k: "xx.x..x...xx....", s: "........X.......", h: "x...x...x...x..." });
          if (bar % 2 === 0) b.crash(b.at(bar, 0), 0.7);
        }
        roll(b, 7, 1);
      },
    },
    solo: {
      bars: 8,
      play(b) {
        // Solo de guitarra na escala de Mi menor (pentatônica com a nona), sobre o riff.
        const scale = [64, 67, 69, 71, 74, 76, 78, 79, 81, 83];
        const shape = [0, 2, 4, 3, 5, 4, 6, 7, 5, 8, 9, 7, 6, 4, 3, 1];
        for (let bar = 0; bar < 8; bar++) {
          riff(b, bar, bar % 2 ? FT_RIFF_B : FT_RIFF_A, 0.75);
          drums(b, bar, { k: FT_KICK, s: "....X.......X...", r: "x.x.x.x.x.x.x.x." });
          const fast = bar >= 4;
          for (let s = 0; s < 16; s += fast ? 1 : 2) {
            const idx = Math.min(scale.length - 1, Math.max(0, shape[(s + bar * 3) % 16] + (bar % 4 === 3 ? 1 : 0)));
            b.guitarLead(b.at(bar, s), scale[idx], b.len(fast ? 1 : 2) * 0.95, 0.8);
          }
        }
        b.guitarLead(b.at(7, 12), 83, b.len(4), 1);
        fill(b, 7, 8);
      },
    },
    final: {
      bars: 4,
      play(b) {
        riff(b, 0, FT_RIFF_A);
        riff(b, 1, FT_RIFF_B);
        drums(b, 0, { k: FT_KICK, s: "....X.......X...", h: "x.x.x.x.x.x.x.x." });
        drums(b, 1, { k: FT_KICK, s: "....X.......X...", h: "x.x.x.x.x.x.x.x." });
        // Acorde final segurado com rufo nos tons e a pancada.
        b.chord(b.at(2, 0), E, b.barTime * 2, false, 1);
        b.bass(b.at(2, 0), E - 12, b.barTime * 2);
        b.crash(b.at(2, 0), 1, -0.4);
        b.crash(b.at(2, 0), 1, 0.4);
        for (let i = 0; i < 24; i++) b.tom(b.at(2, 4) + b.len(i), [50, 47, 43, 40][Math.floor(i / 6)], 0.5 + i / 48);
        b.kick(b.at(3, 12), 1);
        b.crash(b.at(3, 12), 1);
      },
    },
  },
  form: ["intro", "verso", "verso:1", "pre", "refrao", "verso", "pre", "refrao:1", "queda", "solo", "pre", "refrao:1", "refrao:2", "final"],
};

// =====================================================================================
// PERSEGUIÇÃO 2: Os Torresmos – "Banha Elétrica" (nu-metal com eletrônica, 152 bpm, Ré)
// =====================================================================================
const D = 38;
const BE_RIFF_A: Riff = [[0, D, 1, true], [1, D, 1, true], [2, D, 2], [6, D, 1, true], [7, D + 3, 2], [9, D, 1, true], [10, D, 1, true], [11, D + 6, 2], [13, D + 5, 3]];
const BE_RIFF_B: Riff = [[0, D, 1, true], [1, D, 1, true], [2, D, 2], [6, D, 1, true], [7, D + 3, 2], [9, D, 1, true], [10, D + 8, 3], [13, D + 7, 3]];
const BE_GROOVE: Groove = { k: "xx....x..xx.....", s: "....X.......X...", h: "x.xxx.xxx.xxx.xx" };
const BE_CHORUS = [D, 46, 41, 48, D, 46, 41, 45];
const BE_HOOK: Line[] = [
  [[0, 74, 4], [4, 72, 2], [6, 69, 6], [12, 70, 4]],
  [[0, 70, 8], [8, 69, 4], [12, 65, 4]],
  [[0, 65, 4], [4, 69, 4], [8, 72, 8]],
  [[0, 72, 6], [6, 74, 2], [8, 76, 8]],
];

const BANHA_ELETRICA: TrackDef = {
  id: "banha-eletrica", artist: "Os Torresmos", title: "Banha Elétrica", mood: "pursuit", bpm: 152,
  band: { kit: "rock", drive: 26, trim: 0.69 },
  sections: {
    intro: {
      bars: 4,
      play(b) {
        // Só bateria e arranhado; o riff entra no fim.
        for (let bar = 0; bar < 4; bar++) {
          drums(b, bar, { k: "x.....x..x......", h: "x.x.x.x.x.x.x.x.", s: bar >= 2 ? "....x.......x..." : "" }, 0.8);
          b.scratch(b.at(bar, 0), 62, [1, -1, 1, 0, 1.5, -1.5, 0, 0]);
          b.saws(b.at(bar, 0), [62, 65, 69], b.barTime * 0.95, { cutoff: 900 + bar * 500, attack: 0.3, send: 0.4 });
        }
        riff(b, 3, [[8, D, 2], [10, D, 2], [12, D + 3, 2], [14, D + 6, 2]]);
      },
    },
    verso: {
      bars: 8,
      play(b, v) {
        for (let bar = 0; bar < 8; bar++) {
          riff(b, bar, bar % 2 ? BE_RIFF_B : BE_RIFF_A);
          drums(b, bar, BE_GROOVE);
          if (v && bar % 4 === 3) b.scratch(b.at(bar, 8), 64, [1, -1, 2, -2, 1, -1, 0, 0]);
          if (v && bar % 2 === 0) b.saws(b.at(bar, 0), [74, 77, 81], b.barTime * 1.9, { vel: 0.5, cutoff: 1800, attack: 0.2, send: 0.4 });
        }
        b.crash(b.at(0, 0));
        fill(b, 7, 4);
      },
    },
    refrao: {
      bars: 8,
      play(b, v) {
        for (let bar = 0; bar < 8; bar++) {
          const root = BE_CHORUS[bar];
          for (const [step, len, mute] of [[0, 6, false], [6, 1, true], [7, 1, true], [8, 6, false], [14, 1, true], [15, 1, true]] as const) {
            b.chord(b.at(bar, step), root, b.len(len) * 0.95, mute, 1);
            b.bass(b.at(bar, step), root - 12, b.len(len) * 0.9, 1, mute);
          }
          drums(b, bar, { k: "x.....x.x.....x.", s: "....X.......X...", r: "x.x.x.x.x.x.x.x." });
          if (bar % 4 === 0) b.crash(b.at(bar, 0), 0.9);
          if (v >= 1 && bar % 2 === 0) b.choir(b.at(bar, 0), [root + 24, root + 31], b.barTime * 1.9, 0.7);
          if (v >= 2) for (const [s, n, l] of BE_HOOK[bar % 4]) b.lead(b.at(bar, s), n, b.len(l) * 0.95, { vel: 0.9 });
        }
        fill(b, 7, 4);
      },
    },
    ponte: {
      bars: 8,
      play(b) {
        // Respiro: baixo grave, batida quebrada e arranhados.
        for (let bar = 0; bar < 8; bar++) {
          drums(b, bar, { k: "x.....x...x.....", s: "....x.......x..g", h: "x.x.x.x.x.x.x.x." }, 0.8);
          b.reese(b.at(bar, 0), [D, D, 41, 36][bar % 4], b.barTime * 0.95, 0.9, 700 + bar * 120);
          if (bar % 2 === 1) b.scratch(b.at(bar, 8), 66, [1, -1, 1, -1, 2, -2, 0, 0]);
        }
      },
    },
    subida: {
      bars: 4,
      play(b) {
        for (let bar = 0; bar < 4; bar++) {
          for (let s = 0; s < 16; s++) b.chord(b.at(bar, s), D, b.len(1) * 0.9, true, 0.5 + (bar * 16 + s) / 128);
          drums(b, bar, { k: "x...x...x...x...", h: "x.x.x.x.x.x.x.x." });
        }
        roll(b, 2, 2);
        b.riser(b.at(0, 0), b.barTime * 4);
      },
    },
    final: {
      bars: 4,
      play(b) {
        for (let bar = 0; bar < 2; bar++) {
          riff(b, bar, bar ? BE_RIFF_B : BE_RIFF_A);
          drums(b, bar, BE_GROOVE);
        }
        riff(b, 2, [[0, D, 2], [3, D, 2], [6, D + 3, 2], [9, D + 6, 2], [12, D, 4]]);
        drums(b, 2, { k: "X..X..X..X..X...", s: "X..X..X..X..X..." });
        b.crash(b.at(3, 0), 1);
        b.chord(b.at(3, 0), D, b.barTime, false, 1);
        b.kick(b.at(3, 0));
      },
    },
  },
  form: ["intro", "verso", "verso:1", "refrao", "verso:1", "refrao:1", "ponte", "subida", "refrao:1", "refrao:2", "final"],
};

// =====================================================================================
// CORRIDA 1: DJ Maionese – "Molho Especial" (big beat, 134 bpm, Lá menor)
// =====================================================================================
const MO_BREAK: Groove = { k: "X.........x.x...", s: "....X..g.g..X..g", h: "xgxgxgxgxgxgxgxg", o: "..............x." };
const MO_ACID: [number, number, boolean, number?][] = [
  [0, 45, true], [2, 45, false], [3, 57, false], [5, 45, false], [6, 55, true, 57], [8, 45, false], [10, 48, true], [11, 45, false], [13, 52, false], [14, 45, true, 57], [15, 57, false],
];
const MO_CHORDS = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]];
const MO_HOOK: Line[] = [
  [[0, 76, 3], [3, 74, 3], [6, 72, 2], [8, 69, 4], [12, 72, 2], [14, 74, 2]],
  [[0, 76, 4], [4, 79, 4], [8, 77, 6], [14, 76, 2]],
  [[0, 74, 3], [3, 72, 3], [6, 71, 2], [8, 67, 4], [12, 71, 2], [14, 72, 2]],
  [[0, 74, 6], [6, 76, 2], [8, 71, 8]],
];

function moAcid(b: Band, bar: number, cutoff: number) {
  for (const [s, n, accent, slide] of MO_ACID) b.acid(b.at(bar, s), n - 12, b.len(1) * 0.9, accent, cutoff, slide !== undefined ? slide - 12 : undefined);
}

function moStabs(b: Band, bar: number, vel = 1) {
  const chord = MO_CHORDS[Math.floor(bar / 2) % 4];
  for (const s of bar % 2 ? [0, 6] : [0, 3, 6, 10]) b.stab(b.at(bar, s), chord, b.len(2), vel);
}

const MOLHO_ESPECIAL: TrackDef = {
  id: "molho-especial", artist: "DJ Maionese", title: "Molho Especial", mood: "race", bpm: 134,
  band: { kit: "break", pump: 0.55, drive: 16, trim: 0.64 },
  sections: {
    intro: {
      bars: 8,
      play(b) {
        for (let bar = 0; bar < 8; bar++) {
          drums(b, bar, bar < 4 ? { h: "xgxgxgxgxgxgxgxg", s: "....x.......x..." } : MO_BREAK, bar < 4 ? 0.6 : 0.8);
          moAcid(b, bar, 300 + bar * 60);
        }
      },
    },
    subida: {
      bars: 8,
      play(b, v) {
        for (let bar = 0; bar < 8; bar++) {
          if (bar < 6) drums(b, bar, MO_BREAK);
          moAcid(b, bar, 500 + bar * 150);
          if (v) b.saws(b.at(bar, 0), MO_CHORDS[Math.floor(bar / 2) % 4].map((n) => n + 12), b.barTime * 0.95, { vel: 0.6, cutoff: 1200 + bar * 300, attack: 0.05, send: 0.3 });
        }
        roll(b, 6, 2);
        b.riser(b.at(4, 0), b.barTime * 4);
      },
    },
    drop: {
      bars: 8,
      play(b, v) {
        for (let bar = 0; bar < 8; bar++) {
          drums(b, bar, { ...MO_BREAK, c: "....x.......x..." });
          moAcid(b, bar, 1400);
          b.sub(b.at(bar, 0), 33, b.len(6));
          if (v >= 1) moStabs(b, bar);
          if (v >= 2) {
            for (const [s, n, l] of MO_HOOK[bar % 4]) b.lead(b.at(bar, s), n, b.len(l) * 0.9, { vel: 0.8, type: "sawtooth" });
            // Guitarra de big beat: power chords pesados no 1 e no "e" do 2.
            const root = [45, 41, 43, 40][Math.floor(bar / 2) % 4];
            b.chord(b.at(bar, 0), root, b.len(3), false, 0.8);
            b.chord(b.at(bar, 6), root, b.len(2), false, 0.7);
          }
          if (bar % 4 === 0) b.crash(b.at(bar, 0));
        }
      },
    },
    respiro: {
      bars: 8,
      play(b) {
        for (let bar = 0; bar < 8; bar++) {
          b.saws(b.at(bar, 0), MO_CHORDS[Math.floor(bar / 2) % 4], b.barTime, { vel: 0.8, cutoff: 2000, attack: 0.3, release: 0.6, send: 0.5, voices: 5 });
          drums(b, bar, { h: "x.x.x.x.x.x.x.x." }, 0.5);
          if (bar >= 2) for (const [s, n, l] of MO_HOOK[bar % 4]) b.bell(b.at(bar, s), n, b.len(l) * 2, 0.8);
          if (bar >= 4) moAcid(b, bar, 400);
        }
        b.choir(b.at(4, 0), [69, 76], b.barTime * 4, 0.6);
      },
    },
    final: {
      bars: 8,
      play(b) {
        for (let bar = 0; bar < 8; bar++) {
          if (bar < 6) drums(b, bar, MO_BREAK, 1 - bar * 0.1);
          moAcid(b, bar, 1400 - bar * 150);
        }
        b.hit(b.at(7, 0), 0.6);
      },
    },
  },
  form: ["intro", "subida", "drop", "drop:1", "respiro", "subida:1", "drop:2", "drop:1", "respiro", "subida:1", "drop:2", "final"],
};

// =====================================================================================
// CORRIDA 2: Kebab Kollective – "Espeto Corrido" (breakbeat, 142 bpm, Fá# menor)
// =====================================================================================
const KK_BREAK_A: Groove = { k: "X.x.......X.....", s: "....X..g.g.gX..g", h: "x.x.x.x.x.x.x.xx" };
const KK_BREAK_B: Groove = { k: "X.x....x..x.x...", s: "....X..g.g..X.gg", h: "x.x.x.x.x.x.x.x.", o: "......x........." };
const KK_REESE: Line = [[0, 42, 6], [6, 45, 2], [8, 40, 4], [12, 38, 4]];
const KK_ARP = [66, 69, 73, 76, 73, 69, 66, 69];
const KK_ROOTS = [42, 38, 40, 37];

const ESPETO_CORRIDO: TrackDef = {
  id: "espeto-corrido", artist: "Kebab Kollective", title: "Espeto Corrido", mood: "race", bpm: 142,
  band: { kit: "break", pump: 0.4, drive: 20, trim: 0.72 },
  sections: {
    intro: {
      bars: 8,
      play(b) {
        for (let bar = 0; bar < 8; bar++) {
          const shift = KK_ROOTS[Math.floor(bar / 2) % 4] - 42;
          for (let s = 0; s < 16; s++) b.saws(b.at(bar, s), [KK_ARP[s % 8] + shift], b.len(1) * 0.7, { vel: 0.9, cutoff: 900 + bar * 250, voices: 2, echo: 0.3, release: 0.05 });
          if (bar >= 4) drums(b, bar, { h: "x.x.x.x.x.x.x.x.", k: "x.......x......." }, 0.7);
        }
        b.riser(b.at(6, 0), b.barTime * 2);
      },
    },
    batida: {
      bars: 8,
      play(b, v) {
        for (let bar = 0; bar < 8; bar++) {
          drums(b, bar, bar % 2 ? KK_BREAK_B : KK_BREAK_A);
          const shift = KK_ROOTS[Math.floor(bar / 2) % 4] - 42;
          for (const [s, n, l] of KK_REESE) b.reese(b.at(bar, s), n + (s === 0 ? shift : 0) - 12, b.len(l) * 0.95, 1, 900);
          if (v) for (let s = 0; s < 16; s += 2) b.saws(b.at(bar, s), [KK_ARP[(s / 2) % 8] + shift + 12], b.len(1), { vel: 0.6, cutoff: 3000, voices: 2, echo: 0.35 });
        }
        b.crash(b.at(0, 0));
      },
    },
    drop: {
      bars: 8,
      play(b, v) {
        for (let bar = 0; bar < 8; bar++) {
          drums(b, bar, { ...(bar % 2 ? KK_BREAK_B : KK_BREAK_A), c: "....x.......x..." });
          const root = KK_ROOTS[Math.floor(bar / 2) % 4];
          b.reese(b.at(bar, 0), root - 12, b.len(7), 1, 1200);
          b.reese(b.at(bar, 8), root - 12, b.len(7), 1, 1200);
          // Guitarras de big beat em colcheias.
          for (let s = 0; s < 16; s += 2) b.chord(b.at(bar, s), root < 40 ? root + 12 : root, b.len(2) * 0.9, s % 4 === 2, s % 8 === 0 ? 1 : 0.8);
          if (v >= 1) {
            const melody: Line = bar % 2 ? [[0, 81, 4], [4, 80, 4], [8, 76, 8]] : [[0, 78, 3], [3, 76, 3], [6, 73, 2], [8, 76, 6], [14, 78, 2]];
            for (const [s, n, l] of melody) b.lead(b.at(bar, s), n + (root - 42 === -4 ? -2 : 0), b.len(l) * 0.9, { vel: 0.8 });
          }
          if (bar % 4 === 0) b.crash(b.at(bar, 0), 1);
        }
      },
    },
    meio: {
      bars: 8,
      play(b) {
        for (let bar = 0; bar < 8; bar++) {
          const root = KK_ROOTS[Math.floor(bar / 2) % 4];
          b.saws(b.at(bar, 0), [root + 24, root + 27, root + 31], b.barTime, { cutoff: 1500, attack: 0.4, release: 0.8, send: 0.6, voices: 5 });
          b.sub(b.at(bar, 0), root - 12, b.barTime * 0.9, 0.7);
          if (bar >= 4) drums(b, bar, { k: "x.......x.......", h: "..x...x...x...x." }, 0.7);
        }
        roll(b, 6, 2);
        b.riser(b.at(4, 0), b.barTime * 4);
      },
    },
    final: {
      bars: 8,
      play(b) {
        for (let bar = 0; bar < 8; bar++) {
          if (bar < 7) drums(b, bar, bar % 2 ? KK_BREAK_B : KK_BREAK_A, 1 - bar * 0.08);
          for (let s = 0; s < 16; s++) b.saws(b.at(bar, s), [KK_ARP[s % 8]], b.len(1) * 0.7, { vel: 0.8 - bar * 0.08, cutoff: 3000 - bar * 300, voices: 2, echo: 0.3, release: 0.05 });
        }
        b.hit(b.at(7, 8), 0.5);
      },
    },
  },
  form: ["intro", "batida", "batida:1", "drop", "drop:1", "meio", "batida:1", "drop", "drop:1", "meio", "drop:1", "final"],
};

// =====================================================================================
// CIDADE 1: MC Pastel de Feira – "Recheio Pesado" (boom bap, 88 bpm, Dó menor)
// =====================================================================================
const RP_CHORDS = [[60, 63, 67, 70], [56, 60, 63, 67], [53, 56, 60, 63, 67], [55, 59, 62, 65]];
const RP_BASS = [36, 32, 29, 31];
const RP_BEAT: Groove = { k: "X......x..x.....", s: "....X.......X...", h: "x.x.x.x.x.x.x.xg" };
const RP_BEAT_B: Groove = { k: "X.....x...x..x..", s: "....X.......X...", h: "x.xgx.x.x.xgx.x.", o: "..............x." };
const RP_HOOK: Line[] = [
  [[0, 67, 3], [3, 70, 3], [6, 72, 4], [12, 75, 4]],
  [[0, 74, 6], [6, 72, 2], [8, 68, 8]],
  [[0, 65, 3], [3, 68, 3], [6, 72, 4], [12, 70, 4]],
  [[0, 71, 8], [8, 74, 4], [12, 71, 4]],
];

function rpPiano(b: Band, bar: number, vel = 1) {
  const chord = RP_CHORDS[bar % 4];
  b.piano(b.at(bar, 0), chord, b.len(6), 0.8 * vel);
  b.piano(b.at(bar, 7), chord.slice(1), b.len(2), 0.5 * vel);
  b.piano(b.at(bar, 10), chord, b.len(5), 0.65 * vel);
}

function rpBass(b: Band, bar: number, busy: boolean) {
  const root = RP_BASS[bar % 4];
  b.sub(b.at(bar, 0), root, b.len(6));
  b.sub(b.at(bar, 7), root, b.len(2), 0.8);
  b.sub(b.at(bar, 10), busy ? root + 7 : root, b.len(4), 0.9, busy ? root : undefined);
  if (busy) b.sub(b.at(bar, 14), root + 12, b.len(2), 0.7, root + 7);
}

const RECHEIO_PESADO: TrackDef = {
  id: "recheio-pesado", artist: "MC Pastel de Feira", title: "Recheio Pesado", mood: "lobby", bpm: 88,
  band: { kit: "boom", swing: 0.45, trim: 0.72 },
  sections: {
    intro: {
      bars: 4,
      play(b) {
        b.crackle(0, b.barTime * 4);
        for (let bar = 0; bar < 4; bar++) rpPiano(b, bar, 0.7);
        drums(b, 3, { s: "............X.X." });
        b.scratch(b.at(3, 0), 60, [1, -1, 1, -1, 0, 0, 2, -2]);
      },
    },
    verso: {
      bars: 8,
      play(b, v) {
        b.crackle(0, b.barTime * 8);
        for (let bar = 0; bar < 8; bar++) {
          drums(b, bar, v && bar % 2 ? RP_BEAT_B : RP_BEAT);
          rpPiano(b, bar, 0.75);
          rpBass(b, bar, !!v);
          if (v && bar % 4 === 1) b.strings(b.at(bar, 0), [72, 75, 79], b.barTime * 2, 0.4);
        }
      },
    },
    refrao: {
      bars: 8,
      play(b, v) {
        b.crackle(0, b.barTime * 8);
        for (let bar = 0; bar < 8; bar++) {
          drums(b, bar, RP_BEAT_B);
          rpBass(b, bar, true);
          const chord = RP_CHORDS[bar % 4];
          // Metais pesados no contratempo.
          b.brass(b.at(bar, 0), chord.slice(0, 3).map((n) => n + 12), b.len(3), 1);
          b.brass(b.at(bar, 6), chord.slice(0, 3).map((n) => n + 12), b.len(2), 0.8);
          b.strings(b.at(bar, 0), chord.map((n) => n + 12), b.barTime, 0.5, 0.1);
          if (v) for (const [s, n, l] of RP_HOOK[bar % 4]) b.lead(b.at(bar, s), n + 12, b.len(l) * 0.9, { vel: 0.75, cutoff: 2500 });
          if (bar % 4 === 3) b.scratch(b.at(bar, 8), 62, [1, -1, 2, -2, 1, 0, -1, 0]);
        }
        b.crash(b.at(0, 0), 0.6);
      },
    },
    ponte: {
      bars: 8,
      play(b) {
        b.crackle(0, b.barTime * 8);
        for (let bar = 0; bar < 8; bar++) {
          b.strings(b.at(bar, 0), RP_CHORDS[(bar + 2) % 4], b.barTime, 0.7, 0.5);
          drums(b, bar, bar < 6 ? { h: "x.x.x.x.x.x.x.x." } : RP_BEAT, 0.7);
          if (bar % 2 === 0) b.piano(b.at(bar, 0), [RP_CHORDS[(bar + 2) % 4][0] + 12], b.len(8), 0.6);
        }
        rpBass(b, 6, false);
        rpBass(b, 7, true);
      },
    },
    final: {
      bars: 4,
      play(b) {
        b.crackle(0, b.barTime * 4);
        for (let bar = 0; bar < 4; bar++) {
          rpPiano(b, bar, 0.8 - bar * 0.15);
          if (bar < 2) drums(b, bar, RP_BEAT, 0.8);
        }
        b.scratch(b.at(3, 8), 58, [1, -1, 0.5, -0.5, 0, 0, 0, 0]);
      },
    },
  },
  form: ["intro", "verso", "verso:1", "refrao", "verso:1", "refrao:1", "ponte", "refrao:1", "verso", "final"],
};

// =====================================================================================
// CIDADE 2: Sindicato do Torresmo – "Barriga Cheia" (hip-hop de 808, 96 bpm, Sol menor)
// =====================================================================================
const BC_808: [number, number, number, number?][] = [[0, 31, 3], [3, 31, 3], [6, 34, 2, 31], [10, 31, 2], [12, 29, 2], [14, 26, 2, 29]];
const BC_HOOK: Line = [[0, 67, 1], [2, 67, 1], [3, 70, 2], [6, 69, 1], [8, 67, 2], [10, 65, 1], [11, 62, 3], [14, 65, 2]];
const BC_HOOK2: Line = [[0, 67, 1], [2, 67, 1], [3, 70, 2], [6, 72, 2], [8, 74, 3], [11, 72, 1], [12, 70, 4]];
const BC_BEAT: Groove = { k: "X..x..x...x.x...", c: "....X.......X...", h: "x.x.x.x.x.x.x.x." };

function bcHatRoll(b: Band, bar: number) {
  // Rolo de chimbal em fusas no fim do compasso (o "trrrr" do sul dos EUA dos anos 2000).
  for (let i = 0; i < 8; i++) b.hat(b.at(bar, 12) + b.len(i * 0.5), 0.4 + i * 0.07);
}

const BARRIGA_CHEIA: TrackDef = {
  id: "barriga-cheia", artist: "Sindicato do Torresmo", title: "Barriga Cheia", mood: "lobby", bpm: 96,
  band: { kit: "crunk", swing: 0.15, trim: 0.76 },
  sections: {
    intro: {
      bars: 4,
      play(b) {
        for (let bar = 0; bar < 4; bar++) {
          for (const [s, n, l] of BC_HOOK) b.lead(b.at(bar, s), n, b.len(l) * 0.8, { vel: 0.7, cutoff: 900 + bar * 600, type: "square", echo: 0.2 });
          if (bar >= 2) drums(b, bar, { c: "....X.......X..." }, 0.8);
        }
        b.riser(b.at(2, 0), b.barTime * 2, 0.6);
      },
    },
    verso: {
      bars: 8,
      play(b, v) {
        for (let bar = 0; bar < 8; bar++) {
          drums(b, bar, BC_BEAT);
          if (bar % 4 === 3) bcHatRoll(b, bar);
          for (const [s, n, l, from] of BC_808) b.sub(b.at(bar, s), n, b.len(l) * 0.95, 1, from);
          if (bar % 2 === 0) b.saws(b.at(bar, 0), [55, 58, 62], b.barTime * 2, { vel: 0.5, cutoff: 1400, attack: 0.2, send: 0.4 });
          if (v) for (const s of [0, 3, 6]) b.stab(b.at(bar, s), [67, 70, 74], b.len(1), 0.7, 3000);
        }
      },
    },
    refrao: {
      bars: 8,
      play(b, v) {
        for (let bar = 0; bar < 8; bar++) {
          drums(b, bar, { ...BC_BEAT, o: "..............x." });
          if (bar % 2 === 1) bcHatRoll(b, bar);
          for (const [s, n, l, from] of BC_808) b.sub(b.at(bar, s), n, b.len(l) * 0.95, 1, from);
          for (const [s, n, l] of bar % 2 ? BC_HOOK2 : BC_HOOK) b.lead(b.at(bar, s), n + 12, b.len(l) * 0.85, { vel: 0.85, type: "square", cutoff: 3000 });
          b.brass(b.at(bar, 0), [55, 58, 62], b.len(2), 0.9);
          b.brass(b.at(bar, 8), [53, 57, 60], b.len(2), 0.8);
          if (v) b.strings(b.at(bar, 0), [74, 79, 82], b.barTime, 0.45, 0.2);
        }
        b.crash(b.at(0, 0), 0.7);
      },
    },
    queda: {
      bars: 4,
      play(b) {
        for (let bar = 0; bar < 4; bar++) {
          drums(b, bar, { c: "....X.......X...", h: bar >= 2 ? "x.x.x.x.x.x.x.x." : "" });
          for (const [s, n, l, from] of BC_808) b.sub(b.at(bar, s), n, b.len(l) * 0.95, 1, from);
        }
        bcHatRoll(b, 3);
      },
    },
    final: {
      bars: 4,
      play(b) {
        for (let bar = 0; bar < 4; bar++) {
          for (const [s, n, l] of BC_HOOK) b.lead(b.at(bar, s), n, b.len(l) * 0.8, { vel: 0.7 - bar * 0.12, cutoff: 2500 - bar * 500, type: "square", echo: 0.3 });
          if (bar < 2) drums(b, bar, BC_BEAT, 0.8);
        }
        b.sub(b.at(2, 0), 31, b.barTime * 1.5, 1, 38);
      },
    },
  },
  form: ["intro", "verso", "verso:1", "refrao", "verso:1", "refrao:1", "queda", "refrao", "refrao:1", "final"],
};

// =====================================================================================
// DUELO (Lista Gorda): Orquestra do Rodízio – "Prato Principal" (tensão de chefão, 130 bpm, Ré menor)
// =====================================================================================
const PP_CHORDS = [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]];
const PP_OSTINATO = [0, 0, 3, 0, 2, 0, 7, 0, 0, 0, 3, 0, 5, 3, 2, 0];
const PP_TAIKO: Groove = { t: "X..x..x.x...x...", h: "x.x.x.x.x.x.x.x." };
const PP_THEME: Line[] = [
  [[0, 62, 6], [6, 65, 2], [8, 64, 4], [12, 62, 4]],
  [[0, 65, 8], [8, 67, 4], [12, 65, 4]],
  [[0, 67, 6], [6, 70, 2], [8, 69, 8]],
  [[0, 69, 4], [4, 68, 4], [8, 69, 8]],
];

function ppOstinato(b: Band, bar: number, vel = 1) {
  const root = PP_CHORDS[bar % 4][0];
  for (let s = 0; s < 16; s++) b.spiccato(b.at(bar, s), root + PP_OSTINATO[s], (s % 4 === 0 ? 1 : 0.7) * vel);
}

const PRATO_PRINCIPAL: TrackDef = {
  id: "prato-principal", artist: "Orquestra do Rodízio", title: "Prato Principal", mood: "duel", bpm: 130,
  band: { kit: "cine", drive: 24, trim: 0.69 },
  sections: {
    intro: {
      bars: 4,
      play(b) {
        b.hit(0, 0.9);
        for (let bar = 0; bar < 4; bar++) {
          drums(b, bar, { h: "x...x...x...x..." }, 0.5 + bar * 0.1);
          b.strings(b.at(bar, 0), [38, 50], b.barTime, 0.7, 0.8);
        }
        b.choir(b.at(2, 0), [62, 69], b.barTime * 2, 0.6);
        b.riser(b.at(2, 0), b.barTime * 2, 0.8);
      },
    },
    a: {
      bars: 8,
      play(b, v) {
        for (let bar = 0; bar < 8; bar++) {
          ppOstinato(b, bar);
          drums(b, bar, PP_TAIKO);
          b.strings(b.at(bar, 0), [PP_CHORDS[bar % 4][0] - 12], b.barTime, 0.8, 0.1);
          if (v) for (const [s, n, l] of PP_THEME[bar % 4]) b.brass(b.at(bar, s), [n, n - 12], b.len(l) * 0.95, 0.9);
        }
      },
    },
    b: {
      bars: 8,
      play(b, v) {
        for (let bar = 0; bar < 8; bar++) {
          ppOstinato(b, bar);
          drums(b, bar, { ...PP_TAIKO, k: "x.......x.......", s: v ? "....x.......x..." : "" });
          b.strings(b.at(bar, 0), PP_CHORDS[bar % 4].map((n) => n + 12), b.barTime, 0.7, 0.2);
          if (bar % 2 === 0) b.choir(b.at(bar, 0), PP_CHORDS[bar % 4].map((n) => n + 12), b.barTime * 2, 0.7);
        }
        b.riser(b.at(6, 0), b.barTime * 2);
      },
    },
    climax: {
      bars: 8,
      play(b, v) {
        for (let bar = 0; bar < 8; bar++) {
          const root = PP_CHORDS[bar % 4][0] - 12;
          ppOstinato(b, bar, 0.9);
          b.braam(b.at(bar, 0), [root, root + 7], b.barTime * 0.9, 0.9);
          for (const [s, l, m] of [[0, 2, false], [3, 1, true], [4, 1, true], [6, 2, false], [8, 1, true], [9, 1, true], [10, 2, false], [12, 1, true], [13, 1, true], [14, 2, false]] as const) {
            b.chord(b.at(bar, s), root, b.len(l), m, 0.9);
          }
          drums(b, bar, { k: "X..x..x.X..x..x.", s: "....X.......X...", t: "X.......X......." });
          if (bar % 4 === 0) b.crash(b.at(bar, 0));
          if (v) for (const [s, n, l] of PP_THEME[bar % 4]) b.brass(b.at(bar, s), [n + 12, n], b.len(l) * 0.95, 1);
        }
        fill(b, 7, 4);
      },
    },
    respiro: {
      bars: 4,
      play(b) {
        // Coração batendo e o coro: o rival chegando perto.
        for (let bar = 0; bar < 4; bar++) {
          b.kick(b.at(bar, 0), 0.8);
          b.kick(b.at(bar, 3), 0.5);
          b.choir(b.at(bar, 0), PP_CHORDS[bar % 4].map((n) => n + 12), b.barTime, 0.6);
        }
        roll(b, 3, 1);
      },
    },
    final: {
      bars: 4,
      play(b) {
        ppOstinato(b, 0);
        ppOstinato(b, 1);
        drums(b, 0, PP_TAIKO);
        drums(b, 1, PP_TAIKO);
        b.braam(b.at(2, 0), [26, 38, 45], b.barTime * 2, 1);
        b.hit(b.at(2, 0), 1);
        b.choir(b.at(2, 0), [62, 65, 69], b.barTime * 2, 0.8);
      },
    },
  },
  form: ["intro", "a", "b", "climax", "respiro", "a:1", "b:1", "climax:1", "a:1", "climax:1", "final"],
};

// =====================================================================================
// ABERTURA (trailer da intro): coração, depois o riff pesado em loop até apertar Enter.
// =====================================================================================
const ABERTURA: TrackDef = {
  id: "abertura", artist: "NFBMC", title: "Abertura", mood: "trailer", bpm: 140,
  band: { kit: "rock", drive: 22, trim: 0.71 },
  sections: {
    coracao: {
      bars: 4,
      play(b) {
        for (let bar = 0; bar < 4; bar++) {
          b.kick(b.at(bar, 0), 0.6 + bar * 0.1);
          b.kick(b.at(bar, 3), 0.4 + bar * 0.1);
          b.strings(b.at(bar, 0), [50, 53, 57].map((n) => n + (bar % 2 ? -4 : 0)), b.barTime, 0.6, 0.6);
          if (bar >= 2) drums(b, bar, { h: "x.x.x.x.x.x.x.x." }, 0.5);
        }
        roll(b, 3, 1);
        b.riser(b.at(2, 0), b.barTime * 2);
      },
    },
    riff: {
      bars: 4,
      play(b, v) {
        const r: Riff = [[0, D, 2], [2, D, 1, true], [3, D, 1, true], [4, D + 3, 2], [6, D, 1, true], [7, D, 1, true], [8, D + 5, 3], [11, D + 3, 2], [13, D + 1, 3]];
        for (let bar = 0; bar < 4; bar++) {
          riff(b, bar, bar === 3 ? [[0, D - 2, 8], [8, D - 3, 8]] : r);
          drums(b, bar, { k: "x..x..x.x..x..x.", s: "....X.......X...", r: "x.x.x.x.x.x.x.x." });
          if (bar === 0) b.crash(b.at(0, 0));
          if (v) b.choir(b.at(bar, 0), [62, 69], b.barTime, 0.5);
        }
        fill(b, 3, 4);
      },
    },
  },
  form: ["coracao", "riff", "riff:1"],
  loopFrom: 1,
};

/** As faixas do "rádio" do jogo, por clima. */
export const TRACKS: TrackDef[] = [FRITURA_TOTAL, BANHA_ELETRICA, MOLHO_ESPECIAL, ESPETO_CORRIDO, RECHEIO_PESADO, BARRIGA_CHEIA, PRATO_PRINCIPAL, ABERTURA];

// =====================================================================================
// TEMAS DAS CINEMÁTICAS (modo história)
// Cada tema: uma entrada ("golpe") e uma cama que fica em loop enquanto o plano dura.
// =====================================================================================

const cue = (id: CueName, bpm: number, kit: BandOptions["kit"], sections: Record<string, Section>, form: string[], loopFrom = form.length - 1, extra: Partial<BandOptions> = {}): TrackDef =>
  ({ id, artist: "", title: id, mood: "cue", bpm, band: { kit, trim: 0.85, ...extra }, sections, form, loopFrom });

export const CUES: Record<CueName, TrackDef> = {
  // Chegada em Porto Gordo: groove confiante, baixo andando e metais.
  chegada: cue("chegada", 98, "boom", {
    cama: {
      bars: 4,
      play(b) {
        const chords = [[57, 60, 64, 67], [55, 59, 62, 66], [53, 57, 60, 64], [52, 56, 59, 62]];
        for (let bar = 0; bar < 4; bar++) {
          drums(b, bar, { k: "X......x..x.....", s: "....X.......X...", h: "x.x.x.x.x.x.x.x." }, 0.8);
          const root = chords[bar][0] - 24;
          b.bass(b.at(bar, 0), root, b.len(3));
          b.bass(b.at(bar, 3), root + 7, b.len(2), 0.7);
          b.bass(b.at(bar, 6), root + 12, b.len(2), 0.8);
          b.bass(b.at(bar, 10), root + 10, b.len(2), 0.7);
          b.bass(b.at(bar, 12), root + 7, b.len(4), 0.8);
          b.piano(b.at(bar, 0), chords[bar], b.len(3), 0.6);
          b.piano(b.at(bar, 6), chords[bar], b.len(2), 0.45);
          if (bar % 2 === 0) b.brass(b.at(bar, 10), chords[bar].slice(0, 3).map((n) => n + 12), b.len(2), 0.7);
        }
      },
    },
  }, ["cama"], 0),

  // Cerco da Vigilância: drone grave, taikos, "braam" e uma sirene distante na harmonia.
  cerco: cue("cerco", 90, "cine", {
    golpe: {
      bars: 1,
      play(b) {
        b.hit(0, 1);
        b.braam(0, [26, 33, 38], b.barTime, 1);
      },
    },
    cama: {
      bars: 4,
      play(b) {
        for (let bar = 0; bar < 4; bar++) {
          b.strings(b.at(bar, 0), [38, 39 + (bar % 2)], b.barTime, 0.8, 0.3);
          drums(b, bar, { t: "X.....x...x.....", h: "..x...x...x...x." }, 0.8);
          // Sirene longe, entre duas notas, em vez da sirene "de verdade" do jogo.
          b.lead(b.at(bar, 0), 74, b.len(7), { vel: 0.25, cutoff: 1200, echo: 0.5 });
          b.lead(b.at(bar, 8), 75, b.len(7), { vel: 0.25, cutoff: 1200, echo: 0.5 });
        }
        b.braam(b.at(2, 0), [26, 33], b.barTime, 0.7);
      },
    },
  }, ["golpe", "cama"]),

  // Sabotagem: pizzicato de vilão de desenho animado, cromático e na ponta dos pés.
  sabotagem: cue("sabotagem", 112, "cine", {
    cama: {
      bars: 4,
      play(b) {
        const sneak = [57, 0, 60, 0, 59, 0, 58, 0, 57, 0, 64, 0, 63, 62, 61, 0];
        for (let bar = 0; bar < 4; bar++) {
          sneak.forEach((n, s) => n && b.pizz(b.at(bar, s), n + (bar === 3 && s >= 8 ? -5 : 0), s % 4 === 0 ? 1 : 0.7));
          // "Fagote": grave curto e soprado.
          for (const s of [0, 4, 8, 12]) b.saws(b.at(bar, s), [bar % 2 ? 40 : 45], b.len(1.5), { vel: 1.2, cutoff: 700, voices: 1, release: 0.05, pump: false });
          if (bar % 2 === 1) b.bell(b.at(bar, 14), 81, 0.8, 0.7);
          drums(b, bar, { h: "x...x...x...x..." }, 0.4);
        }
      },
    },
  }, ["cama"], 0),

  // Rival / Lista Gorda / Bruno: golpe dramático e cama de tensão.
  rival: cue("rival", 120, "cine", {
    golpe: {
      bars: 1,
      play(b) {
        b.hit(0, 1);
        b.braam(0, [26, 38, 45], b.barTime * 1.2, 1);
        b.crash(0, 0.8);
      },
    },
    cama: {
      bars: 4,
      play(b) {
        for (let bar = 0; bar < 4; bar++) {
          const root = [38, 38, 34, 37][bar];
          for (let s = 0; s < 16; s += 2) b.spiccato(b.at(bar, s), root + (s % 8 === 6 ? 1 : 0), s % 4 === 0 ? 0.9 : 0.6);
          drums(b, bar, { t: "x.......x.......", h: "x.x.x.x.x.x.x.x." }, 0.6);
        }
        b.choir(0, [62, 65], b.barTime * 4, 0.5);
      },
    },
  }, ["golpe", "cama"]),

  // Nota fiscal / vitória sobre o rival: fanfarra triunfante e cama alegre.
  nota: cue("nota", 120, "rock", {
    golpe: {
      bars: 2,
      play(b) {
        b.brass(0, [62, 66, 69], b.len(1.5), 1);
        b.brass(b.len(2), [62, 66, 69], b.len(1.5), 1);
        b.brass(b.len(4), [67, 71, 74], b.len(4), 1);
        b.brass(b.len(8), [69, 73, 76], b.len(16), 1);
        b.crash(b.len(8), 1);
        b.kick(b.len(8));
        for (let i = 0; i < 12; i++) b.taiko(b.len(i * 0.5), 45, 0.2 + i * 0.05);
        b.strings(b.len(8), [62, 66, 69, 74], b.barTime * 1.5, 0.7, 0.05);
      },
    },
    cama: {
      bars: 4,
      play(b) {
        const chords = [[62, 66, 69], [67, 71, 74], [64, 67, 71], [69, 73, 76]];
        for (let bar = 0; bar < 4; bar++) {
          b.strings(b.at(bar, 0), chords[bar], b.barTime, 0.5, 0.2);
          for (let s = 0; s < 16; s += 4) b.bell(b.at(bar, s), chords[bar][(s / 4) % 3] + 12, 0.8, 0.5);
          drums(b, bar, { k: "x.......x.......", h: "..x...x...x...x." }, 0.5);
        }
      },
    },
  }, ["golpe", "cama"]),

  // Rádio do Cross-fit: suspense (relógio, pulso abafado, cordas agudas dissonantes).
  radio: cue("radio", 84, "cine", {
    cama: {
      bars: 4,
      play(b) {
        for (let bar = 0; bar < 4; bar++) {
          for (let s = 0; s < 16; s += 2) b.hat(b.at(bar, s), s % 4 ? 0.3 : 0.5);
          b.sub(b.at(bar, 0), 26, b.len(3), 0.7);
          b.sub(b.at(bar, 8), 26, b.len(3), 0.5);
          b.strings(b.at(bar, 0), [74, 75], b.barTime, 0.35, 0.8);
        }
        b.piano(b.at(1, 0), [50, 56], b.len(16), 0.5, 0.6);
        b.piano(b.at(3, 0), [49, 55], b.len(16), 0.5, 0.6);
      },
    },
  }, ["cama"], 0),

  // Jornal da Gordura: vinheta de telejornal e uma cama "de redação".
  tv: cue("tv", 120, "rock", {
    golpe: {
      bars: 2,
      play(b) {
        const notes = [72, 79, 76, 84];
        notes.forEach((n, i) => {
          b.brass(b.len(i * 2), [n, n - 12], b.len(1.6), 1);
          b.bell(b.len(i * 2), n + 12, 1, 0.8);
        });
        b.brass(b.len(8), [72, 76, 79, 84], b.len(8), 1);
        b.kick(0);
        b.kick(b.len(8));
        b.crash(b.len(8), 0.9);
        b.snare(b.len(6), 0.8);
        b.snare(b.len(7), 0.9);
      },
    },
    cama: {
      bars: 4,
      play(b) {
        for (let bar = 0; bar < 4; bar++) {
          for (let s = 0; s < 16; s++) b.saws(b.at(bar, s), [s % 2 ? 72 : 60], b.len(0.5), { vel: 0.5, cutoff: 2000, voices: 1, release: 0.03, pump: false });
          drums(b, bar, { k: "x.......x.......", h: "x.x.x.x.x.x.x.x." }, 0.5);
          b.strings(b.at(bar, 0), [[60, 64, 67], [57, 60, 64], [65, 69, 72], [67, 71, 74]][bar], b.barTime, 0.3, 0.2);
        }
      },
    },
  }, ["golpe", "cama"]),

  // Fuga final: épico (orquestra e guitarras a 160).
  fuga: cue("fuga", 160, "rock", {
    cama: {
      bars: 8,
      play(b) {
        const roots = [38, 38, 34, 34, 36, 36, 33, 33];
        const theme: Line[] = [[[0, 62, 8], [8, 65, 8]], [[0, 69, 12], [12, 67, 4]], [[0, 65, 8], [8, 62, 8]], [[0, 65, 4], [4, 67, 4], [8, 70, 8]], [[0, 67, 8], [8, 72, 8]], [[0, 76, 12], [12, 74, 4]], [[0, 73, 8], [8, 69, 8]], [[0, 69, 16]]];
        for (let bar = 0; bar < 8; bar++) {
          const root = roots[bar];
          for (let s = 0; s < 16; s++) b.spiccato(b.at(bar, s), root + 12 + (s % 4 === 2 ? 7 : 0), 0.8);
          for (let s = 0; s < 16; s += 2) b.chord(b.at(bar, s), root, b.len(2) * 0.9, s % 4 !== 0, 0.85);
          drums(b, bar, { k: "x.x...x.x.x...x.", s: "....X.......X...", t: "X.......X.......", h: "x.x.x.x.x.x.x.x." });
          for (const [s, n, l] of theme[bar]) b.brass(b.at(bar, s), [n, n - 12], b.len(l) * 0.95, 0.9);
          if (bar % 4 === 0) b.crash(b.at(bar, 0));
        }
        fill(b, 7, 4);
      },
    },
  }, ["cama"], 0, { drive: 22 }),

  // Salto da ponte: câmera lenta, cordas e coro subindo, coração e silêncio no ar.
  ponte: cue("ponte", 70, "cine", {
    subida: {
      bars: 4,
      play(b) {
        b.strings(0, [50, 57, 62, 66], b.barTime * 4, 1, b.barTime * 2.5);
        b.choir(b.barTime, [62, 69, 74], b.barTime * 3, 0.9);
        b.riser(b.barTime * 1.5, b.barTime * 2.5, 0.7);
        for (let bar = 0; bar < 4; bar++) {
          b.kick(b.at(bar, 0), 0.7);
          b.kick(b.at(bar, 3), 0.45);
        }
        b.hit(b.barTime * 4 - 0.02, 0.8);
      },
    },
    ar: {
      bars: 2,
      play(b) {
        b.strings(0, [62, 69, 74, 78], b.barTime * 2, 0.7, 0.3);
        b.choir(0, [74, 78, 81], b.barTime * 2, 0.6);
      },
    },
  }, ["subida", "ar"]),

  // Fim: tema da vitória, em Ré maior, banda inteira.
  fim: cue("fim", 128, "rock", {
    cama: {
      bars: 8,
      play(b) {
        const prog = [[62, 66, 69], [67, 71, 74], [59, 62, 66], [69, 73, 76]];
        const theme: Line[] = [[[0, 74, 6], [6, 76, 2], [8, 78, 8]], [[0, 79, 6], [6, 78, 2], [8, 76, 8]], [[0, 74, 4], [4, 73, 4], [8, 71, 8]], [[0, 73, 8], [8, 76, 8]]];
        for (let bar = 0; bar < 8; bar++) {
          const chord = prog[bar % 4];
          b.strings(b.at(bar, 0), chord, b.barTime, 0.7, 0.1);
          for (const [s, l] of [[0, 3], [3, 3], [6, 2], [8, 3], [11, 3], [14, 2]]) b.chord(b.at(bar, s), chord[0] - 24, b.len(l) * 0.95, false, 0.6);
          b.bass(b.at(bar, 0), chord[0] - 36, b.len(16));
          drums(b, bar, { k: "x.....x.x.......", s: "....X.......X...", r: "x.x.x.x.x.x.x.x." });
          for (const [s, n, l] of theme[bar % 4]) b.brass(b.at(bar, s), [n, n - 12], b.len(l) * 0.95, 1);
          if (bar % 4 === 0) b.crash(b.at(bar, 0));
        }
      },
    },
  }, ["cama"], 0, { drive: 14 }),

  // Mia: misteriosa e calorosa (piano elétrico, pad e batida leve).
  mia: cue("mia", 84, "boom", {
    cama: {
      bars: 4,
      play(b) {
        const chords = [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65], [52, 55, 59, 62]];
        for (let bar = 0; bar < 4; bar++) {
          b.piano(b.at(bar, 0), chords[bar], b.len(7), 0.55);
          b.piano(b.at(bar, 10), chords[bar].slice(1), b.len(5), 0.4);
          b.saws(b.at(bar, 0), chords[bar].map((n) => n + 12), b.barTime, { vel: 0.35, cutoff: 1200, attack: 0.5, release: 0.8, send: 0.6, pump: false });
          drums(b, bar, { k: "x.........x.....", s: "....x.......x...", h: "..x...x...x...x." }, 0.5);
          b.sub(b.at(bar, 0), chords[bar][0] - 24, b.len(8), 0.6);
        }
      },
    },
  }, ["cama"], 0, { swing: 0.3 }),

  // Sozinho, sem nada: piano triste e cordas.
  sozinho: cue("sozinho", 68, "cine", {
    cama: {
      bars: 4,
      play(b) {
        const melody: Line[] = [[[0, 72, 6], [6, 71, 2], [8, 69, 8]], [[0, 67, 8], [8, 65, 8]], [[0, 69, 6], [6, 67, 2], [8, 65, 4], [12, 64, 4]], [[0, 64, 16]]];
        const chords = [[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]];
        for (let bar = 0; bar < 4; bar++) {
          b.piano(b.at(bar, 0), [chords[bar][0] - 12, ...chords[bar]], b.len(16), 0.5, 0.5);
          for (const [s, n, l] of melody[bar]) b.piano(b.at(bar, s), [n], b.len(l), 0.65, 0.5);
          b.strings(b.at(bar, 0), chords[bar].map((n) => n - 12), b.barTime, 0.4, 0.8);
        }
      },
    },
  }, ["cama"], 0),
};

/** Altura de cada tema (medida em LUFS na gravação): todos um pouco abaixo das faixas, para as vozes passarem. */
const CUE_TRIM: Record<CueName, number> = {
  chegada: 0.54, cerco: 0.52, sabotagem: 1.02, rival: 0.57, nota: 0.65, radio: 1.25,
  tv: 0.68, fuga: 0.59, ponte: 0.69, fim: 0.57, mia: 0.63, sozinho: 1.23,
};
for (const [name, trim] of Object.entries(CUE_TRIM)) CUES[name as CueName].band.trim = trim;
