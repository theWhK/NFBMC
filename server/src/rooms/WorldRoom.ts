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
  POLICE,
  ROOM_NAME,
  copsForStars,
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

import { loadProfile, setCalories, type Profile } from "../profiles.ts";
import { copInput, createCopBrain, spawnPoint, type CopBrain } from "./cops.ts";
import { Cop, Stand, WorldPlayer, WorldState } from "./schema.ts";

/** Limite de viaturas na cidade, somando todos os jogadores. */
const MAX_COPS = 12;
/** Ganchos só para os testes e2e (nunca ligados em produção). */
const TEST_HOOKS = process.env.NFBMC_TEST_HOOKS === "1";

export interface PursuitMessage {
  result: "escaped" | "busted";
  calories: number;
}

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
  private copBrains = new Map<string, CopBrain>();
  private copCount = 0;
  /** Última batida em viatura por jogador (para não somar calor a cada tick do encosto). */
  private lastCopHit = new Map<string, number>();
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
    ...(TEST_HOOKS && {
      debugHeat: (client: Client, message: { heat?: unknown }) => {
        const player = this.state.players.get(client.sessionId);
        if (player && typeof message?.heat === "number") player.heat = Math.min(POLICE.maxHeat, Math.max(0, message.heat));
      },
      debugCalories: (client: Client, message: { calories?: unknown }) => {
        const player = this.state.players.get(client.sessionId);
        if (!player || typeof message?.calories !== "number") return;
        player.calories = Math.max(0, Math.round(message.calories));
        this.syncProfile(client.sessionId, player);
      },
    }),
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

  async onJoin(client: Client, options?: WorldJoinOptions) {
    this.joinCount++;
    const name = sanitizeName(options?.name, `Jogador ${this.joinCount}`);
    const profile = await loadProfile(options?.token, name);
    this.profiles.set(client.sessionId, profile);
    client.send("profile", { token: profile.token, races: profile.races, wins: profile.wins, bestRace: profile.bestRace });

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
    this.lastCopHit.delete(client.sessionId);
    this.removeCops(client.sessionId);
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
    if (this.copsOf(client.sessionId).length > 0) {
      client.send("notice", { text: "Despiste a Vigilância Sanitária antes de correr!" });
      return;
    }

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

    this.driveCops(dt);

    // Carros (jogadores e viaturas) que se encostam são empurrados para longe um do outro.
    const all: [string, WorldPlayer | Cop][] = [...cars, ...this.state.cops.entries()];
    const minDist = CAR.radius * 2;
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i][1];
        const b = all[j][1];
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
        // Jogador batendo em viatura esquenta a situação (a viatura batendo nele, não).
        const [player, playerId, cop] = a instanceof Cop
          ? (b instanceof Cop ? [null, "", null] : [b, all[j][0], a])
          : b instanceof Cop ? [a, all[i][0], b] : [null, "", null];
        if (player && cop && Math.abs(player.speed) > 10 && Math.abs(player.speed) > Math.abs(cop.speed)) this.hitCop(playerId);
      }
    }

    for (const [sessionId, player] of cars) this.updatePursuit(sessionId, player, dt);

    for (const [stand, at] of this.respawnAt) {
      if (this.time < at) continue;
      stand.active = true;
      this.respawnAt.delete(stand);
    }
  }

  private syncProfile(sessionId: string, player: WorldPlayer) {
    const profile = this.profiles.get(sessionId);
    if (profile) setCalories(profile, player.calories);
  }

  // --- Vigilância Sanitária --------------------------------------------------

  private copsOf(sessionId: string) {
    return [...this.state.cops.entries()].filter(([, cop]) => cop.target === sessionId);
  }

  private removeCops(sessionId: string) {
    for (const [id] of this.copsOf(sessionId)) {
      this.state.cops.delete(id);
      this.copBrains.delete(id);
    }
  }

  private hitCop(sessionId: string) {
    const player = this.state.players.get(sessionId);
    const last = this.lastCopHit.get(sessionId) ?? -Infinity;
    if (!player || this.time - last < 1) return;
    this.lastCopHit.set(sessionId, this.time);
    player.heat = Math.min(POLICE.maxHeat, player.heat + POLICE.heatPerHit);
  }

  private driveCops(dt: number) {
    for (const [id, cop] of this.state.cops) {
      const target = this.state.players.get(cop.target);
      const brain = this.copBrains.get(id);
      if (!target || !brain) {
        this.state.cops.delete(id);
        this.copBrains.delete(id);
        continue;
      }
      const { input, boost } = copInput(brain, cop, target, Math.floor(target.heat), dt);
      cop.boost = boost ? 1 : 0;
      stepCar(cop, input, dt, !isOnRoad(cop.x, cop.z), boost);
      collideWorld(cop);
    }
  }

  /** Nível de procurado, viaturas, fuga e autuação de um jogador. */
  private updatePursuit(sessionId: string, player: WorldPlayer, dt: number) {
    const stars = Math.floor(player.heat);
    let cops = this.copsOf(sessionId);

    // Viaturas que faltam para o nível atual.
    const wanted = this.leaving.has(sessionId) ? 0 : copsForStars(stars);
    while (cops.length < wanted && this.state.cops.size < MAX_COPS) {
      const cop = new Cop();
      const spot = spawnPoint(player.x, player.z);
      cop.x = spot.x;
      cop.z = spot.z;
      cop.heading = spot.heading;
      cop.target = sessionId;
      const id = `cop-${++this.copCount}`;
      this.state.cops.set(id, cop);
      this.copBrains.set(id, createCopBrain());
      if (cops.length === 0) player.chased = true;
      cops = this.copsOf(sessionId);
    }

    if (cops.length === 0) {
      player.chased = false;
      player.escape = 0;
      player.bust = 0;
      if (stars === 0) player.heat = Math.max(0, player.heat - POLICE.heatDecayPerSecond * dt);
      return;
    }

    const nearest = Math.min(...cops.map(([, c]) => Math.hypot(c.x - player.x, c.z - player.z)));

    // Perseguição x fuga: longe de todas as viaturas por um tempo = escapou.
    if (player.chased) {
      player.heat = Math.min(POLICE.maxHeat, player.heat + POLICE.heatPerSecondChased * dt);
      player.escape = Math.max(0, player.escape - dt * 0.5);
      if (nearest > POLICE.sightRadius) player.chased = false;
    } else {
      player.escape += dt / (POLICE.escapeSeconds + stars);
      if (nearest < POLICE.reacquireRadius) player.chased = true;
    }

    // Autuação: viatura colada e jogador (quase) parado.
    const pinned = nearest < POLICE.bustRadius && Math.abs(player.speed) < POLICE.bustSpeed;
    player.bust = pinned ? player.bust + dt / POLICE.bustSeconds : Math.max(0, player.bust - dt);

    if (player.escape >= 1) {
      const bonus = POLICE.escapeBonusPerStar * Math.max(1, stars);
      player.calories += bonus;
      this.endPursuit(sessionId, player, { result: "escaped", calories: bonus });
    } else if (player.bust >= 1) {
      const lost = Math.floor(player.calories * POLICE.bustPenalty);
      player.calories -= lost;
      player.speed = 0;
      this.endPursuit(sessionId, player, { result: "busted", calories: lost });
    }
  }

  private endPursuit(sessionId: string, player: WorldPlayer, message: PursuitMessage) {
    player.heat = 0;
    player.chased = false;
    player.escape = 0;
    player.bust = 0;
    this.removeCops(sessionId);
    this.syncProfile(sessionId, player);
    this.clients.getById(sessionId)?.send("pursuit", message);
  }

  private eat(sessionId: string, player: WorldPlayer) {
    for (const stand of this.state.stands) {
      if (!stand.active) continue;
      if (Math.hypot(stand.x - player.x, stand.z - player.z) > FOOD_PICKUP_RADIUS) continue;
      const info = FOOD[stand.kind as FoodKind];
      player.calories += info.calories;
      player.boost = Math.max(player.boost, info.boostSeconds);
      this.syncProfile(sessionId, player);
      // Comer na rua chama a atenção da Vigilância Sanitária.
      player.heat = Math.min(POLICE.maxHeat, player.heat + POLICE.heatPerStand);
      stand.active = false;
      this.respawnAt.set(stand, this.time + STAND_RESPAWN_SECONDS);
    }
  }
}
