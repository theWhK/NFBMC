import "@fontsource/russo-one/latin-400.css";
import "@fontsource/black-ops-one/latin-400.css";

import {
  CROSSFIT,
  CROSSFIT_RADIO,
  EPILOGUE,
  FINALE_BRIDGE,
  FINALE_BUSTED,
  FINALE_ESCAPE,
  FINALE_INTRO,
  RIVALS_LADDER,
  radioLineId,
  rivalDefeatScene,
  rivalTauntScene,
  HERO_CAR,
  PROLOGUE,
  carSpec,
  crossfitJoinsAt,
  currentRival,
  finalePending,
  isRaceId,
  type GoRaceMessage,
  type InputMessage,
  type Phase,
  type CineShot,
  type ComicPanel,
  type Rival,
  type RaceId,
} from "@nfbmc/shared";

import { Sound, type OtherCarSound } from "./audio.ts";
import type { CueName } from "./music.ts";
import { showNowPlaying } from "./now-playing.ts";
import { jukeboxState, setupJukebox } from "./jukebox.ts";
import { makeBridge, playStory, showRadio, type Cast } from "./cinematic.ts";
import { createFullMap, createMinimap, createTacho, type MinimapView } from "./hud.ts";
import { introEnabled, playIntro } from "./intro.ts";
import { LOGO_SVG } from "./logo.ts";
import type { ModeContext, PlayerSnapshot } from "./mode.ts";
import { createMenu, type MenuEntry } from "./menu.ts";
import { OfflineError, joinEventRace, joinQuickRace, joinWorld } from "./net.ts";
import { setupPwa, syncProgress } from "./pwa.ts";
import { RaceMode, type RaceFinish } from "./race-mode.ts";
import { StoryTracker, loadStory, renderObjective, renderStoryScreen, showRivalIntro } from "./story.ts";
import { bindTouchControls, isPortrait, isTouchDevice, requestLandscape } from "./touch.ts";
import { GameScene } from "./scene.ts";
import { $, escapeHtml, hideModeUi, kcal, showPopup, ui } from "./ui.ts";
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
sound.onTrack = showNowPlaying;
setupJukebox(sound);
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
  // Jogando sozinho, sair da aba (ou atender o celular) pausa: volta no menu de pausa.
  if (mode?.pausable() && !overlayOpen()) openPause();
});

/** Freio de mão: Espaço no teclado, botão na tela do celular. */
const HANDBRAKE = new Set(["Space", "TouchHandbrake"]);

function currentInput(): InputMessage {
  let throttle = 0;
  let steer = 0;
  let handbrake = false;
  for (const code of keys) {
    throttle += THROTTLE[code] ?? 0;
    steer += STEER[code] ?? 0;
    if (HANDBRAKE.has(code)) handbrake = true;
  }
  return { throttle: Math.sign(throttle), steer: Math.sign(steer), handbrake };
}

