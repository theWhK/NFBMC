// Conexão com o servidor: as duas salas (mundo aberto e corrida) e seus tipos.
import { ColyseusSDK } from "@colyseus/sdk";
import type server from "@nfbmc/server/app.config";
import { ROOM_NAME, WORLD_ROOM_NAME, type CreateOptions, type OnlinePilot, type WorldJoinOptions } from "@nfbmc/shared";

// Em produção o cliente é servido pelo próprio servidor do jogo (mesma origem).
// Em dev o Vite roda na 5173 e o servidor na 2567, na mesma máquina.
const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
const endpoint = import.meta.env.DEV
  ? `${wsProtocol}://${location.hostname}:2567`
  : `${wsProtocol}://${location.host}`;

const client = new ColyseusSDK<typeof server>(endpoint);

/** Endereço da API HTTP do servidor (em dev, a porta 2567; em produção, a mesma origem). */
const apiBase = import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2567` : "";

export interface ListaGordaEntry {
  name: string;
  calories: number;
  races: number;
  wins: number;
}

export interface ProfileSummary {
  name: string;
  calories: number;
  races: number;
  wins: number;
}

/** Ficha do jogador para o rodapé do menu (null se não houver ou o servidor não responder). */
export async function fetchProfile(token: string): Promise<ProfileSummary | null> {
  try {
    const response = await fetch(`${apiBase}/api/ficha/${encodeURIComponent(token)}`);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** Lista Gorda de todos os tempos (fica vazia se o servidor não responder). */
export async function fetchListaGorda(): Promise<ListaGordaEntry[]> {
  try {
    const response = await fetch(`${apiBase}/api/lista-gorda`);
    return response.ok ? await response.json() : [];
  } catch {
    return [];
  }
}

/** Quem está jogando agora, em qualquer sala (fica vazia se o servidor não responder). */
export async function fetchOnline(): Promise<OnlinePilot[]> {
  try {
    const response = await fetch(`${apiBase}/api/online`);
    return response.ok ? await response.json() : [];
  } catch {
    return [];
  }
}

// --- Sem internet (PWA) ------------------------------------------------------
//
// Offline, os modos sozinho (modo solo, história e corrida contra bots) rodam
// numa sala local: as mesmas salas do servidor, dentro do navegador
// (offline/local.ts). Co-op e corrida com a galera precisam de internet.

/** `?offline=1` na URL força o modo sem internet (para testar e para o Will rever). */
const forcedOffline = new URLSearchParams(location.search).get("offline") === "1";
let serverReachable = true;
const offlineListeners = new Set<(offline: boolean) => void>();

/** Está sem internet (ou sem acesso ao servidor do jogo)? */
export const isOffline = () => forcedOffline || !navigator.onLine || !serverReachable;

/** Avisa quando muda (o menu desliga o Co-op, por exemplo). */
export function onOfflineChange(listener: (offline: boolean) => void) {
  offlineListeners.add(listener);
  return () => offlineListeners.delete(listener);
}

/** Confere se o servidor responde (o navegador às vezes diz "online" sem ter rede de verdade). */
export async function checkServer() {
  const before = isOffline();
  if (forcedOffline || !navigator.onLine) serverReachable = navigator.onLine;
  else {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      serverReachable = (await fetch(`${apiBase}/healthz`, { signal: controller.signal, cache: "no-store" })).ok;
      clearTimeout(timer);
    } catch {
      serverReachable = false;
    }
  }
  if (isOffline() !== before) for (const listener of offlineListeners) listener(isOffline());
  return !isOffline();
}
window.addEventListener("online", () => void checkServer());
window.addEventListener("offline", () => void checkServer());

/** Erro de quem tenta um modo que precisa de internet sem ter. */
export class OfflineError extends Error {
  constructor() {
    super("Sem internet: este modo precisa de conexão. Modo solo, história e corrida contra bots funcionam offline.");
  }
}

const local = () => import("./offline/local.ts");

const joinPublicRace = (options: WorldJoinOptions) => client.joinOrCreate(ROOM_NAME, options);
const joinPublicWorld = (options: WorldJoinOptions) => client.joinOrCreate(WORLD_ROOM_NAME, options);
export type RaceRoom = Awaited<ReturnType<typeof joinPublicRace>>;
export type WorldRoom = Awaited<ReturnType<typeof joinPublicWorld>>;

// `create` e `joinById` devolvem a mesma sala com tipos genéricos diferentes no
// SDK; os casts abaixo só unificam esses tipos.

/** Corrida rápida no autódromo: a sala pública da galera, ou uma sala solo contra bots. */
export async function joinQuickRace(options: WorldJoinOptions & CreateOptions, solo: boolean): Promise<RaceRoom> {
  if (isOffline()) {
    if (!solo) throw new OfflineError();
    return (await local()).createLocal(ROOM_NAME, { ...options, solo: true }) as Promise<unknown> as Promise<RaceRoom>;
  }
  return solo
    ? (client.create(ROOM_NAME, { ...options, solo: true }) as Promise<unknown> as Promise<RaceRoom>)
    : joinPublicRace(options);
}

/** Corrida de evento disparada no mundo aberto (sala criada pelo servidor). */
export async function joinEventRace(roomId: string, options: WorldJoinOptions): Promise<RaceRoom> {
  // Corrida criada por um mundo local (offline): a sala também é local.
  if (roomId.startsWith("local-")) return (await local()).joinLocalById(roomId, options) as Promise<unknown> as Promise<RaceRoom>;
  return client.joinById(roomId, options) as Promise<unknown> as Promise<RaceRoom>;
}

/** Mundo aberto: o compartilhado, ou um só seu. */
export async function joinWorld(options: WorldJoinOptions): Promise<WorldRoom> {
  if (isOffline()) {
    if (!options.solo) throw new OfflineError();
    return (await local()).createLocal(WORLD_ROOM_NAME, options) as Promise<unknown> as Promise<WorldRoom>;
  }
  return options.solo
    ? (client.create(WORLD_ROOM_NAME, options) as Promise<unknown> as Promise<WorldRoom>)
    : joinPublicWorld(options);
}
