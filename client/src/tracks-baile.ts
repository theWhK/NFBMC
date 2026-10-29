// Lado E da trilha: o baile de Porto Gordo. Funk de tamborzão, brega funk,
// phonk de drift, funk automotivo e um brega romântico de teclado, tudo em cima
// de um 808 de paredão (grave fundo, saturado e deslizando de nota).
//
// Tudo composto para o jogo. Do gênero vem só a cara, medida numa montagem de
// referência (andamento perto de 130 BPM, bumbo em 1, 5, 9, 11 e 13 ou na quebra
// 3+3+2, grave entre 40 e 70 Hz com muito deslize, agudo abafado, quase mono);
// melodias, baixos e acordes são originais.
//
// Cada faixa é uma "ficha" (baterias, atabaque, linha do 808, gancho, acordes) e
// `baileTrack` monta as seções: intro, "a" (batida e grave), "b" (com o gancho),
// quebra (o chão some), drop (tudo) e final.
import type { Band, BandOptions } from "./band.ts";
import { drums, roll, type Groove, type Line, type Mood, type Section, type TrackDef } from "./compose.ts";

/** Linha do 808 num compasso: [semicolcheia, nota, duração, desliza para?]. */
type BassBar = [number, number, number, number?][];

interface Spec {
  id: string;
  artist: string;
  title: string;
  mood: Mood;
  bpm: number;
  key: string;
  style: string;
  band: Omit<BandOptions, "bpm">;
  drums: { a: Groove; b: Groove; drop: Groove; quebra: Groove };
  /** Atabaque: "L" grave, "H" agudo, "s" tapa, "g" grave fantasma. */
  tambor?: { a: string; b: string; notes: [number, number] };
  /** Quatro compassos do 808 (repetem); `drop` é a variação do drop. */
  bass: BassBar[];
  bassDrop?: BassBar[];
  /** Saturação do 808 (o automotivo é o mais sujo). */
  drive: number;
  /** Gancho: quatro compassos. */
  hook: Line[];
  hookInst: "cowbell" | "brega" | "vox";
  /** Vogais do gancho cantado (uma por nota, em ciclo): o, e, a, u, i ("ai"). */
  vowels?: string;
  /** Resposta da voz de fundo, num compasso (toca nos compassos 4 e 8). */
  answer?: [number, number, number, string][];
  /** Acordes (um por compasso, repetindo) e onde entram os metais curtos ("x"). */
  chords?: number[][];
  stabs?: string;
  /** Teclado de brega: piano elétrico e cama por baixo do gancho. */
  keys?: boolean;
  form: string[];
}

const at = (b: Band, bar: number, step = 0) => b.at(bar, step);

const VOWEL: Record<string, "a" | "e" | "o" | "u" | "ai"> = { a: "a", e: "e", o: "o", u: "u", i: "ai" };

function bassBar(b: Band, s: Spec, bar: number, line: BassBar, vel = 1) {
  for (const [step, note, len, to] of line) b.boom(at(b, bar, step), note, b.len(len) * 0.97, { vel, to, drive: s.drive });
}

function tamborBar(b: Band, s: Spec, bar: number, pattern: string, vel = 1) {
  if (!s.tambor) return;
  const [low, high] = s.tambor.notes;
  for (let i = 0; i < 16; i++) {
    const c = pattern[i];
    if (c === "L") b.tambor(at(b, bar, i), low, 0.9 * vel);
    else if (c === "g") b.tambor(at(b, bar, i), low, 0.4 * vel);
    else if (c === "H") b.tambor(at(b, bar, i), high, 0.8 * vel);
    else if (c === "s") b.tambor(at(b, bar, i), high, 0.85 * vel, true);
  }
}