// O próprio carro vira na tela na hora em que a tecla é apertada (sem esperar o servidor).
if (scene) scene.localInput = () => currentInput();
// Mede a ida e volta até o servidor de tempos em tempos (para a previsão da curva).
setInterval(() => {
  const room = mode?.room as { ping?: (cb: (ms: number) => void) => void } | undefined;
  room?.ping?.((ms) => {
    if (scene) scene.latency = Math.min(0.25, ms / 1000 + 1 / 60);
  });
}, 2000);

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
    const others = new Map<string, OtherCarSound>();
    const mine = cars.get(myId);
    for (const [id, car] of cars) {
      if (id === myId || !car.visible) continue;
      const dx = car.x - me.x;
      const dz = car.z - me.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 70) continue;
      // Direita de quem olha para o heading: (-cos, sin).
      const pan = distance > 0 ? (dx * -Math.cos(me.heading) + dz * Math.sin(me.heading)) / distance : 0;
      // Velocidade de aproximação (para o Doppler): projeção das duas velocidades na linha entre os carros.
      let closing = 0;
      if (distance > 0.5) {
        const ux = dx / distance;
        const uz = dz / distance;
        const theirs = car.speed * (Math.sin(car.heading) * ux + Math.cos(car.heading) * uz);
        const ours = (mine?.speed ?? 0) * (Math.sin(me.heading) * ux + Math.cos(me.heading) * uz);
        closing = ours - theirs;
      }
      others.set(id, { speed: car.speed, distance, pan, rpm: car.rpm, car: car.car, traffic: car.traffic, closing });
    }
    // Só os 6 motores mais perto (com trânsito, podiam ser dezenas de osciladores).
    const nearest = new Map([...others].sort(([, a], [, b]) => a.distance - b.distance).slice(0, 6));
    sound.updateOthers(nearest);
  },
  focusMap: (x, z) => fullMap.focus(x, z),
  detectBump(previous, speed) {
    const now = performance.now();
    const drop = Math.abs(previous.speed) - Math.abs(speed);
    if (drop > 3 && currentInput().throttle >= 0 && now - previous.bumpAt > 400) {
      // Quanto mais velocidade perdeu de uma vez, mais forte a pancada.
      sound.bump(Math.min(1, 0.2 + (drop - 3) / 14));
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
  pauseRequested = false;
  // A ponte do Cais (com a coluna de luz) só aparece durante a fuga final.
  showBridge(finaleRun && !!next);
  // O mapa não mostra o último quadro da sala anterior.
  lastMapView = null;
  mode?.onHorn(remoteHorn);
  // O foco não fica num botão do menu (o Espaço é o freio de mão).
  (document.activeElement as HTMLElement | null)?.blur?.();
  updateRotateHint();
  lastSent = "";
  sendInput();
  publishTestHook();
}

/** Nome, cor, carro e câmbio escolhidos no menu: vão junto ao entrar em qualquer sala. */
function carOptions() {
  // No modo história, o carro é o escolhido entre os liberados na carreira (na fuga final, o M3).
  const car = finaleRun ? HERO_CAR : storyMode ? story.story.car : menu.car();
  return { name: playerName, color: menu.color(), car, manual: menu.manual() };
}

// --- Modo história ---------------------------------------------------------

const story = new StoryTracker(loadStory());
let storyMode = false;
/** Fuga final (depois do Bruno): Porto Gordo inteiro atrás de você, até a ponte do Cais. */
let finaleRun = false;

/** Quem aparece nas cinemáticas: o seu carro da carreira (ou o M3, no prólogo e no final). */
function storyCast(hero = story.story.car, rival?: string, rivalData?: Rival): Cast {
  return { hero, heroColor: hero === HERO_CAR ? carSpec(HERO_CAR).color : menu.color(), rival, rivalData };
}
const heroCast = () => storyCast(HERO_CAR);

/**
 * Trilha das cinemáticas: cada plano tem o seu tema (client/src/tracks.ts,
 * CUES). Enquanto a cena dura, a música e os sons do jogo calam; só ficam as
 * vozes e o tema, que abaixa sozinho quando alguém fala.
 */
const CUE_OF: Record<CineShot, CueName> = {
  aereo: "chegada", chegada: "chegada",
  sirene: "cerco", abordagem: "cerco", cerco: "cerco",
  sabotagem: "sabotagem",
  lista: "rival", bruno: "rival", aposta: "rival", rival: "rival", duelo: "rival", apresenta: "rival",
  entrega: "nota", nota: "nota",
  radio: "radio", beira: "radio",
  tv: "tv", fuga: "fuga", ponte: "ponte", fim: "fim", mia: "mia", sozinho: "sozinho",
};
/** Temas em que cada corte de plano ganha uma pancada. */
const CUT_HITS = new Set<CueName>(["cerco", "rival", "fuga"]);
let lastShot: CineShot | null = null;
function cineSound(shot: CineShot | null) {
  const cue = shot ? CUE_OF[shot] : null;
  // Corte de plano dentro do mesmo tema: a cama segue e o corte ganha uma pancada.
  if (shot && lastShot && cue === CUE_OF[lastShot]) {
    if (shot === "apresenta") sound.cineCut(1.2);
    else if (CUT_HITS.has(cue!)) sound.cineCut(0.6);
  }
  lastShot = shot;
  sound.cinematic(cue);
  if (shot === null && !mode) sound.song("lobby");
}

/** Toca um trecho do roteiro (cinemática 3D com WebGL, quadrinhos sem) e devolve a vitrine do menu. */
async function playStoryScene(panels: ComicPanel[], cast = storyCast()) {
  // As vozes do trecho começam a baixar já (cada fala é um MP3 pequeno).
  sound.preloadVoices(panels.filter((p) => p.id).map((p) => `historia/${p.id}` as const));
  await playStory(panels, scene, cast, {
    onShot: cineSound,
    speak: (panel) => (panel.id ? sound.sayStory(panel.id) : Promise.resolve(null)),
    hush: () => sound.hush(),
  });
  if (!mode) scene?.setShowcase(menu.color(), story.story.car);
}

/** Recado do Cross-fit pelo rádio (perseguições do modo história). */
function crossfitRadio(event: keyof typeof CROSSFIT_RADIO) {
  const lines = CROSSFIT_RADIO[event];
  const index = Math.floor(Math.random() * lines.length);
  showRadio(CROSSFIT, lines[index]);
  // A voz dele pelo rádio (depois do "tchk" e do rádio da central, que já tocam na hora).
  setTimeout(() => void sound.sayStory(radioLineId(event, index), true), event === "start" || event === "crossfit" ? 300 : 2200);
}

/** A ponte inacabada do Cais na cidade, com a coluna de luz verde (fuga final). */
let bridge: ReturnType<typeof makeBridge> | null = null;
function showBridge(on: boolean) {
  if (!scene || on === !!bridge) return;
  if (on) {
    bridge = makeBridge(true);
    scene.addProp(bridge);
  } else if (bridge) {
    scene.removeProp(bridge);
    bridge = null;
  }
}

/** Fim da fuga final: chegou na ponte (salto, epílogo) ou foi autuado (dá para tentar de novo). */
async function finaleOver(escaped: boolean) {
  if (!finaleRun) return;
  finaleRun = false;
  // Deixa a faixa "A ponte!" / "Autuado!" aparecer antes de cortar para a cena.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await returnToMenu();
  if (escaped) {
    story.finishFinale();
    await playStoryScene(FINALE_ESCAPE, heroCast());
    await playStoryScene(EPILOGUE, heroCast());
  } else {
    await playStoryScene(FINALE_BUSTED, heroCast());
  }
  renderStoryScreen(story.story);
}

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
  onPursuit: (event: "start" | "crossfit" | "escaped" | "busted", finale: boolean) => {
    // O Cross-fit comenta a perseguição pelo rádio.
    if (!finale) crossfitRadio(event);
    if (finale) void finaleOver(event === "escaped");
  },
  onFrame: (me: { x: number; z: number }) => {
    if (finaleRun) renderObjective(story.story, Math.hypot(me.x - FINALE_BRIDGE.x, me.z - FINALE_BRIDGE.z));
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
      const cast = storyCast(story.story.car, rival.car, rival);
      if (rival.rank === 1) {
        // Venceu o Bruno: o M3 volta, o Cross-fit fecha a cidade e começa a fuga final.
        await playStoryScene(FINALE_INTRO, storyCast(HERO_CAR, HERO_CAR, rival));
        renderStoryScreen(story.story);
        enter("finale");
        return;
      }
      // A chave, a nota fiscal e, entre um rival e outro, o Cross-fit no rádio, a Mia...
      await playStoryScene(rivalDefeatScene(rival), cast);
      renderStoryScreen(story.story);
    }
  };
}

