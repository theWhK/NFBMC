// Jukebox: a tela para só ouvir a trilha original do jogo. Lista as faixas por
// álbum (o clima de cada uma), com tocar/pausar, anterior/próxima, aleatório e
// repetir, barra de progresso, "tocando agora" e um visualizador synthwave (o
// sol listrado, a grade correndo e o espectro como silhueta da cidade).
//
// Usa o mesmo toca-discos da música do jogo (music.ts): as seções são gravadas
// sob demanda, uma de cada vez, sem travar a tela. Enquanto o jukebox está
// aberto, os sons do jogo ficam calados. Teclado: ↑↓ escolhe, Enter toca,
// Espaço pausa, ←→ anterior/próxima, S aleatório, R repetir, Esc fecha.
import "./jukebox.css";

import type { Sound } from "./audio.ts";
import { JUKEBOX_TRACKS, MOOD_LABELS, trackLength } from "./music.ts";
import type { Mood, TrackDef } from "./tracks.ts";

type Repeat = "off" | "all" | "one";

let sound: Sound | null = null;
let root: HTMLElement | null = null;

const state = {
  open: false,
  /** Faixa tocando (índice em JUKEBOX_TRACKS) e a selecionada na lista. */
  current: -1,
  selected: 0,
  playing: false,
  paused: false,
  shuffle: false,
  repeat: "all" as Repeat,
  /** Ordem do aleatório (índices). */
  order: [] as number[],
};

/** O Sound do jogo (main.ts chama uma vez). */
export function setupJukebox(s: Sound) {
  sound = s;
}

const fmt = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const ALBUM_ORDER: Mood[] = ["lobby", "race", "pursuit", "duel"];
const ALBUM_NAMES: Partial<Record<Mood, string>> = {
  lobby: "Lado A: Porto Gordo à Noite",
  race: "Lado B: Pé na Tábua",
  pursuit: "Lado C: Fuga da Vigilância",
  duel: "Lado D: Chefões da Lista Gorda",
};

function build() {
  const el = document.createElement("div");
  el.id = "jukebox";
  el.className = "jukebox";
  el.dataset.testid = "jukebox";
  el.hidden = true;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Jukebox");
  const albums = ALBUM_ORDER.map((mood) => {
    const items = JUKEBOX_TRACKS.map((t, i) => ({ t, i })).filter(({ t }) => t.mood === mood);
    return `<li class="jb-album"><h3>${ALBUM_NAMES[mood]} <small>${MOOD_LABELS[mood]}</small></h3><ol>` +
      items.map(({ t, i }) => `<li><button type="button" class="jb-track" data-testid="jukebox-track" data-index="${i}">` +
        `<span class="jb-n">${String(i + 1).padStart(2, "0")}</span>` +
        `<span class="jb-t"><strong>${t.title}</strong><small>${t.artist}</small></span>` +
        `<span class="jb-d">${fmt(trackLength(t))}</span></button></li>`).join("") +
      `</ol></li>`;
  }).join("");
  el.innerHTML = `
    <div class="jb-frame">
      <header class="jb-head">
        <h2>Jukebox <span>Rádio Porto Gordo FM</span></h2>
        <button type="button" class="jb-close" data-testid="jukebox-close" aria-label="Fechar o jukebox">✕</button>
      </header>
      <section class="jb-player">
        <canvas class="jb-vis" aria-hidden="true"></canvas>
        <div class="jb-now" data-testid="jukebox-now" aria-live="polite">
          <small class="jb-status">Escolha uma faixa</small>
          <strong class="jb-title">—</strong>
          <span class="jb-artist"></span>
          <span class="jb-meta"></span>
        </div>
        <div class="jb-progress" data-testid="jukebox-progress">
          <span class="jb-elapsed">0:00</span>
          <div class="jb-bar" role="slider" aria-label="Posição na faixa" tabindex="-1"><div class="jb-fill"></div></div>
          <span class="jb-total">0:00</span>
        </div>
        <div class="jb-controls">
          <button type="button" class="jb-shuffle" data-testid="jukebox-shuffle" aria-pressed="false" title="Aleatório (S)">🔀</button>
          <button type="button" class="jb-prev" data-testid="jukebox-prev" title="Anterior (←)">⏮</button>
          <button type="button" class="jb-play" data-testid="jukebox-play" title="Tocar/pausar (Espaço)">▶</button>
          <button type="button" class="jb-next" data-testid="jukebox-next" title="Próxima (→)">⏭</button>
          <button type="button" class="jb-repeat" data-testid="jukebox-repeat" title="Repetir (R)">🔁</button>
        </div>
        <p class="jb-hint">↑↓ escolhe · Enter toca · Espaço pausa · ←→ anterior/próxima · S aleatório · R repetir · Esc fecha</p>
      </section>
      <ul class="jb-list" data-testid="jukebox-list">${albums}</ul>
    </div>`;
  document.body.append(el);

  const q = <T extends HTMLElement>(sel: string) => el.querySelector(sel) as T;
  q(".jb-close").onclick = () => closeJukebox();
  q(".jb-play").onclick = () => togglePlay();
  q(".jb-next").onclick = () => next(false);
  q(".jb-prev").onclick = () => previous();
  q(".jb-shuffle").onclick = () => toggleShuffle();
  q(".jb-repeat").onclick = () => cycleRepeat();
  for (const button of el.querySelectorAll<HTMLButtonElement>(".jb-track")) {
    button.onclick = () => {
      state.selected = Number(button.dataset.index);
      play(state.selected);
    };
  }
  // Tocar na barra: pula para a seção daquele ponto da faixa.
  q(".jb-bar").addEventListener("pointerdown", (e) => {
    if (state.current < 0) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    seek((e.clientX - rect.left) / rect.width);
  });
  return el;
}

