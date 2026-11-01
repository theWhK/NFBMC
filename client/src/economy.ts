// Carteira e peças de cada carro, guardadas neste aparelho (como o progresso da
// carreira): o dinheiro entra pelas corridas, fugas e duelos, e sai na oficina
// da garagem. As regras (preços, prêmios, efeito das peças) ficam em
// shared/src/tuning.ts; o carro chega às salas com a tunagem nas opções.
import {
  MAX_LEVEL,
  STARTING_CASH,
  emptyTune,
  partPrice,
  sanitizeTune,
  type Part,
  type Tune,
} from "@nfbmc/shared";

const KEY = "nfbmc:garage";

interface Wallet {
  cash: number;
  /** Peças compradas, por carro. */
  parts: Record<string, Tune>;
}

function load(): Wallet {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (saved && typeof saved.cash === "number") {
      const parts: Record<string, Tune> = {};
      for (const [car, tune] of Object.entries(saved.parts ?? {})) parts[car] = sanitizeTune(tune);
      return { cash: Math.max(0, Math.round(saved.cash)), parts };
    }
  } catch {
    // Sem localStorage ou salvo quebrado: começa do zero.
  }
  return { cash: STARTING_CASH, parts: {} };
}

let wallet = load();
const listeners = new Set<() => void>();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(wallet));
  } catch {
    // Sem localStorage: vale só nesta aba.
  }
  for (const listener of listeners) listener();
}

/** R$ 1.234 */
export const money = (value: number) => `R$ ${Math.round(value).toLocaleString("pt-BR")}`;

export const economy = {
  cash: () => wallet.cash,

  /** Peças instaladas num carro. */
  tune: (car: string): Tune => ({ ...(wallet.parts[car] ?? emptyTune()) }),

  /** Ganhou dinheiro (corrida, fuga, duelo). */
  earn(amount: number) {
    if (!(amount > 0)) return;
    wallet = { ...wallet, cash: wallet.cash + Math.round(amount) };
    save();
  },

  /** Multa: sai da carteira, até zerar. Devolve quanto saiu de fato. */
  pay(amount: number) {
    const paid = Math.min(wallet.cash, Math.max(0, Math.round(amount)));
    wallet = { ...wallet, cash: wallet.cash - paid };
    save();
    return paid;
  },

  /** Próximo nível de uma peça e o preço dele (null = já está no máximo). */
  nextLevel(car: string, part: Part) {
    const level = (wallet.parts[car] ?? emptyTune())[part];
    if (level >= MAX_LEVEL) return null;
    return { level: level + 1, price: partPrice(car, part, level + 1) };
  },

  /** Compra o próximo nível de uma peça; false se não tiver dinheiro (ou já estiver no máximo). */
  buy(car: string, part: Part) {
    const next = economy.nextLevel(car, part);
    if (!next || wallet.cash < next.price) return false;
    const tune = { ...(wallet.parts[car] ?? emptyTune()), [part]: next.level };
    wallet = { cash: wallet.cash - next.price, parts: { ...wallet.parts, [car]: tune } };
    save();
    return true;
  },

  onChange(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Para os testes (window.__nfbmcEconomy). */
  state: () => ({ cash: wallet.cash, parts: structuredClone(wallet.parts) }),
};
