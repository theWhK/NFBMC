// Abertura do jogo, paródia da do Need for Speed: Most Wanted (2005): aviso à
// saúde, as vinhetas das "empresas" (EAT Games, LunchBox e Nhamvidia, todas de
// mentira, com logos desenhados à mão), um trailer por cima da cidade 3D e a
// tela "Aperte Enter". Qualquer tecla ou clique pula a vinheta atual; Esc (ou
// "Pular abertura") pula tudo.
import type { Sound } from "./audio.ts";
import { LOGO_SVG } from "./logo.ts";
import { $ } from "./ui.ts";

const INTRO_KEY = "nfbmc:intro";

/** A abertura pode ser desligada nas Opções. */
export function introEnabled() {
  try {
    return localStorage.getItem(INTRO_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setIntroEnabled(on: boolean) {
  try {
    localStorage.setItem(INTRO_KEY, on ? "1" : "0");
  } catch {
    // Sem localStorage: vale só nesta aba.
  }
}

// --- Logos de mentira ----------------------------------------------------------

/** Prato cromado com uma mordida na borda. */
const EAT_SVG = `
<svg class="intro-logo" viewBox="0 0 360 300" role="img" aria-label="EAT Games">
  <defs>
    <radialGradient id="eat-plate" cx="0.38" cy="0.3" r="0.8">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.55" stop-color="#d7dbe0"/>
      <stop offset="1" stop-color="#6f767e"/>
    </radialGradient>
    <mask id="eat-bite">
      <rect width="360" height="300" fill="#fff"/>
      <circle cx="262" cy="50" r="22" fill="#000"/>
      <circle cx="282" cy="76" r="20" fill="#000"/>
      <circle cx="292" cy="105" r="17" fill="#000"/>
    </mask>
  </defs>
  <g mask="url(#eat-bite)">
    <circle cx="180" cy="130" r="112" fill="url(#eat-plate)" stroke="#111" stroke-width="5"/>
    <circle cx="180" cy="130" r="84" fill="none" stroke="#9aa1a8" stroke-width="3"/>
  </g>
  <circle cx="306" cy="44" r="3.5" fill="#d7dbe0"/>
  <circle cx="318" cy="70" r="2.5" fill="#d7dbe0"/>
  <circle cx="300" cy="134" r="2" fill="#d7dbe0"/>
  <g transform="translate(180 162) skewX(-10)">
    <text text-anchor="middle" font-family="'Russo One', sans-serif" font-size="96" letter-spacing="-2"
      fill="#e63946" stroke="#16110d" stroke-width="6" paint-order="stroke">EAT</text>
  </g>
  <text x="180" y="288" text-anchor="middle" font-family="'Russo One', sans-serif" font-size="34"
    letter-spacing="16" fill="#ffffff">GAMES</text>
</svg>`;

/** Lancheira preta (cubo em perspectiva) com alça de mostarda. */
const LUNCHBOX_SVG = `
<svg class="intro-logo" viewBox="0 0 360 300" role="img" aria-label="LunchBox">
  <g stroke="#ffc42e" stroke-width="2.5" stroke-linejoin="round">
    <path d="M180 48 L270 93 L180 138 L90 93 Z" fill="#2b2723"/>
    <path d="M90 93 L180 138 L180 233 L90 188 Z" fill="#121010"/>
    <path d="M180 138 L270 93 L270 188 L180 233 Z" fill="#1d1a17"/>
  </g>
  <path d="M146 80 C146 34 214 66 214 112" fill="none" stroke="#ffc42e" stroke-width="9" stroke-linecap="round"/>
  <path d="M214 160 L238 148 L238 166 L214 178 Z" fill="#ffc42e"/>
  <text x="180" y="286" text-anchor="middle" font-family="'Black Ops One', sans-serif" font-size="48"
    letter-spacing="4" fill="#f5ebe0">LUNCHBOX</text>
</svg>`;

/** Selo verde com um olho de alface. */
const NHAM_SVG = `
<svg class="intro-logo wide" viewBox="0 0 480 200" role="img" aria-label="Nhamvidia: the way it's meant to be eaten">
  <rect x="10" y="10" width="460" height="180" rx="14" fill="#0d0d0d" stroke="#5cb83a" stroke-width="4"/>
  <path d="M24 10 H180 V190 H24 A14 14 0 0 1 10 176 V24 A14 14 0 0 1 24 10 Z" fill="#5cb83a"/>
  <path d="M36 100 Q95 40 154 100 Q95 160 36 100 Z" fill="#ffffff" stroke="#16110d" stroke-width="4"/>
  <circle cx="95" cy="100" r="28" fill="#5cb83a" stroke="#16110d" stroke-width="3"/>
  <path d="M95 74 V126 M95 92 L80 80 M95 92 L110 80 M95 108 L81 98 M95 108 L109 98"
    stroke="#2f7a1f" stroke-width="3" stroke-linecap="round" fill="none"/>
  <text x="325" y="88" text-anchor="middle" font-family="'Russo One', sans-serif" font-size="40"
    textLength="262" lengthAdjust="spacingAndGlyphs" fill="#ffffff">NHAMVIDIA</text>
  <text x="325" y="124" text-anchor="middle" font-family="system-ui, sans-serif" font-size="17"
    letter-spacing="1" fill="#cfe9c4">the way it's meant to be</text>
  <text x="325" y="164" text-anchor="middle" font-family="'Russo One', sans-serif" font-size="32"
    letter-spacing="8" fill="#5cb83a">EATEN</text>
</svg>`;

// O logo do jogo já está no menu (escondido durante a abertura). Gradiente de um
// SVG escondido não pinta no Chrome, então esta cópia ganha ids próprios.
const TITLE_SVG = LOGO_SVG.replaceAll('id="logo-', 'id="intro-logo-').replaceAll("url(#logo-", "url(#intro-logo-");

// --- Roteiro ---------------------------------------------------------------------

interface Step {
  id: string;
  /** Passos do mesmo grupo (o trailer) são pulados juntos. */
  group: string;
  /** Visual do fundo: preto (vinhetas), cinema (por cima da cidade 3D) ou título. */
  look: "black" | "film" | "title";
  html: string;
  /** Duração; sem ela, espera uma tecla. */
  ms?: number;
  /** `later` agenda algo dentro do passo (cancelado se o passo for pulado). */
  enter?: (later: (fn: () => void, ms: number) => void) => void;
}

export interface IntroHooks {
  /** Começou o trailer (ou a tela de título): bom momento para trocar o carro da vitrine. */
  onTrailer?: () => void;
}

/** Letreiro do trailer; o da sirene vem com o pisca vermelho e azul na tela toda. */
const card = (kicker: string, line: string, fx = "") =>
  `${fx === "fx-siren" ? '<div class="intro-siren"></div>' : ""}` +
  `<div class="intro-card ${fx}"><p class="intro-kicker">${kicker}</p><h2 class="intro-line">${line}</h2></div>`;

function script(sound: Sound, hooks: IntroHooks): Step[] {
  const touch = document.body.classList.contains("touch");
  const trailer = (id: string, html: string, enter: Step["enter"], ms = 2600): Step => ({ id, group: "trailer", look: "film", html, ms, enter });
  return [
    {
      id: "aviso", group: "aviso", look: "black",
      html: `
        <div class="intro-warning">
          <div class="intro-rating" aria-label="Classificação: mais de mil calorias">
            <div class="box"><strong>+1000</strong><span>kcal</span></div>
            <p>Fritura intensa<br>Molho especial<br>Velocidade</p>
          </div>
          <h2>Aviso à saúde</h2>
          <p>Este jogo contém fritura em alta velocidade, perseguições da Vigilância Sanitária e quantidades irresponsáveis de queijo.</p>
          <p>Não tente isto em casa: na vida real, coma devagar e dirija de cinto.</p>
          <p class="intro-fine">O Ministério da Gordura adverte: hambúrguer a 300 km/h faz mal à saúde.</p>
          <p class="intro-press">${touch ? "Toque na tela" : "Aperte qualquer tecla"}</p>
        </div>`,
      enter: () => sound.song(null),
    },
    {
      id: "eat", group: "eat", look: "black", ms: 3600,
      html: `<div class="intro-brand eat">${EAT_SVG}<p class="intro-tag">Chantilly Everything</p></div>`,
      enter: (later) => {
        sound.whoosh();
        later(() => sound.shimmer(), 450);
        later(() => sound.say("eat"), 700);
      },
    },
    {
      id: "lunchbox", group: "lunchbox", look: "black", ms: 3000,
      html: `<div class="intro-brand lunchbox">${LUNCHBOX_SVG}<p class="intro-tag">estúdio de marmitas</p></div>`,
      enter: (later) => later(() => sound.thud(), 520),
    },
    {
      id: "nhamvidia", group: "nhamvidia", look: "black", ms: 3200,
      html: `<div class="intro-brand nham">${NHAM_SVG}</div>`,
      enter: (later) => {
        sound.whoosh();
        later(() => sound.say("nham"), 500);
      },
    },
    trailer("cidade", card("Fim de tarde. 38 °C. Cheiro de fritura no ar.", "Porto Gordo."), () => {
      hooks.onTrailer?.();
      sound.song("trailer");
      sound.whoosh();
      sound.say("trailer-cidade", 0.9);
    }),
    trailer("digestao", card("Uma cidade que nunca dorme…", "…porque está fazendo a digestão."), () => sound.whoosh()),
    trailer("vigilancia", card("Ninguém come na rua impunemente.", "A Vigilância Sanitária quer você.", "fx-siren"), () => {
      sound.wail();
      sound.say("trailer-vigilancia", 0.5);
    }),
    trailer("rivais", card("Dez rivais. Uma Lista Gorda.", "E um A3 todo mexido."), () => sound.boom()),
    trailer("calorico", card("Só um pode ser", "o mais calórico.", "fx-slam"), () => {
      sound.boom();
      sound.say("trailer-calorico", 0.1);
    }, 2600),
    {
      id: "titulo", group: "titulo", look: "title",
      html: `
        <div class="intro-title-card">
          ${TITLE_SVG}
          <p class="intro-press">${touch ? "Toque para começar" : "Aperte Enter"}</p>
          <p class="intro-legal">EAT Games, LunchBox e Nhamvidia não existem. Paródia de fã de Need for Speed: Most Wanted (2005), sem ligação com a EA. Nenhum hambúrguer foi ferido nesta produção.</p>
        </div>`,
      enter: () => {
        // Quem pulou o trailer também vê o carro atrás do título, com a música.
        hooks.onTrailer?.();
        sound.song("trailer");
        sound.boom();
      },
    },
  ];
}

/** Toca a abertura; resolve quando ela termina ou é pulada. */
export function playIntro(sound: Sound, hooks: IntroHooks = {}): Promise<void> {
  const overlay = $("intro");
  const stage = $("intro-stage");
  const skip = $<HTMLButtonElement>("intro-skip");
  const steps = script(sound, hooks);
  // As falas da abertura começam a baixar já (são poucos KB).
  sound.preloadVoices(["eat", "nham", "trailer-cidade", "trailer-vigilancia", "trailer-calorico"]);
  return new Promise((resolve) => {
    let index = -1;
    let timers: ReturnType<typeof setTimeout>[] = [];
    let done = false;
    const later = (fn: () => void, ms: number) => void timers.push(setTimeout(fn, ms));
    const clearTimers = () => {
      for (const t of timers) clearTimeout(t);
      timers = [];
    };

    const go = (i: number) => {
      clearTimers();
      if (i >= steps.length) {
        finish();
        return;
      }
      index = i;
      const step = steps[i];
      overlay.className = `intro intro-${step.look}`;
      overlay.dataset.step = step.id;
      // Nós novos: as animações do CSS recomeçam a cada passo.
      stage.innerHTML = step.html;
      stage.style.setProperty("--life", step.ms ? `${step.ms}ms` : "0s");
      skip.hidden = step.look === "title";
      step.enter?.(later);
      if (step.ms) later(() => go(index + 1), step.ms);
    };

    /** Próxima vinheta (o trailer inteiro conta como uma só). */
    const advance = () => {
      sound.unlock();
      sound.hush();
      const group = steps[index].group;
      let next = index + 1;
      while (next < steps.length && steps[next].group === group) next++;
      go(next);
    };

    const finish = () => {
      if (done) return;
      done = true;
      clearTimers();
      sound.hush();
      overlay.hidden = true;
      stage.innerHTML = "";
      delete overlay.dataset.step;
      window.removeEventListener("keydown", onKey, true);
      overlay.onclick = skip.onclick = null;
      resolve();
    };

    const onKey = (e: KeyboardEvent) => {
      // Atalhos do navegador (F5, Ctrl+R, F12...) continuam funcionando.
      if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.code)) return;
      // A abertura fica com a tecla: o menu, por baixo, não reage a ela.
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      sound.unlock();
      if (e.code === "Escape") finish();
      else advance();
    };

    overlay.onclick = advance;
    skip.onclick = (e) => {
      e.stopPropagation();
      sound.unlock();
      finish();
    };
    window.addEventListener("keydown", onKey, true);
    overlay.hidden = false;
    go(0);
  });
}
