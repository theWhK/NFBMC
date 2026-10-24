import { ColyseusSDK } from "@colyseus/sdk";
import type server from "@nfbmc/server/app.config";
import {
  FOOD,
  ROOM_NAME,
  TOTAL_LAPS,
  TRACK,
  type InputMessage,
  type Phase,
} from "@nfbmc/shared";

import { GameScene, type CarView } from "./scene.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  status: $("status"),
  count: $("player-count"),
  join: $<HTMLFormElement>("join"),
  name: $<HTMLInputElement>("name"),
  lobby: $("lobby"),
  lobbyList: $("lobby-list"),
  start: $<HTMLButtonElement>("start"),
  hud: $("hud"),
  lap: $("lap"),
  place: $("place"),
  calories: $("calories"),
  speed: $("speed"),
  turbo: $("turbo"),
  countdown: $("countdown"),
  message: $("message"),
  popups: $("popups"),
  results: $("results"),
  winner: $("winner"),
  resultsBody: $("results-body"),
  resultsTimer: $("results-timer"),
  minimap: $<HTMLCanvasElement>("minimap"),
  controls: $("controls"),
};

// Em produção o cliente é servido pelo próprio servidor do jogo (mesma origem).
// Em dev o Vite roda na 5173 e o servidor na 2567, na mesma máquina.
const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
const endpoint = import.meta.env.DEV
  ? `${wsProtocol}://${location.hostname}:2567`
  : `${wsProtocol}://${location.host}`;

const client = new ColyseusSDK<typeof server>(endpoint);

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

// --- Minimapa --------------------------------------------------------------