const track = (i: number): TrackDef => JUKEBOX_TRACKS[i];

function play(i: number, from = 0) {
  if (!sound) return;
  state.current = i;
  state.playing = true;
  if (state.paused) {
    state.paused = false;
    sound.jukeboxPause(false);
  }
  sound.jukeboxPlay(track(i).id, from, () => next(true));
  // A próxima da fila já começa a ser gravada.
  const upcoming = nextIndex(false);
  if (upcoming !== null && upcoming !== i) sound.jukeboxPrefetch(track(upcoming).id);
  render();
}

function nextIndex(auto: boolean): number | null {
  const n = JUKEBOX_TRACKS.length;
  if (state.current < 0) return 0;
  if (auto && state.repeat === "one") return state.current;
  if (state.shuffle) {
    const pos = state.order.indexOf(state.current);
    if (pos + 1 < state.order.length) return state.order[pos + 1];
    if (auto && state.repeat === "off") return null;
    return state.order[0];
  }
  if (state.current + 1 < n) return state.current + 1;
  return auto && state.repeat === "off" ? null : 0;
}

function next(auto: boolean) {
  const i = nextIndex(auto);
  if (i === null) {
    state.playing = false;
    sound?.jukeboxStop();
    render();
    return;
  }
  state.selected = i;
  play(i);
}

function previous() {
  const pos = sound?.jukeboxPosition();
  // Passou dos 3 s: volta para o começo da faixa; senão, a anterior.
  if (state.current >= 0 && pos && pos.elapsed > 3) {
    play(state.current);
    return;
  }
  const n = JUKEBOX_TRACKS.length;
  let i: number;
  if (state.shuffle && state.current >= 0) {
    const p = state.order.indexOf(state.current);
    i = state.order[(p - 1 + n) % n];
  } else i = state.current <= 0 ? n - 1 : state.current - 1;
  state.selected = i;
  play(i);
}

function togglePlay() {
  if (!sound) return;
  if (state.current < 0 || !state.playing) {
    play(state.selected);
    return;
  }
  state.paused = !state.paused;
  sound.jukeboxPause(state.paused);
  render();
}

function toggleShuffle() {
  state.shuffle = !state.shuffle;
  if (state.shuffle) {
    // Embaralha a partir da faixa atual.
    const rest = JUKEBOX_TRACKS.map((_, i) => i).filter((i) => i !== state.current);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    state.order = state.current >= 0 ? [state.current, ...rest] : rest;
  }
  render();
}

function cycleRepeat() {
  state.repeat = state.repeat === "all" ? "one" : state.repeat === "one" ? "off" : "all";
  render();
}

/** Pula para a seção que contém a fração `f` da faixa. */
function seek(f: number) {
  const t = track(state.current);
  const target = Math.max(0, Math.min(0.999, f)) * trackLength(t);
  let acc = 0;
  let index = 0;
  for (let i = 0; i < t.form.length; i++) {
    const len = (t.sections[t.form[i].split(/[:+]/)[0]].bars * 240) / t.bpm;
    if (acc + len > target) {
      index = i;
      break;
    }
    acc += len;
  }
  play(state.current, index);
}

