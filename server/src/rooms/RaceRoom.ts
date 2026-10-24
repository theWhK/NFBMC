import { Room, type Client, type CloseCode } from "colyseus";
import {
  CAR,
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
  TOTAL_LAPS,
  TRACK,
  nearestSample,
  pointOnTrack,
  stepCar,
  DIFFICULTY_LABELS,
  SOLO_DEFAULT_BOTS,
  type CreateOptions,
  type Difficulty,
  type DriveInput,
  type FoodKind,
  type InputMessage,
  type JoinOptions,
  type Phase,
} from "@nfbmc/shared";

import { BOT_NAMES, botInput, createBrain, type Brain, type FoodSpot } from "./bots.ts";
import { Food, Player, RaceState, Result } from "./schema.ts";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** A pista é dividida em setores; só conta a volta quem passou por todos, em ordem. */
const SECTORS = 4;
/** Até onde o carro pode ir antes de bater na "cerca" invisível do mapa. */
const WORLD_LIMIT = 220;

function sectorOf(index: number) {
  return Math.floor((index / TRACK.samples.length) * SECTORS);
}

/** Posição no grid de largada: duas colunas, atrás da linha de chegada. */
function gridSlot(slot: number) {
  const row = Math.floor(slot / 2);
  const side = slot % 2 === 0 ? 3.5 : -3.5;
  return pointOnTrack(TRACK, -8 - row * 7, side);
}

