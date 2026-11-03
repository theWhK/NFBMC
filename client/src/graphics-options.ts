// Opções → "Gráficos avançados": um botão por ajuste, que gira entre os
// valores (como os outros botões das Opções). Mexer em qualquer um deixa o
// preset "personalizado"; escolher um preset no botão de cima desfaz tudo.
import type { Graphics } from "./graphics.ts";
import type { GameScene } from "./scene.ts";

interface Knob {
  key: keyof Graphics;
  label: string;
  values: (number | boolean)[];
  text: (value: number | boolean) => string;
  /** Só faz sentido em um dos visuais. */
  look?: "realista" | "quadrinho";
}

const onOff = (value: number | boolean) => (value ? "ligado" : "desligado");

const KNOBS: Knob[] = [
  { key: "resolution", label: "Resolução", values: [0.75, 1, 1.25, 1.5, 2], text: (v) => `até ${Math.round(Number(v) * 100)}%` },
  { key: "adaptive", label: "Resolução automática", values: [true, false], text: (v) => (v ? "baixa se o FPS cair" : "fixa") },
  { key: "fpsCap", label: "Limite de FPS", values: [0, 60, 30], text: (v) => (v ? `${v} quadros` : "sem limite") },
  { key: "shadows", label: "Sombras", values: [0, 1024, 2048, 4096], text: (v) => ({ 0: "desligadas", 1024: "baixas", 2048: "médias", 4096: "altas" })[Number(v)] ?? String(v) },
  { key: "detail", label: "Detalhe da cidade", values: [0, 190, 340, 480], text: (v) => (v ? `até ${v} m` : "simples") },
  { key: "reflections", label: "Reflexos e materiais", values: [true, false], text: onOff, look: "realista" },
  { key: "bloom", label: "Brilho das luzes", values: [true, false], text: onOff, look: "realista" },
  { key: "occlusion", label: "Oclusão de ambiente", values: [true, false], text: (v) => (v ? "ligada (pesada)" : "desligada"), look: "realista" },
  { key: "outline", label: "Contorno de tinta", values: [true, false], text: onOff, look: "quadrinho" },
  { key: "speedBlur", label: "Borrão de velocidade", values: [true, false], text: onOff },
];

export function mountGraphicsOptions(container: HTMLElement, toggle: HTMLButtonElement, scene: GameScene | null, onChange: () => void) {
  const buttons = new Map<Knob, HTMLButtonElement>();
  for (const knob of KNOBS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.testid = `gfx-${knob.key}`;
    button.addEventListener("click", () => {
      if (!scene) return;
      const now = scene.graphics[knob.key];
      const next = knob.values[(knob.values.indexOf(now) + 1) % knob.values.length];
      scene.setGraphics({ [knob.key]: next });
      refresh();
      onChange();
    });
    buttons.set(knob, button);
    container.append(button);
  }

  const refresh = () => {
    if (!scene) {
      toggle.hidden = true;
      return;
    }
    for (const [knob, button] of buttons) {
      button.textContent = `${knob.label}: ${knob.text(scene.graphics[knob.key])}`;
      button.hidden = !!knob.look && knob.look !== scene.look;
    }
  };

  toggle.addEventListener("click", () => {
    container.hidden = !container.hidden;
    toggle.textContent = `Gráficos avançados ${container.hidden ? "▸" : "▾"}`;
    refresh();
    // O menu refaz a lista navegável pelo teclado (os botões apareceram ou sumiram).
    container.dispatchEvent(new CustomEvent("menu:relist", { bubbles: true }));
  });
  refresh();
  return { refresh };
}
