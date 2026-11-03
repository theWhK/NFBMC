// Menu principal no estilo do Most Wanted (2005): lista vertical à esquerda,
// navegável por teclado (↑↓, Enter, Esc) e mouse, telas que abrem ao lado e o
// carro do jogador girando na vitrine, à direita.
import {
  RACES,
  RACE_IDS,
  isRaceId,
  type RaceId,
} from "@nfbmc/shared";

import type { Sound } from "./audio.ts";
import { economy, money } from "./economy.ts";
import type { Garage } from "./garage.ts";
import { introEnabled, setIntroEnabled } from "./intro.ts";
import { mountGraphicsOptions } from "./graphics-options.ts";
import { openJukebox } from "./jukebox.ts";
import { whereLabel } from "./coop.ts";
import { fetchListaGorda, fetchOnline, fetchProfile } from "./net.ts";
import { localProfile, pendingEntries, rememberCloudProfile } from "./sync.ts";
import type { GameScene } from "./scene.ts";
import { escapeHtml, kcal, setHtml, ui } from "./ui.ts";

export type MenuEntry = "world" | "world-solo" | "quick" | "solo" | "story" | "challenge" | "finale";

const GEARBOX_KEY = "nfbmc:manual";

interface MenuOptions {
  sound: Sound;
  scene: GameScene | null;
  /** Garagem em tela cheia (carro, pintura e tunagem): ela guarda o carro e a cor escolhidos. */
  garage: Garage;
  storage: { get: (key: string) => string; set: (key: string, value: string) => void };
  /** Ficha do jogador, para mostrar as calorias no rodapé. */
  token: () => string | undefined;
  onEnter: (entry: MenuEntry) => void;
  onAudioChange: () => void;
  /** Câmbio trocado nas Opções (também na pausa, com o jogo rodando). */
  onGearbox?: (manual: boolean) => void;
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
  "McGordo's e Burger Kilo brigam pelo título de maior lanche da cidade; Subgordo diz que é salada",
  "Outbacon lança cebola explosiva tamanho família; bombeiros de prontidão",
  "Oficinas de Porto Gordo relatam fila para instalar nitro: \"é para levar marmita mais rápido\"",
];

