import "@fontsource/russo-one/latin-400.css";
import "@fontsource/black-ops-one/latin-400.css";

import { ColyseusSDK } from "@colyseus/sdk";
import type server from "@nfbmc/server/app.config";
import {
  FOOD,
  DIFFICULTY_LABELS,
  MAX_PLAYERS,
  ROOM_NAME,
  TOTAL_LAPS,
  type Difficulty,
  type FoodKind,
  type InputMessage,
  type Phase,
} from "@nfbmc/shared";

import { Sound } from "./audio.ts";
import { createMinimap, createTacho } from "./hud.ts";
import { LOGO_SVG } from "./logo.ts";
import { GameScene, type CarView } from "./scene.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  status: $("status"),
  count: $("player-count"),
  join: $<HTMLFormElement>("join"),
  name: $<HTMLInputElement>("name"),
  logo: $("logo"),
  toggleMusic: $<HTMLButtonElement>("toggle-music"),
  toggleSfx: $<HTMLButtonElement>("toggle-sfx"),
  lobby: $("lobby"),
  lobbyList: $("lobby-list"),
  start: $<HTMLButtonElement>("start"),
  solo: $<HTMLButtonElement>("solo"),
  lobbyTitle: $("lobby-title"),
  lobbyHint: $("lobby-hint"),
  botsMinus: $<HTMLButtonElement>("bots-minus"),
  botsPlus: $<HTMLButtonElement>("bots-plus"),
  botsCount: $("bots-count"),
  difficulty: $<HTMLSelectElement>("difficulty"),
  hud: $("hud"),
  lap: $("lap"),
  place: $("place"),
  calories: $("calories"),
  dash: $("dash"),
  nitroFill: $("nitro-fill"),
  speedlines: $("speedlines"),
  countdown: $("countdown"),
  message: $("message"),
  popups: $("popups"),
  results: $("results"),
  winner: $("winner"),
  resultsBody: $("results-body"),
  resultsTimer: $("results-timer"),
  minimap: $<HTMLCanvasElement>("minimap"),
};

ui.logo.innerHTML = LOGO_SVG;

// Em produção o cliente é servido pelo próprio servidor do jogo (mesma origem).
// Em dev o Vite roda na 5173 e o servidor na 2567, na mesma máquina.
const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
const endpoint = import.meta.env.DEV
  ? `${wsProtocol}://${location.hostname}:2567`
  : `${wsProtocol}://${location.host}`;

const client = new ColyseusSDK<typeof server>(endpoint);
const joinPublic = (name: string) => client.joinOrCreate(ROOM_NAME, { name });
type RaceRoom = Awaited<ReturnType<typeof joinPublic>>;
// Solo cria uma sala privada nova; multiplayer cai na sala pública da galera.
// (As duas são a mesma RaceRoom; o cast só unifica os tipos genéricos do SDK.)
const joinRace = (name: string, solo: boolean): Promise<RaceRoom> =>
  solo ? (client.create(ROOM_NAME, { name, solo: true }) as Promise<unknown> as Promise<RaceRoom>) : joinPublic(name);

const NAME_KEY = "nfbmc:name";
const storage = {
  get: () => {
    try {
      return localStorage.getItem(NAME_KEY) ?? "";
    } catch {
      return "";
    }
  },
  set: (name: string) => {
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      // Sem localStorage (aba anônima, por exemplo): só não lembra o apelido.
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
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyM" && document.activeElement !== ui.name) {
    sound.toggle("music");
    refreshAudioButtons();
  }
});
sound.song("lobby");

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

// --- Utilidades de tela ----------------------------------------------------

const ordinal = (n: number) => `${n}º`;
const kcal = (n: number) => n.toLocaleString("pt-BR");

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Só troca o HTML quando muda, para não refazer o DOM a cada quadro. */
function setHtml(el: HTMLElement, html: string) {
  if (el.innerHTML !== html) el.innerHTML = html;
}

function showPopup(text: string) {
  const el = document.createElement("div");
  el.className = "popup";
  el.textContent = text;
  ui.popups.append(el);
  setTimeout(() => el.remove(), 1200);
}

