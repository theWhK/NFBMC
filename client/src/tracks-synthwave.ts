// Lado B da trilha: as faixas synthwave/outrun do NFBMC (o "verão de 1986" de
// Porto Gordo). Darksynth com guitarras nas perseguições, outrun e breakbeat
// nas corridas, chillwave na cidade e retrowave épico nos duelos.
//
// Tudo composto para o jogo: progressões, ganchos, baixos e arpejos são
// originais; do gênero vem só a cara (bateria com reverberação de portão,
// baixo em arpejo, teclados analógicos com coro, solo com portamento, fita).
//
// Cada faixa é descrita por uma "ficha" (acordes de cada parte, arpejo, gancho,
// grooves, sabor) e `synthTrack` monta as seções a partir dela, com variações
// (o segundo refrão ganha coro e metais, o último sobe de tom etc.).
import type { Band, BandOptions } from "./band.ts";
import { drums, fill, roll, type Groove, type Line, type Mood, type Section, type TrackDef } from "./compose.ts";

/** Acorde: [nota do baixo, ...notas do teclado]. */
type Chord = number[];

interface Spec {
  id: string;
  artist: string;
  title: string;
  mood: Mood;
  bpm: number;
  key: string;
  style: string;
  band: Omit<BandOptions, "bpm">;
  /** Acordes (um por compasso, repetindo) do verso, pré-refrão, refrão e ponte. */
  verse: Chord[];
  pre: Chord[];
  chorus: Chord[];
  bridge: Chord[];
  /** Arpejo do baixo: 16 intervalos sobre a nota do baixo (-1 = pausa). */
  arp: number[];
  /** Gancho do refrão: uma linha por compasso. */
  hook: Line[];
  grooves: { verse: Groove; chorus: Groove; half: Groove };
  /** Guitarras (darksynth): "o" aberta, "m" abafada, "." nada. */
  guitar?: { verse: string; chorus: string };
  lead: { type: OscillatorType; porta: number };
  /** Cara da faixa: escura (guitarras), outrun (estrada), chill, épica (coro, orquestra) ou break. */
  flavor: "dark" | "outrun" | "chill" | "epic" | "break";
  form: string[];
}

const at = (b: Band, bar: number, step = 0) => b.at(bar, step);

/** Baixo em arpejo (ou, no chill, uma nota longa de sub). */
function arpBar(b: Band, s: Spec, bar: number, chord: Chord, cutoff: number, vel = 1) {
  const root = chord[0];
  if (s.flavor === "chill") {
    b.sub(at(b, bar, 0), root + 12, b.len(7), 0.9 * vel);
    b.sub(at(b, bar, 8), root + 12, b.len(4), 0.7 * vel);
    b.arp(at(b, bar, 12), root + 24, b.len(1), { vel: 0.5 * vel, cutoff });
    b.arp(at(b, bar, 14), root + 31, b.len(1), { vel: 0.4 * vel, cutoff });
    return;
  }
  s.arp.forEach((interval, step) => {
    if (interval < 0) return;
    b.arp(at(b, bar, step), root + 12 + interval, b.len(1) * 0.85, { vel: (step % 4 === 0 ? 1 : 0.75) * vel, cutoff, res: s.flavor === "dark" ? 8 : 6 });
  });
  if (s.flavor !== "outrun") b.sub(at(b, bar, 0), root, b.len(s.flavor === "break" ? 6 : 14), 0.6 * vel);
}

function guitarBar(b: Band, pattern: string, bar: number, root: number, vel = 1) {
  const r = root + 12 < 38 ? root + 24 : root + 12;
  for (let i = 0; i < 16; i++) {
    const c = pattern[i];
    if (c !== "o" && c !== "m") continue;
    let len = 1;
    while (i + len < 16 && pattern[i + len] === ".") len++;
    b.chord(at(b, bar, i), r, b.len(c === "o" ? len : 1) * 0.95, c === "m", vel);
  }
}

function hookBar(b: Band, s: Spec, bar: number, line: Line, o: { vel?: number; octave?: number; brass?: boolean } = {}) {
  let prev: number | undefined;
  for (const [step, note, len] of line) {
    const n = note + (o.octave ?? 0);
    if (s.flavor === "epic" || o.brass) b.brass(at(b, bar, step), [n, n - 12], b.len(len) * 0.95, o.vel ?? 1, true);
    else b.lead(at(b, bar, step), n, b.len(len) * 0.92, { vel: o.vel ?? 1, type: s.lead.type, glideFrom: prev, porta: s.lead.porta, chorus: true, echo: 0.28 });
    prev = n;
  }
}

/** Solo improvisado a partir das notas do gancho (sobe, desce, repete com variação). */
function soloBar(b: Band, s: Spec, bar: number) {
  const pool = [...new Set(s.hook.flat().map(([, n]) => n))].sort((x, y) => x - y);
  const shape = [0, 2, 1, 3, 2, 4, 3, 5, 4, 3, 2, 4, 5, 6, 4, 2];
  const fast = bar >= 4;
  let prev: number | undefined;
  for (let step = 0; step < 16; step += fast ? 1 : 2) {
    const idx = (shape[(step + bar * 5) % 16] + bar) % pool.length;
    const n = pool[idx];
    if (s.guitar) b.guitarLead(at(b, bar, step), n, b.len(fast ? 1 : 2) * 0.95, 0.85);
    else b.lead(at(b, bar, step), n, b.len(fast ? 1 : 2) * 0.9, { vel: 0.85, type: s.lead.type, glideFrom: prev, porta: s.lead.porta * 0.6, chorus: true });
    prev = n;
  }
}