function hookBar(b: Band, s: Spec, bar: number, line: Line, o: { vel?: number; octave?: number; inst?: Spec["hookInst"] } = {}) {
  const inst = o.inst ?? s.hookInst;
  const vel = o.vel ?? 1;
  let prev: number | undefined;
  line.forEach(([step, note, len], i) => {
    const n = note + (o.octave ?? 0);
    const t = at(b, bar, step);
    if (inst === "cowbell") b.cowbell(t, n, b.len(len), vel);
    else if (inst === "vox") b.vox(t, n, b.len(len) * 0.95, VOWEL[(s.vowels ?? "o")[(bar * 3 + i) % (s.vowels ?? "o").length]], vel);
    // Teclado de brega: quadrada com vibrato largo e a nota escorregando da anterior.
    else b.lead(t, n, b.len(len) * 0.92, { vel: vel * 1.6, type: "square", glideFrom: prev, porta: 0.035, vibrato: 2.6, vibratoRate: 6.2, chorus: true, echo: 0.22, cutoff: 3200 });
    prev = n;
  });
}

function answerBar(b: Band, s: Spec, bar: number, vel = 1) {
  for (const [step, note, len, vowel] of s.answer ?? []) b.vox(at(b, bar, step), note, b.len(len), VOWEL[vowel], vel);
}

function chordBar(b: Band, s: Spec, bar: number, vel = 1, cutoff = 2400) {
  if (!s.chords) return;
  const c = s.chords[bar % s.chords.length];
  if (s.keys) {
    b.pad(at(b, bar), c, b.barTime * 0.98, 0.7 * vel, cutoff);
    [0, 6, 10].forEach((st) => b.ep(at(b, bar, st), c, b.len(st ? 4 : 6), 0.55 * vel));
  }
  if (s.stabs) for (let i = 0; i < 16; i++) if (s.stabs[i] === "x") b.stab(at(b, bar, i), c.map((n) => n + 12), b.len(1.5), 0.7 * vel, 3200);
}

