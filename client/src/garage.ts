// Garagem em tela cheia: a vitrine 3D com os carros passando pela reta do
// autódromo (um sai arrancando, o escolhido chega freando), a ficha do carro,
// a pintura e a oficina de tunagem (peças compradas com o dinheiro das
// corridas). Abre pelo menu ("Garagem") e, no mundo aberto, parando no pátio
// de uma garagem (aí só a oficina do carro que você está dirigindo).
import "./garage.css";

import {
  CATEGORY_LABELS,
  DEFAULT_CAR,
  HERO_CAR,
  LEVEL_NAMES,
  MAX_LEVEL,
  NOS_LEVELS,
  PARTS,
  PART_INFO,
  PLAYER_CARS,
  PLAYER_COLORS,
  PROGRESS_CARS,
  RIVALS_LADDER,
  STARTER_CARS,
  carSpec,
  isCarId,
  topSpeed,
  tunedSpec,
  zeroToHundred,
  type CarSpec,
  type Part,
  type Tune,
} from "@nfbmc/shared";

import type { Sound } from "./audio.ts";
import { economy, money } from "./economy.ts";
import type { GameScene } from "./scene.ts";
import { $, escapeHtml, setHtml } from "./ui.ts";

const COLOR_KEY = "nfbmc:color";
const CAR_KEY = "nfbmc:car";

type Tab = "cars" | "tuning";

/** De onde a garagem foi aberta. */
export type GarageVisit =
  | { kind: "menu" }
  /** Esconderijo no mundo aberto: só a oficina do carro atual; as peças valem na hora. */
  | { kind: "safehouse"; car: string; name: string; onTune: (tune: Tune) => void };

interface GarageOptions {
  sound: Sound;
  scene: GameScene | null;
  storage: { get: (key: string) => string; set: (key: string, value: string) => void };
  /** Carros liberados na carreira (o escolhido aqui vale lá também, se estiver liberado). */
  careerCars: () => string[];
  /** Escolheu um carro liberado na carreira. */
  onCareerCar?: (car: string) => void;
}

/** Números da ficha (pela mesma física do jogo), em cache por combinação de peças. */
const statsCache = new WeakMap<CarSpec, { top: number; zeroTo100: number }>();
function statsOf(spec: CarSpec) {
  let stats = statsCache.get(spec);
  if (!stats) {
    stats = { top: topSpeed(spec) * 3.6, zeroTo100: zeroToHundred(spec) };
    statsCache.set(spec, stats);
  }
  return stats;
}

/** Nota de curva (0 a 1): esterço, aderência e quanto sai de frente em alta. */
const handling = (spec: CarSpec) => (spec.turn / 2.6) * (spec.grip ?? 1) * (1.2 - spec.understeer * 0.8);

/** Onde se ganha cada carro na carreira (para o aviso na ficha). */
function careerSource(car: string) {
  if (STARTER_CARS.includes(car)) return "começa liberado";
  if (car === HERO_CAR) return "volta para você no fim da Lista Gorda";
  const progress = PROGRESS_CARS.find((p) => p.car === car);
  if (progress) return `chega na garagem depois de vencer ${progress.stage === 1 ? "o primeiro rival" : `${progress.stage} rivais`} da Lista Gorda`;
  const rival = RIVALS_LADDER.find((r) => r.car === car || r.bonusCar === car);
  return rival ? `ganha vencendo o #${rival.rank} ${rival.name}` : "não aparece na carreira";
}

