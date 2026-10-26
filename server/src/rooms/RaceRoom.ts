import { Room, type Client, type CloseCode } from "colyseus";
import {
  COUNTDOWN_SECONDS,
  FINISH_GRACE_SECONDS,
  FOOD,
  FOOD_PICKUP_RADIUS,
  FOOD_RESPAWN_SECONDS,
  MAX_PLAYERS,
  NAME_MAX_LENGTH,
  PLACE_BONUS,
  PLAYER_COLORS,
  RESULTS_SECONDS,
  RACES,
  EVENT_JOIN_SECONDS,
  collideWorld,
  isOnRoad,
  isRaceId,
  nearestSample,
  pointOnTrack,
  stepCar,
  pickColor,
  carHalfSize,
  collideCars,
  DEFAULT_CAR,
  PLAYER_CARS,
  carSpec,
  createDrive,
  isCarId,
  requestShift,
  type DriveState,
  type ShiftMessage,
  DIFFICULTY_LABELS,
  SOLO_DEFAULT_BOTS,
  type CreateOptions,
  type EventRaceOptions,
  type Track,
  type WorldJoinOptions,
  type Difficulty,
  type DriveInput,
  type FoodKind,
  type InputMessage,
  type Phase,
} from "@nfbmc/shared";

import { clearPresence, setPresence } from "../presence.ts";
import { recordRace } from "../profiles.ts";
import { BOT_NAMES, botInput, createBrain, type Brain, type FoodSpot } from "./bots.ts";
import { Food, Player, RaceState, Result } from "./schema.ts";
import { realTimeSteps } from "./tick.ts";
import { Motions, carBody, readInput, resetToRoad } from "./vehicles.ts";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** A pista é dividida em setores; só conta a volta quem passou por todos, em ordem. */
const SECTORS = 4;

/** Comidas espalhadas pela pista: [metros a partir da largada, lado, tipo]. */
function foodLayout(track: Track) {
  const layout: [number, number, FoodKind][] = [];
  const kinds: FoodKind[] = ["fries", "burger", "soda"];
  const sides = [-4.5, 0, 4.5];
  for (let dist = 60, i = 0; dist < track.length - 30; dist += 45, i++) {
    layout.push([dist, sides[i % 3], kinds[i % 3]]);
    // A cada três grupos, uma fileira com mais comida para disputar.
    if (i % 3 === 2) layout.push([dist + 8, -4.5, "burger"]);
  }
  return layout;
}

function sanitizeName(raw: unknown, fallback: string) {
  const name = typeof raw === "string"
    ? raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, NAME_MAX_LENGTH)
    : "";
  return name || fallback;
}

const isDifficulty = (value: unknown): value is Difficulty =>
  typeof value === "string" && value in DIFFICULTY_LABELS;

/**
 * Sala de corrida, numa das pistas de Porto Gordo. Três jeitos de existir:
 * - pública (corrida rápida com a galera): uma só, onde todo mundo cai;
 * - solo: privada, de um jogador contra bots;
 * - evento: criada pelo mundo aberto quando alguém dispara uma corrida num
 *   ponto de encontro. Larga sozinha quando todo mundo chega e, no fim, manda
 *   todos de volta para o mundo.
 *
 * Fluxo: lobby (todos dirigem livres) → "Começar" → contagem → corrida comendo
 * o que aparecer → resultado (calorias + bônus de colocação) → lobby de novo.
 * O cliente só manda acelerar/virar; quem move os carros é o servidor.
 */
export class RaceRoom extends Room<{ state: RaceState }> {
  maxClients = MAX_PLAYERS;
  state = new RaceState();
  patchRate = 1000 / 30;

  private controls = new Map<string, DriveInput>();
  /** Último setor por onde o carro passou, para contar as voltas. */
  private sectors = new Map<string, number>();
  private respawnAt = new Map<Food, number>();
  private brains = new Map<string, Brain>();
  private tokens = new Map<string, string>();
  /** Motor e câmbio de cada carro (giro, marcha, acelerador). */
  private drives = new Map<string, DriveState>();
  private motions = new Motions();
  private lastReset = new Map<string, number>();
  private lastHorn = new Map<string, number>();
  private joinCount = 0;
  private track: Track = RACES.autodromo.track;
  private layout = foodLayout(this.track);
  /** Corrida de evento: quantos jogadores esperar e até quando. */
  private expected = 0;
  /** Rival do duelo do modo história (null = corrida normal). */
  private rival: { name: string; car: string; skill: number } | null = null;
  private age = 0;

