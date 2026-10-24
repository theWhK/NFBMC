import "@fontsource/russo-one/latin-400.css";
import "@fontsource/black-ops-one/latin-400.css";

import { isRaceId, type GoRaceMessage, type InputMessage, type Phase, type RaceId } from "@nfbmc/shared";

import { Sound } from "./audio.ts";
import { createMinimap, createTacho } from "./hud.ts";
import { LOGO_SVG } from "./logo.ts";
import type { ModeContext, PlayerSnapshot } from "./mode.ts";
import { createMenu, type MenuEntry } from "./menu.ts";
import { joinEventRace, joinQuickRace, joinWorld } from "./net.ts";
import { RaceMode } from "./race-mode.ts";
import { GameScene } from "./scene.ts";
import { $, hideModeUi, ui } from "./ui.ts";
import { WorldMode } from "./world-mode.ts";

ui.logo.innerHTML = LOGO_SVG;

const storage = {
  get: (key: string) => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  },
  set: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Sem localStorage (aba anônima, por exemplo): só não lembra.
    }
  },
};

// --- Som -------------------------------------------------------------------

const sound = new Sound();

function refreshAudioButtons() {
  ui.toggleMusic.classList.toggle("off", !sound.prefs.music);
  ui.toggleSfx.classList.toggle("off", !sound.prefs.sfx);
}
refreshAudioButtons();

// O navegador só deixa tocar som depois da primeira interação.
for (const event of ["pointerdown", "keydown"]) {
  window.addEventListener(event, () => sound.unlock(), { once: true });
}
ui.toggleMusic.addEventListener("click", () => {
  sound.toggle("music");
  refreshAudioButtons();
  ui.toggleMusic.blur();
});
ui.toggleSfx.addEventListener("click", () => {
  sound.toggle("sfx");
  refreshAudioButtons();
  ui.toggleSfx.blur();
});
sound.song("lobby");

// --- Cena 3D ---------------------------------------------------------------

// A cena já roda no menu, sobrevoando a cidade atrás do logo.
let scene: GameScene | null = null;
try {
  scene = new GameScene($<HTMLCanvasElement>("game"));
} catch (err) {
  // Sem WebGL o jogo continua funcionando (útil para os testes), só não desenha o 3D.
  console.error("Não foi possível iniciar o 3D", err);
}

// --- Controles -------------------------------------------------------------

const keys = new Set<string>();
const THROTTLE: Record<string, number> = { ArrowUp: 1, KeyW: 1, ArrowDown: -1, KeyS: -1 };
const STEER: Record<string, number> = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 };

function currentInput(): InputMessage {
  let throttle = 0;
  let steer = 0;
  for (const code of keys) {
    throttle += THROTTLE[code] ?? 0;
    steer += STEER[code] ?? 0;
  }
  return { throttle: Math.sign(throttle), steer: Math.sign(steer) };
}

// --- Contexto dos modos ----------------------------------------------------

const drawTacho = createTacho(ui.tacho);
const drawMinimap = createMinimap(ui.minimap);

const ctx: ModeContext = {
  scene,
  sound,
  input: currentInput,
  drawTacho,
  drawMinimap,
  updateOtherEngines(cars, myId, me) {
    const others = new Map<string, { speed: number; distance: number; pan: number }>();
    for (const [id, car] of cars) {
      if (id === myId || !car.visible) continue;
      const dx = car.x - me.x;
      const dz = car.z - me.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 70) continue;
      // Direita de quem olha para o heading: (-cos, sin).
      const pan = distance > 0 ? (dx * -Math.cos(me.heading) + dz * Math.sin(me.heading)) / distance : 0;
      others.set(id, { speed: car.speed, distance, pan });
    }
    // Só os 6 motores mais perto (com trânsito, podiam ser dezenas de osciladores).
    const nearest = new Map([...others].sort(([, a], [, b]) => a.distance - b.distance).slice(0, 6));
    sound.updateOthers(nearest);
  },
  detectBump(previous, speed) {
    const now = performance.now();
    const drop = Math.abs(previous.speed) - Math.abs(speed);
    if (drop > 3 && currentInput().throttle >= 0 && now - previous.bumpAt > 400) {
      sound.bump();
      previous.bumpAt = now;
    }
  },
};

// --- Modos e transições ----------------------------------------------------

let mode: WorldMode | RaceMode | null = null;
let playerName = "";
/**
 * Ficha do jogador no servidor (calorias, corridas, vitórias). Fica guardada
 * neste navegador, então quem volta outro dia continua de onde parou.
 */
let token = storage.get("nfbmc:token") || undefined;
let soloWorld = false;
let switching = false;

function setMode(next: WorldMode | RaceMode | null) {
  mode?.dispose();
  hideModeUi();
  sound.updateSiren(null);
  mode = next;
  lastSent = "";
  sendInput();
  publishTestHook();
}

function setLoading(text: string | null) {
  ui.loading.hidden = !text;
  ui.loading.textContent = text ?? "";
}

async function enterWorld(spawn?: RaceId) {
  const room = await joinWorld({ name: playerName, token, solo: soloWorld, spawn, color: menu.color() });
  room.onLeave(() => {
    if (!switching) ui.status.textContent = "Desconectado. Recarregue a página.";
  });
  setMode(new WorldMode(room, ctx, goRace, (newToken) => {
    token = newToken;
    storage.set("nfbmc:token", newToken);
  }));
}

