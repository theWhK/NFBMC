// Modo história no cliente: progresso salvo neste navegador, quadrinhos,
// apresentação do rival, quadro da Lista Gorda no menu e o objetivo no HUD.
import {
  RACES,
  RIVALS_LADDER,
  cachedTopSpeed,
  canChallenge,
  carSpec,
  currentRival,
  defeatRival,
  finalePending,
  newStory,
  storyFinished,
  type ComicPanel,
  type Rival,
  type StoryProgress,
} from "@nfbmc/shared";

import { cachedPortrait, portraitLater } from "./portraits.ts";
import { $, escapeHtml, kcal, setHtml } from "./ui.ts";

const STORY_KEY = "nfbmc:story";

export function loadStory(): StoryProgress {
  try {
    const saved = JSON.parse(localStorage.getItem(STORY_KEY) ?? "null");
    if (saved && typeof saved.stage === "number") return { ...newStory(), ...saved };
  } catch {
    // Sem localStorage ou salvo quebrado: começa do zero.
  }
  return newStory();
}

export function saveStory(story: StoryProgress) {
  try {
    localStorage.setItem(STORY_KEY, JSON.stringify(story));
  } catch {
    // Sem localStorage: o progresso vale só nesta aba.
  }
}

// --- Quadrinhos --------------------------------------------------------------

/** Separa um texto em "letras" visíveis (emoji com variação conta como uma só). */
export function graphemes(text: string) {
  const Segmenter = (Intl as unknown as { Segmenter?: new (l: string, o: object) => { segment: (t: string) => Iterable<{ segment: string }> } }).Segmenter;
  return Segmenter ? [...new Segmenter("pt-BR", { granularity: "grapheme" }).segment(text)].map((g) => g.segment) : [...text];
}

/**
 * Mostra os quadros um por um, animados: a "arte" entra pulando, o texto vem
 * como máquina de escrever e cada quadro pode ter efeito (tremer, zoom, linhas
 * de velocidade, flash da sirene) e onomatopeia. Clique, Enter, espaço ou →:
 * a primeira vez completa o texto, a segunda avança. Esc pula tudo.
 * Resolve com true se pulou (Esc ou "Pular").
 */
export function playComic(panels: ComicPanel[], hooks: { onPanel?: (panel: ComicPanel) => void; onEnd?: () => void } = {}): Promise<boolean> {
  const overlay = $("comic");
  const panel = $("comic-panel");
  const art = $("comic-art");
  const textEl = $("comic-text");
  const next = $<HTMLButtonElement>("comic-next");
  const skip = $<HTMLButtonElement>("comic-skip");
  if (!panels.length) return Promise.resolve(false);
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return new Promise((resolve) => {
    let index = 0;
    let typing: ReturnType<typeof setInterval> | null = null;
    let full = "";

    const finishTyping = () => {
      if (typing) clearInterval(typing);
      typing = null;
      textEl.textContent = full;
      textEl.classList.remove("typing");
    };

    const show = () => {
      const p = panels[index];
      panel.style.backgroundColor = p.color ?? "#16110d";
      // Reinicia as animações trocando as classes (e forçando o navegador a recalcular).
      panel.className = "comic-panel";
      void panel.offsetWidth;
      panel.classList.add("turn");
      if (p.fx) panel.classList.add(`fx-${p.fx}`);
      art.innerHTML = graphemes(p.art)
        .map((g, i) => (g.trim() ? `<span style="animation-delay:${0.12 + i * 0.12}s">${escapeHtml(g)}</span>` : " "))
        .join("");
      $("comic-speaker").textContent = p.speaker ?? "";
      $("comic-sfx").textContent = p.sfx ?? "";
      $("comic-page").textContent = `${index + 1}/${panels.length}`;
      next.textContent = index === panels.length - 1 ? "Fechar ▶" : "Continuar ▶";
      hooks.onPanel?.(p);

      // Máquina de escrever (~45 letras por segundo).
      full = p.text;
      if (typing) clearInterval(typing);
      if (reducedMotion) {
        finishTyping();
        return;
      }
      const letters = graphemes(full);
      let shown = 0;
      textEl.textContent = "";
      textEl.classList.add("typing");
      typing = setInterval(() => {
        shown += 1;
        textEl.textContent = letters.slice(0, shown).join("");
        if (shown >= letters.length) finishTyping();
      }, 22);
    };

    const finish = (skipped = false) => {
      finishTyping();
      overlay.hidden = true;
      window.removeEventListener("keydown", onKey, true);
      next.onclick = skip.onclick = panel.onclick = null;
      hooks.onEnd?.();
      resolve(skipped);
    };
    const advance = () => {
      if (typing) {
        finishTyping();
        return;
      }
      index++;
      if (index >= panels.length) finish();
      else show();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Enter" || e.code === "Space" || e.code === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        advance();
      } else if (e.code === "Escape") {
        e.stopPropagation();
        finish(true);
      }
    };
    next.onclick = advance;
    panel.onclick = advance;
    skip.onclick = () => finish(true);
    window.addEventListener("keydown", onKey, true);
    overlay.hidden = false;
    show();
  });
}

