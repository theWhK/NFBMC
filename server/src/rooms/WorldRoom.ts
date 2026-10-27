import { Room, matchMaker, type Client, type CloseCode } from "colyseus";
import {
  DIFFICULTY_LABELS,
  FOOD,
  FOOD_PICKUP_RADIUS,
  MARKER_RADIUS,
  MAX_PLAYERS,
  NAME_MAX_LENGTH,
  POLICE,
  ROOM_NAME,
  TRAFFIC_KINDS,
  copsForStars,
  STANDS,
  STAND_RESPAWN_SECONDS,
  SPAWNS,
  collideWorld,
  isOnRoad,
  isRaceId,
  raceMarker,
  stepCar,
  pickColor,
  TRAFFIC_SIZE,
  carHalfSize,
  collideCars,
  DEFAULT_CAR,
  carSpec,
  createDrive,
  createPlayerDrive,
  isCarId,
  requestShift,
  CHALLENGE_SECONDS,
  atRace,
  type ChallengeInvite,
  type ChallengeMessage,
  type ChallengeReply,
  type RaceId,
  type DriveState,
  type ShiftMessage,
  type Difficulty,
  type DriveInput,
  type EventRaceOptions,
  type FoodKind,
  type GoRaceMessage,
  type InputMessage,
  type WorldJoinOptions,
} from "@nfbmc/shared";

import { clearPresence, setPresence } from "../presence.ts";
import { loadProfile, setCalories, type Profile } from "../profiles.ts";
import { copInput, createCopBrain, spawnPoint, type CopBrain } from "./cops.ts";
import { Cop, Npc, Stand, WorldPlayer, WorldState } from "./schema.ts";
import { realTimeSteps } from "./tick.ts";
import { Motions, carBody, readInput, resetToRoad } from "./vehicles.ts";
import { spawnTraffic, trafficInput, type TrafficBrain } from "./traffic.ts";

/** Carros do trânsito: alguns por jogador, até um limite, só por perto de quem joga. */
const TRAFFIC_PER_PLAYER = 16;
const MAX_TRAFFIC = 32;
const TRAFFIC_DESPAWN_DISTANCE = 300;
/** Cores discretas de carro de rua (os jogadores têm as cores vivas). */
const TRAFFIC_COLORS = ["#8a8f98", "#5b6470", "#d8d4c8", "#7a2e2e", "#2e4a6b", "#4a5a3a", "#c9b27a", "#3a3a3a"];

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

