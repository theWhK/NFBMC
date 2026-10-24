// Modo história no cliente: progresso salvo neste navegador, quadrinhos,
// apresentação do rival, quadro da Lista Gorda no menu e o objetivo no HUD.
import {
  RIVALS_LADDER,
  canChallenge,
  carSpec,
  currentRival,
  defeatRival,
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

/** Mostra os quadros um por um (clique, Enter, espaço ou toque avança). */
export function playComic(panels: ComicPanel[]): Promise<void> {
  const overlay = $("comic");
  const panel = $("comic-panel");
  const next = $<HTMLButtonElement>("comic-next");
  const skip = $<HTMLButtonElement>("comic-skip");
  if (!panels.length) return Promise.resolve();
  return new Promise((resolve) => {
    let index = 0;
    const show = () => {
      const p = panels[index];
      panel.style.backgroundColor = p.color ?? "#16110d";
      $("comic-art").textContent = p.art;
      $("comic-speaker").textContent = p.speaker ?? "";
      $("comic-text").textContent = p.text;
      $("comic-page").textContent = `${index + 1}/${panels.length}`;
      next.textContent = index === panels.length - 1 ? "Fechar ▶" : "Continuar ▶";
      // Reinicia a animação de entrada do quadro.
      panel.style.animation = "none";
      void panel.offsetWidth;
      panel.style.animation = "";
    };
    const finish = () => {
      overlay.hidden = true;
      window.removeEventListener("keydown", onKey, true);
      next.onclick = skip.onclick = panel.onclick = null;
      resolve();
    };
    const advance = () => {
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
        finish();
      }
    };
    next.onclick = advance;
    panel.onclick = advance;
    skip.onclick = finish;
    window.addEventListener("keydown", onKey, true);
    overlay.hidden = false;
    show();
  });
}

/** Apresentação do rival, estilo Borderlands, por alguns segundos. */
export function showRivalIntro(rival: Rival): Promise<void> {
  const el = $("rival-intro");
  $("rival-rank").textContent = `#${rival.rank} da Lista Gorda`;
  $("rival-name").textContent = rival.name;
  $("rival-title").textContent = rival.title;
  $("rival-car").textContent = carSpec(rival.car).name;
  el.hidden = false;
  return new Promise((resolve) => setTimeout(() => {
    el.hidden = true;
    resolve();
  }, 2600));
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
  if (!rival) {
    setHtml(target, `<h3>Você é o Número 1!</h3><p class="quote">O M3 Gorgonzola voltou para casa e o A3 do Bruno está na sua garagem. Porto Gordo é sua.</p>`);
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

export function renderObjective(story: StoryProgress) {
  const el = $("story-objective");
  const rival = currentRival(story);
  el.hidden = false;
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

  markPrologueSeen() {
    this.story = { ...this.story, seenPrologue: true };
    saveStory(this.story);
  }
}
