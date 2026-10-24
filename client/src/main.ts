import "@fontsource/russo-one/latin-400.css";
import "@fontsource/black-ops-one/latin-400.css";

import {
  EPILOGUE,
  PROLOGUE,
  carSpec,
  currentRival,
  isRaceId,
  type GoRaceMessage,
  type InputMessage,
  type Phase,
  type RaceId,
} from "@nfbmc/shared";

import { Sound } from "./audio.ts";
import { createFullMap, createMinimap, createTacho, type MinimapView } from "./hud.ts";
import { LOGO_SVG } from "./logo.ts";
import type { ModeContext, PlayerSnapshot } from "./mode.ts";
import { createMenu, type MenuEntry } from "./menu.ts";
import { joinEventRace, joinQuickRace, joinWorld } from "./net.ts";
import { RaceMode, type RaceFinish } from "./race-mode.ts";
import { StoryTracker, loadStory, playComic, renderObjective, renderStoryScreen, showRivalIntro } from "./story.ts";
import { bindTouchControls, isPortrait, isTouchDevice, requestLandscape } from "./touch.ts";
import { GameScene } from "./scene.ts";
import { $, hideModeUi, showPopup, ui } from "./ui.ts";
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
// Teclas "Touch*" são os botões de toque da tela (celular).
const THROTTLE: Record<string, number> = { ArrowUp: 1, KeyW: 1, ArrowDown: -1, KeyS: -1, TouchUp: 1, TouchDown: -1 };
const STEER: Record<string, number> = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1, TouchLeft: -1, TouchRight: 1 };

// --- Celular ---------------------------------------------------------------

const touch = isTouchDevice();
document.body.classList.toggle("touch", touch);
const touchControls = bindTouchControls($("touch"), keys, () => sendInput());
// Botões + e − de marcha (aparecem só com câmbio manual).
for (const button of document.querySelectorAll<HTMLButtonElement>("#touch [data-shift]")) {
  button.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    navigator.vibrate?.(10);
    shift(Number(button.dataset.shift));
  });
}
const rotateHint = $("rotate");

/** No jogo, com o celular em pé: pede para girar (o layout foi feito para a tela deitada). */
function updateRotateHint() {
  rotateHint.hidden = !(touch && mode && isPortrait());
}
window.addEventListener("resize", updateRotateHint);
screen.orientation?.addEventListener?.("change", updateRotateHint);

// App em segundo plano (trocou de aba, atendeu ligação): solta tudo.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) return;
  keys.clear();
  touchControls.reset();
  sendInput();
});

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
const minimap = createMinimap(ui.minimap);
const fullMap = createFullMap($<HTMLCanvasElement>("fullmap-canvas"));
/** Último quadro do minimapa: o mapa grande desenha a mesma coisa. */
let lastMapView: MinimapView | null = null;
const drawMinimap = (view: MinimapView) => {
  lastMapView = view;
  minimap(view);
};

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
      if (touch) navigator.vibrate?.(60);
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
  touchControls.reset();
  $("touch").hidden = !(touch && next);
  $("to-menu").hidden = !next;
  $("open-map").hidden = !next;
  closeOverlays();
  $("touch").classList.toggle("manual", menu.manual());
  mode = next;
  updateRotateHint();
  lastSent = "";
  sendInput();
  publishTestHook();
}

/** Nome, cor, carro e câmbio escolhidos no menu: vão junto ao entrar em qualquer sala. */
function carOptions() {
  // No modo história, o carro é o escolhido entre os liberados na carreira.
  return { name: playerName, color: menu.color(), car: storyMode ? story.story.car : menu.car(), manual: menu.manual() };
}

// --- Modo história ---------------------------------------------------------

const story = new StoryTracker(loadStory());
let storyMode = false;

/** Desafio liberado: avisa com destaque. */
function announceReady(ready: boolean) {
  if (!ready) return;
  const rival = currentRival(story.story);
  sound.lap();
  showStoryBanner(`Desafio liberado: #${rival?.rank} ${rival?.name}! ☰ Menu → Modo história`);
}

function showStoryBanner(text: string) {
  ui.district.hidden = true;
  ui.district.textContent = text;
  void ui.district.offsetWidth;
  ui.district.hidden = false;
}

const storyHooks = () => storyMode ? {
  onCalories: (gained: number) => {
    announceReady(story.addBounty(gained));
    renderObjective(story.story);
  },
  onEscape: (stars: number, bonus: number) => {
    announceReady(story.addBounty(bonus) || story.addEscape(stars));
    renderObjective(story.story);
  },
} : {};

/** Fim de corrida de evento no modo história: calorias da corrida e, se venceu, uma vitória. */
function storyRaceFinished(result: RaceFinish) {
  if (!storyMode || !result.event) return;
  let ready = story.addBounty(result.total);
  if (result.place === 1) {
    ready = story.addWin() || ready;
    showPopup("Vitória! Conta para a Lista Gorda 🏆");
  }
  announceReady(ready);
}