/** Sai da sala atual e volta para o menu principal. */
async function returnToMenu() {
  if (switching) return;
  switching = true;
  const room = mode?.room as { leave: () => Promise<unknown> } | undefined;
  finaleRun = false;
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
  ui.dash.hidden = true;
  $("story-objective").hidden = true;
  renderStoryScreen(story.story);
  menu.show();
  sound.song("lobby");
  ui.status.textContent = "Digite seu apelido";
  // Jogou offline? Se a internet voltou, o progresso sobe agora.
  void syncProgress(playerName);
}

function setLoading(text: string | null) {
  ui.loading.hidden = !text;
  ui.loading.textContent = text ?? "";
}

async function enterWorld(spawn?: RaceId) {
  const room = await joinWorld({
    ...carOptions(), token, solo: soloWorld, spawn, story: storyMode,
    // Modo história: o Cross-fit entra nas perseguições conforme a carreira (e na fuga final, desde o começo).
    ...(storyMode && { crossfit: crossfitJoinsAt(story.story), finale: finaleRun }),
  });
  room.onLeave(() => {
    if (!switching) ui.status.textContent = "Desconectado. Recarregue a página.";
  });
  setMode(new WorldMode(room, ctx, goRace, (newToken) => {
    token = newToken;
    storage.set("nfbmc:token", newToken);
  }, storyHooks()));
  if (storyMode) renderObjective(story.story, finaleRun ? Math.hypot(FINALE_BRIDGE.x, FINALE_BRIDGE.z) : undefined);
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
const help = $("help");
const overlayOpen = () => !pause.hidden || !fullMapEl.hidden || !help.hidden;

/**
 * Pausa de verdade (a simulação para no servidor) com a pausa, o mapa ou a
 * lista de comandos abertos. Só nas salas de um jogador só (modo solo e
 * história); com a galera, o servidor ignora e o jogo segue.
 */
let pauseRequested = false;
function pauseGame(on: boolean) {
  if (!mode || on === pauseRequested) return;
  pauseRequested = on;
  try {
    mode.sendPause(on);
  } catch {
    // Sala já fechando: nada a pausar.
  }
}

/** Avisos de "pausado" / "o jogo continua" na pausa e no mapa. */
function refreshPauseNotes() {
  const pausable = !!mode?.pausable();
  $("pause-note").textContent = pausable
    ? "Jogo pausado."
    : "O jogo continua rodando para a galera enquanto este menu está aberto.";
  $("map-paused").hidden = !pausable;
}

function openHelp() {
  cancelResume();
  pause.hidden = true;
  fullMapEl.hidden = true;
  help.hidden = false;
  releaseControls();
  pauseGame(true);
  $<HTMLButtonElement>("help-close").focus();
}

/** Comandos do carro que não são acelerar/virar (teclado ou botões do celular). */
function carAction(action: "horn" | "camera" | "reset" | "pause" | "map") {
  if (!mode) return;
  if (action === "pause") openPause();
  else if (action === "map") openMap();
  else if (action === "horn") {
    const view = lastMapView;
    sound.horn(1, 0, view?.cars.get(view.myId)?.car);
    mode.sendHorn();
  } else if (action === "camera") {
    const name = scene?.cycleCamera();
    if (name) showPopup(`Câmera: ${name}`);
  } else {
    mode.sendReset();
    showPopup("De volta para a rua");
  }
}

/** Buzina de outro jogador: volume pela distância e lado esquerdo/direito. */
function remoteHorn(id: string) {
  const view = lastMapView;
  const car = view?.cars.get(id);
  const me = view?.cars.get(view.myId);
  if (!car || !me) return;
  const dx = car.x - me.x;
  const dz = car.z - me.z;
  const distance = Math.hypot(dx, dz);
  const pan = distance > 0 ? (dx * -Math.cos(me.heading) + dz * Math.sin(me.heading)) / distance : 0;
  sound.horn(Math.max(0, 1 - distance / 120), pan, car.car);
}

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

/** Resumo ao lado da pausa: onde você está, com que carro e quanto já comeu. */
function renderPauseCard() {
  const me = lastMapView?.cars.get(lastMapView.myId);
  const snapshot = mode?.snapshot()[mode.room.sessionId];
  const where = storyMode ? "Modo história" : mode instanceof RaceMode ? (mode.pausable() ? "Corrida solo" : "Corrida") : mode?.pausable() ? "Modo solo" : "Co-op";
  const car = snapshot ? carSpec(snapshot.car) : undefined;
  const rows = [
    `<p class="stamp small">${where}</p>`,
    car ? `<p><small>Carro</small><strong>${escapeHtml(car.name)}</strong></p>` : "",
    snapshot ? `<p><small>Calorias</small><strong>${kcal(snapshot.calories)} kcal</strong></p>` : "",
    me ? `<p><small>Velocidade ao pausar</small><strong>${Math.round(Math.abs(me.speed) * 3.6)} km/h</strong></p>` : "",
    `<p class="hint">${PAUSE_TIPS[Math.floor(Math.random() * PAUSE_TIPS.length)]}</p>`,
  ];
  pauseCard.innerHTML = rows.join("");
}

const pauseCard = $("pause-card");
const PAUSE_TIPS = [
  "Dica: freie antes da curva e acelere na saída. Freio de mão (Espaço) faz o carro deslizar.",
  "Dica: comida dá turbo. Mas comer na rua esquenta a Vigilância Sanitária.",
  "Dica: empacou? R volta para a rua.",
  "Dica: C troca a câmera. A de capô ajuda a mirar a curva.",
  "Dica: no mapa (M) dá para ver quem está online e desafiar para um pega.",
];

function openPause() {
  if (!mode) return;
  cancelResume();
  fullMapEl.hidden = true;
  help.hidden = true;
  pause.hidden = false;
  renderPauseCard();
  refreshPauseLabels();
  refreshPauseNotes();
  releaseControls();
  pauseGame(true);
  $<HTMLButtonElement>("pause-resume").focus();
}

/** O mapa abriu antes do primeiro quadro do minimapa (logo ao entrar): centraliza quando o carro aparecer. */
let mapNeedsFocus = false;

function focusMapOnMe() {
  const me = lastMapView?.cars.get(lastMapView.myId);
  mapNeedsFocus = !me;
  if (me) fullMap.focus(me.x, me.z);
}

function openMap() {
  if (!mode) return;
  cancelResume();
  pause.hidden = true;
  fullMapEl.hidden = false;
  focusMapOnMe();
  refreshPauseNotes();
  releaseControls();
  pauseGame(true);
}

function closeOverlays() {
  cancelResume();
  pause.hidden = true;
  fullMapEl.hidden = true;
  help.hidden = true;
  pauseGame(false);
}

/**
 * Fechar a pausa (ou o mapa) jogando sozinho: 3, 2, 1 com o jogo ainda parado,
 * para dar tempo de pôr o dedo no acelerador. Com a galera, fecha na hora.
 */
const resumeCount = $("resume-count");
let resumeTimer: ReturnType<typeof setTimeout> | undefined;
function resumeGame() {
  if (!mode?.pausable() || !pauseRequested) return closeOverlays();
  pause.hidden = true;
  fullMapEl.hidden = true;
  help.hidden = true;
  (document.activeElement as HTMLElement | null)?.blur?.();
  let n = 3;
  const tick = () => {
    if (n === 0) {
      resumeCount.hidden = true;
      resumeTimer = undefined;
      pauseGame(false);
      return;
    }
    resumeCount.textContent = String(n);
    resumeCount.hidden = false;
    // Reinicia a animação a cada número.
    resumeCount.classList.remove("pop");
    void resumeCount.offsetWidth;
    resumeCount.classList.add("pop");
    sound.click();
    n--;
    resumeTimer = setTimeout(tick, 550);
  };
  tick();
}

function cancelResume() {
  if (resumeTimer !== undefined) clearTimeout(resumeTimer);
  resumeTimer = undefined;
  resumeCount.hidden = true;
}

$("to-menu").addEventListener("click", openPause);
$("open-map").addEventListener("click", openMap);
$("pause-resume").addEventListener("click", resumeGame);
$("pause-map").addEventListener("click", openMap);
$("pause-help").addEventListener("click", openHelp);
$("help-close").addEventListener("click", resumeGame);
for (const button of document.querySelectorAll<HTMLButtonElement>("#touch [data-action]")) {
  button.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    carAction(button.dataset.action as Parameters<typeof carAction>[0]);
  });
}
$("fullmap-close").addEventListener("click", resumeGame);
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
  // Pausa: Esc ou P (Esc também fecha mapa e ajuda).
  if (mode && (e.code === "Escape" || (e.code === "KeyP" && help.hidden))) {
    e.preventDefault();
    if (overlayOpen()) resumeGame();
    else openPause();
    return;
  }
  // Mapa: M ou Tab.
  if (mode && (e.code === "KeyM" || e.code === "Tab") && pause.hidden && help.hidden) {
    e.preventDefault();
    if (!fullMapEl.hidden) resumeGame();
    else openMap();
    return;
  }
  // Lista de comandos: F1.
  if (mode && e.code === "F1") {
    e.preventDefault();
    if (!help.hidden) resumeGame();
    else openHelp();
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
  // Desafio de outro piloto na tela: Y aceita, X amarela (até com o mapa aberto).
  if (!e.repeat && mode instanceof WorldMode && help.hidden && pause.hidden && mode.answerChallengeKey(e.code)) {
    e.preventDefault();
    return;
  }
  // Com a pausa ou o mapa aberto, nada de dirigir.
  if (overlayOpen()) return;
  if (e.code === "KeyN") {
    sound.toggle("music");
    refreshAudioButtons();
    showPopup(`Música ${sound.prefs.music ? "ligada" : "desligada"}`);
  }
  if (!e.repeat && e.code === "KeyH") carAction("horn");
  if (!e.repeat && e.code === "KeyC") carAction("camera");
  if (!e.repeat && e.code === "KeyR") carAction("reset");
  if (!e.repeat && (e.code === "KeyE" || e.code === "ShiftLeft" || e.code === "ShiftRight")) shift(1);
  if (!e.repeat && (e.code === "KeyQ" || e.code === "ControlLeft" || e.code === "ControlRight")) shift(-1);
  if (mode instanceof WorldMode) mode.handleKey(e.code);
  if (!(e.code in THROTTLE) && !(e.code in STEER) && !HANDBRAKE.has(e.code)) return;
  // (Sem isto, o Espaço "clicaria" o último botão em foco e as setas rolariam a página.)
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
  if (scene) scene.paused = !!mode?.paused();
  // Com a pausa, o mapa ou a ajuda abertos, o HUD do jogo (e os botões de toque) sai da frente.
  document.body.classList.toggle("overlay-open", !!mode && overlayOpen());
  document.body.classList.toggle("playing", !!mode);
  if (mode) mode.frame();
  else scene?.render(new Map(), undefined);
  if (!fullMapEl.hidden && mapNeedsFocus) focusMapOnMe();
  if (!fullMapEl.hidden && lastMapView) fullMap.draw(lastMapView);
  requestAnimationFrame(frame);
}
frame();

