import { Room, type Client, type CloseCode } from "colyseus";
import {
  PLAYER_COLORS,
  PLAYER_SIZE,
  PLAYER_SPEED,
  WORLD,
  type InputMessage,
} from "@nfbmc/shared";

import { Player, RaceState } from "./schema.ts";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Hello world multiplayer: cada jogador é um quadrado. O cliente só manda a
 * direção desejada; quem move é o servidor (autoritativo), a cada tick.
 */
export class RaceRoom extends Room<{ state: RaceState }> {
  maxClients = 8;
  state = new RaceState();

  private directions = new Map<string, InputMessage>();
  private joinCount = 0;

  messages = {
    input: (client: Client, message: InputMessage) => {
      if (!Number.isFinite(message?.x) || !Number.isFinite(message?.y)) return;
      this.directions.set(client.sessionId, {
        x: clamp(message.x, -1, 1),
        y: clamp(message.y, -1, 1),
      });
    },
  };

  onCreate() {
    this.setSimulationInterval((deltaMs) => this.update(deltaMs));
  }

  onJoin(client: Client) {
    const player = new Player();
    player.x = Math.random() * (WORLD.width - PLAYER_SIZE);
    player.y = Math.random() * (WORLD.height - PLAYER_SIZE);
    player.color = PLAYER_COLORS[this.joinCount++ % PLAYER_COLORS.length];
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client, _code: CloseCode) {
    this.state.players.delete(client.sessionId);
    this.directions.delete(client.sessionId);
  }

  private update(deltaMs: number) {
    const step = (PLAYER_SPEED * deltaMs) / 1000;

    for (const [sessionId, input] of this.directions) {
      const player = this.state.players.get(sessionId);
      if (!player) continue;

      // Normaliza a diagonal para não andar mais rápido.
      const length = Math.hypot(input.x, input.y);
      if (length === 0) continue;
      const scale = step / Math.max(1, length);

      player.x = clamp(player.x + input.x * scale, 0, WORLD.width - PLAYER_SIZE);
      player.y = clamp(player.y + input.y * scale, 0, WORLD.height - PLAYER_SIZE);
    }
  }
}