const drawTacho = createTacho($<HTMLCanvasElement>("tacho"));
const drawMinimap = createMinimap(ui.minimap);

// --- Cena 3D ---------------------------------------------------------------

// A cena já roda no menu, sobrevoando a pista atrás do logo.
let scene: GameScene | null = null;
try {
  scene = new GameScene($<HTMLCanvasElement>("game"));
} catch (err) {
  // Sem WebGL o jogo continua funcionando (útil para os testes), só não desenha o 3D.
  console.error("Não foi possível iniciar o 3D", err);
}

let room: RaceRoom | null = null;

const phase = (): Phase => (room?.state.phase ?? "lobby") as Phase;

/** Transforma o estado da sala no que a cena precisa desenhar. */
function carViews() {
  const views = new Map<string, CarView>();
  if (!room) return views;
  const showAll = phase() === "lobby" || phase() === "results";
  room.state.players?.forEach((p, id) => {
    views.set(id, {
      name: p.bot ? `🤖 ${p.name}` : p.name,
      color: p.color,
      x: p.x,
      z: p.z,
      heading: p.heading,
      speed: p.speed,
      boost: p.boost,
      visible: showAll || p.racing,
    });
  });
  return views;
}

interface MySnapshot {
  lap: number;
  finished: boolean;
  calories: number;
  boost: number;
  speed: number;
  racing: boolean;
}

/** Valores do quadro anterior, para perceber eventos (comeu, deu volta, bateu...). */
const previous = { phase: "", countdown: 0, lap: 0, finished: false, calories: 0, boost: 0, speed: 0, bumpAt: 0 };

function playEventSounds(r: RaceRoom, me: MySnapshot) {
  const current = phase();
  const now = performance.now();

  if (current === "countdown") {
    const count = Math.ceil(r.state.timer);
    if (count !== previous.countdown && count > 0) sound.beep();
    previous.countdown = count;
  }
  if (current === "racing" && previous.phase === "countdown" && me.racing) sound.beep(true);

  if (current === "racing" && me.racing) {
    if (me.lap > previous.lap && me.lap > 1) sound.lap();
    if (me.finished && !previous.finished) sound.finish();
    if (me.calories > previous.calories) {
      const gained = me.calories - previous.calories;
      const entry = (Object.entries(FOOD) as [FoodKind, (typeof FOOD)[FoodKind]][]).find(([, f]) => f.calories === gained);
      sound.eat(entry?.[0]);
      showPopup(`+${kcal(gained)} kcal${entry ? ` ${entry[1].label.toLowerCase()}` : ""}`);
    }
    if (me.boost > previous.boost + 0.9) sound.boost();
  }

  // Batida: o carro perdeu velocidade de repente sem o jogador frear.
  const drop = Math.abs(previous.speed) - Math.abs(me.speed);
  if (drop > 3 && currentInput().throttle >= 0 && now - previous.bumpAt > 400) {
    sound.bump();
    previous.bumpAt = now;
  }

  previous.phase = current;
  previous.lap = me.lap;
  previous.finished = me.finished;
  previous.calories = me.calories;
  previous.boost = me.boost;
  previous.speed = me.speed;
}

