import { Room, matchMaker, type Client, type CloseCode } from "colyseus";
import {
  CAR,
  DIFFICULTY_LABELS,
  FOOD,
  FOOD_PICKUP_RADIUS,
  MARKER_RADIUS,
  MAX_PLAYERS,
  NAME_MAX_LENGTH,
  PLAYER_COLORS,
  ROOM_NAME,
  STANDS,
  STAND_RESPAWN_SECONDS,
  STREET_LINES,
  collideWorld,
  isOnRoad,
  isRaceId,
  raceMarker,
  stepCar,
  type Difficulty,
  type DriveInput,
  type EventRaceOptions,
  type FoodKind,
  type GoRaceMessage,
  type InputMessage,
  type WorldJoinOptions,
} from "@nfbmc/shared";

import { getProfile, type Profile } from "../profiles.ts";
import { Stand, WorldPlayer, WorldState } from "./schema.ts";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function sanitizeName(raw: unknown, fallback: string) {
  const name = typeof raw === "string"
    ? raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, NAME_MAX_LENGTH)
    : "";
  return name || fallback;
}

const isDifficulty = (value: unknown): value is Difficulty =>
  typeof value === "string" && value in DIFFICULTY_LABELS;

/**
 * Mundo aberto de Porto Gordo. Todo mundo circula pela mesma cidade, come nas
 * barraquinhas e para nos pontos de encontro para disparar corridas. A corrida
 * acontece numa sala própria (RaceRoom em modo evento); no fim, os jogadores
 * voltam para cá, no ponto de onde saíram.
 */
export class WorldRoom extends Room<{ state: WorldState }> {
  maxClients = 16;
  state = new WorldState();
  patchRate = 1000 / 30;

  private controls = new Map<string, DriveInput>();
  private profiles = new Map<string, Profile>();
  private respawnAt = new Map<Stand, number>();
  /** Quem já foi chamado para uma corrida (não entra em outra enquanto sai daqui). */
  private leaving = new Set<string>();
  private time = 0;
  private joinCount = 0;

  messages = {
    input: (client: Client, message: InputMessage) => {
      if (!Number.isFinite(message?.throttle) || !Number.isFinite(message?.steer)) return;
      this.controls.set(client.sessionId, {
        throttle: clamp(message.throttle, -1, 1),
        steer: clamp(message.steer, -1, 1),
      });
    },
    startRace: (client: Client, message: { raceId?: unknown; bots?: unknown; difficulty?: unknown }) => {
      this.startRace(client, message).catch((err) => console.error("Falha ao criar corrida", err));
    },
  };

  onCreate(options?: WorldJoinOptions) {
    if (options?.solo) {
      this.setPrivate(true);
      this.maxClients = 1;
      this.state.solo = true;
    }
    for (const spot of STANDS) {
      const stand = new Stand();
      stand.kind = spot.kind;
      stand.x = spot.x;
      stand.z = spot.z;
      this.state.stands.push(stand);
    }
    this.setSimulationInterval((deltaMs) => this.update(Math.min(deltaMs, 100) / 1000));
  }

  onJoin(client: Client, options?: WorldJoinOptions) {
    this.joinCount++;
    const name = sanitizeName(options?.name, `Jogador ${this.joinCount}`);
    const profile = getProfile(options?.token, name);
    this.profiles.set(client.sessionId, profile);
    client.send("profile", { token: profile.token });

    const player = new WorldPlayer();
    player.name = name;
    player.calories = profile.calories;
    const usedColors = new Set([...this.state.players.values()].map((p) => p.color));
    player.color = PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[this.joinCount % PLAYER_COLORS.length];

    if (isRaceId(options?.spawn)) {
      // Voltando de uma corrida: aparece no ponto de encontro dela, um pouco ao lado.
      const marker = raceMarker(options.spawn);
      player.x = marker.x + (Math.random() - 0.5) * 6;
      player.z = marker.z + (Math.random() - 0.5) * 6;
      player.heading = marker.heading;
    } else {
      // Nasce numa esquina do centro, de frente para uma rua.
      const x = STREET_LINES[3 + Math.floor(Math.random() * 2)];
      const z = STREET_LINES[3 + Math.floor(Math.random() * 2)] + (Math.random() < 0.5 ? -40 : 40);
      player.x = x + (Math.random() - 0.5) * 6;
      player.z = z;
      player.heading = z > 0 ? 0 : Math.PI;
    }
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client, _code: CloseCode) {
    this.state.players.delete(client.sessionId);
    this.controls.delete(client.sessionId);
    this.profiles.delete(client.sessionId);
    this.leaving.delete(client.sessionId);
  }