// --- Menu ------------------------------------------------------------------

async function start(entry: MenuEntry) {
  // Saiu do menu: a vitrine sai de cena (no duelo, só depois da apresentação do rival).
  if (entry !== "challenge") scene?.setShowcase(null);
  storyMode = entry === "story" || entry === "challenge" || entry === "finale";
  finaleRun = entry === "finale";
  if (entry === "finale") {
    // Fuga final: Porto Gordo só seu, nível máximo, Cross-fit e todas as viaturas atrás.
    soloWorld = true;
    await enterWorld();
  } else if (entry === "challenge") {
    // Duelo: apresentação do rival, a provocação dele e a corrida 1x1.
    const rival = currentRival(story.story);
    if (!rival) return;
    const cast = storyCast(story.story.car, rival.car, rival);
    if (scene) {
      // Com 3D, tudo é cinemática: o cartão da Lista Gorda com o rival na frente
      // do carro, a provocação dele e vocês dois frente a frente na largada.
      await playStoryScene(rivalTauntScene(rival), cast);
    } else {
      // Sem 3D: o cartão do rival e a provocação em quadrinhos.
      cineSound("apresenta");
      await showRivalIntro(rival, story.story.car);
      await playStoryScene(rival.taunt, cast);
      cineSound(null);
    }
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
    const room = await joinQuickRace({ ...carOptions(), raceId: menu.quickTrack() }, entry === "solo");
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
      ui.status.textContent = err instanceof OfflineError ? err.message : "Não foi possível conectar ao servidor.";
      if (err instanceof OfflineError) showPopup("📴 Sem internet: este modo precisa de conexão");
      menu.show();
    })
    .finally(() => (entering = false));
}
let entering = false;