  messages = {
    input: (client: Client, message: InputMessage) => {
      const input = readInput(message);
      if (input) this.controls.set(client.sessionId, input);
    },
    horn: (client: Client) => this.horn(client),
    reset: (client: Client) => {
      // Voltar para a pista (quando empaca), no máximo a cada 3 s.
      const player = this.state.players.get(client.sessionId);
      const last = this.lastReset.get(client.sessionId) ?? -Infinity;
      if (!player || this.age - last < 3) return;
      this.lastReset.set(client.sessionId, this.age);
      resetToRoad(player, this.track);
      this.motions.reset(client.sessionId);
    },
    start: () => {
      if (this.state.phase === "lobby" && this.state.players.size > 0) this.startCountdown();
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
    setBots: (_client: Client, message: { count?: unknown }) => {
      if (this.state.phase !== "lobby" || typeof message?.count !== "number") return;
      this.state.botCount = clamp(Math.round(message.count), 0, MAX_PLAYERS - 1);
    },
    setDifficulty: (_client: Client, message: { level?: unknown }) => {
      if (this.state.phase !== "lobby" || !isDifficulty(message?.level)) return;
      this.state.difficulty = message.level;
    },
  };

  onCreate(options?: CreateOptions & Partial<EventRaceOptions>) {
    const race = RACES[isRaceId(options?.raceId) ? options.raceId : "autodromo"];
    this.track = race.track;
    this.layout = foodLayout(this.track);
    this.state.raceId = race.id;
    this.state.laps = race.laps;

    if (options?.solo) {
      // Sala solo: some da busca do "entrar" e só cabe quem criou.
      this.setPrivate(true);
      this.maxClients = 1;
      this.state.solo = true;
      this.state.botCount = SOLO_DEFAULT_BOTS;
      const rival = options.rival;
      if (rival && typeof rival.name === "string" && carSpec(rival.car).id === rival.car && Number.isFinite(rival.skill)) {
        this.rival = { name: rival.name.slice(0, NAME_MAX_LENGTH + 4), car: rival.car, skill: clamp(rival.skill, 0.5, 1.05) };
        this.state.challenge = true;
        this.state.botCount = 1;
        this.state.difficulty = "dificil";
      }
    } else if (typeof options?.expected === "number" && options.expected > 0) {
      // Evento do mundo aberto: só entra quem foi chamado (pelo id da sala).
      this.setPrivate(true);
      this.expected = clamp(Math.round(options.expected), 1, MAX_PLAYERS);
      this.maxClients = this.expected;
      this.state.event = true;
      this.state.botCount = clamp(Math.round(options.bots ?? 0), 0, MAX_PLAYERS - 1);
      if (isDifficulty(options.difficulty)) this.state.difficulty = options.difficulty;
    }
    for (const [dist, side, kind] of this.layout) {
      const food = new Food();
      const point = pointOnTrack(this.track, dist, side);
      food.kind = kind;
      food.x = point.x;
      food.z = point.z;
      this.state.foods.push(food);
    }
    this.setSimulationInterval(realTimeSteps((dt) => this.update(dt)));
  }

  onJoin(client: Client, options?: WorldJoinOptions) {
    if (typeof options?.token === "string") this.tokens.set(client.sessionId, options.token);
    const player = new Player();
    this.joinCount++;
    player.name = sanitizeName(options?.name, `Jogador ${this.joinCount}`);

    const usedColors = new Set([...this.state.players.values()].map((p) => p.color));
    player.color = pickColor(options?.color, usedColors);
    player.car = isCarId(options?.car) ? options.car : DEFAULT_CAR;
    player.manual = options?.manual === true;
    this.drives.set(client.sessionId, createDrive(carSpec(player.car), player.manual));

    this.placeOnGrid(player, this.state.players.size);
    this.state.players.set(client.sessionId, player);
    const where = this.state.challenge ? "duel" : this.state.event ? "event" : this.state.solo ? "solo" : "race";
    setPresence(this.roomId, client.sessionId, () => ({
      name: player.name, color: player.color, car: player.car, where, raceId: this.state.raceId, calories: player.calories,
    }));
  }

  onLeave(client: Client, _code: CloseCode) {
    clearPresence(this.roomId, client.sessionId);
    this.state.players.delete(client.sessionId);
    this.controls.delete(client.sessionId);
    this.sectors.delete(client.sessionId);
    this.tokens.delete(client.sessionId);
    this.drives.delete(client.sessionId);
    this.motions.delete(client.sessionId);
  }

  /** Posição no grid de largada: duas colunas, atrás da linha de chegada. */
  private gridSlot(slot: number) {
    const row = Math.floor(slot / 2);
    const side = slot % 2 === 0 ? 3.5 : -3.5;
    return pointOnTrack(this.track, -8 - row * 7, side);
  }

  private sectorOf(index: number) {
    return Math.floor((index / this.track.samples.length) * SECTORS);
  }

  private setPhase(phase: Phase, timer = 0) {
    this.state.phase = phase;
    this.state.timer = timer;
  }

  private placeOnGrid(player: Player, slot: number) {
    const spot = this.gridSlot(slot);
    player.x = spot.x;
    player.z = spot.z;
    player.heading = spot.heading;
    player.speed = 0;
    player.gear = 1;
    player.rpm = carSpec(player.car).idleRpm;
  }

  private removeBots() {
    for (const id of this.brains.keys()) {
      this.state.players.delete(id);
      this.controls.delete(id);
      this.sectors.delete(id);
      this.drives.delete(id);
    }
    this.brains.clear();
  }

  /** Coloca os bots da próxima corrida, até completar o limite de carros. */
  private addBots() {
    this.removeBots();
    const humans = this.state.players.size;
    const count = Math.min(this.state.botCount, MAX_PLAYERS - humans);
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    // Carros dos bots perto do nível do melhor carro humano: um pouco abaixo no
    // fácil, igual no médio, acima no difícil. (O A3 do Bruno fica de fora.)
    const humanTier = Math.max(0, ...[...this.state.players.values()].map((p) => PLAYER_CARS.indexOf(p.car)));
    const offset = { facil: -3, medio: 0, dificil: 2 }[this.state.difficulty as Difficulty] ?? 0;
    const botCars = PLAYER_CARS.filter((id) => id !== "a3bruno");
    if (this.rival) {
      const bot = new Player();
      bot.bot = true;
      bot.name = this.rival.name;
      bot.car = this.rival.car;
      const usedColors = new Set([...this.state.players.values()].map((p) => p.color));
      bot.color = PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[1];
      const brain = createBrain("dificil");
      brain.skill = this.rival.skill;
      brain.greed = 0.6;
      this.drives.set("bot-0", createDrive(carSpec(bot.car)));
      this.state.players.set("bot-0", bot);
      this.brains.set("bot-0", brain);
      return;
    }
    for (let i = 0; i < count; i++) {
      const bot = new Player();
      bot.bot = true;
      bot.name = names[i % names.length];
      const usedColors = new Set([...this.state.players.values()].map((p) => p.color));
      bot.color = PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[i % PLAYER_COLORS.length];
      const tier = Math.round(humanTier + offset + (Math.random() * 3 - 1.5));
      bot.car = botCars[clamp(tier, 0, botCars.length - 1)];
      const id = `bot-${i}`;
      this.drives.set(id, createDrive(carSpec(bot.car)));
      this.state.players.set(id, bot);
      this.brains.set(id, createBrain(this.state.difficulty as Difficulty));
    }
  }

  private startCountdown() {
    this.addBots();
    // Bots largam na frente: quem joga sai de trás e tem que ultrapassar.
    const grid = [...this.state.players.entries()].sort(([, a], [, b]) => Number(b.bot) - Number(a.bot));
    let slot = 0;
    grid.forEach(([sessionId, player]) => {
      this.placeOnGrid(player, slot++);
      this.drives.set(sessionId, createDrive(carSpec(player.car), player.manual));
      this.motions.reset(sessionId);
      player.racing = true;
      player.lap = 0;
      player.progress = 0;
      player.place = slot;
      player.calories = 0;
      player.boost = 0;
      player.finished = false;
      player.finishTime = 0;
      // O grid fica antes da linha, no último setor: cruzar a linha começa a volta 1.
      this.sectors.set(sessionId, SECTORS - 1);
    });
    for (const food of this.state.foods) food.active = true;
    this.respawnAt.clear();
    this.state.raceTime = 0;
    this.setPhase("countdown", COUNTDOWN_SECONDS);
  }

  private racers() {
    return [...this.state.players.entries()].filter(([, p]) => p.racing);
  }

  private update(dt: number) {
    const phase = this.state.phase as Phase;
    this.age += dt;

    if (this.state.challenge && phase === "lobby") {
      // Duelo: larga assim que o jogador entra.
      if (this.state.players.size > 0) this.startCountdown();
      return;
    }

    if (this.state.event && phase === "lobby") {
      // Larga quando todo mundo chegou (ou cansou de esperar); sala abandonada fecha.
      const everyone = this.state.players.size >= this.expected;
      if (this.state.players.size > 0 && (everyone || this.age > EVENT_JOIN_SECONDS)) this.startCountdown();
      else if (this.age > EVENT_JOIN_SECONDS * 3) this.disconnect();
      return;
    }

    if (phase !== "lobby" && phase !== "results" && this.racers().length === 0) {
      // Todo mundo que estava correndo saiu.
      this.setPhase("lobby");
      return;
    }

    switch (phase) {
      case "lobby":
        this.drive(dt, [...this.state.players.entries()]);
        break;

      case "countdown":
        this.state.timer -= dt;
        if (this.state.timer <= 0) this.setPhase("racing");
        break;

      case "racing":
        this.state.raceTime += dt;
        this.drive(dt, this.racers());
        this.updateRace(dt);
        this.respawnFood();
        break;

      case "results":
        this.state.timer -= dt;
        this.drive(dt, [...this.state.players.entries()]);
        if (this.state.timer <= 0) {
          if (this.state.challenge) {
            // Duelo: fica no resultado até o jogador sair (uma corrida só).
            this.state.timer = Infinity;
            return;
          }
          if (this.state.event) {
            // Fim do evento: todo mundo volta para o mundo aberto.
            this.broadcast("backToWorld", { raceId: this.state.raceId });
            this.clock.setTimeout(() => this.disconnect(), 3000);
            this.state.timer = Infinity;
            return;
          }
          this.removeBots();
          this.state.players.forEach((p) => (p.racing = false));
          this.setPhase("lobby");
        }
        break;
    }
  }

  /** Os bots decidem o que "apertar" neste tick, como se fossem jogadores. */
  private driveBots(dt: number) {
    if (this.brains.size === 0) return;
    const foods: FoodSpot[] = this.layout.map(([dist, side], i) => ({ dist, side, active: this.state.foods[i].active }));
    // Ritmo: um pouco mais lento quando está muito na frente do humano mais
    // adiantado, um pouco mais rápido quando está muito atrás.
    const humans = [...this.state.players.values()].filter((p) => !p.bot && p.racing);
    const bestHuman = humans.length ? Math.max(...humans.map((p) => p.progress)) : null;
    for (const [id, brain] of this.brains) {
      const bot = this.state.players.get(id);
      if (!bot) continue;
      let pace = 1;
      if (bestHuman !== null && this.state.phase === "racing") {
        const lead = bot.progress - bestHuman;
        pace = lead > 120 ? 0.93 : lead < -150 ? 1.06 : 1;
      }
      const others = [...this.state.players.values()].filter((p) => p !== bot && p.racing);
      this.controls.set(id, botInput(brain, this.track, bot, carSpec(bot.car), dt, foods, others, pace));
    }
  }

  private drive(dt: number, cars: [string, Player][]) {
    const racing = this.state.phase === "racing";
    this.driveBots(dt);

    for (const [sessionId, player] of cars) {
      const input = this.controls.get(sessionId) ?? { throttle: 0, steer: 0 };
      const onGrass = !isOnRoad(player.x, player.z);

      player.boost = Math.max(0, player.boost - dt);
      const spec = carSpec(player.car);
      let drive = this.drives.get(sessionId);
      if (!drive) this.drives.set(sessionId, (drive = createDrive(spec, player.manual)));
      const motion = this.motions.get(sessionId);
      stepCar(player, drive, spec, input, dt, onGrass, player.boost > 0, motion);
      const size = carHalfSize(player.car);
      collideWorld(player, size.halfLength, size.halfWidth, motion);
      player.rpm = Math.round(drive.rpm);
      player.gear = drive.gear;

      if (racing && !player.finished) {
        this.countLaps(sessionId, player);
        this.eat(player);
      }
    }

    // Batidas entre carros: caixas do tamanho de cada um, com impulso e giro.
    collideCars(cars.map(([id, p]) => carBody(p, this.motions.get(id), p.car)));
  }

  /** Buzina: os outros jogadores ouvem (no máximo duas vezes por segundo). */
  private horn(client: Client) {
    const last = this.lastHorn.get(client.sessionId) ?? -Infinity;
    if (this.age - last < 0.5) return;
    this.lastHorn.set(client.sessionId, this.age);
    this.broadcast("horn", { id: client.sessionId }, { except: client });
  }

  private countLaps(sessionId: string, player: Player) {
    const { index } = nearestSample(this.track, player.x, player.z);
    const sector = this.sectorOf(index);
    const last = this.sectors.get(sessionId) ?? 0;

    if (sector === (last + 1) % SECTORS) {
      this.sectors.set(sessionId, sector);
      if (sector === 0) {
        player.lap++;
        if (player.lap > this.state.laps) {
          player.lap = this.state.laps;
          player.finished = true;
          player.finishTime = this.state.raceTime;
          if (!this.racers().some(([, p]) => p.finished && p !== player)) {
            this.state.timer = FINISH_GRACE_SECONDS;
          }
        }
      }
    }

    // Metros totais desde a largada. Antes de cruzar a linha (lap 0) fica negativo.
    const length = this.track.length;
    const dist = this.track.samples[index].dist;
    const lapsDone = player.lap - 1;
    player.progress = lapsDone * length + (player.lap === 0 ? dist - length : dist);
    // Se o carro voltou para trás da linha sem completar a volta, não ganha uma volta de presente.
    if (player.lap > 0 && sector === SECTORS - 1 && this.sectors.get(sessionId) !== SECTORS - 1) {
      player.progress -= length;
    }
  }

  private eat(player: Player) {
    for (const food of this.state.foods) {
      if (!food.active) continue;
      if (Math.hypot(food.x - player.x, food.z - player.z) > FOOD_PICKUP_RADIUS) continue;
      const info = FOOD[food.kind as FoodKind];
      player.calories += info.calories;
      player.boost = Math.max(player.boost, info.boostSeconds);
      food.active = false;
      this.respawnAt.set(food, this.state.raceTime + FOOD_RESPAWN_SECONDS);
    }
  }

  private respawnFood() {
    for (const [food, at] of this.respawnAt) {
      if (this.state.raceTime < at) continue;
      food.active = true;
      this.respawnAt.delete(food);
    }
  }

  private finishRace() {
    const rows: Result[] = [];
    this.racers().forEach(([sessionId, p]) => {
      const row = new Result();
      row.sessionId = sessionId;
      row.name = p.name;
      row.color = p.color;
      row.bot = p.bot;
      row.place = p.finished ? p.place : 0;
      row.calories = p.calories;
      // Só ganha bônus de colocação quem cruzou a chegada.
      row.bonus = p.finished ? (PLACE_BONUS[p.place - 1] ?? 0) : 0;
      row.total = p.calories + row.bonus;
      rows.push(row);
      // O que comeu e ganhou na corrida entra na conta do jogador no mundo aberto.
      if (!p.bot) recordRace(this.tokens.get(sessionId), row.total, p.finished && p.place === 1);
    });
    // Empate em calorias: quem chegou antes leva.
    rows.sort((a, b) => b.total - a.total || (a.place || 99) - (b.place || 99));
    this.state.results.clear();
    for (const row of rows) this.state.results.push(row);
    this.setPhase("results", RESULTS_SECONDS);
  }

  private updateRace(dt: number) {
    const racers = this.racers().map(([, p]) => p);
    racers.sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return a.finishTime - b.finishTime;
      return b.progress - a.progress;
    });
    racers.forEach((p, i) => (p.place = i + 1));

    const someoneFinished = racers.some((p) => p.finished);
    if (someoneFinished) this.state.timer -= dt;

    if (racers.every((p) => p.finished) || (someoneFinished && this.state.timer <= 0)) {
      this.finishRace();
    }
  }
}