/** Desafio de um piloto para outro, esperando resposta. */
interface Invite {
  from: string;
  to: string;
  raceId: RaceId;
  expires: number;
}

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
  /** Motor e câmbio de cada carro (jogadores, viaturas e trânsito). */
  private drives = new Map<string, DriveState>();
  private motions = new Motions();
  private lastReset = new Map<string, number>();
  private lastHorn = new Map<string, number>();
  private profiles = new Map<string, Profile>();
  private respawnAt = new Map<Stand, number>();
  /** Quem já foi chamado para uma corrida (não entra em outra enquanto sai daqui). */
  private leaving = new Set<string>();
  private copBrains = new Map<string, CopBrain>();
  private copCount = 0;
  private trafficBrains = new Map<string, TrafficBrain>();
  private trafficCount = 0;
  /** Última batida em viatura por jogador (para não somar calor a cada tick do encosto). */
  private lastCopHit = new Map<string, number>();
  private time = 0;
  private joinCount = 0;
  /** Desafios diretos (co-op) esperando resposta, pelo id. */
  private invites = new Map<string, Invite>();
  private inviteCount = 0;

  messages = {
    input: (client: Client, message: InputMessage) => {
      const input = readInput(message);
      if (input) this.controls.set(client.sessionId, input);
    },
    horn: (client: Client) => {
      // Buzina: os outros ouvem (no máximo duas vezes por segundo).
      const last = this.lastHorn.get(client.sessionId) ?? -Infinity;
      if (this.time - last < 0.5) return;
      this.lastHorn.set(client.sessionId, this.time);
      this.broadcast("horn", { id: client.sessionId }, { except: client });
    },
    pause: (_client: Client, message: { paused?: unknown }) => {
      // Só sala de um jogador só; com mais gente, o jogo não para.
      if (this.state.pausable && typeof message?.paused === "boolean") this.state.paused = message.paused;
    },
    reset: (client: Client) => {
      // Voltar para a rua (quando empaca), no máximo a cada 3 s.
      const player = this.state.players.get(client.sessionId);
      const last = this.lastReset.get(client.sessionId) ?? -Infinity;
      if (!player || this.time - last < 3) return;
      this.lastReset.set(client.sessionId, this.time);
      resetToRoad(player);
      this.motions.reset(client.sessionId);
    },
    shift: (client: Client, message: ShiftMessage) => {
      const player = this.state.players.get(client.sessionId);
      const drive = this.drives.get(client.sessionId);
      if (player && drive && Number.isFinite(message?.direction)) requestShift(drive, carSpec(player.car), message.direction);
    },
    gearbox: (client: Client, message: { manual?: unknown }) => {
      const player = this.state.players.get(client.sessionId);
      const drive = this.drives.get(client.sessionId);
      if (!player || !drive || typeof message?.manual !== "boolean") return;
      player.manual = drive.manual = message.manual;
    },
    startRace: (client: Client, message: { raceId?: unknown; bots?: unknown; difficulty?: unknown }) => {
      this.startRace(client, message).catch((err) => console.error("Falha ao criar corrida", err));
    },
    challenge: (client: Client, message: Partial<ChallengeMessage>) => this.challenge(client, message),
    challengeReply: (client: Client, message: Partial<ChallengeReply>) => {
      this.replyChallenge(client, message).catch((err) => console.error("Falha ao criar o pega", err));
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
    this.state.pausable = this.maxClients === 1;
    this.setSimulationInterval(realTimeSteps((dt) => {
      if (!this.state.paused) this.update(dt);
    }));
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
    player.color = pickColor(options?.color, usedColors, this.joinCount);
    player.car = isCarId(options?.car) ? options.car : DEFAULT_CAR;
    player.manual = options?.manual === true;
    this.drives.set(client.sessionId, createPlayerDrive(carSpec(player.car), player.manual));

    if (isRaceId(options?.spawn)) {
      // Voltando de uma corrida: aparece no ponto de encontro dela, um pouco ao lado.
      const marker = raceMarker(options.spawn);
      player.x = marker.x + (Math.random() - 0.5) * 6;
      player.z = marker.z + (Math.random() - 0.5) * 6;
      player.heading = marker.heading;
    } else {
      // Nasce numa rua do centro, de frente para ela.
      const spawn = SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
      player.x = spawn.x + (Math.random() - 0.5) * 4;
      player.z = spawn.z + (Math.random() - 0.5) * 4;
      player.heading = spawn.heading;
    }
    this.state.players.set(client.sessionId, player);
    const where = this.state.solo ? (options?.story ? "story" : "solo") : "world";
    setPresence(this.roomId, client.sessionId, () => ({
      name: player.name, color: player.color, car: player.car, where, calories: player.calories,
    }));
  }

  onLeave(client: Client, _code: CloseCode) {
    clearPresence(this.roomId, client.sessionId);
    this.cancelInvites(client.sessionId, "saiu da cidade");
    this.state.players.delete(client.sessionId);
    this.controls.delete(client.sessionId);
    this.profiles.delete(client.sessionId);
    this.leaving.delete(client.sessionId);
    this.lastCopHit.delete(client.sessionId);
    this.drives.delete(client.sessionId);
    this.motions.delete(client.sessionId);
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
    const bots = typeof message.bots === "number" ? clamp(Math.round(message.bots), 0, MAX_PLAYERS - participants.length) : 3;
    await this.launchRace(participants, raceId, bots, isDifficulty(message.difficulty) ? message.difficulty : "medio");
  }

  /** Cria a sala da corrida (modo evento) e manda os participantes para lá. */
  private async launchRace(participants: string[], raceId: RaceId, bots: number, difficulty: Difficulty) {
    participants.forEach((id) => {
      this.leaving.add(id);
      this.cancelInvites(id, "foi para uma corrida");
    });
    const options: EventRaceOptions = { raceId, expected: participants.length, bots, difficulty };
    const room = await matchMaker.createRoom(ROOM_NAME, options);
    const go: GoRaceMessage = { roomId: room.roomId, raceId };
    for (const id of participants) this.clients.getById(id)?.send("goRace", go);
    // Se alguém não sair (fechou a aba no meio), libera de novo depois de um tempo.
    this.clock.setTimeout(() => participants.forEach((id) => this.leaving.delete(id)), 15_000);
  }

  // --- Co-op: desafio direto entre dois pilotos ------------------------------

  private notice(sessionId: string, text: string) {
    this.clients.getById(sessionId)?.send("notice", { text });
  }

  /** Por que este piloto não pode entrar num pega agora (null = pode). */
  private busyReason(sessionId: string, you: boolean) {
    const player = this.state.players.get(sessionId);
    if (!player || this.leaving.has(sessionId)) return you ? "Você já está indo para uma corrida." : "Esse piloto já está indo para uma corrida.";
    if (this.copsOf(sessionId).length > 0) {
      return you ? "Despiste a Vigilância Sanitária antes de desafiar alguém!" : `${player.name} está fugindo da Vigilância. Tente daqui a pouco.`;
    }
    return null;
  }

  private challenge(client: Client, message: Partial<ChallengeMessage>) {
    const from = client.sessionId;
    const to = message?.to;
    if (this.state.solo || typeof to !== "string" || to === from || !isRaceId(message?.raceId)) return;
    const target = this.state.players.get(to);
    if (!target) return;
    const busy = this.busyReason(from, true) ?? this.busyReason(to, false);
    if (busy) return this.notice(from, busy);
    const pending = [...this.invites.values()];
    if (pending.some((i) => i.from === from)) return this.notice(from, "Espere a resposta do desafio anterior.");
    if (pending.some((i) => i.to === to || i.from === to)) return this.notice(from, `${target.name} já tem um desafio na mesa.`);

    const id = `pega-${++this.inviteCount}`;
    const raceId = message.raceId;
    this.invites.set(id, { from, to, raceId, expires: this.time + CHALLENGE_SECONDS });
    const challenger = this.state.players.get(from)!;
    const invite: ChallengeInvite = { id, fromName: challenger.name, color: challenger.color, raceId, seconds: CHALLENGE_SECONDS };
    this.clients.getById(to)?.send("challenge", invite);
    this.notice(from, `Desafio enviado para ${target.name}!`);
  }

  private async replyChallenge(client: Client, message: Partial<ChallengeReply>) {
    const invite = typeof message?.id === "string" ? this.invites.get(message.id) : undefined;
    if (!invite || invite.to !== client.sessionId) return;
    this.invites.delete(message.id!);
    const target = this.state.players.get(invite.to);
    if (!message.accept) {
      this.notice(invite.from, `${target?.name ?? "O piloto"} amarelou! 🐔`);
      return;
    }
    const busy = this.busyReason(invite.from, false) ?? this.busyReason(invite.to, true);
    if (busy) {
      this.notice(invite.to, busy);
      this.notice(invite.from, `O pega não rolou: ${this.busyReason(invite.from, true) ?? this.busyReason(invite.to, false)}`);
      return;
    }
    this.notice(invite.from, `${target?.name} aceitou! Pega ${atRace(invite.raceId)}.`);
    // Pega é só entre os dois: sem bots.
    await this.launchRace([invite.from, invite.to], invite.raceId, 0, "medio");
  }

  /** Desfaz os desafios de um piloto (saiu, foi correr) e avisa o outro lado. */
  private cancelInvites(sessionId: string, why: string) {
    for (const [id, invite] of this.invites) {
      if (invite.from !== sessionId && invite.to !== sessionId) continue;
      this.invites.delete(id);
      const other = invite.from === sessionId ? invite.to : invite.from;
      const name = this.state.players.get(sessionId)?.name ?? "O piloto";
      if (other === invite.to) this.clients.getById(other)?.send("challengeGone", { id });
      this.notice(other, `${name} ${why}: desafio cancelado.`);
    }
  }

  private expireInvites() {
    for (const [id, invite] of this.invites) {
      if (this.time < invite.expires) continue;
      this.invites.delete(id);
      this.clients.getById(invite.to)?.send("challengeGone", { id });
      this.notice(invite.from, `${this.state.players.get(invite.to)?.name ?? "O piloto"} não respondeu o desafio.`);
    }
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
      const spec = carSpec(player.car);
      const drive = this.driveOf(sessionId, spec, player.manual, true);
      const motion = this.motions.get(sessionId);
      stepCar(player, drive, spec, input, dt, !isOnRoad(player.x, player.z), player.boost > 0, motion);
      const size = carHalfSize(player.car);
      collideWorld(player, size.halfLength, size.halfWidth, motion);
      player.rpm = Math.round(drive.rpm);
      player.gear = drive.gear;
      this.eat(sessionId, player);
    }

    this.driveCops(dt);
    this.driveTraffic(dt);

    // Batidas entre todos os carros (jogadores, viaturas e trânsito): caixas do
    // tamanho de cada um, com impulso pela massa e giro.
    const all: [string, WorldPlayer | Cop | Npc][] = [...cars, ...this.state.cops.entries(), ...this.state.traffic.entries()];
    // (Trânsito não tem carro da garagem: os ids dele começam com "npc-".)
    const bodies = all.map(([id, c]) => carBody(c, this.motions.get(id), id.startsWith("npc-") ? null : (c as WorldPlayer | Cop).car));
    for (const impact of collideCars(bodies)) {
      // Jogador batendo forte em viatura ou no trânsito esquenta a situação (sendo atingido, não).
      for (const [mine, other] of [[impact.a, impact.b], [impact.b, impact.a]]) {
        const [playerId, player] = all[mine];
        const target = all[other][1];
        if (!(player instanceof WorldPlayer) || target instanceof WorldPlayer) continue;
        if (Math.abs(player.speed) <= Math.abs(target.speed)) continue;
        if (target instanceof Cop && impact.speed > 6) this.hitCop(playerId, POLICE.heatPerHit);
        else if (target instanceof Npc && impact.speed > 12) this.hitCop(playerId, POLICE.heatPerTrafficHit);
      }
    }

    for (const [sessionId, player] of cars) this.updatePursuit(sessionId, player, dt);
    this.expireInvites();

    for (const [stand, at] of this.respawnAt) {
      if (this.time < at) continue;
      stand.active = true;
      this.respawnAt.delete(stand);
    }
  }

  private driveOf(id: string, spec: ReturnType<typeof carSpec>, manual = false, human = false) {
    let drive = this.drives.get(id);
    if (!drive) this.drives.set(id, (drive = human ? createPlayerDrive(spec, manual) : createDrive(spec, manual)));
    return drive;
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
      this.drives.delete(id);
      this.motions.delete(id);
    }
  }

  private hitCop(sessionId: string, heat: number) {
    const player = this.state.players.get(sessionId);
    const last = this.lastCopHit.get(sessionId) ?? -Infinity;
    if (!player || this.time - last < 1) return;
    this.lastCopHit.set(sessionId, this.time);
    player.heat = Math.min(POLICE.maxHeat, player.heat + heat);
  }

  // --- Trânsito --------------------------------------------------------------

  private removeTraffic(id: string) {
    this.state.traffic.delete(id);
    this.trafficBrains.delete(id);
    this.drives.delete(id);
    this.motions.delete(id);
  }

  private driveTraffic(dt: number) {
    const players = [...this.state.players.values()];
    // Sem ninguém na cidade, sem trânsito.
    if (players.length === 0) {
      for (const id of [...this.state.traffic.keys()]) this.removeTraffic(id);
      return;
    }

    // Some quem ficou longe de todo mundo; aparece carro novo (um por tick) se faltar.
    for (const [id, npc] of this.state.traffic) {
      const closest = Math.min(...players.map((p) => Math.hypot(p.x - npc.x, p.z - npc.z)));
      if (closest > TRAFFIC_DESPAWN_DISTANCE) this.removeTraffic(id);
    }
    const target = Math.min(MAX_TRAFFIC, TRAFFIC_PER_PLAYER * players.length);
    if (this.state.traffic.size < target) {
      const spawned = spawnTraffic(players);
      if (spawned) {
        const npc = new Npc();
        Object.assign(npc, spawned.car);
        npc.kind = TRAFFIC_KINDS[Math.floor(Math.random() * TRAFFIC_KINDS.length)];
        npc.color = TRAFFIC_COLORS[Math.floor(Math.random() * TRAFFIC_COLORS.length)];
        const id = `npc-${++this.trafficCount}`;
        this.state.traffic.set(id, npc);
        this.trafficBrains.set(id, spawned.brain);
      }
    }

    const everyone = [...players, ...this.state.cops.values(), ...this.state.traffic.values()];
    for (const [id, npc] of this.state.traffic) {
      const brain = this.trafficBrains.get(id)!;
      // Só os carros por perto importam para frear (evita olhar a cidade inteira).
      const nearby = everyone.filter((o) => o !== npc && Math.abs(o.x - npc.x) < 20 && Math.abs(o.z - npc.z) < 20);
      const input = trafficInput(brain, npc, nearby, dt);
      if (!input) {
        this.removeTraffic(id);
        continue;
      }
      // O trânsito anda num carro popular comum, com câmbio automático.
      const spec = carSpec("uno");
      const motion = this.motions.get(id);
      stepCar(npc, this.driveOf(id, spec), spec, input, dt, !isOnRoad(npc.x, npc.z), false, motion);
      collideWorld(npc, TRAFFIC_SIZE.length / 2, TRAFFIC_SIZE.width / 2, motion);
    }
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
      // De 4 estrelas para cima, a Vigilância manda a viatura tática (superesportiva).
      const stars = Math.floor(target.heat);
      cop.car = stars >= 4 ? "viatura-tatica" : "viatura";
      const spec = carSpec(cop.car);
      const { input, boost } = copInput(brain, cop, spec, target, stars, dt);
      cop.boost = boost ? 1 : 0;
      const motion = this.motions.get(id);
      stepCar(cop, this.driveOf(id, spec), spec, input, dt, !isOnRoad(cop.x, cop.z), boost, motion);
      const size = carHalfSize(cop.car);
      collideWorld(cop, size.halfLength, size.halfWidth, motion);
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