function render() {
  if (!root) return;
  const q = <T extends HTMLElement>(sel: string) => root!.querySelector(sel) as T;
  const t = state.current >= 0 ? track(state.current) : null;
  q(".jb-title").textContent = t ? t.title : "—";
  q(".jb-artist").textContent = t ? t.artist : "";
  q(".jb-meta").textContent = t ? `${t.bpm} BPM · ${MOOD_LABELS[t.mood as Mood]} · ${t.style ?? ""} · ${t.key ?? ""}` : "";
  q(".jb-play").textContent = state.playing && !state.paused ? "⏸" : "▶";
  q(".jb-play").setAttribute("aria-label", state.playing && !state.paused ? "Pausar" : "Tocar");
  const shuffle = q(".jb-shuffle");
  shuffle.classList.toggle("on", state.shuffle);
  shuffle.setAttribute("aria-pressed", String(state.shuffle));
  const repeat = q(".jb-repeat");
  repeat.classList.toggle("on", state.repeat !== "off");
  repeat.textContent = state.repeat === "one" ? "🔂" : "🔁";
  repeat.setAttribute("aria-label", `Repetir: ${{ off: "desligado", all: "todas", one: "esta" }[state.repeat]}`);
  root.querySelectorAll<HTMLButtonElement>(".jb-track").forEach((b, i) => {
    b.classList.toggle("playing", i === state.current);
    b.classList.toggle("selected", i === state.selected);
  });
  root.dataset.track = t?.id ?? "";
  updateProgress();
}

function updateProgress() {
  if (!root) return;
  const q = <T extends HTMLElement>(sel: string) => root!.querySelector(sel) as T;
  const t = state.current >= 0 ? track(state.current) : null;
  const pos = t ? sound?.jukeboxPosition() : null;
  const total = t ? trackLength(t) : 0;
  const elapsed = pos?.elapsed ?? 0;
  q(".jb-elapsed").textContent = fmt(elapsed);
  q(".jb-total").textContent = fmt(total);
  q(".jb-fill").style.width = `${total ? (elapsed / total) * 100 : 0}%`;
  q(".jb-status").textContent = !t ? "Escolha uma faixa" : !state.playing ? "Parado" : state.paused ? "Pausado" : pos?.loading ? "Gravando a faixa…" : "Tocando agora";
}

// --- Visualizador ------------------------------------------------------------------

let frame = 0;
let progressTimer: ReturnType<typeof setInterval> | null = null;

