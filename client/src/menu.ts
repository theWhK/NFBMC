// Menu principal no estilo do Most Wanted (2005): lista vertical à esquerda,
// navegável por teclado (↑↓, Enter, Esc) e mouse, telas que abrem ao lado e o
// carro do jogador girando na vitrine, à direita.
import {
  CATEGORY_LABELS,
  DEFAULT_CAR,
  PLAYER_CARS,
  PLAYER_COLORS,
  RIVALS,
  carSpec,
  isCarId,
  topSpeed,
  zeroToHundred,
} from "@nfbmc/shared";

import type { Sound } from "./audio.ts";
import { fetchListaGorda, fetchProfile } from "./net.ts";
import type { GameScene } from "./scene.ts";
import { escapeHtml, kcal, setHtml, ui } from "./ui.ts";

export type MenuEntry = "world" | "world-solo" | "quick" | "solo";

const COLOR_KEY = "nfbmc:color";
const CAR_KEY = "nfbmc:car";
const GEARBOX_KEY = "nfbmc:manual";

/** Números da ficha de cada carro (calculados pela mesma física do jogo). */
const STATS = Object.fromEntries(PLAYER_CARS.map((id) => {
  const spec = carSpec(id);
  return [id, { top: topSpeed(spec) * 3.6, zeroTo100: zeroToHundred(spec), torque: spec.torque, mass: spec.mass }];
}));
const MAX_TOP = Math.max(...Object.values(STATS).map((s) => s.top));

interface MenuOptions {
  sound: Sound;
  scene: GameScene | null;
  storage: { get: (key: string) => string; set: (key: string, value: string) => void };
  /** Ficha do jogador, para mostrar as calorias no rodapé. */
  token: () => string | undefined;
  onEnter: (entry: MenuEntry) => void;
  onAudioChange: () => void;
}

