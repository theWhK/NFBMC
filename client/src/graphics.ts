// Regulagem dos gráficos: os presets (baixo, médio, alto, ultra) e os ajustes
// avulsos por cima deles (Opções → "Gráficos avançados"). O preset fica em
// `nfbmc:quality` (como antes) e os ajustes em `nfbmc:graphics`.

export type Preset = "ultra" | "alto" | "medio" | "baixo";

export interface Graphics {
  /** Teto da densidade de pixels (1 = um pixel por pixel CSS; 2 = tela retina inteira). */
  resolution: number;
  /** Baixa a resolução sozinho quando o FPS cai. */
  adaptive: boolean;
  /** Tamanho do mapa de sombras (0 = sem sombras). */
  shadows: number;
  /** Oclusão de ambiente (realista): a parte mais pesada. */
  occlusion: boolean;
  /** Brilho das luzes fortes (bloom, realista). */
  bloom: boolean;
  /** Reflexo do céu e materiais físicos (realista); desligado fica no Lambert. */
  reflections: boolean;
  /** Contorno de tinta (quadrinho). */
  outline: boolean;
  /** Até onde (m) os blocos da cidade aparecem com todos os detalhes. */
  detail: number;
  /** Borrão de velocidade em alta. */
  speedBlur: boolean;
  /** Limite de quadros por segundo (0 = sem limite): segura o calor e a bateria. */
  fpsCap: number;
}

export const PRESETS: Record<Preset, Graphics> = {
  ultra: { resolution: 2, adaptive: true, shadows: 4096, occlusion: true, bloom: true, reflections: true, outline: true, detail: 480, speedBlur: true, fpsCap: 0 },
  alto: { resolution: 1.5, adaptive: true, shadows: 2048, occlusion: false, bloom: true, reflections: true, outline: true, detail: 340, speedBlur: true, fpsCap: 0 },
  medio: { resolution: 1.25, adaptive: true, shadows: 0, occlusion: false, bloom: false, reflections: true, outline: true, detail: 190, speedBlur: true, fpsCap: 0 },
  baixo: { resolution: 1, adaptive: true, shadows: 0, occlusion: false, bloom: false, reflections: false, outline: false, detail: 0, speedBlur: false, fpsCap: 0 },
};

export const PRESET_ORDER: Preset[] = ["ultra", "alto", "medio", "baixo"];
export const isPreset = (value: unknown): value is Preset => typeof value === "string" && (PRESET_ORDER as string[]).includes(value);

const GRAPHICS_KEY = "nfbmc:graphics";

/** Ajustes avulsos salvos (só as chaves conhecidas, com o tipo certo). */
export function loadOverrides(): Partial<Graphics> {
  try {
    const saved = JSON.parse(localStorage.getItem(GRAPHICS_KEY) ?? "null") as Record<string, unknown> | null;
    if (!saved || typeof saved !== "object") return {};
    const clean: Partial<Graphics> = {};
    for (const [key, base] of Object.entries(PRESETS.alto) as [keyof Graphics, unknown][]) {
      if (typeof saved[key] === typeof base) (clean as Record<string, unknown>)[key] = saved[key];
    }
    return clean;
  } catch {
    return {};
  }
}

export function saveOverrides(overrides: Partial<Graphics>) {
  try {
    if (Object.keys(overrides).length) localStorage.setItem(GRAPHICS_KEY, JSON.stringify(overrides));
    else localStorage.removeItem(GRAPHICS_KEY);
  } catch {
    // Sem localStorage: vale só nesta aba.
  }
}