const minimap = (() => {
  const ctx = ui.minimap.getContext("2d")!;
  const size = ui.minimap.width;
  const xs = TRACK.samples.map((s) => s.x);
  const zs = TRACK.samples.map((s) => s.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const scale = (size - 24) / Math.max(maxX - minX, maxZ - minZ);
  // Visto de cima com +Z para cima da tela, +X fica à esquerda.
  const toMap = (x: number, z: number): [number, number] => [
    size / 2 - (x - (minX + maxX) / 2) * scale,
    size / 2 - (z - (minZ + maxZ) / 2) * scale,
  ];

  return (cars: Map<string, CarView>, myId: string) => {
    ctx.clearRect(0, 0, size, size);
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#5b5148";
    ctx.lineWidth = TRACK.width * scale;
    ctx.beginPath();
    for (const s of TRACK.samples) ctx.lineTo(...toMap(s.x, s.z));
    ctx.closePath();
    ctx.stroke();

    const start = TRACK.samples[0];
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(...toMap(start.x, start.z), 3, 3);

    const drawCar = (car: CarView, radius: number) => {
      ctx.fillStyle = car.color;
      ctx.beginPath();
      ctx.arc(...toMap(car.x, car.z), radius, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const [id, car] of cars) if (id !== myId && car.visible) drawCar(car, 4);
    const me = cars.get(myId);
    if (me?.visible) {
      drawCar(me, 6);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  };
})();

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

// --- Jogo ------------------------------------------------------------------

async function play(name: string) {
  ui.status.textContent = "Conectando…";
  const room = await client.joinOrCreate(ROOM_NAME, { name });
  ui.status.textContent = "Conectado";
  ui.join.hidden = true;
  ui.minimap.hidden = false;
  ui.controls.hidden = false;

  let scene: GameScene | null = null;
  try {
    scene = new GameScene($<HTMLCanvasElement>("game"));
  } catch (err) {
    // Sem WebGL o jogo continua conectado (útil para os testes), só não desenha o 3D.
    console.error("Não foi possível iniciar o 3D", err);
    ui.status.textContent = "Conectado (sem 3D neste navegador)";
  }

  const phase = () => (room.state.phase ?? "lobby") as Phase;

  // Gancho para os testes e2e (Playwright) lerem o estado sem depender do canvas.
  window.__nfbmc = {
    sessionId: room.sessionId,
    phase,
    players: () => {
      const snapshot: Record<string, NfbmcPlayerSnapshot> = {};
      room.state.players?.forEach((p, id) => {
        snapshot[id] = {
          name: p.name,
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
    room.send("input", input);
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

  ui.start.addEventListener("click", () => {
    room.send("start");
    ui.start.blur();
  });

  room.onLeave(() => {
    ui.status.textContent = "Desconectado. Recarregue a página.";
  });

  let lastCalories = 0;

  /** Transforma o estado da sala no que a cena precisa desenhar. */
  const carViews = () => {
    const showAll = phase() === "lobby" || phase() === "results";
    const views = new Map<string, CarView>();
    room.state.players?.forEach((p, id) => {
      views.set(id, {
        name: p.name,
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
  };

  const updateUi = () => {
    const players = room.state.players;
    const me = players?.get(room.sessionId);
    if (!players || !me) return;
    const current = phase();
    const spectating = current !== "lobby" && !me.racing;
    const racers = [...players.values()].filter((p) => p.racing);

    ui.count.textContent = String(players.size);

    // Lobby
    ui.lobby.hidden = current !== "lobby";
    if (current === "lobby") {
      setHtml(
        ui.lobbyList,
        [...players.entries()]
          .map(([id, p]) =>
            `<li><span class="dot" style="background:${p.color}"></span>${escapeHtml(p.name)}${id === room.sessionId ? " (você)" : ""}</li>`)
          .join(""),
      );
    }

    // HUD da corrida
    const inRace = (current === "countdown" || current === "racing") && me.racing;
    ui.hud.hidden = !inRace;
    if (inRace) {
      ui.lap.textContent = `${Math.max(1, me.lap)}/${TOTAL_LAPS}`;
      ui.place.textContent = `${ordinal(me.place)}/${racers.length}`;
      ui.calories.textContent = kcal(me.calories);
      ui.speed.textContent = String(Math.round(Math.abs(me.speed) * 3.6));
      ui.turbo.hidden = me.boost <= 0;
    }
    if (current === "racing" && me.calories > lastCalories) {
      const gained = me.calories - lastCalories;
      const food = Object.values(FOOD).find((f) => f.calories === gained);
      showPopup(`+${kcal(gained)} kcal${food ? ` ${food.label.toLowerCase()}` : ""}`);
    }
    lastCalories = me.calories;

    // Contagem regressiva
    let countdown = "";
    if (current === "countdown") countdown = String(Math.max(1, Math.ceil(room.state.timer)));
    else if (current === "racing" && room.state.raceTime < 1) countdown = "VAI!";
    ui.countdown.hidden = !countdown;
    ui.countdown.textContent = countdown;

    // Mensagem no meio da tela
    let message = "";
    const firstDone = racers.find((p) => p.finished);
    const secondsLeft = Math.ceil(room.state.timer);
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
      const rows = [...(room.state.results ?? [])];
      const winner = rows[0];
      setHtml(
        ui.winner,
        winner && winner.total > 0 ? `🏆 ${escapeHtml(winner.name)} é o mais calórico!` : "Ninguém comeu nada?! 🥗",
      );
      setHtml(
        ui.resultsBody,
        rows
          .map((r, i) =>
            `<tr class="${r.sessionId === room.sessionId ? "me" : ""}"><td>${i + 1}</td>` +
            `<td><span class="dot" style="background:${r.color}"></span>${escapeHtml(r.name)}</td>` +
            `<td>${r.place ? ordinal(r.place) : "—"}</td><td>${kcal(r.calories)}</td>` +
            `<td>+${kcal(r.bonus)}</td><td>${kcal(r.total)}</td></tr>`)
          .join(""),
      );
      ui.resultsTimer.textContent = `Voltando para o lobby em ${secondsLeft}s`;
    }
  };

  const frame = () => {
    const cars = carViews();
    const me = room.state.players?.get(room.sessionId);
    let followId: string | undefined = room.sessionId;
    if (me && phase() !== "lobby" && !me.racing) {
      // Esperando a próxima corrida: a câmera acompanha quem está na frente.
      followId = [...(room.state.players?.entries() ?? [])].find(([, p]) => p.racing && p.place === 1)?.[0];
    }
    if (scene) {
      scene.syncCars(cars);
      scene.syncFoods([...(room.state.foods ?? [])]);
      scene.render(cars, followId);
    }
    minimap(cars, room.sessionId);
    updateUi();
    requestAnimationFrame(frame);
  };
  frame();
}

ui.name.value = storage.get();
ui.name.focus();
ui.join.addEventListener("submit", (e) => {
  e.preventDefault();
  const button = ui.join.querySelector("button")!;
  if (button.disabled) return;
  button.disabled = true;
  const name = ui.name.value.trim();
  storage.set(name);
  play(name).catch((err) => {
    console.error(err);
    ui.status.textContent = "Não foi possível conectar ao servidor.";
    button.disabled = false;
  });
});

interface NfbmcPlayerSnapshot {
  name: string;
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