/** Comidas espalhadas pela pista: [metros a partir da largada, lado, tipo]. */
const FOOD_LAYOUT: [number, number, FoodKind][] = [];
for (let dist = 60, i = 0; dist < TRACK.length - 30; dist += 45, i++) {
  const kinds: FoodKind[] = ["fries", "burger", "soda"];
  const sides = [-4.5, 0, 4.5];
  FOOD_LAYOUT.push([dist, sides[i % 3], kinds[i % 3]]);
  // A cada três grupos, uma fileira com mais comida para disputar.
  if (i % 3 === 2) FOOD_LAYOUT.push([dist + 8, -4.5, "burger"]);
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
 * Sala de corrida. A sala pública é uma só, onde todo mundo cai; a sala solo é
 * privada, de um jogador contra bots. Fluxo: lobby (todos dirigem livres) →
 * alguém aperta "Começar" → contagem → corrida de TOTAL_LAPS voltas comendo o
 * que aparecer → resultado (calorias + bônus de colocação) → lobby de novo.
 *
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
  private joinCount = 0;

  messages = {
    input: (client: Client, message: InputMessage) => {
      if (!Number.isFinite(message?.throttle) || !Number.isFinite(message?.steer)) return;
      this.controls.set(client.sessionId, {
        throttle: clamp(message.throttle, -1, 1),
        steer: clamp(message.steer, -1, 1),
      });
    },
    start: () => {
      if (this.state.phase === "lobby" && this.state.players.size > 0) this.startCountdown();
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

  onCreate(options?: CreateOptions) {
    if (options?.solo) {
      // Sala solo: some da busca do "entrar" e só cabe quem criou.
      this.setPrivate(true);
      this.maxClients = 1;
      this.state.solo = true;
      this.state.botCount = SOLO_DEFAULT_BOTS;
    }
    for (const [dist, side, kind] of FOOD_LAYOUT) {
      const food = new Food();
      const point = pointOnTrack(TRACK, dist, side);
      food.kind = kind;
      food.x = point.x;
      food.z = point.z;
      this.state.foods.push(food);
    }
    this.setSimulationInterval((deltaMs) => this.update(Math.min(deltaMs, 100) / 1000));
  }

  onJoin(client: Client, options?: JoinOptions) {
    const player = new Player();
    this.joinCount++;
    player.name = sanitizeName(options?.name, `Jogador ${this.joinCount}`);

    const usedColors = new Set([...this.state.players.values()].map((p) => p.color));
    player.color = PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[0];

    this.placeOnGrid(player, this.state.players.size);
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client, _code: CloseCode) {
    this.state.players.delete(client.sessionId);
    this.controls.delete(client.sessionId);
    this.sectors.delete(client.sessionId);
  }

  private setPhase(phase: Phase, timer = 0) {
    this.state.phase = phase;
    this.state.timer = timer;
  }

  private placeOnGrid(player: Player, slot: number) {
    const spot = gridSlot(slot);
    player.x = spot.x;
    player.z = spot.z;
    player.heading = spot.heading;
    player.speed = 0;
  }

  private removeBots() {
    for (const id of this.brains.keys()) {
      this.state.players.delete(id);
      this.controls.delete(id);
      this.sectors.delete(id);
    }
    this.brains.clear();
  }

  /** Coloca os bots da próxima corrida, até completar o limite de carros. */
  private addBots() {
    this.removeBots();
    const humans = this.state.players.size;
    const count = Math.min(this.state.botCount, MAX_PLAYERS - humans);
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < count; i++) {
      const bot = new Player();
      bot.bot = true;
      bot.name = names[i % names.length];
      const usedColors = new Set([...this.state.players.values()].map((p) => p.color));
      bot.color = PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[i % PLAYER_COLORS.length];
      const id = `bot-${i}`;
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
    const foods: FoodSpot[] = FOOD_LAYOUT.map(([dist, side], i) => ({ dist, side, active: this.state.foods[i].active }));
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
      this.controls.set(id, botInput(brain, bot, dt, foods, others, pace));
    }
  }

  private drive(dt: number, cars: [string, Player][]) {
    const racing = this.state.phase === "racing";
    this.driveBots(dt);

    for (const [sessionId, player] of cars) {
      const input = this.controls.get(sessionId) ?? { throttle: 0, steer: 0 };
      const near = nearestSample(TRACK, player.x, player.z);
      const onGrass = near.distance > TRACK.width / 2 + 1;

      player.boost = Math.max(0, player.boost - dt);
      stepCar(player, input, dt, onGrass, player.boost > 0);

      if (Math.abs(player.x) > WORLD_LIMIT || Math.abs(player.z) > WORLD_LIMIT) {
        player.x = clamp(player.x, -WORLD_LIMIT, WORLD_LIMIT);
        player.z = clamp(player.z, -WORLD_LIMIT, WORLD_LIMIT);
        player.speed *= -0.3;
      }

      if (racing && !player.finished) {
        this.countLaps(sessionId, player);
        this.eat(player);
      }
    }

    this.bump(cars);
  }

  private countLaps(sessionId: string, player: Player) {
    const { index } = nearestSample(TRACK, player.x, player.z);
    const sector = sectorOf(index);
    const last = this.sectors.get(sessionId) ?? 0;

    if (sector === (last + 1) % SECTORS) {
      this.sectors.set(sessionId, sector);
      if (sector === 0) {
        player.lap++;
        if (player.lap > TOTAL_LAPS) {
          player.lap = TOTAL_LAPS;
          player.finished = true;
          player.finishTime = this.state.raceTime;
          if (!this.racers().some(([, p]) => p.finished && p !== player)) {
            this.state.timer = FINISH_GRACE_SECONDS;
          }
        }
      }
    }

    // Metros totais desde a largada. Antes de cruzar a linha (lap 0) fica negativo.
    const dist = TRACK.samples[index].dist;
    const lapsDone = player.lap - 1;
    player.progress = lapsDone * TRACK.length + (player.lap === 0 ? dist - TRACK.length : dist);
    // Se o carro voltou para trás da linha sem completar a volta, não ganha uma volta de presente.
    if (player.lap > 0 && sector === SECTORS - 1 && this.sectors.get(sessionId) !== SECTORS - 1) {
      player.progress -= TRACK.length;
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

  /** Carros que se encostam são empurrados para longe um do outro. */
  private bump(cars: [string, Player][]) {
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