/** Contra-melodia (no verso, na segunda vez): as notas do acorde subindo, num piano elétrico ou sino. */
function counterBar(b: Band, s: Spec, bar: number, chord: Chord) {
  const notes = chord.slice(1).map((n) => n + 12);
  [0, 3, 6, 10, 12].forEach((step, i) => {
    const n = notes[i % notes.length];
    if (s.flavor === "chill" || s.flavor === "outrun") b.ep(at(b, bar, step), [n], b.len(3), 0.7);
    else b.bell(at(b, bar, step), n + 12, 0.6, 0.6);
  });
}

function padBar(b: Band, s: Spec, bar: number, chord: Chord, vel = 1, cutoff = 2400) {
  if (s.flavor === "chill") b.ep(at(b, bar, 0), chord.slice(1), b.barTime * 0.95, 0.8 * vel);
  b.pad(at(b, bar, 0), chord.slice(1), b.barTime * 0.98, vel, cutoff);
}

/** Monta as seções da faixa a partir da ficha. */
function synthTrack(s: Spec): TrackDef {
  const dark = s.flavor === "dark";
  const epic = s.flavor === "epic";
  const chord = (list: Chord[], bar: number) => list[bar % list.length];
  const sections: Record<string, Section> = {
    intro: {
      bars: 4,
      play(b) {
        for (let bar = 0; bar < 4; bar++) {
          const c = chord(s.verse, bar);
          padBar(b, s, bar, c, 0.8, 900 + bar * 500);
          arpBar(b, s, bar, c, 300 + bar * 250, 0.8);
          if (bar >= 2) drums(b, bar, { h: s.grooves.verse.h }, 0.6);
        }
        if (epic || dark) b.hit(0, 0.7);
        b.riser(at(b, 2), b.barTime * 2);
      },
    },
    verso: {
      bars: 8,
      play(b, v) {
        for (let bar = 0; bar < 8; bar++) {
          const c = chord(s.verse, bar);
          drums(b, bar, s.grooves.verse, v ? 1 : 0.9);
          arpBar(b, s, bar, c, v ? 1100 : 800);
          padBar(b, s, bar, c, 0.6, 1600);
          if (s.guitar && (v || dark)) guitarBar(b, s.guitar.verse, bar, c[0], 0.85);
          if (v) counterBar(b, s, bar, c);
          if (epic) for (let st = 0; st < 16; st += 2) b.spiccato(at(b, bar, st), c[1] + (st % 8 === 6 ? 7 : 0), 0.6);
        }
        b.crash(at(b, 0), 0.7);
        if (s.flavor === "outrun" || s.flavor === "chill") for (let i = 0; i < 4; i++) b.simmons(at(b, 7, 8 + i * 2), 52 - i * 4, 0.8);
        else fill(b, 7, 4);
      },
    },
    pre: {
      bars: 4,
      play(b) {
        for (let bar = 0; bar < 4; bar++) {
          const c = chord(s.pre, bar);
          drums(b, bar, s.grooves.half);
          arpBar(b, s, bar, c, 700 + bar * 300);
          padBar(b, s, bar, c, 0.9, 1800 + bar * 400);
          b.brass(at(b, bar, 0), c.slice(1).map((n) => n + 12), b.barTime * 0.9, 0.6, true);
          if (s.guitar) b.chord(at(b, bar, 0), c[0] + 12 < 38 ? c[0] + 24 : c[0] + 12, b.barTime * 0.95, false, 0.8);
        }
        roll(b, 2, 2);
        b.riser(at(b, 1), b.barTime * 3);
      },
    },
    refrao: {
      bars: 8,
      play(b, v) {
        for (let bar = 0; bar < 8; bar++) {
          const c = chord(s.chorus, bar);
          const groove = v >= 2 && !s.flavor.startsWith("chill") ? { ...s.grooves.chorus, h: "x.x.x.x.x.x.x.x.", o: "..x...x...x...x." } : s.grooves.chorus;
          drums(b, bar, groove);
          arpBar(b, s, bar, c, 1500);
          padBar(b, s, bar, c, 1, 3000);
          if (s.guitar) guitarBar(b, s.guitar.chorus, bar, c[0]);
          // Metais em contratempo (a "parede" dos anos 80).
          if (!s.guitar && s.flavor !== "chill") for (const st of [0, 6, 10]) b.brass(at(b, bar, st), c.slice(1).map((n) => n + 12), b.len(st ? 2 : 3), 0.55, true);
          hookBar(b, s, bar, s.hook[bar % s.hook.length], { vel: 1 });
          if (v >= 1) {
            // Segunda vez: coro sem letra e o gancho dobrado uma oitava abaixo nos metais.
            if (bar % 2 === 0) b.choir(at(b, bar, 0), c.slice(1).map((n) => n + 12), b.barTime * 1.9, 0.6);
            if (!epic) hookBar(b, s, bar, s.hook[bar % s.hook.length], { vel: 0.6, octave: -12, brass: true });
          }
          if (v >= 2 && epic) b.taiko(at(b, bar, 0), 36, 1);
          if (bar % 4 === 0) b.crash(at(b, bar, 0), 0.9, bar ? -0.4 : 0.4);
        }
        if (dark || epic) b.braam(at(b, 0), [s.chorus[0][0], s.chorus[0][0] + 7], b.barTime, 0.8);
        if (s.flavor === "outrun" || s.flavor === "chill") for (let i = 0; i < 4; i++) b.simmons(at(b, 7, 8 + i * 2), 50 - i * 3, 0.9);
        else fill(b, 7, 4);
      },
    },
    queda: {
      bars: 4,
      play(b) {
        // O chão some: só o arpejo filtrado subindo e o teclado, e a volta com tudo.
        for (let bar = 0; bar < 4; bar++) {
          const c = chord(s.chorus, bar);
          arpBar(b, s, bar, c, 250 + bar * 350, 0.9);
          padBar(b, s, bar, c, 0.7, 700 + bar * 500);
          if (bar >= 2) drums(b, bar, { k: "x...x...x...x...", h: "x.x.x.x.x.x.x.x." }, 0.7);
        }
        roll(b, 3, 1);
        b.riser(at(b, 0), b.barTime * 4);
      },
    },
    ponte: {
      bars: 8,
      play(b, v) {
        for (let bar = 0; bar < 8; bar++) {
          const c = chord(s.bridge, bar);
          padBar(b, s, bar, c, 0.9, 2000);
          // Arpejo de piano elétrico no lugar do baixo: a ponte "flutua".
          c.slice(1).concat(c.slice(1).map((n) => n + 12)).forEach((n, i) => b.ep(at(b, bar, i * 2), [n], b.len(3), 0.55));
          b.sub(at(b, bar, 0), c[0] + 12, b.barTime * 0.95, 0.7);
          if (bar >= 4 || v) drums(b, bar, s.grooves.half, 0.75);
          if (bar >= 2) {
            const motif = s.hook[(bar + 3) % s.hook.length];
            for (const [step, note, len] of motif) b.bell(at(b, bar, step), note, b.len(len) * 2, 0.6);
          }
        }
        if (epic) b.choir(at(b, 0), s.bridge[0].slice(1).map((n) => n + 12), b.barTime * 8, 0.7);
        roll(b, 7, 1);
      },
    },
    solo: {
      bars: 8,
      play(b) {
        for (let bar = 0; bar < 8; bar++) {
          const c = chord(s.verse, bar);
          drums(b, bar, s.grooves.chorus);
          arpBar(b, s, bar, c, 1200);
          padBar(b, s, bar, c, 0.7, 2200);
          if (s.guitar) guitarBar(b, s.guitar.verse, bar, c[0], 0.7);
          soloBar(b, s, bar);
        }
        b.crash(at(b, 0));
        fill(b, 7, 8);
      },
    },
    final: {
      bars: 4,
      play(b) {
        for (let bar = 0; bar < 2; bar++) {
          const c = chord(s.chorus, bar + 6);
          drums(b, bar, s.grooves.chorus);
          arpBar(b, s, bar, c, 1500);
          padBar(b, s, bar, c, 1, 3000);
          hookBar(b, s, bar, s.hook[(bar + 6) % s.hook.length]);
          if (s.guitar) guitarBar(b, s.guitar.chorus, bar, c[0]);
        }
        // Acorde final (o primeiro do verso, o "lar"), segurado com prato e pancada.
        const home = s.verse[0];
        padBar(b, s, 2, home, 1, 3000);
        b.pad(at(b, 3), home.slice(1), b.barTime, 0.8, 1500);
        b.sub(at(b, 2), home[0] + 12, b.barTime * 2, 0.9);
        b.crash(at(b, 2), 1, -0.4);
        b.crash(at(b, 2), 1, 0.4);
        b.kick(at(b, 2));
        if (s.guitar) b.chord(at(b, 2), home[0] + 12 < 38 ? home[0] + 24 : home[0] + 12, b.barTime * 2, false, 1);
        if (epic || s.flavor === "dark") b.hit(at(b, 2), 0.8);
        if (epic) b.choir(at(b, 2), home.slice(1).map((n) => n + 12), b.barTime * 2, 0.8);
      },
    },
  };
  return { id: s.id, artist: s.artist, title: s.title, mood: s.mood, bpm: s.bpm, key: s.key, style: s.style, band: s.band, sections, form: s.form };
}

