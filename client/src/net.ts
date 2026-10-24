// Conexão com o servidor: as duas salas (mundo aberto e corrida) e seus tipos.
import { ColyseusSDK } from "@colyseus/sdk";
import type server from "@nfbmc/server/app.config";
import { ROOM_NAME, WORLD_ROOM_NAME, type WorldJoinOptions } from "@nfbmc/shared";

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

const joinPublicRace = (options: WorldJoinOptions) => client.joinOrCreate(ROOM_NAME, options);
const joinPublicWorld = (options: WorldJoinOptions) => client.joinOrCreate(WORLD_ROOM_NAME, options);
export type RaceRoom = Awaited<ReturnType<typeof joinPublicRace>>;
export type WorldRoom = Awaited<ReturnType<typeof joinPublicWorld>>;

// `create` e `joinById` devolvem a mesma sala com tipos genéricos diferentes no
// SDK; os casts abaixo só unificam esses tipos.

/** Corrida rápida no autódromo: a sala pública da galera, ou uma sala solo contra bots. */
export const joinQuickRace = (options: WorldJoinOptions, solo: boolean): Promise<RaceRoom> =>
  solo
    ? (client.create(ROOM_NAME, { ...options, solo: true }) as Promise<unknown> as Promise<RaceRoom>)
    : joinPublicRace(options);

/** Corrida de evento disparada no mundo aberto (sala criada pelo servidor). */
export const joinEventRace = (roomId: string, options: WorldJoinOptions): Promise<RaceRoom> =>
  client.joinById(roomId, options) as Promise<unknown> as Promise<RaceRoom>;

/** Mundo aberto: o compartilhado, ou um só seu. */
export const joinWorld = (options: WorldJoinOptions): Promise<WorldRoom> =>
  options.solo
    ? (client.create(WORLD_ROOM_NAME, options) as Promise<unknown> as Promise<WorldRoom>)
    : joinPublicWorld(options);
