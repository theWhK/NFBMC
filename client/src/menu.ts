// Menu principal no estilo do Most Wanted (2005): lista vertical à esquerda,
// navegável por teclado (↑↓, Enter, Esc) e mouse, telas que abrem ao lado e o
// carro do jogador girando na vitrine, à direita.
import {
  CATEGORY_LABELS,
  DEFAULT_CAR,
  PLAYER_CARS,
  PLAYER_COLORS,
  RACES,
  RACE_IDS,
  RIVALS_LADDER,
  carSpec,
  isCarId,
  isRaceId,
  topSpeed,
  zeroToHundred,
  type RaceId,
} from "@nfbmc/shared";

import type { Sound } from "./audio.ts";
import { introEnabled, setIntroEnabled } from "./intro.ts";
import { whereLabel } from "./coop.ts";
import { fetchListaGorda, fetchOnline, fetchProfile } from "./net.ts";
import { localProfile, pendingEntries, rememberCloudProfile } from "./sync.ts";
import type { GameScene } from "./scene.ts";
import { escapeHtml, kcal, setHtml, ui } from "./ui.ts";

export type MenuEntry = "world" | "world-solo" | "quick" | "solo" | "story" | "challenge" | "finale";

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
  /** Uma tela do menu foi aberta (ex.: a Lista Gorda, para atualizar o cardápio). */
  onScreen?: (id: string) => void;
  /** Combo do cardápio em destaque (setas, mouse ou toque). */
  onPreviewRival?: (index: number) => void;
  /** O cardápio (tela cheia) fechou. */
  onBoardClosed?: () => void;
}

/** Manchetes da faixa de notícias do menu. */
const HEADLINES = [
  "URGENTE: Vigilância Sanitária apreende três toneladas de maionese caseira no Porto",
  "Sargento Cross-fit bate recorde de supino; ninguém pediu",
  "Bruno é visto comendo X-Tudo no café da manhã. De novo.",
  "Preço do pastel de feira sobe 10% na Vila; feirantes culpam o óleo",
  "Coxinha Turbo lança sabor catupiry nitro",
  "Voo atrasa no Aeroporto do Pastel: excesso de bagagem (era fritura)",
  "Bandeira do Orgulho Gordo tremula em todos os pontos de encontro",
  "Previsão do tempo: nublado com chance de molho especial",
  "Academia da Liberdade fecha por falta de alunos; lanchonete ao lado abre filial",
];

