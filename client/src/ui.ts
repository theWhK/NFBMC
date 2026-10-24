// Referências da interface (HTML) e utilidades de tela compartilhadas pelos modos.
import { FOOD, type FoodKind } from "@nfbmc/shared";

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export const ui = {
  status: $("status"),
  count: $("player-count"),
  join: $<HTMLFormElement>("join"),
  name: $<HTMLInputElement>("name"),
  logo: $("logo"),
  toggleMusic: $<HTMLButtonElement>("toggle-music"),
  toggleSfx: $<HTMLButtonElement>("toggle-sfx"),
  worldSolo: $<HTMLButtonElement>("world-solo"),
  quick: $<HTMLButtonElement>("quick"),
  solo: $<HTMLButtonElement>("solo"),
  // Corrida
  lobby: $("lobby"),
  lobbyTitle: $("lobby-title"),
  lobbyHint: $("lobby-hint"),
  lobbyList: $("lobby-list"),
  start: $<HTMLButtonElement>("start"),
  botsMinus: $<HTMLButtonElement>("bots-minus"),
  botsPlus: $<HTMLButtonElement>("bots-plus"),
  botsCount: $("bots-count"),
  difficulty: $<HTMLSelectElement>("difficulty"),
  hud: $("hud"),
  lap: $("lap"),
  place: $("place"),
  calories: $("calories"),
  countdown: $("countdown"),
  message: $("message"),
  results: $("results"),
  winner: $("winner"),
  resultsBody: $("results-body"),
  resultsTimer: $("results-timer"),
  // Mundo aberto
  worldHud: $("world-hud"),
  worldCalories: $("world-calories"),
  leaderboard: $("leaderboard"),
  leaderboardList: $("leaderboard-list"),
  markerPanel: $("marker-panel"),
  markerTitle: $("marker-title"),
  markerInfo: $("marker-info"),
  markerPeople: $("marker-people"),
  markerBots: $("marker-bots"),
  markerBotsMinus: $<HTMLButtonElement>("marker-bots-minus"),
  markerBotsPlus: $<HTMLButtonElement>("marker-bots-plus"),
  markerDifficulty: $<HTMLSelectElement>("marker-difficulty"),
  startRace: $<HTMLButtonElement>("start-race"),
  loading: $("loading"),
  // Comum
  dash: $("dash"),
  tacho: $<HTMLCanvasElement>("tacho"),
  nitroFill: $("nitro-fill"),
  speedlines: $("speedlines"),
  popups: $("popups"),
  minimap: $<HTMLCanvasElement>("minimap"),
};

export const ordinal = (n: number) => `${n}º`;
export const kcal = (n: number) => n.toLocaleString("pt-BR");

export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Só troca o HTML quando muda, para não refazer o DOM a cada quadro. */
export function setHtml(el: HTMLElement, html: string) {
  if (el.innerHTML !== html) el.innerHTML = html;
}

export function showPopup(text: string) {
  const el = document.createElement("div");
  el.className = "popup";
  el.textContent = text;
  ui.popups.append(el);
  setTimeout(() => el.remove(), 1200);
}

/** Qual comida dá exatamente essas calorias (para o som e o "+500 kcal hambúrguer"). */
export function foodByCalories(calories: number) {
  const entry = (Object.entries(FOOD) as [FoodKind, (typeof FOOD)[FoodKind]][]).find(([, f]) => f.calories === calories);
  return entry ? { kind: entry[0], label: entry[1].label } : undefined;
}

/** Esconde tudo que é de um modo (corrida ou mundo), para o próximo modo mostrar o seu. */
export function hideModeUi() {
  for (const el of [
    ui.lobby, ui.hud, ui.countdown, ui.message, ui.results,
    ui.worldHud, ui.leaderboard, ui.markerPanel, ui.speedlines,
  ]) el.hidden = true;
}