/** Preenche o cartão do rival (#N, nome letra por letra, título e VOCÊ x RIVAL). */
function fillRivalCard(rival: Rival, yourCar: string) {
  const you = carSpec(yourCar);
  const them = carSpec(rival.car);
  const kmh = (id: string) => `${Math.round(cachedTopSpeed(carSpec(id)) * 3.6)} km/h`;
  $("rival-rank").textContent = `#${rival.rank} da Lista Gorda`;
  $("rival-name").innerHTML = graphemes(rival.name)
    .map((g, i) => (g === " " ? " " : `<span style="animation-delay:${0.25 + i * 0.06}s">${escapeHtml(g)}</span>`))
    .join("");
  $("rival-title").textContent = rival.title;
  $("vs-you").textContent = you.name;
  $("vs-you-stat").textContent = kmh(you.id);
  $("vs-them-label").textContent = rival.name;
  $("vs-them").textContent = them.name;
  $("vs-them-stat").textContent = kmh(them.id);
}

/**
 * Cartão do rival por cima da cinemática de apresentação (null = some). Ali
 * ele não recebe cliques: quem passa a cena é a cinemática.
 */
export function rivalCard(card: { rival: Rival; yourCar: string } | null) {
  const el = $("rival-intro");
  if (!card) {
    el.hidden = true;
    el.classList.remove("in-cine");
    return;
  }
  fillRivalCard(card.rival, card.yourCar);
  el.classList.add("in-cine");
  el.hidden = true;
  void el.offsetWidth;
  el.hidden = false;
}

/**
 * Apresentação do rival sem 3D, estilo Borderlands: flash, linhas de velocidade, o
 * nome batendo letra por letra e o painel "VOCÊ x RIVAL". `onStart`/`onEnd`
 * deixam quem chamou trocar o carro da vitrine 3D pelo do rival durante a cena.
 * Dura ~4 s; clique ou Enter pula.
 */
export function showRivalIntro(rival: Rival, yourCar: string, hooks: { onStart?: () => void; onEnd?: () => void } = {}): Promise<void> {
  const el = $("rival-intro");
  fillRivalCard(rival, yourCar);
  el.classList.remove("in-cine");
  // Reinicia as animações (a cena pode ser vista mais de uma vez).
  el.hidden = true;
  void el.offsetWidth;
  el.hidden = false;
  hooks.onStart?.();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.hidden = true;
      el.onclick = null;
      window.removeEventListener("keydown", onKey, true);
      hooks.onEnd?.();
      resolve();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Enter" || e.code === "Space" || e.code === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish();
      }
    };
    el.onclick = finish;
    window.addEventListener("keydown", onKey, true);
    setTimeout(finish, 4200);
  });
}

// --- Quadro da Lista Gorda (menu) e objetivo (HUD) ---------------------------

function requirements(story: StoryProgress, rival: Rival) {
  const rows = [
    { label: "Vitórias em corridas (pontos 🏁 da cidade)", have: Math.min(story.wins, rival.wins), need: rival.wins, text: `${Math.min(story.wins, rival.wins)}/${rival.wins}` },
    { label: "Calorias na carreira", have: Math.min(story.bounty, rival.bounty), need: rival.bounty, text: `${kcal(Math.min(story.bounty, rival.bounty))}/${kcal(rival.bounty)}` },
  ];
  if (rival.escapes > 0) {
    rows.push({
      label: `Fugas da Vigilância com ${rival.escapeStars}★ ou mais`,
      have: Math.min(story.escapes, rival.escapes), need: rival.escapes, text: `${Math.min(story.escapes, rival.escapes)}/${rival.escapes}`,
    });
  }
  return rows;
}

/** Combo da Lista Gorda em destaque no cardápio (índice em RIVALS_LADDER); null = o rival atual. */
let previewed: number | null = null;
/** A tela avisa quem está em destaque (a vitrine 3D mostra o carro dele por trás). */
let onPreview: ((car: string, color: string) => void) | null = null;
export const setPreviewHook = (hook: (car: string, color: string) => void) => (onPreview = hook);

