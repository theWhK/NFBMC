// Celular e tablet: controles na tela (multitoque), tela cheia na horizontal e
// o aviso para girar o aparelho quando ele estiver em pé durante o jogo.

/** Aparelho de toque (dedo como apontador principal). */
export const isTouchDevice = () =>
  window.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window || navigator.maxTouchPoints > 0;

/**
 * Liga os botões da tela (com `data-key`) ao conjunto de teclas apertadas.
 * Cada dedo é acompanhado pelo seu pointerId, então dá para acelerar e virar
 * ao mesmo tempo; arrastar o dedo de um botão para outro troca o comando.
 */
export function bindTouchControls(root: HTMLElement, keys: Set<string>, onChange: () => void) {
  const pressed = new Map<number, string>();

  const release = (pointerId: number) => {
    const key = pressed.get(pointerId);
    if (!key) return;
    pressed.delete(pointerId);
    // Outro dedo ainda pode estar no mesmo botão.
    if (![...pressed.values()].includes(key)) {
      keys.delete(key);
      root.querySelector(`[data-key="${key}"]`)?.classList.remove("down");
    }
    onChange();
  };

  const press = (pointerId: number, key: string) => {
    if (pressed.get(pointerId) === key) return;
    release(pointerId);
    pressed.set(pointerId, key);
    keys.add(key);
    root.querySelector(`[data-key="${key}"]`)?.classList.add("down");
    navigator.vibrate?.(8);
    onChange();
  };

  const keyAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y)?.closest("[data-key]") as HTMLElement | null)?.dataset.key;

  root.addEventListener("pointerdown", (e) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>("[data-key]")?.dataset.key;
    if (!key) return;
    e.preventDefault();
    // Sem isso, o navegador "prende" o ponteiro no botão onde o dedo começou
    // (e não daria para arrastar o dedo de um botão para outro).
    const target = e.target as HTMLElement;
    if (target.hasPointerCapture?.(e.pointerId)) target.releasePointerCapture(e.pointerId);
    press(e.pointerId, key);
  });
  // Movimento e soltura na janela inteira: o dedo pode sair de cima dos botões
  // (aí os eventos vão para o canvas) e o comando não pode ficar preso.
  window.addEventListener("pointermove", (e) => {
    if (!pressed.has(e.pointerId)) return;
    const key = keyAt(e.clientX, e.clientY);
    if (key) press(e.pointerId, key);
    else release(e.pointerId);
  });
  for (const type of ["pointerup", "pointercancel"] as const) {
    window.addEventListener(type, (e) => release(e.pointerId));
  }
  // Menu de contexto do "segurar o dedo" atrapalha.
  root.addEventListener("contextmenu", (e) => e.preventDefault());

  return {
    /** Solta tudo (ex.: ao trocar de sala ou o app ir para segundo plano). */
    reset: () => [...pressed.keys()].forEach(release),
  };
}

/**
 * Pede tela cheia e trava na horizontal. Precisa ser chamado dentro de um toque.
 * O Android aceita; o iPhone não deixa travar (aí vale o aviso de girar).
 */
export async function requestLandscape() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await orientation.lock?.("landscape");
  } catch {
    // Sem tela cheia ou sem trava: segue normal, com o aviso de girar.
  }
}

export const isPortrait = () => window.matchMedia("(orientation: portrait)").matches;