/** Monta as seções da faixa a partir da ficha. */
function baileTrack(s: Spec): TrackDef {
  const bass = (bar: number, drop = false) => (drop && s.bassDrop ? s.bassDrop : s.bass)[bar % 4];
  const hook = (bar: number) => s.hook[bar % s.hook.length];
  const sections: Record<string, Section> = {
    intro: {
      bars: 4,
      play(b) {
        for (let bar = 0; bar < 4; bar++) {
          chordBar(b, s, bar, 0.6, 600 + bar * 400);
          // O gancho de longe (só nos dois últimos compassos) e a voz chamando.
          if (bar >= 2) hookBar(b, s, bar, hook(bar), { vel: 0.45 });
          if (bar === 1 || bar === 3) answerBar(b, s, bar, 0.8);
          if (bar === 3) drums(b, bar, { h: s.drums.a.h }, 0.6);
        }
        b.boom(at(b, 0), s.bass[0][0][1], b.barTime * 1.8, { vel: 0.7, drive: s.drive });
        b.riser(at(b, 2), b.barTime * 2);
      },
    },
    a: {
      bars: 8,
      play(b, v) {
        for (let bar = 0; bar < 8; bar++) {
          drums(b, bar, s.drums.a, v ? 1 : 0.92);
          tamborBar(b, s, bar, s.tambor?.a ?? "", v ? 1 : 0.85);
          bassBar(b, s, bar, bass(bar));
          if (s.keys) chordBar(b, s, bar, 0.7, 1600);
          if (v) hookBar(b, s, bar, hook(bar), { vel: 0.5, octave: s.hookInst === "vox" ? 0 : -12 });
          if (bar % 4 === 3) answerBar(b, s, bar, 0.9);
        }
        b.crash(at(b, 0), 0.6);
      },
    },
    b: {
      bars: 8,
      play(b, v) {
        for (let bar = 0; bar < 8; bar++) {
          drums(b, bar, s.drums.b);
          tamborBar(b, s, bar, s.tambor?.b ?? "");
          bassBar(b, s, bar, bass(bar, v > 0));
          chordBar(b, s, bar, 0.85, 2600);
          hookBar(b, s, bar, hook(bar));
          if (v && s.hookInst !== "vox") answerBar(b, s, bar, bar % 2 ? 0.7 : 0);
          if (bar % 4 === 0) b.crash(at(b, bar), 0.75, bar ? -0.4 : 0.4);
        }
        roll(b, 7, 1);
      },
    },
    quebra: {
      bars: 4,
      play(b) {
        // O chão some: um 808 longo descendo, a voz e o gancho filtrado; volta com rufo.
        const root = s.bass[0][0][1];
        b.boom(at(b, 0), root + 5, b.barTime * 1.9, { to: root, drive: s.drive });
        b.boom(at(b, 2), root + 7, b.barTime * 1.4, { to: root - 2, drive: s.drive });
        for (let bar = 0; bar < 4; bar++) {
          drums(b, bar, s.drums.quebra, 0.8);
          chordBar(b, s, bar, 0.5, 900);
          if (bar < 3) hookBar(b, s, bar, hook(bar), { vel: 0.35 });
          answerBar(b, s, bar, 0.75);
        }
        roll(b, 3, 1);
        b.riser(at(b, 1), b.barTime * 3);
      },
    },
    drop: {
      bars: 8,
      play(b, v) {
        for (let bar = 0; bar < 8; bar++) {
          drums(b, bar, s.drums.drop);
          tamborBar(b, s, bar, s.tambor?.b ?? "");
          bassBar(b, s, bar, bass(bar, true), 1.05);
          chordBar(b, s, bar, 1, 3200);
          hookBar(b, s, bar, hook(bar));
          // Segunda vez: o gancho dobrado (cowbell em cima, voz por baixo) e a resposta.
          if (v) hookBar(b, s, bar, hook(bar), { vel: 0.45, octave: s.hookInst === "cowbell" ? -12 : 12, inst: s.hookInst === "vox" ? "cowbell" : s.hookInst });
          if (bar % 4 === 3) answerBar(b, s, bar, 0.8);
          if (bar % 4 === 0) b.crash(at(b, bar), 0.85, bar ? -0.4 : 0.4);
        }
        if (s.drums.drop.k) for (let i = 0; i < 4; i++) b.tom(at(b, 7, 12 + i), 50 - i * 3, 0.8);
      },
    },
    final: {
      bars: 3,
      play(b) {
        drums(b, 0, s.drums.drop);
        tamborBar(b, s, 0, s.tambor?.b ?? "");
        bassBar(b, s, 0, bass(3, true));
        chordBar(b, s, 0, 1, 3000);
        hookBar(b, s, 0, hook(3));
        // A última pancada: bumbo, prato e o 808 caindo até o fundo.
        const root = s.bass[0][0][1];
        b.kick(at(b, 1));
        b.crash(at(b, 1), 1, -0.4);
        b.crash(at(b, 1), 1, 0.4);
        b.boom(at(b, 1), root, b.barTime * 1.8, { to: root - 7, drive: s.drive });
        if (s.chords) b.pad(at(b, 1), s.chords[0], b.barTime * 1.8, 0.7, 1400);
        answerBar(b, s, 1, 0.8);
      },
    },
  };
  return { id: s.id, artist: s.artist, title: s.title, mood: s.mood, bpm: s.bpm, key: s.key, style: s.style, band: s.band, sections, form: s.form, album: "baile" };
}

const FORM_BAILE = ["intro", "a", "b", "a:1", "b:1", "quebra", "drop", "a:1", "drop:1", "final"];