ui.name.value = storage.get("nfbmc:name");

// PWA: service worker, aviso de offline e sincronização do progresso feito sem internet.
setupPwa(() => playerName || ui.name.value.trim());

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
    const named = new URLSearchParams(location.search).get("cena");
    if (named && namedScene(named)) void playNamedScene(named);
    else if (!story.story.seenPrologue) void playStoryScene(PROLOGUE, heroCast()).then(() => story.markPrologueSeen());
  },
});

/**
 * Cenas do modo história pelo nome, para rever qualquer uma (e para os testes):
 * `?cena=prologo`, `r7-provoca`, `r7-perde`, `final`, `autuado`, `fuga` ou
 * `epilogo`, tocada ao abrir o Modo história.
 */
function namedScene(name: string): { panels: ComicPanel[]; cast: Cast } | null {
  const rival = RIVALS_LADDER.find((r) => name.startsWith(`r${r.rank}-`));
  if (rival) {
    const cast = storyCast(story.story.car, rival.car, rival);
    if (name.endsWith("-provoca")) return { panels: rivalTauntScene(rival), cast };
    if (name.endsWith("-perde")) return { panels: rivalDefeatScene(rival), cast };
    return null;
  }
  const scenes: Record<string, ComicPanel[]> = { prologo: PROLOGUE, final: FINALE_INTRO, autuado: FINALE_BUSTED, fuga: FINALE_ESCAPE, epilogo: EPILOGUE };
  const bruno = RIVALS_LADDER[RIVALS_LADDER.length - 1];
  return scenes[name] ? { panels: scenes[name], cast: storyCast(HERO_CAR, HERO_CAR, bruno) } : null;
}