export function createMenu(options: MenuOptions) {
  const { sound, scene, storage } = options;
  const list = document.getElementById("menu-list")!;
  const items = [...list.querySelectorAll<HTMLButtonElement>("button")];
  const screens = [...document.querySelectorAll<HTMLElement>(".mw-screen")];
  const hint = document.getElementById("menu-hint")!;
  const swatches = document.getElementById("swatches")!;
  const rivals = document.getElementById("rivals")!;
  const optMusic = document.getElementById("opt-music") as HTMLButtonElement;
  const optSfx = document.getElementById("opt-sfx") as HTMLButtonElement;
  const profileKcal = document.getElementById("profile-kcal")!;

  let color = storage.get(COLOR_KEY);
  if (!(PLAYER_COLORS as readonly string[]).includes(color)) color = PLAYER_COLORS[0];
  let car = storage.get(CAR_KEY);
  if (!isCarId(car)) car = DEFAULT_CAR;
  let manual = storage.get(GEARBOX_KEY) === "1";
  const showcase = (c = color, id = car) => scene?.setShowcase(c, id);
  showcase();

  /** Lista ativa: a principal ou a de dentro de uma tela aberta (submenu). */
  let active: HTMLButtonElement[] = items;
  let selected = 0;
  let openScreen: HTMLElement | null = null;

  const select = (index: number, buttons = active) => {
    if (!buttons.length) return;
    selected = (index + buttons.length) % buttons.length;
    for (const b of buttons) b.classList.toggle("selected", b === buttons[selected]);
    if (buttons === items) hint.textContent = items[selected].dataset.hint ?? "";
  };

  const showScreen = (id: string | null) => {
    openScreen = null;
    for (const screen of screens) {
      const open = screen.dataset.screenId === id;
      screen.hidden = !open;
      if (open) openScreen = screen;
    }
  };

  /** Esc: fecha o submenu e volta para a lista principal. */
  const back = () => {
    if (active === items) return;
    // Saiu da garagem sem escolher: a vitrine volta para o carro e a cor guardados.
    showcase();
    for (const b of active) b.classList.remove("selected");
    active = items;
    select(items.indexOf(items.find((b) => b.dataset.screen === openScreen?.dataset.screenId) ?? items[0]));
  };

  const activate = (button: HTMLButtonElement) => {
    sound.unlock();
    sound.click();
    if (button.dataset.screen) {
      showScreen(button.dataset.screen);
      // Telas com botões viram um submenu navegável pelo teclado.
      const sub = [...(openScreen?.querySelectorAll<HTMLButtonElement>(".mw-list.sub button, .swatches button") ?? [])];
      if (sub.length) {
        active = sub;
        select(button.dataset.screen === "garage" ? Math.max(0, sub.findIndex((b) => b.dataset.car === car)) : 0, sub);
      }
      return;
    }
    button.click();
  };

  // Itens que abrem telas: ao passar o mouse, mostram a tela; ao clicar, entram nela.
  items.forEach((button, i) => {
    button.addEventListener("mouseenter", () => {
      if (active !== items) back();
      select(i);
    });
    if (button.dataset.screen) {
      button.addEventListener("click", () => activate(button));
    }
  });
  document.getElementById("world")!.addEventListener("click", () => options.onEnter("world"));
  ui.worldSolo.addEventListener("click", () => options.onEnter("world-solo"));
  ui.quick.addEventListener("click", () => options.onEnter("quick"));
  ui.solo.addEventListener("click", () => options.onEnter("solo"));

  // Garagem: lista de carros por categoria e a ficha do selecionado.
  const carList = document.getElementById("car-list")!;
  const carInfo = document.getElementById("car-info")!;
  let lastCategory = "";
  setHtml(carList, PLAYER_CARS.map((id) => {
    const spec = carSpec(id);
    const header = spec.category !== lastCategory ? `<span class="cat">${CATEGORY_LABELS[spec.category]}</span>` : "";
    lastCategory = spec.category;
    return `${header}<button type="button" data-car="${id}">${escapeHtml(spec.name)}</button>`;
  }).join(""));
  const bar = (label: string, value: number, max: number, text: string) =>
    `<div class="stat-bar"><span>${label}</span><div class="track"><div class="fill" style="width:${Math.round(Math.min(1, value / max) * 100)}%"></div></div><strong>${text}</strong></div>`;
  const showCarInfo = (id: string) => {
    const spec = carSpec(id);
    const stats = STATS[id];
    setHtml(carInfo, `
      <h3>${escapeHtml(spec.name)}</h3>
      <p class="inspired">${CATEGORY_LABELS[spec.category]} · inspirado no ${escapeHtml(spec.inspired)}</p>
      <p class="food">${escapeHtml(spec.food)}</p>
      ${bar("Velocidade", stats.top, MAX_TOP, `${Math.round(stats.top)} km/h`)}
      ${bar("Aceleração", 1 / stats.zeroTo100, 1, `${stats.zeroTo100.toFixed(1).replace(".", ",")} s`)}
      ${bar("Torque", stats.torque, 1250, `${stats.torque} N·m`)}
      ${bar("Peso", stats.mass, 1900, `${stats.mass} kg`)}
      <div class="stat-bar"><span>Câmbio</span><span>${spec.gears.length} marchas · giro até ${spec.redline.toLocaleString("pt-BR")}</span></div>`);
  };
  const refreshCars = () => {
    for (const b of carList.querySelectorAll<HTMLButtonElement>("button")) b.classList.toggle("selected-car", b.dataset.car === car);
  };
  showCarInfo(car);
  refreshCars();
  for (const button of carList.querySelectorAll<HTMLButtonElement>("button")) {
    const id = button.dataset.car!;
    button.addEventListener("click", () => {
      car = id;
      storage.set(CAR_KEY, car);
      showCarInfo(car);
      showcase();
      refreshCars();
      sound.click();
    });
    // Passar pelo carro já mostra a ficha e a vitrine com ele.
    button.addEventListener("mouseenter", () => {
      showCarInfo(id);
      showcase(color, id);
    });
  }

  // Pintura: uma amostra de cada cor; a escolhida vai para a vitrine e fica guardada.
  setHtml(swatches, PLAYER_COLORS.map((c) =>
    `<button type="button" data-color="${c}" style="background:${c}" aria-label="Cor ${c}"></button>`).join(""));
  const refreshSwatches = () => {
    // "chosen" (e não "selected", que é o foco do teclado no submenu).
    for (const b of swatches.querySelectorAll<HTMLButtonElement>("button")) b.classList.toggle("chosen", b.dataset.color === color);
  };
  refreshSwatches();
  for (const button of swatches.querySelectorAll<HTMLButtonElement>("button")) {
    button.addEventListener("click", () => {
      color = button.dataset.color!;
      storage.set(COLOR_KEY, color);
      showcase();
      refreshSwatches();
      sound.click();
    });
    // Na garagem, só passar pela cor já mostra o carro com ela.
    button.addEventListener("focus", () => showcase(button.dataset.color!));
  }

  // Opções de som.
  const optGearbox = document.getElementById("opt-gearbox") as HTMLButtonElement;
  const refreshOptions = () => {
    optMusic.textContent = `Música: ${sound.prefs.music ? "ligada" : "desligada"}`;
    optSfx.textContent = `Efeitos: ${sound.prefs.sfx ? "ligados" : "desligados"}`;
    optGearbox.textContent = `Câmbio: ${manual ? "manual (E/Q)" : "automático"}`;
  };
  // Gráficos: automático → alto → médio → baixo. Recarrega para aplicar (muda o jeito de desenhar).
  const optQuality = document.getElementById("opt-quality") as HTMLButtonElement;
  const QUALITY_KEY = "nfbmc:quality";
  const qualityOrder = ["", "alto", "medio", "baixo"];
  const qualityLabel: Record<string, string> = {
    "": `automático (${scene?.quality === "medio" ? "médio" : scene?.quality ?? "baixo"})`,
    alto: "alto (contorno + sombras)",
    medio: "médio (contorno)",
    baixo: "baixo (mais leve)",
  };
  const currentQuality = storage.get(QUALITY_KEY);
  optQuality.textContent = `Gráficos: ${qualityLabel[currentQuality] ?? qualityLabel[""]}`;
  optQuality.addEventListener("click", () => {
    const next = qualityOrder[(qualityOrder.indexOf(currentQuality) + 1) % qualityOrder.length];
    storage.set(QUALITY_KEY, next);
    location.reload();
  });
  optGearbox.addEventListener("click", () => {
    manual = !manual;
    storage.set(GEARBOX_KEY, manual ? "1" : "0");
    refreshOptions();
  });
  refreshOptions();
  optMusic.addEventListener("click", () => {
    sound.toggle("music");
    refreshOptions();
    options.onAudioChange();
  });
  optSfx.addEventListener("click", () => {
    sound.toggle("sfx");
    refreshOptions();
    options.onAudioChange();
  });

  // Lista Gorda: os rivais (bots) e o placar de todos os tempos.
  setHtml(rivals, RIVALS.map((r, i) => `
    <div class="rival"><span class="rank">${i + 1}</span><strong>${escapeHtml(r.name)}</strong>
    <span class="title">${escapeHtml(r.title)}</span><span class="quote">“${escapeHtml(r.quote)}”</span></div>`).join(""));
  fetchListaGorda().then((entries) => {
    if (!entries.length) return;
    setHtml(ui.hallList, entries.map((e) => `<li>${escapeHtml(e.name)} <strong>${kcal(e.calories)}</strong></li>`).join(""));
    ui.hall.hidden = false;
  });

  // Ficha do jogador no rodapé.
  const token = options.token();
  if (token) {
    fetchProfile(token).then((profile) => {
      if (!profile) return;
      profileKcal.textContent = `${kcal(profile.calories)} kcal · ${profile.races} ${profile.races === 1 ? "corrida" : "corridas"} · ${profile.wins} ${profile.wins === 1 ? "vitória" : "vitórias"}`;
    });
  }

  // Teclado: ↑↓ navega, Enter seleciona, Esc volta. Não atrapalha quem está digitando o nome.
  window.addEventListener("keydown", (e) => {
    if (ui.join.hidden || document.activeElement === ui.name) {
      if (e.code === "Enter" && document.activeElement === ui.name) ui.name.blur();
      return;
    }
    const inSubmenu = active !== items;
    if (e.code === "ArrowDown" || (e.code === "ArrowRight" && inSubmenu)) {
      e.preventDefault();
      select(selected + 1);
      sound.click();
    } else if (e.code === "ArrowUp" || (e.code === "ArrowLeft" && inSubmenu)) {
      e.preventDefault();
      select(selected - 1);
      sound.click();
    } else if (e.code === "Enter") {
      e.preventDefault();
      activate(active[selected]);
    } else if (e.code === "Escape" || e.code === "Backspace") {
      back();
    }
    // Na garagem, o carro ou a cor selecionados pelo teclado já aparecem na vitrine.
    const current = active[selected];
    if (current?.dataset.color) showcase(current.dataset.color);
    if (current?.dataset.car) {
      showCarInfo(current.dataset.car);
      showcase(color, current.dataset.car);
    }
  });

  select(0);
  return {
    color: () => color,
    car: () => car,
    manual: () => manual,
    /** Volta a mostrar a vitrine (ex.: ao sair do jogo). */
    show: () => showcase(),
  };
}