const SPECS: Spec[] = [
  // Funk de tamborzão: o bumbo do mandelão, atabaque em cima e a voz puxando o coro.
  {
    id: "tamborzao-do-torresmo", artist: "MC Pururuca", title: "Tamborzão do Torresmo", mood: "race", bpm: 130,
    key: "Sol menor", style: "funk de tamborzão",
    band: { kit: "baile", pump: 0.22, tape: 0.5, lowpass: 9500, trim: 0.374 },
    drums: {
      a: { k: "X...x...x.x.x...", c: "....X.......X...", h: "..x...x...x...x." },
      b: { k: "X...x...x.x.x...", c: "....X..x....X...", h: "x.x.x.x.x.x.x.x.", s: "...........g...g" },
      drop: { k: "X...x...x.x.x..x", c: "....X..x....X.x.", h: "x.xxx.xxx.xxx.xx" },
      quebra: { k: "X...............", h: "....x.......x..." },
    },
    tambor: { a: "L..s..L.L..s..s.", b: "L.ss.sL.L.ss.sLs", notes: [50, 57] },
    bass: [
      [[0, 31, 6], [8, 31, 3], [11, 34, 5]],
      [[0, 29, 6], [8, 29, 3], [11, 31, 5]],
      [[0, 34, 6], [8, 34, 3], [11, 36, 5]],
      [[0, 33, 10, 29], [12, 31, 4]],
    ],
    bassDrop: [
      [[0, 31, 3], [3, 31, 3], [6, 34, 2], [8, 31, 3], [11, 38, 5, 34]],
      [[0, 29, 3], [3, 29, 3], [6, 33, 2], [8, 29, 3], [11, 36, 5, 31]],
      [[0, 34, 3], [3, 34, 3], [6, 36, 2], [8, 34, 3], [11, 38, 5]],
      [[0, 33, 6], [6, 33, 2], [8, 36, 4, 29], [12, 31, 4]],
    ],
    drive: 4.5,
    hook: [
      [[0, 67, 3], [4, 70, 3], [8, 67, 2], [10, 65, 6]],
      [[0, 65, 3], [4, 69, 3], [8, 65, 2], [10, 62, 6]],
      [[0, 70, 3], [4, 72, 3], [8, 74, 2], [10, 72, 3], [13, 70, 3]],
      [[0, 69, 6], [8, 67, 8]],
    ],
    hookInst: "vox",
    vowels: "oeoia",
    answer: [[8, 55, 3, "i"], [12, 55, 4, "o"]],
    chords: [[55, 58, 62], [53, 57, 60], [58, 62, 65], [50, 54, 57]],
    stabs: "x..x..x.........",
    form: FORM_BAILE,
  },
  // Brega funk: a batida quebrada do Recife, teclado de brega com vibrato e 808 cantando junto.
  {
    id: "brega-funk-do-pastel", artist: "Banda Calabresa Neon", title: "Brega Funk do Pastel", mood: "race", bpm: 160,
    key: "Lá menor", style: "brega funk",
    band: { kit: "baile", pump: 0.3, tape: 0.4, trim: 0.337 },
    drums: {
      a: { k: "X..x..x...x.x...", c: "....X......xX...", h: "..x...x...x...x." },
      b: { k: "X..x..x...x.x...", c: "....X......xX...", h: "x.x.x.x.x.x.x.x.", o: "..x.......x....." },
      drop: { k: "X..x..x.X.x.x..x", c: "....X..x...xX...", h: "xxx.xxx.xxx.xxx.", o: "..x...x...x...x." },
      quebra: { k: "X.......X.......", c: "............X..." },
    },
    tambor: { a: "................", b: "....s.......s..s", notes: [52, 59] },
    bass: [
      [[0, 33, 5], [6, 33, 2], [10, 36, 6]],
      [[0, 29, 5], [6, 29, 2], [10, 33, 6]],
      [[0, 36, 5], [6, 36, 2], [10, 31, 6]],
      [[0, 31, 8, 33], [10, 31, 2], [12, 28, 4]],
    ],
    bassDrop: [
      [[0, 33, 3], [3, 33, 3], [6, 36, 2], [10, 40, 6, 33]],
      [[0, 29, 3], [3, 29, 3], [6, 33, 2], [10, 36, 6, 29]],
      [[0, 36, 3], [3, 36, 3], [6, 40, 2], [10, 31, 6]],
      [[0, 31, 6], [6, 35, 4], [10, 31, 2], [12, 28, 4, 33]],
    ],
    drive: 3.5,
    hook: [
      [[0, 76, 3], [3, 74, 3], [6, 72, 2], [8, 74, 4], [12, 72, 2], [14, 69, 2]],
      [[0, 72, 6], [6, 69, 2], [8, 65, 8]],
      [[0, 67, 3], [3, 69, 3], [6, 72, 2], [8, 76, 4], [12, 74, 4]],
      [[0, 72, 4], [4, 71, 4], [8, 69, 8]],
    ],
    hookInst: "brega",
    answer: [[8, 64, 2, "e"], [10, 64, 2, "e"], [12, 69, 4, "o"]],
    chords: [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]],
    keys: true,
    form: FORM_BAILE,
  },
  // Phonk de drift: cowbell em semicolcheias no frígio, 808 deslizando e chimbal correndo.
  {
    id: "drift-na-banha", artist: "Phonk do Cais", title: "Drift na Banha", mood: "pursuit", bpm: 132,
    key: "Fá# frígio", style: "phonk de drift",
    band: { kit: "baile", pump: 0.35, tape: 0.8, lowpass: 7500, trim: 0.37 },
    drums: {
      a: { k: "X.....X...X.....", c: "........X.......", h: "x.x.x.x.x.x.xxxx" },
      b: { k: "X.....X.X.X.....", c: "........X.......", h: "xxxxxxxxxxxxxxxx", o: "..x.......x....." },
      drop: { k: "X.....X.X.X...x.", c: "........X.....x.", h: "xxxxxxxxxxxxxxxx", o: "..x...x...x...x." },
      quebra: { h: "x.x.x.x.x.x.x.x." },
    },
    bass: [
      [[0, 30, 10], [10, 30, 2], [12, 31, 4, 30]],
      [[0, 30, 6], [6, 33, 4], [10, 31, 6, 26]],
      [[0, 26, 8], [8, 28, 8]],
      [[0, 30, 6], [6, 30, 2], [8, 33, 4], [12, 31, 4, 30]],
    ],
    drive: 6,
    hook: [
      [[0, 78, 2], [2, 78, 1], [3, 78, 1], [4, 79, 2], [6, 78, 2], [8, 76, 2], [10, 74, 2], [12, 73, 2], [14, 74, 2]],
      [[0, 73, 2], [2, 73, 1], [3, 73, 1], [4, 74, 2], [6, 73, 2], [8, 71, 4], [12, 69, 4]],
      [[0, 78, 2], [2, 78, 1], [3, 78, 1], [4, 79, 2], [6, 78, 2], [8, 76, 2], [10, 74, 2], [12, 78, 2], [14, 81, 2]],
      [[0, 79, 3], [3, 78, 3], [6, 76, 2], [8, 74, 4], [12, 73, 4]],
    ],
    hookInst: "cowbell",
    answer: [[0, 42, 8, "u"], [8, 45, 8, "o"]],
    form: FORM_BAILE,
  },
  // Funk automotivo com phonk: a quebra 3+3+2 do paredão, 808 bem sujo e cowbell no menor.
  {
    id: "automotivo-da-mortadela", artist: "DJ Paredão da Vila", title: "Automotivo da Mortadela", mood: "pursuit", bpm: 130,
    key: "Dó# menor", style: "funk automotivo com phonk",
    band: { kit: "baile", pump: 0.3, tape: 0.9, lowpass: 8000, trim: 0.326 },
    drums: {
      a: { k: "X..xx..xX.x.x...", c: "....X.......X...", h: "x.x.x.x.x.x.x.x." },
      b: { k: "X..xx..xX.x.x..x", c: "....X..x....X...", h: "xxx.xxx.xxx.xxxx" },
      drop: { k: "X..xx..xX.x.x.xx", c: "....X..x....X..x", h: "xxxxxxxxxxxxxxxx", o: "..x...x...x...x." },
      quebra: { k: "X..x..x.........", h: "x...x...x...x..." },
    },
    tambor: { a: "L.s.L.s.L.sLs.s.", b: "LssLL.sLLssL.sLs", notes: [49, 56] },
    bass: [
      [[0, 37, 7], [8, 37, 4], [12, 40, 4, 37]],
      [[0, 33, 7], [8, 33, 4], [12, 35, 4]],
      [[0, 32, 8], [8, 32, 4], [12, 35, 4, 32]],
      [[0, 37, 12, 30], [12, 37, 4]],
    ],
    bassDrop: [
      [[0, 37, 3], [3, 37, 3], [6, 37, 2], [8, 40, 4], [12, 37, 4, 33]],
      [[0, 33, 3], [3, 33, 3], [6, 33, 2], [8, 35, 4], [12, 36, 4, 33]],
      [[0, 32, 3], [3, 32, 3], [6, 32, 2], [8, 35, 4], [12, 32, 4, 37]],
      [[0, 37, 6], [6, 37, 2], [8, 40, 4, 30], [12, 37, 4]],
    ],
    drive: 8,
    hook: [
      [[0, 80, 2], [2, 80, 2], [4, 78, 2], [6, 76, 2], [8, 80, 2], [10, 80, 2], [12, 83, 2], [14, 80, 2]],
      [[0, 78, 2], [2, 78, 2], [4, 76, 2], [6, 75, 2], [8, 73, 4], [12, 75, 4]],
      [[0, 80, 2], [2, 80, 2], [4, 78, 2], [6, 76, 2], [8, 80, 2], [10, 80, 2], [12, 85, 2], [14, 83, 2]],
      [[0, 76, 2], [2, 76, 2], [4, 75, 2], [6, 73, 2], [8, 71, 4], [12, 73, 4]],
    ],
    hookInst: "cowbell",
    answer: [[4, 49, 3, "i"], [12, 52, 4, "i"]],
    form: FORM_BAILE,
  },
  // Brega romântico: teclado chorando, piano elétrico, 808 macio e a troca de tom no fim.
  {
    id: "saudade-de-torresmo", artist: "Os Tecladistas do Cais", title: "Saudade de Torresmo", mood: "lobby", bpm: 96,
    key: "Mi maior → Fá maior", style: "brega romântico",
    band: { kit: "baile", pump: 0.15, tape: 0.5, trim: 0.334 },
    drums: {
      a: { k: "X.......X.x.....", c: "....X.......X...", h: "x.x.x.x.x.x.x.x." },
      b: { k: "X.......X.x.....", c: "....X.......X...", h: "x.x.x.x.x.x.x.x.", o: "......x.......x." },
      drop: { k: "X.....x.X.x.....", c: "....X.......X..x", h: "xxx.xxx.xxx.xxx.", o: "......x.......x." },
      quebra: { h: "x...x...x...x..." },
    },
    bass: [
      [[0, 28, 7], [8, 28, 4], [12, 32, 4]],
      [[0, 37, 7], [8, 37, 4], [12, 35, 4]],
      [[0, 33, 7], [8, 33, 4], [12, 37, 4]],
      [[0, 35, 10], [10, 35, 2], [12, 35, 4, 28]],
    ],
    drive: 2.5,
    hook: [
      [[0, 71, 4], [4, 73, 2], [6, 75, 2], [8, 76, 6], [14, 75, 2]],
      [[0, 73, 8], [8, 71, 4], [12, 68, 4]],
      [[0, 69, 4], [4, 71, 2], [6, 73, 2], [8, 76, 4], [12, 78, 4]],
      [[0, 75, 10], [12, 71, 4]],
    ],
    hookInst: "brega",
    answer: [[0, 64, 6, "a"], [8, 63, 6, "o"]],
    chords: [[56, 59, 64], [56, 61, 64], [57, 61, 64], [59, 63, 66]],
    keys: true,
    form: ["intro", "a", "b", "a:1", "b:1", "quebra", "drop", "drop:1+1", "final+1"],
  },
];

export const BAILE_TRACKS: TrackDef[] = SPECS.map(baileTrack);
