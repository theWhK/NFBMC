// Colyseus "de mentira" para jogar sem internet: no build do cliente, o import
// "colyseus" das salas do servidor (server/src/rooms) aponta para cá (veja o
// vite.config.ts). Só o pedaço do Room que as salas usam, rodando no navegador:
// mensagens, relógio, simulação, broadcast e o matchMaker (o mundo cria a sala
// da corrida de evento). Quem conversa com a sala é o LocalRoom (local.ts).

export type CloseCode = number;

export interface Client {
  sessionId: string;
  send(type: string, message?: unknown): void;
  leave(code?: number): void;
}

type Handler = (client: Client, message: never) => void;

/** Lista de clientes com o `getById` do Colyseus. */
class ClientList extends Array<Client> {
  getById(sessionId: string) {
    return this.find((c) => c.sessionId === sessionId);
  }
}

export class Room<_Options = unknown> {
  state: unknown;
  clients = new ClientList();
  roomId = "";
  maxClients = Infinity;
  /** Mensagens que a sala aceita (o mesmo objeto `messages` das salas do servidor). */
  messages?: Record<string, Handler>;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private interval: ReturnType<typeof setInterval> | undefined;
  disposed = false;

  onCreate?(options?: unknown): void | Promise<void>;
  onJoin?(client: Client, options?: unknown): void | Promise<void>;
  onLeave?(client: Client, code: CloseCode): void | Promise<void>;
  onDispose?(): void | Promise<void>;

  clock = {
    setTimeout: (callback: () => void, ms: number) => {
      const id = setTimeout(() => {
        this.timers.delete(id);
        callback();
      }, ms);
      this.timers.add(id);
      return { clear: () => clearTimeout(id) };
    },
  };

  setPrivate(_value = true) {}
  lock() {}
  unlock() {}

  broadcast(type: string, message?: unknown, options?: { except?: Client }) {
    for (const client of [...this.clients]) if (client !== options?.except) client.send(type, message);
  }

  /** Mesmo contrato do Colyseus: chama `callback(msDesdeAÚltima)` a cada ~16 ms. */
  setSimulationInterval(callback: (deltaMs: number) => void, ms = 1000 / 60) {
    clearInterval(this.interval);
    let last = performance.now();
    this.interval = setInterval(() => {
      const now = performance.now();
      callback(now - last);
      last = now;
    }, ms);
  }

  disconnect() {
    for (const client of [...this.clients]) client.leave(4000);
    this.dispose();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.interval);
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    void this.onDispose?.();
    localServer.forget(this.roomId);
  }
}

type RoomClass = new () => Room;

/** As salas locais abertas (por id) e as classes registradas (por nome). */
export const localServer = {
  classes: new Map<string, RoomClass>(),
  rooms: new Map<string, Room>(),
  define(name: string, room: RoomClass) {
    this.classes.set(name, room);
  },
  async create(name: string, options: unknown) {
    const RoomClass = this.classes.get(name);
    if (!RoomClass) throw new Error(`Sala local desconhecida: ${name}`);
    const room = new RoomClass();
    room.roomId = `local-${name}-${Math.random().toString(36).slice(2, 10)}`;
    this.rooms.set(room.roomId, room);
    await room.onCreate?.(options);
    return room;
  },
  forget(roomId: string) {
    this.rooms.delete(roomId);
  },
};

export const matchMaker = {
  /** O mundo cria a sala da corrida de evento: aqui, mais uma sala local. */
  createRoom: async (name: string, options: unknown) => {
    const room = await localServer.create(name, options);
    return { roomId: room.roomId };
  },
};
