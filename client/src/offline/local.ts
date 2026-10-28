// Salas locais (jogo sem internet): as MESMAS salas do servidor (RaceRoom e
// WorldRoom), rodando no navegador com o Colyseus de mentira (colyseus.ts). O
// LocalRoom tem a mesma cara da sala do SDK que o resto do cliente usa:
// state, sessionId, send, onMessage, onLeave, leave e ping.
//
// Este módulo é carregado só quando precisa (import dinâmico em net.ts).
import { ROOM_NAME, WORLD_ROOM_NAME } from "@nfbmc/shared";

import { RaceRoom } from "../../../server/src/rooms/RaceRoom.ts";
import { WorldRoom } from "../../../server/src/rooms/WorldRoom.ts";
import { localServer, type Client, type Room } from "./colyseus.ts";

localServer.define(ROOM_NAME, RaceRoom as unknown as new () => Room);
localServer.define(WORLD_ROOM_NAME, WorldRoom as unknown as new () => Room);

type Listener = (message: unknown) => void;

let sessions = 0;

export class LocalRoom {
  readonly sessionId = `local${++sessions}`;
  readonly roomId: string;
  private listeners = new Map<string, Set<Listener>>();
  /** Mensagens que chegaram antes de alguém escutar (a sala manda logo ao entrar). */
  private early = new Map<string, unknown[]>();
  private leaveListeners: ((code: number) => void)[] = [];
  private left = false;
  private client: Client;
  private room: Room;

  constructor(room: Room) {
    this.room = room;
    this.roomId = room.roomId;
    this.client = {
      sessionId: this.sessionId,
      // Entrega "pela rede": depois do código atual, como no SDK.
      send: (type, message) => setTimeout(() => this.deliver(type, message), 0),
      leave: (code) => void this.leave(code),
    };
  }

  get state() {
    return this.room.state as never;
  }

  /** Entra na sala (o onJoin da sala roda aqui). */
  async join(options: unknown) {
    this.room.clients.push(this.client);
    await this.room.onJoin?.(this.client, options);
    return this;
  }

  private deliver(type: string, message: unknown) {
    if (this.left) return;
    const listeners = this.listeners.get(type);
    if (listeners?.size) for (const listener of listeners) listener(message);
    else this.early.set(type, [...(this.early.get(type) ?? []), message]);
  }

  send(type: string, message?: unknown) {
    if (this.left) return;
    const handler = this.room.messages?.[type];
    if (handler) handler(this.client, message as never);
  }

  onMessage(type: string, listener: Listener) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
    // Entrega o que chegou antes de ter alguém escutando.
    const queued = this.early.get(type);
    if (queued) {
      this.early.delete(type);
      for (const message of queued) setTimeout(() => listener(message), 0);
    }
    return () => set.delete(listener);
  }

  onLeave(listener: (code: number) => void) {
    this.leaveListeners.push(listener);
  }

  async leave(code = 1000) {
    if (this.left) return;
    this.left = true;
    const index = this.room.clients.indexOf(this.client);
    if (index >= 0) this.room.clients.splice(index, 1);
    await this.room.onLeave?.(this.client, code);
    // Como no servidor: sala vazia fecha.
    if (this.room.clients.length === 0) this.room.dispose();
    for (const listener of this.leaveListeners) listener(code);
  }

  /** Sem rede, sem atraso. */
  ping(callback: (ms: number) => void) {
    callback(0);
  }
}

/** Cria uma sala local nova e entra nela. */
export async function createLocal(name: string, options: unknown) {
  const room = await localServer.create(name, options);
  return new LocalRoom(room).join(options);
}

/** Entra numa sala local que já existe (a corrida de evento que o mundo local criou). */
export async function joinLocalById(roomId: string, options: unknown) {
  const room = localServer.rooms.get(roomId);
  if (!room) throw new Error(`Sala local não encontrada: ${roomId}`);
  return new LocalRoom(room).join(options);
}