async function playNamedScene(name: string) {
  const found = namedScene(name);
  if (found) await playStoryScene(found.panels, found.cast);
}

// --- Abertura ----------------------------------------------------------------

/** Aviso, logos de mentira e trailer; no fim (ou ao pular), o menu. */
async function runIntro() {
  ui.join.hidden = true;
  $("topbar").hidden = true;
  await playIntro(sound, {
    // O trailer passa com o M3 Gorgonzola na vitrine, como o M3 GTR do original.
    onTrailer: () => scene?.setShowcase(carSpec("m3").color, "m3"),
  });
  ui.join.hidden = false;
  $("topbar").hidden = false;
  menu.show();
  sound.song("lobby");
}

/**
 * Toca ao abrir o jogo, a não ser que tenha sido desligada nas Opções. Nos testes
 * automáticos (navigator.webdriver) fica desligada; `?intro=1` força, `?intro=0` pula.
 */
const introParam = new URLSearchParams(location.search).get("intro");
if (introParam === "1" || (introParam !== "0" && !navigator.webdriver && introEnabled())) void runIntro();
$("credits-intro").addEventListener("click", () => void runIntro());

$("story-go").addEventListener("click", () => enter("story"));
// Depois do Bruno, o mesmo botão leva para a fuga final.
$("story-challenge").addEventListener("click", () => enter(finalePending(story.story) ? "finale" : "challenge"));
$("story-prologue").addEventListener("click", () => void playStoryScene(PROLOGUE, heroCast()));
$("story-car").addEventListener("click", () => {
  // Alterna entre os carros liberados na carreira (e mostra na vitrine).
  const cars = story.story.unlocked;
  story.setCar(cars[(cars.indexOf(story.story.car) + 1) % cars.length]);
  scene?.setShowcase(menu.color(), story.story.car);
  renderStoryScreen(story.story);
});

