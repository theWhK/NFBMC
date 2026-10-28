// Modo história no cliente: progresso salvo neste navegador, quadrinhos,
// apresentação do rival, quadro da Lista Gorda no menu e o objetivo no HUD.
import {
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

export function renderStoryScreen(story: StoryProgress) {
  const rival = currentRival(story);
  setHtml($("ladder"), RIVALS_LADDER.map((r, i) => {
    const state = i < story.stage ? "beaten" : i === story.stage ? "current" : "locked";
    return `<li class="${state}"><span class="rank">#${r.rank}</span><span>${escapeHtml(r.name)}<small>${escapeHtml(carSpec(r.car).name)}</small></span></li>`;
  }).reverse().join(""));

  const target = $("story-target");
  const challenge = $<HTMLButtonElement>("story-challenge");
  if (finalePending(story)) {
    // Venceu o Bruno: falta a fuga final, com o Cross-fit e a cidade inteira atrás.
    setHtml(target, `
      <h3>Fuga final: Sargento Cross-fit</h3>
      <p class="quote">Você recuperou o M3 Gorgonzola, mas a Vigilância Sanitária inteira fechou a cidade. A única saída é a ponte inacabada do Cais.</p>
      <div class="req"><span>Chegue na ponte do Cais sem ser autuado</span><strong>🌉</strong></div>`);
    challenge.disabled = false;
    challenge.textContent = "Fugir pela ponte 🚨";
  } else if (!rival) {
    setHtml(target, `<h3>Você é o Número 1!</h3><p class="quote">O M3 Gorgonzola voltou para casa, o A3 do Bruno está na sua garagem e o Cross-fit ficou na beira do cais. Porto Gordo é sua.</p>`);
    challenge.disabled = true;
    challenge.textContent = "Lista Gorda zerada 👑";
  } else {
    const rows = requirements(story, rival);
    setHtml(target, `
      <h3>#${rival.rank} ${escapeHtml(rival.name)}</h3>
      <p class="quote">${escapeHtml(rival.title)} · ${escapeHtml(carSpec(rival.car).name)} · ${rival.race === "autodromo" ? "Autódromo" : "corrida de rua"}</p>
      ${rows.map((r) => `<div class="req ${r.have >= r.need ? "done" : ""}"><span>${r.label}</span><strong>${r.text}</strong></div>`).join("")}`);
    challenge.disabled = !canChallenge(story);
    challenge.textContent = canChallenge(story) ? `Desafiar ${rival.name}` : "Desafiar (cumpra os requisitos)";
  }
  $("story-car").textContent = `Carro: ${carSpec(story.car).name}`;
  $("story-go").textContent = storyFinished(story) ? "Passear por Porto Gordo" : "Ir para Porto Gordo";
}

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