/** O mundo chamou para uma corrida: sai do mundo e entra na sala dela. */
async function goRace(message: GoRaceMessage) {
  if (switching || !(mode instanceof WorldMode)) return;
  switching = true;
  setLoading("Indo para a largada…");
  try {
    const world = mode.room;
    setMode(null);
    await world.leave();
    const room = await joinEventRace(message.roomId, { name: playerName, token, color: menu.color() });
    room.onLeave(() => {
      if (!switching) ui.status.textContent = "Desconectado. Recarregue a página.";
    });
    setMode(new RaceMode(room, ctx, backToWorld));
  } catch (err) {
    console.error(err);
    await enterWorld().catch(() => (ui.status.textContent = "Não foi possível conectar ao servidor."));
  } finally {
    switching = false;
    setLoading(null);
  }
}

/** Fim da corrida de evento: volta para o mundo, no ponto de encontro dela. */
async function backToWorld(raceId: RaceId) {
  if (switching || !(mode instanceof RaceMode)) return;
  switching = true;
  setLoading("Voltando para Porto Gordo…");
  try {
    const race = mode.room;
    setMode(null);
    await race.leave();
    await enterWorld(raceId);
  } catch (err) {
    console.error(err);
    ui.status.textContent = "Não foi possível conectar ao servidor.";
  } finally {
    switching = false;
    setLoading(null);
  }
}

// --- Envio dos controles ---------------------------------------------------

let lastSent = "";
function sendInput() {
  if (!mode) return;
  const input = currentInput();
  const serialized = JSON.stringify(input);
  if (serialized === lastSent) return;
  lastSent = serialized;
  mode.sendInput(input);
}

window.addEventListener("keydown", (e) => {
  if (document.activeElement === ui.name) return;
  if (e.code === "KeyM") {
    sound.toggle("music");
    refreshAudioButtons();
  }
  if (mode instanceof WorldMode) mode.handleKey(e.code);
  if (!(e.code in THROTTLE) && !(e.code in STEER)) return;
  e.preventDefault();
  keys.add(e.code);
  sendInput();
});
window.addEventListener("keyup", (e) => {
  keys.delete(e.code);
  sendInput();
});
window.addEventListener("blur", () => {
  keys.clear();
  sendInput();
});

// --- Laço de desenho -------------------------------------------------------

function frame() {
  if (mode) mode.frame();
  else scene?.render(new Map(), undefined);
  requestAnimationFrame(frame);
}
frame();

// --- Menu ------------------------------------------------------------------

async function start(entry: MenuEntry) {
  // Saiu do menu: a vitrine sai de cena.
  scene?.setShowcase(null);
  if (entry === "world" || entry === "world-solo") {
    soloWorld = entry === "world-solo";
    // ?spawn=centro na URL nasce direto num ponto de encontro (atalho para testes).
    const spawn = new URLSearchParams(location.search).get("spawn");
    await enterWorld(isRaceId(spawn) ? spawn : undefined);
  } else {
    const room = await joinQuickRace(playerName, entry === "solo", menu.color());
    room.onLeave(() => {
      if (!switching) ui.status.textContent = "Desconectado. Recarregue a página.";
    });
    setMode(new RaceMode(room, ctx));
  }
  ui.status.textContent = scene ? "Conectado" : "Conectado (sem 3D neste navegador)";
  ui.join.hidden = true;
  ui.minimap.hidden = false;
}

function enter(entry: MenuEntry) {
  sound.unlock();
  sound.click();
  const buttons = [...ui.join.querySelectorAll("button")];
  if (buttons.some((b) => b.disabled)) return;
  buttons.forEach((b) => (b.disabled = true));
  playerName = ui.name.value.trim();
  storage.set("nfbmc:name", playerName);
  ui.status.textContent = "Conectando…";
  start(entry).catch((err) => {
    console.error(err);
    ui.status.textContent = "Não foi possível conectar ao servidor.";
    buttons.forEach((b) => (b.disabled = false));
    menu.show();
  });
}

ui.name.value = storage.get("nfbmc:name");

const menu = createMenu({
  sound,
  scene,
  storage,
  token: () => token,
  onEnter: enter,
  onAudioChange: refreshAudioButtons,
});

// --- Gancho para os testes e2e ---------------------------------------------

/** Deixa os testes (Playwright) lerem o estado sem depender do canvas. */
function publishTestHook() {
  const current = mode;
  if (!current) return;
  window.__nfbmc = {
    sessionId: current.room.sessionId,
    mode: () => (current instanceof WorldMode ? "world" : "race"),
    raceId: () => (current instanceof RaceMode ? current.raceId : null),
    phase: () => (current instanceof RaceMode ? current.phase() : "lobby"),
    players: () => current.snapshot(),
    police: () => (current instanceof WorldMode ? current.policeSnapshot() : null),
    send: (type: string, message: unknown) => {
      if (current instanceof WorldMode) current.send(type, message);
    },
  };
}

declare global {
  interface Window {
    __nfbmc?: {
      sessionId: string;
      mode: () => "world" | "race";
      raceId: () => RaceId | null;
      phase: () => Phase;
      players: () => Record<string, PlayerSnapshot>;
      police: () => {
        heat: number;
        chased: boolean;
        cops: { x: number; z: number; target: string }[];
        traffic: { x: number; z: number; speed: number; kind: string }[];
      } | null;
      send: (type: string, message: unknown) => void;
    };
  }
}