// --- Gancho para os testes e2e ---------------------------------------------

/** Deixa os testes (Playwright) lerem o estado sem depender do canvas. */
// A trilha (clima, faixa e tema da cinemática) fica visível para os testes desde o menu.
window.__nfbmcAudio = () => sound.audioState();
window.__nfbmcJukebox = jukeboxState;

function publishTestHook() {
  const current = mode;
  if (!current) return;
  window.__nfbmc = {
    sessionId: current.room.sessionId,
    mode: () => (current instanceof WorldMode ? "world" : "race"),
    raceId: () => (current instanceof RaceMode ? current.raceId : null),
    phase: () => (current instanceof RaceMode ? current.phase() : "lobby"),
    paused: () => current.paused(),
    players: () => current.snapshot(),
    police: () => (current instanceof WorldMode ? current.policeSnapshot() : null),
    send: (type: string, message: unknown) => {
      if (current instanceof WorldMode) current.send(type, message);
      else (current.room as unknown as { send: (type: string, message: unknown) => void }).send(type, message);
    },
  };
}

declare global {
  interface Window {
    __nfbmcJukebox?: typeof jukeboxState;
    __nfbmcAudio?: () => { mood: string | null; cue: string | null; track: string | null; enabled: boolean; cinematic: boolean; jukebox?: boolean };
    __nfbmc?: {
      sessionId: string;
      mode: () => "world" | "race";
      raceId: () => RaceId | null;
      phase: () => Phase;
      paused: () => boolean;
      players: () => Record<string, PlayerSnapshot>;
      police: () => {
        heat: number;
        chased: boolean;
        cops: { x: number; z: number; target: string; car: string }[];
        traffic: { x: number; z: number; speed: number; kind: string }[];
      } | null;
      send: (type: string, message: unknown) => void;
    };
  }
}