function draw(canvas: HTMLCanvasElement, time: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const g = canvas.getContext("2d");
  if (!g) return;
  const analyser = sound?.musicAnalyser() ?? null;
  const bins = new Uint8Array(analyser ? analyser.frequencyBinCount : 0);
  const wave = new Uint8Array(analyser ? analyser.fftSize : 0);
  if (analyser) {
    analyser.getByteFrequencyData(bins);
    analyser.getByteTimeDomainData(wave);
  }
  const level = bins.length ? bins.slice(2, 40).reduce((a, b) => a + b, 0) / (38 * 255) : 0;
  const horizon = h * 0.58;

  // Céu do fim de tarde (roxo → rosa → laranja).
  const sky = g.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#12052b");
  sky.addColorStop(0.6, "#4a0f5c");
  sky.addColorStop(1, "#ff4f8b");
  g.fillStyle = sky;
  g.fillRect(0, 0, w, horizon);

  // Sol listrado, pulsando com o grave.
  const r = Math.min(w, h) * (0.24 + level * 0.05);
  const cx = w / 2;
  const cy = horizon - r * 0.15;
  const sun = g.createLinearGradient(0, cy - r, 0, cy + r);
  sun.addColorStop(0, "#ffe66d");
  sun.addColorStop(0.55, "#ff8a3d");
  sun.addColorStop(1, "#ff2e88");
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = sun;
  g.fillRect(cx - r, cy - r, r * 2, r * 2);
  g.fillStyle = "#4a0f5c";
  for (let k = 0; k < 7; k++) {
    const y = cy + r * (0.05 + k * 0.14);
    g.fillRect(cx - r, y, r * 2, Math.max(1, r * 0.018 * (k + 1)));
  }
  g.restore();

  // Espectro como silhueta de prédios no horizonte (espelhado).
  if (bins.length) {
    const bars = 48;
    const bw = w / bars;
    g.fillStyle = "rgba(20, 4, 40, 0.92)";
    for (let i = 0; i < bars; i++) {
      const k = Math.floor(Math.pow(i / bars, 1.6) * bins.length * 0.6) + 1;
      const v = bins[k] / 255;
      const mirror = Math.abs(i - bars / 2) / (bars / 2);
      const bh = v * h * 0.3 * (0.5 + mirror * 0.7);
      g.fillRect(i * bw + 1, horizon - bh, bw - 2, bh);
    }
  }

  // Chão: grade em perspectiva correndo na direção do sol.
  const floor = g.createLinearGradient(0, horizon, 0, h);
  floor.addColorStop(0, "#1b0533");
  floor.addColorStop(1, "#05010d");
  g.fillStyle = floor;
  g.fillRect(0, horizon, w, h - horizon);
  g.strokeStyle = "rgba(255, 46, 200, 0.75)";
  g.lineWidth = Math.max(1, dpr);
  const bpm = state.current >= 0 ? track(state.current).bpm : 90;
  const speed = state.playing && !state.paused ? (time / 1000) * (bpm / 60) * 0.5 : 0;
  for (let k = 0; k < 14; k++) {
    const z = (k + (speed % 1)) / 14;
    const y = horizon + (h - horizon) * z * z;
    g.globalAlpha = 0.2 + z * 0.8;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  g.globalAlpha = 1;
  for (let k = -12; k <= 12; k++) {
    g.beginPath();
    g.moveTo(cx + k * w * 0.012, horizon);
    g.lineTo(cx + k * w * 0.16, h);
    g.stroke();
  }

  // Osciloscópio ciano atravessando o sol.
  if (wave.length) {
    g.strokeStyle = "#3ff3ff";
    g.lineWidth = Math.max(1.5, 2 * dpr);
    g.shadowColor = "#3ff3ff";
    g.shadowBlur = 8 * dpr;
    g.beginPath();
    const step = Math.max(1, Math.floor(wave.length / w));
    for (let x = 0; x < w; x++) {
      const v = (wave[Math.min(wave.length - 1, x * step)] - 128) / 128;
      const y = cy + v * r * 0.9;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.shadowBlur = 0;
  }
}

function loop(time: number) {
  if (!state.open || !root) return;
  draw(root.querySelector<HTMLCanvasElement>(".jb-vis")!, time);
  frame = requestAnimationFrame(loop);
}

// --- Teclado ------------------------------------------------------------------------

function onKey(e: KeyboardEvent) {
  if (!state.open) return;
  if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.code)) return;
  const handled = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Space", "Escape", "KeyS", "KeyR"];
  if (!handled.includes(e.code)) return;
  // O jukebox fica com a tecla: o menu, por baixo, não reage.
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.repeat && (e.code === "Space" || e.code === "Enter")) return;
  const n = JUKEBOX_TRACKS.length;
  if (e.code === "Escape") closeJukebox();
  else if (e.code === "ArrowDown") state.selected = (state.selected + 1) % n;
  else if (e.code === "ArrowUp") state.selected = (state.selected - 1 + n) % n;
  else if (e.code === "Enter") play(state.selected);
  else if (e.code === "Space") togglePlay();
  else if (e.code === "ArrowRight") next(false);
  else if (e.code === "ArrowLeft") previous();
  else if (e.code === "KeyS") toggleShuffle();
  else if (e.code === "KeyR") cycleRepeat();
  render();
  root?.querySelectorAll<HTMLElement>(".jb-track")[state.selected]?.scrollIntoView({ block: "nearest" });
}

/** Abre o jukebox (a música do jogo sai e os efeitos calam até fechar). */
export function openJukebox() {
  if (state.open) return;
  root ??= build();
  sound?.unlock();
  sound?.jukebox(true);
  state.open = true;
  root.hidden = false;
  window.addEventListener("keydown", onKey, true);
  frame = requestAnimationFrame(loop);
  progressTimer = setInterval(updateProgress, 250);
  // Já começa tocando a selecionada (a primeira, na primeira vez).
  play(state.current >= 0 ? state.current : state.selected);
  root.querySelector<HTMLButtonElement>(".jb-play")?.focus();
}

export function closeJukebox() {
  if (!state.open || !root) return;
  state.open = false;
  state.playing = false;
  state.paused = false;
  root.hidden = true;
  window.removeEventListener("keydown", onKey, true);
  cancelAnimationFrame(frame);
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = null;
  sound?.jukeboxStop();
  sound?.jukebox(false);
  render();
  document.getElementById("menu-jukebox")?.focus();
}

/** Estado para os testes. */
export function jukeboxState() {
  const t = state.current >= 0 ? track(state.current) : null;
  return {
    open: state.open,
    count: JUKEBOX_TRACKS.length,
    track: t?.id ?? null,
    title: t?.title ?? null,
    playing: state.playing,
    paused: state.paused,
    shuffle: state.shuffle,
    repeat: state.repeat,
    elapsed: sound?.jukeboxPosition()?.elapsed ?? 0,
  };
}