function updateUi(r: RaceRoom) {
  const players = r.state.players;
  const me = players?.get(r.sessionId);
  if (!players || !me) return;
  const current = phase();
  const spectating = current !== "lobby" && !me.racing;
  const racers = [...players.values()].filter((p) => p.racing);

  ui.count.textContent = String([...players.values()].filter((p) => !p.bot).length);
  sound.song(current === "racing" ? "race" : current === "countdown" ? null : "lobby");

  // Lobby
  ui.lobby.hidden = current !== "lobby";
  if (current === "lobby") {
    const humans = [...players.entries()].filter(([, p]) => !p.bot);
    const difficulty = r.state.difficulty as Difficulty;
    const bots = Math.min(r.state.botCount, MAX_PLAYERS - humans.length);
    setHtml(
      ui.lobbyList,
      humans
        .map(([id, p]) =>
          `<li><span class="dot" style="background:${p.color}"></span>${escapeHtml(p.name)}${id === r.sessionId ? " (você)" : ""}</li>`)
        .join("") +
        (bots > 0 ? `<li>🤖 ${bots} ${bots === 1 ? "bot" : "bots"} da Lista Gorda (${DIFFICULTY_LABELS[difficulty]})</li>` : ""),
    );
    ui.lobbyTitle.textContent = r.state.solo ? "Corrida solo" : "Lobby";
    ui.lobbyHint.textContent = r.state.solo
      ? "Você contra os bots. Escolha quantos e a dificuldade."
      : "Dirija à vontade enquanto a galera chega.";
    ui.botsCount.textContent = String(bots);
    ui.botsMinus.disabled = bots <= 0;
    ui.botsPlus.disabled = bots >= MAX_PLAYERS - humans.length;
    if (document.activeElement !== ui.difficulty) ui.difficulty.value = difficulty;
  }

  // HUD da corrida
  const inRace = (current === "countdown" || current === "racing") && me.racing;
  ui.hud.hidden = !inRace;
  if (inRace) {
    ui.lap.textContent = `${Math.max(1, me.lap)}/${TOTAL_LAPS}`;
    ui.place.textContent = `${ordinal(me.place)}/${racers.length}`;
    ui.calories.textContent = kcal(me.calories);
  }
  ui.dash.hidden = spectating;
  if (!spectating) {
    drawTacho(me.speed);
    ui.nitroFill.style.width = `${Math.min(100, (me.boost / 2.5) * 100)}%`;
  }
  ui.speedlines.hidden = !(me.boost > 0 && !spectating);

  // Contagem regressiva
  let countdown = "";
  if (current === "countdown") countdown = String(Math.max(1, Math.ceil(r.state.timer)));
  else if (current === "racing" && r.state.raceTime < 1) countdown = "VAI!";
  ui.countdown.hidden = !countdown;
  ui.countdown.textContent = countdown;

  // Mensagem no meio da tela
  let message = "";
  const firstDone = racers.find((p) => p.finished);
  const secondsLeft = Math.ceil(r.state.timer);
  if (spectating && current !== "results") {
    message = "Corrida em andamento: você entra na próxima! 🍟";
  } else if (current === "racing" && me.finished) {
    message = `Você chegou em ${ordinal(me.place)}! Esperando os outros… ${secondsLeft}s`;
  } else if (current === "racing" && firstDone) {
    message = `${escapeHtml(firstDone.name)} já chegou! Você tem ${secondsLeft}s`;
  }
  ui.message.hidden = !message;
  setHtml(ui.message, message);

  // Resultado
  ui.results.hidden = current !== "results";
  if (current === "results") {
    const rows = [...(r.state.results ?? [])];
    const winner = rows[0];
    setHtml(
      ui.winner,
      winner && winner.total > 0 ? `🏆 ${escapeHtml(winner.name)} é o mais calórico!` : "Ninguém comeu nada?! 🥗",
    );
    setHtml(
      ui.resultsBody,
      rows
        .map((row, i) =>
          `<tr class="${row.sessionId === r.sessionId ? "me" : ""}"><td>${i + 1}</td>` +
          `<td><span class="dot" style="background:${row.color}"></span>${row.bot ? "🤖 " : ""}${escapeHtml(row.name)}</td>` +
          `<td>${row.place ? ordinal(row.place) : "—"}</td><td>${kcal(row.calories)}</td>` +
          `<td>+${kcal(row.bonus)}</td><td>${kcal(row.total)}</td></tr>`)
        .join(""),
    );
    ui.resultsTimer.textContent = `Voltando para o lobby em ${secondsLeft}s`;
  }

  playEventSounds(r, me);
}