/** Fim do duelo contra o rival (uma vez por duelo). */
let duelDone = false;
function duelFinished(result: RaceFinish) {
  const rival = currentRival(story.story);
  if (!rival || duelDone) return;
  duelDone = true;
  const won = result.place === 1;
  const stamp = $("duel-stamp");
  if (won) {
    story.defeat();
    const prizes = [carSpec(rival.car).name, ...(rival.bonusCar ? [carSpec(rival.bonusCar).name] : [])];
    stamp.textContent = "Nota fiscal";
    $("duel-title").textContent = `Você derrotou ${rival.name}!`;
    $("duel-text").textContent = rival.rank === 1
      ? "Você é o novo Número 1 da Lista Gorda."
      : `Na sua garagem agora: ${prizes.join(" e ")}. Próximo alvo: #${rival.rank - 1}.`;
    sound.finish();
  } else {
    stamp.textContent = "Derrota";
    $("duel-title").textContent = `${rival.name} levou essa.`;
    $("duel-text").textContent = "Os requisitos continuam cumpridos: dá para desafiar de novo quando quiser.";
  }
  $("duel-result").hidden = false;
  const button = $<HTMLButtonElement>("duel-continue");
  button.focus();
  button.onclick = async () => {
    $("duel-result").hidden = true;
    await returnToMenu();
    if (won) {
      await playComic(rival.defeat);
      if (rival.rank === 1) await playComic(EPILOGUE);
      renderStoryScreen(story.story);
    }
  };
}

/** Sai da sala atual e volta para o menu principal. */
async function returnToMenu() {
  if (switching) return;
  switching = true;
  const room = mode?.room as { leave: () => Promise<unknown> } | undefined;
  setMode(null);
  storyMode = false;
  try {
    await room?.leave();
  } catch {
    // Já tinha caído: tudo bem.
  }
  switching = false;
  ui.join.hidden = false;
  ui.minimap.hidden = true;
  $("story-objective").hidden = true;
  renderStoryScreen(story.story);
  menu.show();
  sound.song("lobby");
  ui.status.textContent = "Digite seu apelido";
}

function setLoading(text: string | null) {
  ui.loading.hidden = !text;
  ui.loading.textContent = text ?? "";
}