  /** Dispara a corrida do ponto de encontro e chama todo mundo que está nele. */
  private async startRace(client: Client, message: { raceId?: unknown; bots?: unknown; difficulty?: unknown }) {
    if (!isRaceId(message?.raceId) || this.leaving.has(client.sessionId)) return;
    const raceId = message.raceId;
    const marker = raceMarker(raceId);
    const near = (id: string) => {
      const p = this.state.players.get(id);
      return !!p && !this.leaving.has(id) && Math.hypot(p.x - marker.x, p.z - marker.z) <= MARKER_RADIUS;
    };
    if (!near(client.sessionId)) return;

    const participants = [...this.state.players.keys()].filter(near).slice(0, MAX_PLAYERS);
    participants.forEach((id) => this.leaving.add(id));
    const bots = typeof message.bots === "number" ? clamp(Math.round(message.bots), 0, MAX_PLAYERS - participants.length) : 3;
    const options: EventRaceOptions = {
      raceId,
      expected: participants.length,
      bots,
      difficulty: isDifficulty(message.difficulty) ? message.difficulty : "medio",
    };
    const room = await matchMaker.createRoom(ROOM_NAME, options);
    const go: GoRaceMessage = { roomId: room.roomId, raceId };
    for (const id of participants) this.clients.getById(id)?.send("goRace", go);
    // Se alguém não sair (fechou a aba no meio), libera de novo depois de um tempo.
    this.clock.setTimeout(() => participants.forEach((id) => this.leaving.delete(id)), 15_000);
  }

  private update(dt: number) {
    this.time += dt;
    const cars = [...this.state.players.entries()];

    for (const [sessionId, player] of cars) {
      // Quem está indo para uma corrida fica parado esperando.
      const input = this.leaving.has(sessionId)
        ? { throttle: -1, steer: 0 }
        : this.controls.get(sessionId) ?? { throttle: 0, steer: 0 };
      player.boost = Math.max(0, player.boost - dt);
      stepCar(player, input, dt, !isOnRoad(player.x, player.z), player.boost > 0);
      collideWorld(player);
      this.eat(sessionId, player);
    }

    // Carros que se encostam são empurrados para longe um do outro.
    const minDist = CAR.radius * 2;
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i][1];
        const b = cars[j][1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        if (dist >= minDist || dist === 0) continue;
        const push = (minDist - dist) / 2;
        a.x -= (dx / dist) * push;
        a.z -= (dz / dist) * push;
        b.x += (dx / dist) * push;
        b.z += (dz / dist) * push;
        a.speed *= 0.9;
        b.speed *= 0.9;
      }
    }

    for (const [stand, at] of this.respawnAt) {
      if (this.time < at) continue;
      stand.active = true;
      this.respawnAt.delete(stand);
    }
  }

  private eat(sessionId: string, player: WorldPlayer) {
    for (const stand of this.state.stands) {
      if (!stand.active) continue;
      if (Math.hypot(stand.x - player.x, stand.z - player.z) > FOOD_PICKUP_RADIUS) continue;
      const info = FOOD[stand.kind as FoodKind];
      player.calories += info.calories;
      player.boost = Math.max(player.boost, info.boostSeconds);
      const profile = this.profiles.get(sessionId);
      if (profile) profile.calories = player.calories;
      stand.active = false;
      this.respawnAt.set(stand, this.time + STAND_RESPAWN_SECONDS);
    }
  }
}