function frame() {
  const cars = carViews();
  const me = room?.state.players?.get(room.sessionId);
  let followId: string | undefined = room?.sessionId;
  if (room && me && phase() !== "lobby" && !me.racing) {
    // Esperando a próxima corrida: a câmera acompanha quem está na frente.
    followId = [...(room.state.players?.entries() ?? [])].find(([, p]) => p.racing && p.place === 1)?.[0];
  }

  const followed = scene
    ? (scene.syncCars(cars), scene.syncFoods([...(room?.state.foods ?? [])]), scene.render(cars, followId))
    : null;

  if (room && me) {
    sound.updateMine(followId === room.sessionId && followed ? {
      speed: me.speed,
      throttle: currentInput().throttle,
      skid: followed.skid,
      offroad: followed.offroad,
      boost: me.boost > 0,
    } : null);

    // Motores dos outros, com volume pela distância e lado pelo ângulo.
    const others = new Map<string, { speed: number; distance: number; pan: number }>();
    for (const [id, car] of cars) {
      if (id === room.sessionId || !car.visible) continue;
      const dx = car.x - me.x;
      const dz = car.z - me.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 70) continue;
      // Direita de quem olha para o heading: (-cos, sin).
      const pan = distance > 0 ? (dx * -Math.cos(me.heading) + dz * Math.sin(me.heading)) / distance : 0;
      others.set(id, { speed: car.speed, distance, pan });
    }
    sound.updateOthers(others);

    drawMinimap(cars, room.sessionId);
    updateUi(room);
  }
  requestAnimationFrame(frame);
}
frame();

// --- Entrar no jogo --------------------------------------------------------

async function play(name: string, solo: boolean) {
  ui.status.textContent = "Conectando…";
  const joined = await joinRace(name, solo);
  room = joined;
  ui.status.textContent = scene ? "Conectado" : "Conectado (sem 3D neste navegador)";
  ui.join.hidden = true;
  ui.minimap.hidden = false;

  // Gancho para os testes e2e (Playwright) lerem o estado sem depender do canvas.
  window.__nfbmc = {
    sessionId: joined.sessionId,
    phase,
    players: () => {
      const snapshot: Record<string, NfbmcPlayerSnapshot> = {};
      joined.state.players?.forEach((p, id) => {
        snapshot[id] = {
          name: p.name,
          bot: p.bot,
          x: p.x,
          z: p.z,
          speed: p.speed,
          racing: p.racing,
          lap: p.lap,
          place: p.place,
          calories: p.calories,
          finished: p.finished,
        };
      });
      return snapshot;
    },
  };

  let lastSent = "";
  const sendInput = () => {
    const input = currentInput();
    const serialized = JSON.stringify(input);
    if (serialized === lastSent) return;
    lastSent = serialized;
    joined.send("input", input);
  };

  window.addEventListener("keydown", (e) => {
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

  const changeBots = (delta: number) => {
    sound.click();
    joined.send("setBots", { count: joined.state.botCount + delta });
  };
  ui.botsMinus.addEventListener("click", () => changeBots(-1));
  ui.botsPlus.addEventListener("click", () => changeBots(1));
  ui.difficulty.addEventListener("change", () => {
    joined.send("setDifficulty", { level: ui.difficulty.value });
    ui.difficulty.blur();
  });

  ui.start.addEventListener("click", () => {
    sound.click();
    joined.send("start");
    ui.start.blur();
  });

  joined.onLeave(() => {
    ui.status.textContent = "Desconectado. Recarregue a página.";
  });
}

ui.name.value = storage.get();
ui.name.focus();
function enter(solo: boolean) {
  sound.unlock();
  sound.click();
  const buttons = [...ui.join.querySelectorAll("button")];
  if (buttons.some((b) => b.disabled)) return;
  buttons.forEach((b) => (b.disabled = true));
  const name = ui.name.value.trim();
  storage.set(name);
  play(name, solo).catch((err) => {
    console.error(err);
    ui.status.textContent = "Não foi possível conectar ao servidor.";
    buttons.forEach((b) => (b.disabled = false));
  });
}
ui.join.addEventListener("submit", (e) => {
  e.preventDefault();
  enter(false);
});
ui.solo.addEventListener("click", () => enter(true));

interface NfbmcPlayerSnapshot {
  name: string;
  bot: boolean;
  x: number;
  z: number;
  speed: number;
  racing: boolean;
  lap: number;
  place: number;
  calories: number;
  finished: boolean;
}

declare global {
  interface Window {
    __nfbmc?: {
      sessionId: string;
      phase: () => Phase;
      players: () => Record<string, NfbmcPlayerSnapshot>;
    };
  }
}