export function createMenu(options: MenuOptions) {
  const { sound, scene, storage, garage } = options;
  const list = document.getElementById("menu-list")!;
  const items = [...list.querySelectorAll<HTMLButtonElement>("button")];
  const screens = [...document.querySelectorAll<HTMLElement>(".mw-screen")];
  const hint = document.getElementById("menu-hint")!;
  const optMusic = document.getElementById("opt-music") as HTMLButtonElement;
  const optSfx = document.getElementById("opt-sfx") as HTMLButtonElement;
  const profileKcal = document.getElementById("profile-kcal")!;

  let manual = storage.get(GEARBOX_KEY) === "1";
  const showcase = () => scene?.setShowcase(garage.color(), garage.car());
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
    } else buttons[selected].scrollIntoView?.({ block: "nearest" });
  };

  /** Botões navegáveis da tela aberta (os escondidos ficam de fora). */
  const subButtons = () =>
    [...(openScreen?.querySelectorAll<HTMLButtonElement>(".mw-list.sub button, .swatches button") ?? [])].filter((b) => !b.hidden && !b.closest("[hidden]"));
  // Uma tela mostrou ou escondeu botões (Gráficos avançados): refaz a lista do teclado.
  document.addEventListener("menu:relist", (e) => {
    if (active === items || !openScreen?.contains(e.target as Node)) return;
    const current = active[selected];
    active = subButtons();
    select(Math.max(0, active.indexOf(current)), active);
  });

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
      const sub = subButtons();
      if (sub.length) {
        active = sub;
        // Lista Gorda: no combo atual.
        const start = button.dataset.screen === "story" ? sub.findIndex((b) => b.classList.contains("current")) : 0;
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

  // Garagem: tela cheia própria (client/src/garage.ts); ao fechar, a vitrine volta a girar.
  document.getElementById("menu-garage")!.addEventListener("click", () => {
    sound.unlock();
    sound.click();
    void garage.open({ kind: "menu" }).then(() => {
      showcase();
      refreshCash();
    });
  });

  // Opções de som.
  const optGearbox = document.getElementById("opt-gearbox") as HTMLButtonElement;
  const refreshOptions = () => {
    optMusic.textContent = `Música: ${sound.prefs.music ? "ligada" : "desligada"}`;
    optSfx.textContent = `Efeitos: ${sound.prefs.sfx ? "ligados" : "desligados"}`;
    optGearbox.textContent = `Câmbio: ${manual ? "manual (E/Q)" : "automático"}`;
  };
  // Gráficos: automático → ultra → alto → médio → baixo. Vale na hora (sem
  // recarregar a página, que fazia a abertura tocar de novo a cada clique).
  const optQuality = document.getElementById("opt-quality") as HTMLButtonElement;
  const QUALITY_KEY = "nfbmc:quality";
  const qualityOrder = ["", "ultra", "alto", "medio", "baixo"];
  const qualityLabel = (choice: string) => {
    const comic = scene?.look === "quadrinho";
    const label = ({
      "": `automático (${scene?.quality === "medio" ? "médio" : scene?.quality ?? "baixo"})`,
      ultra: comic ? "ultra (contorno + sombras altas)" : "ultra (sombras altas, oclusão e brilho)",
      alto: comic ? "alto (contorno + sombras)" : "alto (sombras e brilho)",
      medio: comic ? "médio (contorno)" : "médio (reflexos, sem sombras)",
      baixo: "baixo (mais leve)",
    } as Record<string, string>)[choice] ?? "automático";
    return scene?.customized ? `${label}, personalizado` : label;
  };
  let currentQuality = storage.get(QUALITY_KEY);
  if (!qualityOrder.includes(currentQuality)) currentQuality = "";
  const refreshQuality = () => (optQuality.textContent = `Gráficos: ${qualityLabel(currentQuality)}`);
  refreshQuality();
  optQuality.addEventListener("click", () => {
    currentQuality = qualityOrder[(qualityOrder.indexOf(currentQuality) + 1) % qualityOrder.length];
    storage.set(QUALITY_KEY, currentQuality);
    scene?.setQuality(currentQuality);
    refreshQuality();
    advanced.refresh();
  });
  // Gráficos avançados: cada ajuste por cima do preset (client/src/graphics-options.ts).
  const advanced = mountGraphicsOptions(
    document.getElementById("gfx-advanced")!,
    document.getElementById("opt-advanced") as HTMLButtonElement,
    scene,
    refreshQuality,
  );
  // Visual: realista (materiais físicos, reflexos) ou quadrinho (cel-shading com contorno, o antigo).
  const optLook = document.getElementById("opt-look") as HTMLButtonElement;
  const LOOK_KEY = "nfbmc:look";
  let currentLook = storage.get(LOOK_KEY) === "quadrinho" ? "quadrinho" : "realista";
  const refreshLook = () => (optLook.textContent = `Visual: ${currentLook === "quadrinho" ? "quadrinho (cel-shading)" : "realista"}`);
  refreshLook();
  optLook.addEventListener("click", () => {
    currentLook = currentLook === "quadrinho" ? "realista" : "quadrinho";
    storage.set(LOOK_KEY, currentLook);
    scene?.setLook(currentLook);
    refreshLook();
    refreshQuality();
    advanced.refresh();
  });
  // Jukebox: a tela para ouvir a trilha (client/src/jukebox.ts), item do menu principal.
  document.getElementById("menu-jukebox")!.addEventListener("click", () => openJukebox());
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
    options.onGearbox?.(manual);
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

  // Ficha do jogador no rodapé (e a carteira).
  let profileText = "";
  const refreshCash = () => (profileKcal.textContent = `${profileText}${money(economy.cash())}`);
  refreshCash();
  economy.onChange(refreshCash);
  const token = options.token();
  if (token) {
    fetchProfile(token).then((cloud) => {
      if (cloud) rememberCloudProfile(cloud);
      // Com progresso offline ainda não sincronizado (ou sem internet), mostra a ficha local.
      const profile = cloud && pendingEntries().length === 0 ? cloud : localProfile(token, "");
      if (!cloud && profile.races === 0 && profile.calories === 0) return;
      profileText = `${kcal(profile.calories)} kcal · ${profile.races} ${profile.races === 1 ? "corrida" : "corridas"} · ${profile.wins} ${profile.wins === 1 ? "vitória" : "vitórias"} · `;
      refreshCash();
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
    const current = active[selected];
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
  // Só quando o mouse anda: o cardápio abre em tela cheia e, com o mouse parado
  // em cima de outro combo (onde estava o cartão do menu), trocava o destaque.
  let hovered: string | undefined;
  ladder.addEventListener("mousemove", (e) => {
    if (!matchMedia("(hover: hover)").matches) return;
    const rival = (e.target as HTMLElement).closest<HTMLElement>("[data-rival]")?.dataset.rival;
    if (!rival || rival === hovered) return;
    hovered = rival;
    pickCombo(e);
  });
  ladder.addEventListener("mouseleave", () => (hovered = undefined));
  document.getElementById("board-close")!.addEventListener("click", () => back());

  // Volume da música e dos efeitos (0 a 100%).
  const refreshVolumes = () => {
    for (const kind of ["music", "sfx"] as const) {
      const slider = document.getElementById(`vol-${kind}`) as HTMLInputElement;
      const value = kind === "music" ? sound.prefs.musicVolume : sound.prefs.sfxVolume;
      slider.value = String(Math.round(value * 100));
      document.getElementById(`vol-${kind}-out`)!.textContent = `${slider.value}%`;
    }
  };
  refreshVolumes();
  for (const kind of ["music", "sfx"] as const) {
    const slider = document.getElementById(`vol-${kind}`) as HTMLInputElement;
    const out = document.getElementById(`vol-${kind}-out`)!;
    slider.addEventListener("input", () => {
      sound.setVolume(kind, Number(slider.value) / 100);
      out.textContent = `${slider.value}%`;
    });
    // Ao soltar, um clique no volume novo (só nos efeitos: a música já está tocando).
    if (kind === "sfx") slider.addEventListener("change", () => sound.click());
  }

  select(0);
  return {
    color: () => garage.color(),
    car: () => garage.car(),
    manual: () => manual,
    /** Reescreve os rótulos das Opções (a pausa mostra o mesmo painel; a música pode ter mudado no N). */
    refreshOptions: () => {
      refreshOptions();
      refreshLook();
      refreshQuality();
      refreshIntro();
      refreshVolumes();
    },
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