// --- Grooves ---------------------------------------------------------------------------
const FOUR: Groove = { k: "x...x...x...x...", s: "....X.......X...", h: "..x...x...x...x." };
const FOUR_BUSY: Groove = { k: "x...x...x...x.x.", s: "....X.......X...", h: "xxx.xxx.xxx.xxx.", o: "..x...x...x...x." };
const HALF: Groove = { k: "x.......x.......", s: "........X.......", h: "x.x.x.x.x.x.x.x." };

// Formas: quase todas passam por intro, versos, pré, refrões, queda, ponte e
// final; cada uma com a sua ordem, e o último refrão sobe de tom ("+2").
const FORM_STD = ["intro", "verso", "verso:1", "pre", "refrao", "verso:1", "pre", "refrao:1", "ponte", "queda", "refrao:1", "refrao:2+2", "final+2"];
const FORM_SOLO = ["intro", "verso", "pre", "refrao", "verso:1", "pre", "refrao:1", "solo", "ponte", "queda", "refrao:2+1", "final+1"];
const FORM_CHILL = ["intro", "verso", "verso:1", "refrao", "ponte", "verso:1", "refrao:1", "ponte:1", "refrao:1", "final"];

const SPECS: Spec[] = [
  // ------------------------------- PERSEGUIÇÃO (darksynth) -------------------------------
  {
    id: "oleo-quente", artist: "Fritadeira Turbo", title: "Óleo Quente 2049", mood: "pursuit", bpm: 150,
    key: "Fá# menor harmônica → Sol menor", style: "darksynth com guitarras",
    band: { kit: "synth", drive: 22, pump: 0.3, tape: 0.6, trim: 0.48 },
    verse: [[30, 54, 57, 61], [26, 50, 54, 57], [28, 52, 56, 59], [25, 49, 53, 56]],
    pre: [[23, 47, 50, 54], [23, 47, 50, 54], [25, 49, 53, 56], [25, 49, 53, 56]],
    chorus: [[26, 50, 54, 57], [28, 52, 56, 59], [30, 54, 57, 61], [30, 54, 57, 61], [23, 47, 50, 54], [25, 49, 53, 56], [30, 54, 57, 61], [30, 54, 57, 61]],
    bridge: [[33, 57, 61, 64], [31, 55, 59, 62], [30, 54, 57, 61], [28, 52, 56, 59]],
    arp: [0, 12, 0, 12, 7, 12, 0, 12, 0, 12, 0, 12, 10, 12, 7, 12],
    hook: [
      [[0, 74, 4], [4, 73, 2], [6, 71, 2], [8, 69, 6], [14, 71, 2]],
      [[0, 71, 6], [6, 73, 2], [8, 76, 6], [14, 73, 2]],
      [[0, 73, 12], [12, 69, 2], [14, 71, 2]],
      [[0, 73, 4], [4, 76, 4], [8, 78, 8]],
      [[0, 78, 4], [4, 76, 2], [6, 74, 2], [8, 73, 6], [14, 74, 2]],
      [[0, 73, 4], [4, 77, 4], [8, 80, 8]],
      [[0, 81, 6], [6, 80, 2], [8, 78, 8]],
      [[0, 73, 16]],
    ],
    grooves: { verse: { k: "x.x...x.x.x...x.", s: "....X.......X...", h: "x.x.x.x.x.x.x.x." }, chorus: { k: "x..x..x.x..x..x.", s: "....X.......X...", h: "xxxxxxxxxxxxxxxx" }, half: HALF },
    guitar: { verse: "mmmmo.mmmmo.mmom", chorus: "o.....o.o.....o." },
    lead: { type: "sawtooth", porta: 0.05 },
    flavor: "dark",
    form: FORM_SOLO,
  },
  {
    id: "sirene-de-neon", artist: "Laser Linguiça", title: "Sirene de Néon", mood: "pursuit", bpm: 140,
    key: "Ré dórico → Mi dórico", style: "darksynth",
    band: { kit: "synth", drive: 20, pump: 0.35, tape: 0.5, trim: 0.5 },
    verse: [[26, 50, 53, 57], [31, 55, 59, 62], [22, 46, 50, 53], [33, 57, 61, 64]],
    pre: [[22, 46, 50, 53], [24, 48, 52, 55], [22, 46, 50, 53], [33, 57, 61, 64]],
    chorus: [[22, 46, 50, 53], [24, 48, 52, 55], [26, 50, 53, 57], [26, 50, 53, 57], [31, 55, 58, 62], [33, 57, 61, 64], [26, 50, 53, 57], [33, 57, 61, 64]],
    bridge: [[29, 53, 57, 60], [27, 51, 55, 58], [22, 46, 50, 53], [33, 57, 61, 64]],
    arp: [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 12, 0, 12],
    hook: [
      [[0, 69, 6], [6, 70, 2], [8, 72, 8]],
      [[0, 72, 4], [4, 74, 4], [8, 76, 8]],
      [[0, 77, 8], [8, 76, 4], [12, 74, 4]],
      [[0, 74, 12], [12, 72, 4]],
      [[0, 70, 6], [6, 74, 2], [8, 79, 8]],
      [[0, 76, 8], [8, 73, 8]],
      [[0, 74, 6], [6, 76, 2], [8, 77, 8]],
      [[0, 76, 4], [4, 73, 4], [8, 69, 8]],
    ],
    grooves: { verse: { k: "x...x...x...x...", s: "....X.......X...", h: "x.xxx.xxx.xxx.xx" }, chorus: FOUR_BUSY, half: HALF },
    guitar: { verse: "m.mm.mo.m.mm.mo.", chorus: "o..o..o.o..o..o." },
    lead: { type: "square", porta: 0.08 },
    flavor: "dark",
    form: FORM_STD,
  },
  {
    id: "blitz-noturna", artist: "Os Vigilantes do Colesterol", title: "Blitz Noturna", mood: "pursuit", bpm: 128,
    key: "Dó frígio → Ré frígio", style: "darksynth industrial (meio-tempo)",
    band: { kit: "synth", drive: 26, pump: 0.25, tape: 0.8, trim: 0.5 },
    verse: [[24, 48, 51, 55], [24, 48, 51, 55], [25, 49, 53, 56], [24, 48, 51, 55]],
    pre: [[20, 44, 48, 51], [22, 46, 50, 53], [20, 44, 48, 51], [19, 43, 47, 50]],
    chorus: [[20, 44, 48, 51], [22, 46, 50, 53], [24, 48, 51, 55], [25, 49, 53, 56], [20, 44, 48, 51], [22, 46, 50, 53], [19, 43, 47, 50], [19, 43, 47, 50]],
    bridge: [[27, 51, 55, 58], [22, 46, 50, 53], [29, 53, 56, 60], [19, 43, 47, 50]],
    arp: [0, -1, 0, 12, -1, 0, 1, -1, 0, -1, 0, 12, -1, 0, 7, 6],
    hook: [
      [[0, 72, 8], [8, 75, 8]],
      [[0, 74, 8], [8, 77, 8]],
      [[0, 79, 12], [12, 75, 4]],
      [[0, 77, 8], [8, 73, 8]],
      [[0, 75, 6], [6, 77, 2], [8, 79, 8]],
      [[0, 77, 6], [6, 79, 2], [8, 80, 8]],
      [[0, 79, 16]],
      [[0, 74, 8], [8, 71, 8]],
    ],
    grooves: { verse: { k: "X......x..X.....", s: "........X.......", h: "xxxxxxxxxxxxxxxx" }, chorus: { k: "X..x...x..X..x..", s: "........X.......", h: "x.x.x.x.x.x.x.x.", o: "......x.......x." }, half: { k: "X...............", s: "........X.......", h: "x...x...x...x..." } },
    guitar: { verse: "mmo.mmo.mm.omm.o", chorus: "o.......o...o..." },
    lead: { type: "sawtooth", porta: 0.1 },
    flavor: "dark",
    form: ["intro", "verso", "verso:1", "pre", "refrao", "queda", "verso:1", "pre", "refrao:1", "ponte", "solo", "refrao:2+2", "final+2"],
  },

  // ------------------------------- CORRIDA (outrun / breakbeat) -------------------------------
  {
    id: "avenida-infinita", artist: "Maionese 1986", title: "Avenida Infinita", mood: "race", bpm: 118,
    key: "Lá menor ↔ Dó maior → Ré maior", style: "outrun",
    band: { kit: "synth", pump: 0.4, tape: 0.7, trim: 0.52 },
    verse: [[33, 57, 60, 64], [29, 53, 57, 60], [24, 55, 60, 64], [31, 55, 59, 62]],
    pre: [[26, 50, 53, 57], [28, 52, 55, 59], [29, 53, 57, 60], [31, 55, 59, 62]],
    chorus: [[24, 55, 60, 64], [31, 55, 59, 62], [33, 57, 60, 64], [29, 53, 57, 60], [24, 55, 60, 64], [31, 55, 59, 62], [29, 53, 57, 60], [28, 52, 56, 59]],
    bridge: [[29, 53, 57, 60, 64], [28, 52, 55, 59, 62], [26, 50, 53, 57, 60], [28, 52, 57, 59]],
    arp: [0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 12, 0, 12],
    hook: [
      [[0, 76, 6], [6, 74, 2], [8, 72, 4], [12, 79, 4]],
      [[0, 79, 8], [8, 74, 4], [12, 76, 4]],
      [[0, 76, 6], [6, 72, 2], [8, 69, 8]],
      [[0, 72, 4], [4, 74, 4], [8, 77, 8]],
      [[0, 76, 6], [6, 79, 2], [8, 84, 8]],
      [[0, 83, 8], [8, 79, 8]],
      [[0, 81, 6], [6, 79, 2], [8, 77, 8]],
      [[0, 76, 8], [8, 80, 8]],
    ],
    grooves: { verse: FOUR, chorus: FOUR_BUSY, half: HALF },
    lead: { type: "sawtooth", porta: 0.07 },
    flavor: "outrun",
    form: FORM_STD,
  },
  {
    id: "turbo-caramelo", artist: "Neon Pastel", title: "Turbo Caramelo", mood: "race", bpm: 132,
    key: "Mi dórico → Fá# dórico", style: "synthwave + breakbeat",
    band: { kit: "break", pump: 0.45, tape: 0.5, drive: 16, trim: 0.51 },
    verse: [[28, 52, 55, 59], [28, 52, 55, 59], [24, 48, 52, 55], [26, 50, 54, 57]],
    pre: [[33, 57, 61, 64], [33, 57, 61, 64], [24, 48, 52, 55], [23, 47, 51, 54]],
    chorus: [[31, 55, 59, 62], [33, 57, 61, 64], [28, 52, 55, 59], [28, 52, 55, 59], [24, 48, 52, 55], [26, 50, 54, 57], [23, 47, 51, 54], [23, 47, 51, 54]],
    bridge: [[24, 48, 52, 55, 59], [23, 47, 50, 54, 57], [21, 45, 48, 52, 55], [23, 47, 52, 54, 57]],
    arp: [0, 7, 12, 7, 0, 7, 12, 7, 0, 7, 12, 14, 12, 7, 0, 7],
    hook: [
      [[0, 74, 4], [4, 76, 4], [8, 78, 6], [14, 79, 2]],
      [[0, 81, 8], [8, 79, 4], [12, 76, 4]],
      [[0, 79, 6], [6, 78, 2], [8, 76, 8]],
      [[0, 71, 8], [8, 74, 8]],
      [[0, 76, 4], [4, 79, 4], [8, 84, 8]],
      [[0, 83, 6], [6, 81, 2], [8, 78, 8]],
      [[0, 78, 4], [4, 75, 4], [8, 71, 8]],
      [[0, 75, 8], [8, 78, 8]],
    ],
    grooves: {
      verse: { k: "X.....x...x.....", s: "....X..g.gX...g.", h: "xgxgxgxgxgxgxgxg" },
      chorus: { k: "X.x...x...x..x..", s: "....X..g.gX...gg", h: "x.x.x.x.x.x.x.x.", o: "......x.......x." },
      half: { k: "X.........x.....", s: "........X.......", h: "x.x.x.x.x.x.x.x." },
    },
    lead: { type: "square", porta: 0.06 },
    flavor: "break",
    form: ["intro", "verso", "pre", "refrao", "verso:1", "pre", "refrao:1", "queda", "solo", "ponte", "queda", "refrao:2+2", "final+2"],
  },
  {
    id: "noite-no-autodromo", artist: "Os Pastéis de Néon", title: "Noite no Autódromo", mood: "race", bpm: 124,
    key: "Sol menor → Lá menor", style: "outrun / electro",
    band: { kit: "synth", pump: 0.4, tape: 0.6, trim: 0.52 },
    verse: [[31, 55, 58, 62], [27, 51, 55, 58], [22, 46, 50, 53], [29, 53, 57, 60]],
    pre: [[24, 48, 51, 55], [26, 50, 53, 57], [27, 51, 55, 58], [26, 50, 54, 57]],
    chorus: [[27, 51, 55, 58], [29, 53, 57, 60], [31, 55, 58, 62], [26, 50, 53, 57], [27, 51, 55, 58], [29, 53, 57, 60], [26, 50, 54, 57], [26, 50, 54, 57]],
    bridge: [[24, 48, 51, 55], [20, 44, 48, 51], [27, 51, 55, 58], [26, 50, 54, 57]],
    arp: [0, 12, 24, 12, 0, 12, 24, 12, 0, 12, 22, 12, 0, 10, 12, 7],
    hook: [
      [[0, 70, 3], [3, 72, 3], [6, 74, 2], [8, 75, 6], [14, 74, 2]],
      [[0, 72, 8], [8, 69, 8]],
      [[0, 70, 3], [3, 74, 3], [6, 77, 2], [8, 79, 8]],
      [[0, 77, 6], [6, 74, 2], [8, 72, 8]],
      [[0, 75, 3], [3, 77, 3], [6, 79, 2], [8, 82, 8]],
      [[0, 81, 6], [6, 79, 2], [8, 77, 8]],
      [[0, 78, 8], [8, 74, 4], [12, 81, 4]],
      [[0, 78, 16]],
    ],
    grooves: { verse: { k: "X..x..x...X..x..", c: "....X.......X...", h: "x.x.x.x.x.x.x.x." }, chorus: { k: "X..x..x...X..x..", s: "....X.......X...", c: "....X.......X...", h: "xxxxxxxxxxxxxxxx" }, half: HALF },
    lead: { type: "sawtooth", porta: 0.04 },
    flavor: "outrun",
    form: ["intro", "verso", "verso:1", "pre", "refrao", "queda", "verso:1", "refrao:1", "ponte", "solo", "pre", "refrao:2+2", "final+2"],
  },

  // ------------------------------- CIDADE (chillwave / retrowave) -------------------------------
  {
    id: "por-do-sol-no-cais", artist: "Sorvete de Vapor", title: "Pôr do Sol no Cais", mood: "lobby", bpm: 84,
    key: "Réb maior (com Lá maior emprestado)", style: "chillwave",
    band: { kit: "synth", pump: 0.3, tape: 1.2, trim: 0.5 },
    verse: [[30, 53, 58, 61, 65], [29, 53, 56, 60, 63], [27, 51, 54, 58, 65], [32, 56, 61, 63, 66]],
    pre: [[30, 53, 58, 61, 65], [32, 56, 60, 63]],
    chorus: [[25, 49, 53, 56, 60], [22, 46, 49, 53, 56], [30, 53, 58, 61, 65], [32, 56, 60, 63], [25, 49, 53, 56, 60], [22, 46, 49, 53, 56], [27, 51, 54, 58, 61], [33, 57, 61, 64]],
    bridge: [[23, 47, 51, 54, 58], [22, 46, 49, 53, 56], [27, 51, 54, 58, 61], [32, 56, 61, 63, 66]],
    arp: [0, -1, 12, -1, 7, -1, 12, -1, 0, -1, 12, -1, 7, -1, 12, 14],
    hook: [
      [[0, 77, 6], [6, 75, 2], [8, 73, 8]],
      [[0, 72, 4], [4, 73, 4], [8, 77, 8]],
      [[0, 78, 6], [6, 77, 2], [8, 73, 8]],
      [[0, 75, 16]],
      [[0, 77, 6], [6, 80, 2], [8, 82, 8]],
      [[0, 80, 6], [6, 77, 2], [8, 73, 8]],
      [[0, 75, 8], [8, 78, 8]],
      [[0, 76, 8], [8, 73, 8]],
    ],
    grooves: { verse: { k: "x.......x.x.....", s: "....x.......x...", h: "..x...x...x...x." }, chorus: { k: "x.......x.x.....", s: "....X.......X...", h: "x.x.x.x.x.x.x.x." }, half: { k: "x...............", s: "........x.......", h: "..x...x...x...x." } },
    lead: { type: "square", porta: 0.12 },
    flavor: "chill",
    form: FORM_CHILL,
  },
  {
    id: "fliperama-do-bairro", artist: "Brigadeiro Laser", title: "Fliperama do Bairro", mood: "lobby", bpm: 100,
    key: "Sib maior → Dó maior", style: "retrowave",
    band: { kit: "synth", pump: 0.35, tape: 0.6, trim: 0.53 },
    verse: [[22, 50, 53, 58], [31, 55, 58, 62], [27, 51, 55, 58], [29, 53, 57, 60]],
    pre: [[27, 51, 55, 58], [29, 53, 57, 60], [27, 51, 55, 58], [29, 53, 57, 60]],
    chorus: [[27, 51, 55, 58], [29, 53, 57, 60], [26, 50, 53, 57], [31, 55, 58, 62], [24, 48, 51, 55], [29, 53, 57, 60], [22, 50, 53, 58], [22, 50, 53, 58]],
    bridge: [[30, 54, 58, 61], [32, 56, 60, 63], [22, 50, 53, 58], [22, 50, 53, 58]],
    arp: [0, 12, 7, 12, 0, 12, 7, 12, 0, 12, 7, 12, 5, 7, 12, 14],
    hook: [
      [[0, 70, 2], [2, 75, 2], [4, 79, 2], [6, 77, 2], [8, 75, 4], [12, 74, 4]],
      [[0, 72, 2], [2, 77, 2], [4, 81, 2], [6, 79, 2], [8, 77, 8]],
      [[0, 74, 4], [4, 77, 4], [8, 81, 4], [12, 79, 4]],
      [[0, 79, 6], [6, 77, 2], [8, 74, 8]],
      [[0, 75, 2], [2, 79, 2], [4, 82, 2], [6, 79, 2], [8, 75, 8]],
      [[0, 77, 4], [4, 81, 4], [8, 84, 8]],
      [[0, 82, 8], [8, 77, 8]],
      [[0, 74, 16]],
    ],
    grooves: { verse: { k: "x...x...x...x...", c: "....x.......x...", h: "x.x.x.x.x.x.x.x." }, chorus: { k: "x...x...x...x...", s: "....X.......X...", c: "....x.......x...", h: "x.x.x.x.x.x.x.x.", o: "..x...x...x...x." }, half: HALF },
    lead: { type: "square", porta: 0.02 },
    flavor: "outrun",
    form: ["intro", "verso", "verso:1", "refrao", "verso:1", "pre", "refrao:1", "ponte", "queda", "refrao:1", "refrao:2+2", "final+2"],
  },
  {
    id: "madrugada-na-lanchonete", artist: "Rádio Gordura FM", title: "Madrugada na Lanchonete", mood: "lobby", bpm: 90,
    key: "Fá menor (com Solb napolitano)", style: "balada synthwave",
    band: { kit: "synth", pump: 0.2, tape: 1, trim: 0.51 },
    verse: [[29, 53, 56, 60], [25, 49, 53, 56], [32, 56, 60, 63], [27, 51, 55, 58]],
    pre: [[25, 49, 53, 56], [27, 51, 55, 58], [24, 48, 52, 55], [24, 48, 52, 55]],
    chorus: [[25, 49, 53, 56], [27, 51, 55, 58], [24, 48, 51, 55], [29, 53, 56, 60], [25, 49, 53, 56], [27, 51, 55, 58], [24, 48, 52, 55], [24, 48, 52, 55]],
    bridge: [[22, 46, 49, 53], [30, 54, 58, 61], [25, 49, 53, 56], [24, 48, 52, 55]],
    arp: [0, -1, 12, -1, 7, -1, 12, -1, 0, -1, 12, -1, 7, -1, 10, -1],
    hook: [
      [[0, 77, 6], [6, 75, 2], [8, 72, 8]],
      [[0, 75, 4], [4, 77, 4], [8, 79, 8]],
      [[0, 79, 6], [6, 77, 2], [8, 75, 8]],
      [[0, 72, 12], [12, 68, 4]],
      [[0, 77, 6], [6, 80, 2], [8, 84, 8]],
      [[0, 82, 6], [6, 80, 2], [8, 79, 8]],
      [[0, 79, 8], [8, 76, 8]],
      [[0, 72, 16]],
    ],
    grooves: { verse: { k: "x.......x.......", s: "....X.......X...", h: "x.x.x.x.x.x.x.x." }, chorus: { k: "x.......x.x.....", s: "....X.......X...", h: "x.x.x.x.x.x.x.x.", o: "..............x." }, half: { k: "x...............", s: "........X.......", h: "x...x...x...x..." } },
    lead: { type: "sawtooth", porta: 0.1 },
    flavor: "outrun",
    form: ["intro", "verso", "verso:1", "pre", "refrao", "ponte", "verso:1", "pre", "refrao:1", "solo", "refrao:2+1", "final+1"],
  },
  {
    id: "fumaca-rosa", artist: "Churrasco Cósmico", title: "Fumaça Rosa", mood: "lobby", bpm: 96,
    key: "Mi maior (iv, bIII e bVII emprestados)", style: "retrowave sonhador",
    band: { kit: "synth", pump: 0.35, tape: 0.9, trim: 0.51 },
    verse: [[28, 52, 56, 59], [25, 49, 52, 56], [33, 57, 61, 64], [23, 47, 51, 54]],
    pre: [[33, 57, 61, 64], [23, 47, 51, 54]],
    chorus: [[33, 57, 61, 64], [33, 57, 60, 64], [28, 52, 56, 59], [25, 49, 52, 56], [33, 57, 61, 64], [23, 47, 51, 54], [26, 50, 54, 57], [28, 52, 56, 59]],
    bridge: [[31, 55, 59, 62, 66], [24, 48, 52, 55, 59], [33, 57, 61, 64], [23, 47, 51, 54]],
    arp: [0, 7, 12, 7, 0, 7, 12, 7, 0, 7, 12, 7, 0, 7, 12, 16],
    hook: [
      [[0, 80, 6], [6, 78, 2], [8, 76, 8]],
      [[0, 76, 6], [6, 74, 2], [8, 72, 8]],
      [[0, 71, 4], [4, 76, 4], [8, 80, 8]],
      [[0, 80, 6], [6, 78, 2], [8, 76, 4], [12, 73, 4]],
      [[0, 76, 4], [4, 80, 4], [8, 83, 8]],
      [[0, 83, 6], [6, 81, 2], [8, 78, 8]],
      [[0, 81, 6], [6, 78, 2], [8, 74, 8]],
      [[0, 76, 16]],
    ],
    grooves: { verse: { k: "x.....x.x.......", s: "....X.......X...", h: "xgxgxgxgxgxgxgxg" }, chorus: { k: "x.....x.x.......", s: "....X.......X...", h: "x.x.x.x.x.x.x.x.", o: "......x.......x." }, half: HALF },
    lead: { type: "triangle", porta: 0.1 },
    flavor: "chill",
    form: ["intro", "verso", "verso:1", "refrao", "ponte", "verso:1", "refrao:1", "queda", "refrao:2", "final"],
  },

  // ------------------------------- DUELO (retrowave épico) -------------------------------
  {
    id: "ultimo-rodizio", artist: "Banda Calórica Infinita", title: "O Último Rodízio", mood: "duel", bpm: 112,
    key: "Dó# menor → Ré menor", style: "retrowave épico",
    band: { kit: "synth", pump: 0.3, tape: 0.5, trim: 0.52 },
    verse: [[25, 49, 52, 56], [33, 57, 61, 64], [28, 52, 56, 59], [23, 47, 51, 54]],
    pre: [[30, 54, 57, 61], [32, 56, 60, 63], [30, 54, 57, 61], [32, 56, 60, 63]],
    chorus: [[33, 57, 61, 64], [23, 47, 51, 54], [25, 49, 52, 56], [25, 49, 52, 56], [30, 54, 57, 61], [32, 56, 60, 63], [25, 49, 52, 56], [32, 56, 60, 63]],
    bridge: [[26, 50, 54, 57], [33, 57, 61, 64], [30, 54, 57, 61], [32, 56, 60, 63]],
    arp: [0, 12, 7, 12, 0, 12, 7, 12, 0, 12, 7, 12, 0, 12, 10, 11],
    hook: [
      [[0, 73, 8], [8, 76, 8]],
      [[0, 75, 8], [8, 78, 8]],
      [[0, 80, 12], [12, 76, 4]],
      [[0, 78, 8], [8, 76, 8]],
      [[0, 73, 6], [6, 76, 2], [8, 81, 8]],
      [[0, 80, 6], [6, 78, 2], [8, 75, 8]],
      [[0, 76, 6], [6, 78, 2], [8, 80, 8]],
      [[0, 80, 16]],
    ],
    grooves: { verse: { k: "x...x...x...x...", s: "....X.......X...", h: "..x...x...x...x." }, chorus: { k: "x...x...x...x.x.", s: "....X.......X...", h: "x.x.x.x.x.x.x.x.", t: "X.......X......." }, half: { k: "x.......x.......", s: "........X.......", t: "X..x..x........." } },
    lead: { type: "sawtooth", porta: 0.06 },
    flavor: "epic",
    form: ["intro", "verso", "verso:1", "pre", "refrao", "verso:1", "pre", "refrao:1", "ponte", "queda", "refrao:2+1", "final+1"],
  },
  {
    id: "sobremesa-mortal", artist: "Orquestra do Rodízio", title: "Sobremesa Mortal", mood: "duel", bpm: 138,
    key: "Sib menor (com trítono) → Dó menor", style: "chefão darksynth",
    band: { kit: "synth", drive: 24, pump: 0.3, tape: 0.5, trim: 0.48 },
    verse: [[22, 46, 49, 53], [30, 54, 58, 61], [28, 52, 56, 59], [29, 53, 57, 60]],
    pre: [[30, 54, 58, 61], [32, 56, 60, 63], [30, 54, 58, 61], [29, 53, 57, 60]],
    chorus: [[30, 54, 58, 61], [32, 56, 60, 63], [22, 46, 49, 53], [22, 46, 49, 53], [30, 54, 58, 61], [32, 56, 60, 63], [29, 53, 57, 60], [29, 53, 57, 60]],
    bridge: [[27, 51, 54, 58], [23, 47, 51, 54], [30, 54, 58, 61], [29, 53, 57, 60]],
    arp: [0, 12, 6, 12, 0, 12, 7, 12, 0, 12, 6, 12, 0, 13, 12, 7],
    hook: [
      [[0, 77, 4], [4, 78, 4], [8, 80, 8]],
      [[0, 80, 4], [4, 82, 4], [8, 84, 8]],
      [[0, 85, 8], [8, 84, 4], [12, 82, 4]],
      [[0, 77, 16]],
      [[0, 78, 4], [4, 80, 4], [8, 82, 8]],
      [[0, 84, 4], [4, 85, 4], [8, 87, 8]],
      [[0, 84, 8], [8, 81, 8]],
      [[0, 77, 16]],
    ],
    grooves: { verse: { k: "X.x...x.X.x...x.", s: "....X.......X...", h: "x.x.x.x.x.x.x.x." }, chorus: { k: "X.xx..x.X.xx..x.", s: "....X.......X...", h: "xxxxxxxxxxxxxxxx" }, half: HALF },
    guitar: { verse: "mmom.mmomm.o.mmo", chorus: "o...o...o..o..o." },
    lead: { type: "sawtooth", porta: 0.05 },
    flavor: "dark",
    form: ["intro", "verso", "pre", "refrao", "verso:1", "pre", "refrao:1", "solo", "ponte", "queda", "refrao:2+2", "final+2"],
  },
  {
    id: "rei-da-lista-gorda", artist: "Coxinha Mecânica", title: "Rei da Lista Gorda", mood: "duel", bpm: 146,
    key: "Mi frígio → Fá frígio", style: "chefão darksynth com coro",
    band: { kit: "synth", drive: 24, pump: 0.3, tape: 0.5, trim: 0.48 },
    verse: [[28, 52, 55, 59], [29, 53, 57, 60], [28, 52, 55, 59], [26, 50, 54, 57]],
    pre: [[33, 57, 60, 64], [29, 53, 57, 60], [31, 55, 59, 62], [23, 47, 51, 54]],
    chorus: [[24, 48, 52, 55], [26, 50, 54, 57], [28, 52, 55, 59], [29, 53, 57, 60], [24, 48, 52, 55], [26, 50, 54, 57], [23, 47, 51, 54], [23, 47, 51, 54]],
    bridge: [[33, 57, 60, 64], [29, 53, 57, 60], [31, 55, 59, 62], [23, 47, 51, 54]],
    arp: [0, 12, 1, 12, 0, 12, 7, 12, 0, 12, 1, 12, 0, 12, 7, 5],
    hook: [
      [[0, 76, 6], [6, 77, 2], [8, 79, 8]],
      [[0, 78, 6], [6, 79, 2], [8, 81, 8]],
      [[0, 83, 8], [8, 81, 4], [12, 79, 4]],
      [[0, 77, 16]],
      [[0, 79, 6], [6, 81, 2], [8, 84, 8]],
      [[0, 86, 6], [6, 84, 2], [8, 81, 8]],
      [[0, 83, 8], [8, 78, 8]],
      [[0, 75, 16]],
    ],
    grooves: { verse: { k: "X.xx..x.X.xx..x.", s: "....X.......X...", h: "x.x.x.x.x.x.x.x." }, chorus: { k: "X..x..x.X..x..x.", s: "....X.......X...", h: "x.x.x.x.x.x.x.x.", t: "X.......X......." }, half: HALF },
    guitar: { verse: "mmmo..mmmo..momo", chorus: "o..o..o.o..o..o." },
    lead: { type: "square", porta: 0.05 },
    flavor: "epic",
    form: ["intro", "verso", "verso:1", "pre", "refrao", "queda", "verso:1", "pre", "refrao:1", "solo", "ponte", "refrao:2+1", "final+1"],
  },
];

export const SYNTHWAVE_TRACKS: TrackDef[] = SPECS.map(synthTrack);