async function enterWorld(spawn?: RaceId) {
  const room = await joinWorld({ ...carOptions(), token, solo: soloWorld, spawn });
  room.onLeave(() => {
    if (!switching) ui.status.textContent = "Desconectado. Recarregue a página.";
  });
  setMode(new WorldMode(room, ctx, goRace, (newToken) => {
    token = newToken;
    storage.set("nfbmc:token", newToken);
  }, storyHooks()));
  if (storyMode) renderObjective(story.story);
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
    const room = await joinEventRace(message.roomId, { ...carOptions(), token });
    room.onLeave(() => {
      if (!switching) ui.status.textContent = "Desconectado. Recarregue a página.";
    });
    setMode(new RaceMode(room, ctx, backToWorld, storyRaceFinished));
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

/** Troca de marcha no câmbio manual (teclado ou botões da tela). */
function shift(direction: number) {
  if (!mode || !menu.manual()) return;
  mode.sendShift(direction);
}

// --- Pausa e mapa ------------------------------------------------------------

const pause = $("pause");
const fullMapEl = $("fullmap");
const overlayOpen = () => !pause.hidden || !fullMapEl.hidden;

/** Ao abrir a pausa ou o mapa, solta tudo (o carro não fica acelerando sozinho). */
function releaseControls() {
  keys.clear();
  touchControls.reset();
  sendInput();
}

function refreshPauseLabels() {
  $("pause-music").textContent = `Música: ${sound.prefs.music ? "ligada" : "desligada"}`;
  $("pause-sfx").textContent = `Efeitos: ${sound.prefs.sfx ? "ligados" : "desligados"}`;
}

function openPause() {
  if (!mode) return;
  fullMapEl.hidden = true;
  pause.hidden = false;
  refreshPauseLabels();
  releaseControls();
  $<HTMLButtonElement>("pause-resume").focus();
}

function openMap() {
  if (!mode || !lastMapView) return;
  pause.hidden = true;
  fullMapEl.hidden = false;
  const me = lastMapView.cars.get(lastMapView.myId);
  fullMap.focus(me?.x ?? 0, me?.z ?? 0);
  releaseControls();
}

function closeOverlays() {
  pause.hidden = true;
  fullMapEl.hidden = true;
}

$("to-menu").addEventListener("click", openPause);
$("open-map").addEventListener("click", openMap);
$("pause-resume").addEventListener("click", closeOverlays);
$("pause-map").addEventListener("click", openMap);
$("fullmap-close").addEventListener("click", closeOverlays);
$("pause-music").addEventListener("click", () => {
  sound.toggle("music");
  refreshAudioButtons();
  refreshPauseLabels();
});
$("pause-sfx").addEventListener("click", () => {
  sound.toggle("sfx");
  refreshAudioButtons();
  refreshPauseLabels();
});
$("pause-quit").addEventListener("click", () => {
  closeOverlays();
  void returnToMenu();
});

window.addEventListener("keydown", (e) => {
  if (document.activeElement === ui.name) return;
  if (mode && e.code === "Escape") {
    e.preventDefault();
    if (overlayOpen()) closeOverlays();
    else openPause();
    return;
  }
  if (mode && e.code === "Tab") {
    e.preventDefault();
    if (!fullMapEl.hidden) closeOverlays();
    else openMap();
    return;
  }
  // Na pausa, ↑↓ andam entre as opções (Enter aperta a que estiver em foco).
  if (!pause.hidden && (e.code === "ArrowUp" || e.code === "ArrowDown")) {
    e.preventDefault();
    const buttons = [...pause.querySelectorAll<HTMLButtonElement>("button")];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(index + (e.code === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length].focus();
    return;
  }
  // Com a pausa ou o mapa aberto, nada de dirigir.
  if (overlayOpen()) return;
  if (e.code === "KeyM") {
    sound.toggle("music");
    refreshAudioButtons();
  }
  if (!e.repeat && (e.code === "KeyE" || e.code === "ShiftLeft" || e.code === "ShiftRight")) shift(1);
  if (!e.repeat && (e.code === "KeyQ" || e.code === "ControlLeft" || e.code === "ControlRight")) shift(-1);
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
  if (!fullMapEl.hidden && lastMapView) fullMap.draw(lastMapView);
  requestAnimationFrame(frame);
}
frame();

// --- Menu ------------------------------------------------------------------

async function start(entry: MenuEntry) {
  // Saiu do menu: a vitrine sai de cena (no duelo, só depois da apresentação do rival).
  if (entry !== "challenge") scene?.setShowcase(null);
  storyMode = entry === "story" || entry === "challenge";
  if (entry === "challenge") {
    // Duelo: apresentação do rival, a provocação dele e a corrida 1x1.
    const rival = currentRival(story.story);
    if (!rival) return;
    // Durante a apresentação, a vitrine 3D mostra o carro do rival girando atrás.
    await showRivalIntro(rival, story.story.car, {
      onStart: () => scene?.setShowcase(carSpec(rival.car).color, rival.car),
      onEnd: () => scene?.setShowcase(null),
    });
    await playComic(rival.taunt);
    const room = await joinQuickRace({
      ...carOptions(), raceId: rival.race, rival: { name: rival.name, car: rival.car, skill: rival.skill },
    }, true);
    room.onLeave(() => {
      if (!switching) ui.status.textContent = "Desconectado. Recarregue a página.";
    });
    duelDone = false;
    setMode(new RaceMode(room, ctx, undefined, duelFinished));
  } else if (entry === "world" || entry === "world-solo" || entry === "story") {
    // O modo história acontece num Porto Gordo só seu.
    soloWorld = entry !== "world";
    // ?spawn=centro na URL nasce direto num ponto de encontro (atalho para testes).
    const spawn = new URLSearchParams(location.search).get("spawn");
    await enterWorld(isRaceId(spawn) ? spawn : undefined);
  } else {
    const room = await joinQuickRace(carOptions(), entry === "solo");
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
  // No celular: tela cheia e horizontal (tem que ser pedido ainda dentro do toque).
  if (touch) void requestLandscape();
  sound.unlock();
  sound.click();
  // Trava própria (o botão "Desafiar" pode estar desabilitado por outro motivo).
  if (entering) return;
  entering = true;
  playerName = ui.name.value.trim();
  storage.set("nfbmc:name", playerName);
  ui.status.textContent = "Conectando…";
  start(entry)
    .catch((err) => {
      console.error(err);
      ui.status.textContent = "Não foi possível conectar ao servidor.";
      menu.show();
    })
    .finally(() => (entering = false));
}
let entering = false;

ui.name.value = storage.get("nfbmc:name");

const menu = createMenu({
  sound,
  scene,
  storage,
  token: () => token,
  onEnter: enter,
  onAudioChange: refreshAudioButtons,
  onScreen: (id) => {
    if (id !== "story") return;
    renderStoryScreen(story.story);
    if (!story.story.seenPrologue) void playComic(PROLOGUE).then(() => story.markPrologueSeen());
  },
});

$("story-go").addEventListener("click", () => enter("story"));
$("story-challenge").addEventListener("click", () => enter("challenge"));
$("story-prologue").addEventListener("click", () => void playComic(PROLOGUE));
$("story-car").addEventListener("click", () => {
  // Alterna entre os carros liberados na carreira (e mostra na vitrine).
  const cars = story.story.unlocked;
  story.setCar(cars[(cars.indexOf(story.story.car) + 1) % cars.length]);
  scene?.setShowcase(menu.color(), story.story.car);
  renderStoryScreen(story.story);
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