/** Destaca um combo do cardápio (passar o mouse, tocar ou andar com as setas). */
export function previewRival(story: StoryProgress, index: number) {
  previewed = index;
  renderStoryScreen(story);
}

/** Foto do combo: o rival na frente do carro (3D), ou a arte de emoji sem WebGL. */
function photo(rival: Rival) {
  const spec = carSpec(rival.car);
  const image = (url: string) => `<img src="${url}" alt="${escapeHtml(rival.name)} e o ${escapeHtml(spec.name)}" />`;
  const cached = cachedPortrait(rival.name);
  if (cached) return image(cached);
  // Renderiza depois de a tela aparecer (sem travar o clique); até lá, a arte de emoji.
  portraitLater(rival.name, rival.name, rival.car, spec.color, (url) => {
    const frame = $("board-photo");
    if (url && frame.dataset.rival === rival.name) setHtml(frame, image(url));
  });
  return `<div class="board-art">${escapeHtml(rival.taunt[0]?.art ?? "🍔")}</div>`;
}

export function renderStoryScreen(story: StoryProgress) {
  const rival = currentRival(story);
  const current = Math.min(story.stage, RIVALS_LADDER.length - 1);
  const shown = previewed ?? current;
  // Cardápio: do combo #1 (o Bruno) para baixo, cada um com o "preço" (as calorias exigidas).
  setHtml($("ladder"), RIVALS_LADDER.map((r, i) => {
    const state = i < story.stage ? "beaten" : i === story.stage ? "current" : "locked";
    const badge = state === "beaten" ? "✔ comido" : state === "current" ? "🔥 pedido agora" : "🔒 em breve";
    return `<li><button type="button" class="rival ${state}${i === shown ? " shown" : ""}" data-rival="${i}">` +
      `<span class="rank">${r.rank}</span>` +
      `<span class="combo"><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(r.title)}</small></span>` +
      `<span class="price">${kcal(r.bounty)}<small>kcal</small></span><span class="badge">${badge}</span></button></li>`;
  }).reverse().join(""));
  $("board-progress").textContent = storyFinished(story)
    ? "Lista Gorda zerada 👑"
    : `${story.stage} de ${RIVALS_LADDER.length} combos comidos · ${kcal(story.bounty)} kcal na carreira`;

  const target = $("story-target");
  const challenge = $<HTMLButtonElement>("story-challenge");
  const highlighted = RIVALS_LADDER[shown];
  if (highlighted && !(finalePending(story) && previewed === null)) {
    onPreview?.(highlighted.car, carSpec(highlighted.car).color);
    $("board-photo").dataset.rival = highlighted.name;
    setHtml($("board-photo"), photo(highlighted));
  } else {
    setHtml($("board-photo"), `<div class="board-art">🚨🌉</div>`);
  }

  if (finalePending(story) && previewed === null) {
    // Venceu o Bruno: falta a fuga final, com o Cross-fit e a cidade inteira atrás.
    setHtml(target, `
      <h3>Fuga final: Sargento Cross-fit</h3>
      <p class="quote">Você recuperou o M3 Gorgonzola, mas a Vigilância Sanitária inteira fechou a cidade. A única saída é a ponte inacabada do Cais.</p>
      <div class="req"><span>Chegue na ponte do Cais sem ser autuado</span><strong>🌉</strong></div>`);
  } else if (!rival && previewed === null) {
    setHtml(target, `<h3>Você é o Número 1!</h3><p class="quote">O M3 Gorgonzola voltou para casa, o A3 do Bruno está na sua garagem e o Cross-fit ficou na beira do cais. Porto Gordo é sua.</p>`);
  } else if (highlighted) {
    // Ficha do combo: "informação nutricional" (carro, pista, ritmo) e o que falta para pedir.
    const spec = carSpec(highlighted.car);
    const state = shown < story.stage ? "beaten" : shown === story.stage ? "current" : "locked";
    const rows = state === "current" ? requirements(story, highlighted) : [];
    const race = RACES[highlighted.race]?.name ?? highlighted.race;
    setHtml(target, `
      <h3>#${highlighted.rank} ${escapeHtml(highlighted.name)}</h3>
      <p class="quote">“${escapeHtml(highlighted.taunt[0]?.text ?? highlighted.title)}”</p>
      <table class="nutrition">
        <caption>Informação nutricional</caption>
        <tr><th>Carro</th><td>${escapeHtml(spec.name)}</td></tr>
        <tr><th>Pista do duelo</th><td>${escapeHtml(race)}</td></tr>
        <tr><th>Gordura no volante</th><td><span class="meter"><i style="width:${Math.round(highlighted.skill * 100)}%"></i></span></td></tr>
        <tr><th>Preço</th><td>${kcal(highlighted.bounty)} kcal · ${highlighted.wins} ${highlighted.wins === 1 ? "vitória" : "vitórias"}${highlighted.escapes ? ` · ${highlighted.escapes} ${highlighted.escapes === 1 ? "fuga" : "fugas"} ${highlighted.escapeStars}★` : ""}</td></tr>
      </table>
      ${state === "beaten" ? `<p class="stamp small">Nota fiscal na mão: ${escapeHtml(spec.name)} é seu</p>` : ""}
      ${state === "locked" ? `<p class="hint">🔒 Derrote o #${RIVALS_LADDER[story.stage]?.rank ?? ""} primeiro.</p>` : ""}
      ${rows.map((r) => `<div class="req ${r.have >= r.need ? "done" : ""}"><span>${r.label}</span><strong>${r.text}</strong></div>`).join("")}`);
  }

  // O botão de desafiar é sempre do combo atual (ou da fuga final).
  if (finalePending(story)) {
    challenge.disabled = false;
    challenge.textContent = "Fugir pela ponte 🚨";
  } else if (!rival) {
    challenge.disabled = true;
    challenge.textContent = "Lista Gorda zerada 👑";
  } else {
    challenge.disabled = !canChallenge(story);
    challenge.textContent = canChallenge(story) ? `Desafiar ${rival.name}` : "Desafiar (cumpra os requisitos)";
  }
  $("story-car").textContent = `Carro: ${carSpec(story.car).name}`;
  $("story-go").textContent = storyFinished(story) ? "Passear por Porto Gordo" : "Ir para Porto Gordo";
}

/** Ao fechar e abrir o cardápio de novo, ele volta para o combo atual. */
export const resetPreview = () => (previewed = null);

export function renderObjective(story: StoryProgress, finaleDistance?: number) {
  const el = $("story-objective");
  const rival = currentRival(story);
  el.hidden = false;
  if (finaleDistance !== undefined) {
    setHtml(el, `<strong>Fuga final: chegue na ponte do Cais 🌉</strong><br>` +
      `<span>${Math.round(finaleDistance)} m · siga a coluna de luz verde</span>`);
    return;
  }
  if (!rival) {
    setHtml(el, "👑 <strong>Número 1 da Lista Gorda.</strong> Aproveite a cidade.");
    return;
  }
  const rows = requirements(story, rival);
  const ready = canChallenge(story);
  setHtml(el, `<strong>Alvo: #${rival.rank} ${escapeHtml(rival.name)}</strong><br>` +
    rows.map((r) => `<span class="${r.have >= r.need ? "ok" : ""}">${r.text}</span>`).join(" · ") +
    (ready ? `<br><span class="ok">Pronto! ☰ Menu → Modo história → Desafiar</span>` : ""));
}

// --- Regras de progresso ----------------------------------------------------

/** Contadores do modo história. Cada um devolve true se acabou de liberar o desafio. */
export class StoryTracker {
  story: StoryProgress;

  constructor(story: StoryProgress) {
    this.story = story;
  }

  private update(change: (s: StoryProgress) => StoryProgress) {
    const before = canChallenge(this.story);
    this.story = change(this.story);
    saveStory(this.story);
    return !before && canChallenge(this.story);
  }

  addBounty(calories: number) {
    return this.update((s) => ({ ...s, bounty: s.bounty + Math.max(0, Math.round(calories)) }));
  }

  addWin() {
    return this.update((s) => ({ ...s, wins: s.wins + 1 }));
  }

  addEscape(stars: number) {
    const rival = currentRival(this.story);
    if (!rival || stars < rival.escapeStars) return false;
    return this.update((s) => ({ ...s, escapes: s.escapes + 1 }));
  }

  defeat() {
    this.story = defeatRival(this.story);
    saveStory(this.story);
  }

  setCar(car: string) {
    this.story = { ...this.story, car };
    saveStory(this.story);
  }

  finishFinale() {
    this.story = { ...this.story, finaleDone: true };
    saveStory(this.story);
  }

  markPrologueSeen() {
    this.story = { ...this.story, seenPrologue: true };
    saveStory(this.story);
  }
}
