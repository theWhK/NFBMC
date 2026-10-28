// Progresso feito sem internet e a sincronização com a nuvem.
//
// Jogando offline (modo solo, história, corrida contra bots), o que o jogador
// ganha vira um "lançamento" com id único, guardado no aparelho. Quando a
// internet volta, os lançamentos vão para /api/sync, que soma cada um uma vez só
// na ficha do servidor. A ficha local mostra a última ficha vista do servidor
// mais o que ainda não foi enviado.

export interface SyncEntry {
  id: string;
  calories: number;
  races: number;
  wins: number;
  best: number;
}

export interface LocalProfile {
  token: string;
  name: string;
  calories: number;
  races: number;
  wins: number;
  bestRace: number;
}

const PENDING_KEY = "nfbmc:pendentes";
const SNAPSHOT_KEY = "nfbmc:ficha-nuvem";
const TOKEN_KEY = "nfbmc:token";

const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sem localStorage (aba anônima): o progresso offline vale só nesta sessão.
  }
};

const uuid = () =>
  crypto.randomUUID?.() ??
  "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16));

/** Token da ficha (cria um se o jogador nunca jogou online: o servidor aceita na primeira sincronização). */
export function ensureToken() {
  let token = "";
  try {
    token = localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    // segue sem
  }
  if (!token) {
    token = uuid();
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // segue sem
    }
  }
  return token;
}

export const pendingEntries = () => read<SyncEntry[]>(PENDING_KEY, []);

/** Lançamentos sendo enviados agora (não podem ser alterados até a resposta). */
const inFlight = new Set<string>();

function enqueue(entry: Omit<SyncEntry, "id">) {
  const pending = pendingEntries();
  const last = pending[pending.length - 1];
  // Calorias do mundo chegam aos pouquinhos: junta no último lançamento só de calorias (se ainda não saiu).
  if (last && !inFlight.has(last.id) && entry.races === 0 && last.races === 0) {
    last.calories += entry.calories;
  } else {
    pending.push({ id: uuid(), ...entry });
  }
  write(PENDING_KEY, pending);
}

/** Guarda a ficha que o servidor mostrou (base da ficha local). */
export function rememberCloudProfile(profile: { name?: string; calories: number; races: number; wins: number; bestRace?: number }) {
  write(SNAPSHOT_KEY, { bestRace: 0, ...profile });
}

/** Ficha local: a última vista do servidor mais o que ainda não foi sincronizado. */
export function localProfile(token: string, name: string): LocalProfile {
  const cloud = read(SNAPSHOT_KEY, { calories: 0, races: 0, wins: 0, bestRace: 0 });
  const pending = pendingEntries();
  return {
    token,
    name,
    calories: cloud.calories + pending.reduce((sum, e) => sum + e.calories, 0),
    races: cloud.races + pending.reduce((sum, e) => sum + e.races, 0),
    wins: cloud.wins + pending.reduce((sum, e) => sum + e.wins, 0),
    bestRace: Math.max(cloud.bestRace ?? 0, ...pending.map((e) => e.best)),
  };
}

/** Calorias ganhas no mundo offline (diferença para a ficha). */
export function addOfflineCalories(calories: number) {
  if (calories > 0) enqueue({ calories, races: 0, wins: 0, best: 0 });
}

/** Corrida terminada offline. */
export function addOfflineRace(total: number, won: boolean) {
  enqueue({ calories: Math.max(0, total), races: 1, wins: won ? 1 : 0, best: Math.max(0, total) });
}

const apiBase = import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2567` : "";
let syncing: Promise<boolean> | null = null;

/** Manda os lançamentos guardados para a nuvem. true se não sobrou nada pendente. */
export function syncNow(name: string): Promise<boolean> {
  if (syncing) return syncing;
  syncing = (async () => {
    const pending = pendingEntries();
    if (!pending.length) return true;
    if (!navigator.onLine) return false;
    for (const e of pending) inFlight.add(e.id);
    try {
      const response = await fetch(`${apiBase}/api/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: ensureToken(), name: name || "Piloto", entries: pending }),
      });
      if (!response.ok) return false;
      const result = await response.json();
      // Tira da fila o que foi enviado (o que chegou durante o envio fica).
      const sent = new Set(pending.map((e) => e.id));
      write(PENDING_KEY, pendingEntries().filter((e) => !sent.has(e.id)));
      if (result) rememberCloudProfile(result);
      return pendingEntries().length === 0;
    } catch {
      return false;
    } finally {
      for (const e of pending) inFlight.delete(e.id);
      syncing = null;
    }
  })();
  return syncing;
}