export function createGarage(options: GarageOptions) {
  const { sound, scene, storage } = options;
  const root = $("garage");
  const strip = $("car-list");
  const info = $("car-info");
  const swatches = $("swatches");
  const partsList = $("garage-parts");
  const partInfo = $("garage-part-info");
  const cashEl = $("garage-cash");
  const tabs = [...root.querySelectorAll<HTMLButtonElement>("[data-tab]")];
  const panes = [...root.querySelectorAll<HTMLElement>("[data-pane]")];

  let color = storage.get(COLOR_KEY);
  if (!(PLAYER_COLORS as readonly string[]).includes(color)) color = PLAYER_COLORS[0];
  let car = storage.get(CAR_KEY);
  if (!isCarId(car)) car = DEFAULT_CAR;

  let visit: GarageVisit | null = null;
  let tab: Tab = "cars";
  /** Peça em destaque na oficina (setas ↑↓). */
  let part: Part = "engine";
  let resolveClose: (() => void) | null = null;

  /** Carro que a garagem está mostrando agora. */
  const viewing = () => (visit?.kind === "safehouse" ? visit.car : car);
  const cars = () => (visit?.kind === "safehouse" ? [visit.car] : PLAYER_CARS);

  // Maiores números possíveis (carro mais forte com tudo de corrida), para as barras.
  const full = Object.fromEntries(PARTS.map((p) => [p, MAX_LEVEL])) as Tune;
  const maxTop = Math.max(...PLAYER_CARS.map((id) => statsOf(tunedSpec(carSpec(id), full)).top));
  const maxHandling = Math.max(...PLAYER_CARS.map((id) => handling(tunedSpec(carSpec(id), full))));
  const maxBrake = Math.max(...PLAYER_CARS.map((id) => tunedSpec(carSpec(id), full).brake));

  // --- Faixa de carros (embaixo) ----------------------------------------------

  const renderStrip = () => {
    const career = new Set(options.careerCars());
    setHtml(strip, cars().map((id) => {
      const spec = carSpec(id);
      const tune = economy.tune(id);
      const level = Math.max(...PARTS.map((p) => tune[p]));
      return `<button type="button" data-car="${id}" class="${id === viewing() ? "selected-car" : ""}">` +
        `<span class="cat">${CATEGORY_LABELS[spec.category]}</span><strong>${escapeHtml(spec.name)}</strong>` +
        `<small>${level ? `🔧 ${LEVEL_NAMES[level]}` : "de fábrica"}${career.has(id) ? "" : " · 🔒 carreira"}</small>` +
        `<i class="paint" style="background:${id === viewing() ? color : spec.color}"></i></button>`;
    }).join(""));
    strip.querySelector(".selected-car")?.scrollIntoView?.({ block: "nearest", inline: "center" });
  };

  // --- Ficha (números com as peças, e a prévia da próxima peça) --------------

  const bar = (label: string, value: number, max: number, text: string, preview?: number) => {
    const pct = (v: number) => Math.round(Math.max(0.02, Math.min(1, v / max)) * 100);
    const ghost = preview !== undefined && preview > value ? `<div class="gain" style="width:${pct(preview)}%"></div>` : "";
    return `<div class="stat-bar"><span>${label}</span><div class="track">${ghost}<div class="fill" style="width:${pct(value)}%"></div></div><strong>${text}</strong></div>`;
  };

  const renderInfo = () => {
    const id = viewing();
    const base = carSpec(id);
    const tune = economy.tune(id);
    const spec = tunedSpec(base, tune);
    const stats = statsOf(spec);
    // Na oficina, a peça em destaque mostra o ganho do próximo nível (em verde).
    const next = tab === "tuning" ? economy.nextLevel(id, part) : null;
    const previewSpec = next ? tunedSpec(base, { ...tune, [part]: next.level }) : null;
    const preview = previewSpec ? statsOf(previewSpec) : null;
    const decimal = (n: number) => n.toFixed(1).replace(".", ",");
    const career = options.careerCars().includes(id);
    const nos = NOS_LEVELS[tune.nos];
    setHtml(info, `
      <p class="garage-cat">${CATEGORY_LABELS[base.category]}</p>
      <h3>${escapeHtml(base.name)}</h3>
      <p class="inspired">inspirado no ${escapeHtml(base.inspired)}</p>
      ${visit?.kind === "menu" ? `<p class="food">${escapeHtml(base.food)}</p>` : ""}
      ${bar("Velocidade", stats.top, maxTop, `${Math.round(stats.top)} km/h`, preview?.top)}
      ${bar("Aceleração", 1 / stats.zeroTo100, 1 / 2.2, `${decimal(stats.zeroTo100)} s`, preview ? 1 / preview.zeroTo100 : undefined)}
      ${bar("Curva", handling(spec), maxHandling, `${Math.round((handling(spec) / maxHandling) * 100)}`, previewSpec ? handling(previewSpec) : undefined)}
      ${bar("Freio", spec.brake, maxBrake, `${decimal(spec.brake * 2.3 / 9.81)} g`, previewSpec?.brake)}
      ${bar("Peso", 2000 - spec.mass, 1300, `${spec.mass} kg`, previewSpec ? 2000 - previewSpec.mass : undefined)}
      <div class="stat-bar"><span>Nitro</span><span>${nos.seconds ? `${nos.seconds} s · +${Math.round(nos.power * 100)}% de força (Shift)` : "sem cilindro"}</span></div>
      ${visit?.kind === "menu" ? `<p class="garage-career ${career ? "ok" : ""}">${career ? "✔ Liberado na carreira" : `🔒 Na carreira: ${careerSource(id)}`}</p>` : ""}`);
  };

  // --- Oficina -----------------------------------------------------------------

  const renderParts = () => {
    const id = viewing();
    const tune = economy.tune(id);
    setHtml(partsList, PARTS.map((p) => {
      const level = tune[p];
      const next = economy.nextLevel(id, p);
      const pips = Array.from({ length: MAX_LEVEL }, (_, i) => `<i class="${i < level ? "on" : ""}"></i>`).join("");
      const price = next
        ? `<span class="price ${economy.cash() < next.price ? "short" : ""}">${LEVEL_NAMES[next.level]} · ${money(next.price)}</span>`
        : `<span class="price max">no máximo</span>`;
      return `<li><button type="button" data-part="${p}" class="${p === part ? "selected" : ""}" ${next && economy.cash() >= next.price ? "" : "data-off"}>` +
        `<span class="icon" aria-hidden="true">${PART_INFO[p].icon}</span><span class="name">${PART_INFO[p].name}<small>${LEVEL_NAMES[level]}</small></span>` +
        `<span class="pips">${pips}</span>${price}</button></li>`;
    }).join(""));
    const next = economy.nextLevel(id, part);
    partInfo.textContent = `${PART_INFO[part].what}${next ? ` Enter ou clique para comprar o nível ${LEVEL_NAMES[next.level]}.` : ""}`;
  };

  const buy = (p: Part) => {
    const id = viewing();
    const next = economy.nextLevel(id, p);
    part = p;
    if (!next) return render();
    if (!economy.buy(id, p)) {
      sound.bump(0.3);
      partInfo.textContent = `Falta ${money(next.price - economy.cash())} para o ${PART_INFO[p].name} ${LEVEL_NAMES[next.level]}. Corra, fuja da Vigilância e volte!`;
      partInfo.classList.add("short");
      setTimeout(() => partInfo.classList.remove("short"), 600);
      return;
    }
    sound.lap();
    // O ronco já muda com a peça nova (turbina, escapamento).
    sound.revPreview(id, tunedSpec(carSpec(id), economy.tune(id)));
    if (visit?.kind === "safehouse") visit.onTune(economy.tune(id));
    render();
  };

  // --- Pintura -------------------------------------------------------------------

  setHtml(swatches, PLAYER_COLORS.map((c) =>
    `<button type="button" data-color="${c}" style="background:${c}" aria-label="Cor ${c}"></button>`).join(""));
  const renderSwatches = () => {
    for (const b of swatches.querySelectorAll<HTMLButtonElement>("button")) b.classList.toggle("chosen", b.dataset.color === color);
  };

  // --- Tudo junto ----------------------------------------------------------------

  const render = () => {
    cashEl.textContent = money(economy.cash());
    for (const t of tabs) t.classList.toggle("active", t.dataset.tab === tab);
    for (const pane of panes) pane.hidden = pane.dataset.pane !== tab;
    renderStrip();
    renderInfo();
    renderSwatches();
    if (tab === "tuning") renderParts();
  };

  const showCar = (pass: boolean) => {
    if (visit?.kind === "menu") scene?.setShowcase(color, car, pass);
  };

  /** Escolhe outro carro (vale para o Co-op e a corrida rápida, e na carreira se estiver liberado). */
  const choose = (id: string) => {
    if (visit?.kind !== "menu" || id === car) return;
    car = id;
    storage.set(CAR_KEY, car);
    if (options.careerCars().includes(id)) options.onCareerCar?.(id);
    showCar(true);
    sound.click();
    sound.revPreview(id, tunedSpec(carSpec(id), economy.tune(id)));
    render();
  };

  const step = (delta: number) => {
    const list = cars();
    choose(list[(list.indexOf(car) + delta + list.length) % list.length]);
  };

  const setTab = (next: Tab) => {
    if (visit?.kind === "safehouse") next = "tuning";
    if (next === tab) return;
    tab = next;
    sound.click();
    render();
  };

  strip.addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-car]")?.dataset.car;
    if (id) choose(id);
  });
  swatches.addEventListener("click", (e) => {
    const picked = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-color]")?.dataset.color;
    if (!picked || visit?.kind !== "menu") return;
    color = picked;
    storage.set(COLOR_KEY, color);
    showCar(false);
    sound.click();
    render();
  });
  partsList.addEventListener("click", (e) => {
    const p = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-part]")?.dataset.part as Part | undefined;
    if (p) buy(p);
  });
  partsList.addEventListener("mouseover", (e) => {
    const p = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-part]")?.dataset.part as Part | undefined;
    if (!p || p === part || !matchMedia("(hover: hover)").matches) return;
    part = p;
    render();
  });
  for (const t of tabs) t.addEventListener("click", () => setTab(t.dataset.tab as Tab));
  $("garage-prev").addEventListener("click", () => step(-1));
  $("garage-next").addEventListener("click", () => step(1));
  $("garage-close").addEventListener("click", () => close());

  // Teclado: ←→ troca de carro, ↑↓ anda pelas peças, Enter compra, Tab troca a aba, Esc fecha.
  // (Na fase de captura: o menu e o jogo não veem as teclas enquanto a garagem está aberta.)
  window.addEventListener("keydown", (e) => {
    if (!visit) return;
    e.stopImmediatePropagation();
    const code = e.code;
    if (code === "Escape" || code === "Backspace") close();
    else if (code === "Tab") setTab(tab === "cars" ? "tuning" : "cars");
    else if (code === "ArrowLeft" || code === "ArrowRight") {
      if (visit.kind === "menu") step(code === "ArrowLeft" ? -1 : 1);
    } else if (code === "ArrowUp" || code === "ArrowDown") {
      if (tab !== "tuning") setTab("tuning");
      else {
        part = PARTS[(PARTS.indexOf(part) + (code === "ArrowDown" ? 1 : -1) + PARTS.length) % PARTS.length];
        sound.click();
        render();
      }
    } else if (code === "Enter" && tab === "tuning") buy(part);
    else return;
    e.preventDefault();
  }, true);
  economy.onChange(() => {
    if (visit) render();
  });

  function close() {
    if (!visit) return;
    const wasMenu = visit.kind === "menu";
    visit = null;
    root.hidden = true;
    sound.click();
    if (wasMenu) scene?.setShowroom(false);
    else scene?.setGarageCam(false);
    resolveClose?.();
    resolveClose = null;
  }

  return {
    color: () => color,
    car: () => car,
    isOpen: () => !!visit,
    /** Abre a garagem; resolve quando ela fechar. */
    open(next: GarageVisit): Promise<void> {
      if (visit) close();
      visit = next;
      tab = next.kind === "safehouse" ? "tuning" : "cars";
      part = "engine";
      root.hidden = false;
      root.classList.toggle("safehouse", next.kind === "safehouse");
      $("garage-title").textContent = next.kind === "safehouse" ? next.name : "Garagem";
      $("garage-sub").textContent = next.kind === "safehouse"
        ? "Esconderijo e oficina: as peças valem assim que você compra"
        : "Escolha o carro, a pintura e as peças";
      if (next.kind === "menu") {
        scene?.setShowroom(true);
        showCar(false);
      } else {
        scene?.setGarageCam(true);
      }
      render();
      return new Promise((resolve) => (resolveClose = resolve));
    },
    close,
  };
}

export type Garage = ReturnType<typeof createGarage>;