export function createMenu(options: MenuOptions) {
  const { sound, scene, storage } = options;
  const list = document.getElementById("menu-list")!;
  const items = [...list.querySelectorAll<HTMLButtonElement>("button")];
  const screens = [...document.querySelectorAll<HTMLElement>(".mw-screen")];
  const hint = document.getElementById("menu-hint")!;
  const swatches = document.getElementById("swatches")!;
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
    if (buttons === items) {
      // Nome grande do item e a descrição embaixo, em cima do carrossel.
      const label = items[selected].querySelector(".label")?.textContent ?? "";
      setHtml(hint, `<strong>${escapeHtml(label)}</strong><span>${escapeHtml(items[selected].dataset.hint ?? "")}</span>`);
      items[selected].scrollIntoView?.({ block: "nearest", inline: "center" });
    }
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
    const from = openScreen;
    select(items.indexOf(items.find((b) => b.dataset.screen === from?.dataset.screenId) ?? items[0]));
    // O cardápio da Lista Gorda é tela cheia: Esc fecha de vez.
    if (from?.classList.contains("menu-board")) {
      showScreen(null);
      options.onBoardClosed?.();
    }
  };

  const activate = (button: HTMLButtonElement) => {
    sound.unlock();
    sound.click();
    if (button.dataset.screen) {
      showScreen(button.dataset.screen);
      options.onScreen?.(button.dataset.screen);
      // Telas com botões viram um submenu navegável pelo teclado.
      const sub = [...(openScreen?.querySelectorAll<HTMLButtonElement>(".mw-list.sub button, .swatches button") ?? [])];
      if (sub.length) {
        active = sub;
        // Garagem: no carro escolhido. Lista Gorda: no combo atual.
        const start = button.dataset.screen === "garage"
          ? sub.findIndex((b) => b.dataset.car === car)
          : button.dataset.screen === "story" ? sub.findIndex((b) => b.classList.contains("current")) : 0;
        select(Math.max(0, start), sub);
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
  // Corrida rápida: qualquer pista da cidade (a escolha fica guardada).
  const trackSelect = document.getElementById("quick-track") as HTMLSelectElement;
  const trackInfo = document.getElementById("quick-info")!;
  trackSelect.innerHTML = RACE_IDS.map((id) => `<option value="${id}">${RACES[id].name}</option>`).join("");
  const savedTrack = storage.get("nfbmc:quick-track");
  trackSelect.value = isRaceId(savedTrack) ? savedTrack : "autodromo";
  const describeTrack = () => {
    const race = RACES[trackSelect.value as RaceId];
    trackInfo.textContent = `${race.laps} ${race.laps === 1 ? "volta" : "voltas"} · ${(race.track.length / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km por volta`;
  };
  describeTrack();
  trackSelect.addEventListener("change", () => {
    storage.set("nfbmc:quick-track", trackSelect.value);
    describeTrack();
  });
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
      sound.revPreview(id);
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
  // Gráficos: automático → alto → médio → baixo. Vale na hora (sem recarregar a
  // página, que fazia a abertura tocar de novo a cada clique).
  const optQuality = document.getElementById("opt-quality") as HTMLButtonElement;
  const QUALITY_KEY = "nfbmc:quality";
  const qualityOrder = ["", "alto", "medio", "baixo"];
  const qualityLabel = (choice: string) => ({
    "": `automático (${scene?.quality === "medio" ? "médio" : scene?.quality ?? "baixo"})`,
    alto: "alto (contorno + sombras)",
    medio: "médio (contorno)",
    baixo: "baixo (mais leve)",
  } as Record<string, string>)[choice] ?? "automático";
  let currentQuality = storage.get(QUALITY_KEY);
  if (!qualityOrder.includes(currentQuality)) currentQuality = "";
  const refreshQuality = () => (optQuality.textContent = `Gráficos: ${qualityLabel(currentQuality)}`);
  refreshQuality();
  optQuality.addEventListener("click", () => {
    currentQuality = qualityOrder[(qualityOrder.indexOf(currentQuality) + 1) % qualityOrder.length];
    storage.set(QUALITY_KEY, currentQuality);
    scene?.setQuality(currentQuality);
    refreshQuality();
  });
  // Abertura (aviso, logos e trailer) ao abrir o jogo.
  const optIntro = document.getElementById("opt-intro") as HTMLButtonElement;
  const refreshIntro = () => (optIntro.textContent = `Abertura: ${introEnabled() ? "ligada" : "desligada"}`);
  refreshIntro();
  optIntro.addEventListener("click", () => {
    setIntroEnabled(!introEnabled());
    refreshIntro();
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

  // Mais pedidos de todos os tempos (o rodapé do cardápio da Lista Gorda).
  fetchListaGorda().then((entries) => {
    if (!entries.length) return;
    setHtml(ui.hallList, entries.map((e) => `<li>${escapeHtml(e.name)} <strong>${kcal(e.calories)}</strong></li>`).join(""));
    ui.hall.hidden = false;
  });

  // Co-op: quantos estão online (selo no item) e quem, onde (na dica do item).
  const worldButton = document.getElementById("world") as HTMLButtonElement;
  const onlineBadge = document.getElementById("online-badge")!;
  const worldHint = worldButton.dataset.hint ?? "";
  const refreshOnline = async () => {
    if (ui.join.hidden) return;
    const pilots = await fetchOnline();
    onlineBadge.hidden = pilots.length === 0;
    onlineBadge.textContent = `${pilots.length} online`;
    const names = pilots.slice(0, 5).map((p) => `${p.name} (${whereLabel(p)})`).join(", ");
    const more = pilots.length > 5 ? ` e mais ${pilots.length - 5}` : "";
    worldButton.dataset.hint = pilots.length ? `${worldHint} Online agora: ${names}${more}.` : `${worldHint} Ninguém online agora.`;
    if (active === items && items[selected] === worldButton) hint.textContent = worldButton.dataset.hint;
  };
  void refreshOnline();
  setInterval(() => void refreshOnline(), 8000);

  // Ficha do jogador no rodapé.
  const token = options.token();
  if (token) {
    fetchProfile(token).then((cloud) => {
      if (cloud) rememberCloudProfile(cloud);
      // Com progresso offline ainda não sincronizado (ou sem internet), mostra a ficha local.
      const profile = cloud && pendingEntries().length === 0 ? cloud : localProfile(token, "");
      if (!cloud && profile.races === 0 && profile.calories === 0) return;
      profileKcal.textContent = `${kcal(profile.calories)} kcal · ${profile.races} ${profile.races === 1 ? "corrida" : "corridas"} · ${profile.wins} ${profile.wins === 1 ? "vitória" : "vitórias"}`;
    });
  }

  // Faixa de notícias de Porto Gordo no rodapé (troca a cada passada).
  const ticker = document.getElementById("menu-ticker");
  if (ticker) {
    let headline = Math.floor(Math.random() * HEADLINES.length);
    const nextHeadline = () => {
      ticker.textContent = HEADLINES.map((_, i) => HEADLINES[(headline + i) % HEADLINES.length]).join("   ✦   ");
      headline = (headline + 1) % HEADLINES.length;
    };
    nextHeadline();
    ticker.addEventListener("animationiteration", nextHeadline);
  }

  // Teclado: ↑↓ navega, Enter seleciona, Esc volta. Não atrapalha quem está digitando o nome.
  window.addEventListener("keydown", (e) => {
    if (ui.join.hidden || document.activeElement === ui.name) {
      if (e.code === "Enter" && document.activeElement === ui.name) ui.name.blur();
      return;
    }
    // O carrossel principal é horizontal (←→), mas ↑↓ também andam por ele e pelos submenus.
    if (e.code === "ArrowDown" || e.code === "ArrowRight") {
      e.preventDefault();
      select(selected + 1);
      sound.click();
    } else if (e.code === "ArrowUp" || e.code === "ArrowLeft") {
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
    // No cardápio, andar pelos combos troca a foto e a ficha.
    if (current?.dataset.rival && (e.code.startsWith("Arrow"))) options.onPreviewRival?.(Number(current.dataset.rival));
  });

  // Cardápio: passar o mouse ou tocar num combo destaca ele; "Voltar" fecha.
  const ladder = document.getElementById("ladder")!;
  const pickCombo = (e: Event) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-rival]");
    if (!button) return;
    options.onPreviewRival?.(Number(button.dataset.rival));
    // Mantém a seleção do teclado no combo tocado (a lista foi redesenhada).
    if (active !== items) {
      const sub = [...(openScreen?.querySelectorAll<HTMLButtonElement>(".mw-list.sub button") ?? [])];
      active = sub;
      select(Math.max(0, sub.findIndex((b) => b.dataset.rival === button.dataset.rival)), sub);
    }
  };
  ladder.addEventListener("click", pickCombo);
  ladder.addEventListener("mouseover", (e) => {
    if (matchMedia("(hover: hover)").matches) pickCombo(e);
  });
  document.getElementById("board-close")!.addEventListener("click", () => back());

  // Volume da música e dos efeitos (0 a 100%).
  for (const kind of ["music", "sfx"] as const) {
    const slider = document.getElementById(`vol-${kind}`) as HTMLInputElement;
    const out = document.getElementById(`vol-${kind}-out`)!;
    const value = kind === "music" ? sound.prefs.musicVolume : sound.prefs.sfxVolume;
    slider.value = String(Math.round(value * 100));
    out.textContent = `${slider.value}%`;
    slider.addEventListener("input", () => {
      sound.setVolume(kind, Number(slider.value) / 100);
      out.textContent = `${slider.value}%`;
    });
    // Ao soltar, um clique no volume novo (só nos efeitos: a música já está tocando).
    if (kind === "sfx") slider.addEventListener("change", () => sound.click());
  }

  select(0);
  return {
    color: () => color,
    car: () => car,
    manual: () => manual,
    /** Pista escolhida na corrida rápida. */
    quickTrack: () => trackSelect.value as RaceId,
    /** Abre o cardápio da Lista Gorda (depois de um duelo ou da fuga final: mostra como ficou a carreira). */
    openBoard: () => {
      const item = items.find((b) => b.dataset.screen === "story");
      if (item) activate(item);
    },
    /** Volta a mostrar a vitrine (ex.: ao sair do jogo) e atualiza quem está online. */
    show: () => {
      // Voltando de uma partida, o menu reaparece sem o cardápio (tela cheia) aberto.
      if (openScreen?.classList.contains("menu-board")) {
        if (active !== items) back();
        else {
          showScreen(null);
          options.onBoardClosed?.();
        }
      }
      showcase();
      void refreshOnline();
    },
  };
}
