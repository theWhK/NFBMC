import { Room, type Client, type CloseCode } from "colyseus";
import {
  COUNTDOWN_SECONDS,
  FINISH_CAM_SECONDS,
  FINISH_GRACE_SECONDS,
  MAX_PLAYERS,
  NAME_MAX_LENGTH,
  PLAYER_COLORS,
  RESULTS_SECONDS,
  RACES,
  EVENT_JOIN_SECONDS,
  collideWorld,
  isOnRoad,
  keepInCorridor,
  trackCorridor,
  isRaceId,
  raceCalories,
  raceCash,
  sanitizeTune,
  tunedSpec,
  nearestSample,
  pointOnTrack,
  gradeAt,
  stepCar,
  pickColor,
  carHalfSize,
  collideCars,
  DEFAULT_CAR,
  PLAYER_CARS,
  carSpec,
  createDrive,
  createPlayerDrive,
  isCarId,
  requestShift,
  type CarSpec,
  type DriveState,
  type ShiftMessage,
  type Tune,
  DIFFICULTY_LABELS,
  SOLO_DEFAULT_BOTS,
  type CreateOptions,
  type DragInfo,
  type RadarMedal,
  DRAG_AUTO_LAUNCH,
  DRAG_GRACE_SECONDS,
  RADAR_MEDAL_CASH,
  dragDistance,
  dragPoint,
  freeRev,
  gradeLaunch,
  gradeShift,
  launchZone,
  radarGoals,
  radarMedal,
  shiftPoint,
  type EventRaceOptions,
  type Track,
  type WorldJoinOptions,
  type Difficulty,
  type DriveInput,
  type InputMessage,
  type Phase,
} from "@nfbmc/shared";

import { clearPresence, setPresence } from "../presence.ts";
import { recordRace } from "../profiles.ts";
import { BOT_NAMES, botInput, createBrain, type Brain } from "./bots.ts";
import {
  createDragBrain,
  createDragCar,
  dragBotRev,
  dragBotShift,
  dragSteer,
  dragTraction,
  type DragBrain,
  type DragCar,
} from "./drag.ts";
import { Player, RaceState, Result } from "./schema.ts";
import { realTimeSteps } from "./tick.ts";
import { Motions, Nitros, carBody, readInput, resetToRoad } from "./vehicles.ts";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** A pista é dividida em setores; só conta a volta quem passou por todos, em ordem. */
const SECTORS = 4;

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
 * Fluxo: lobby (todos dirigem livres) → "Começar" → contagem → corrida →
 * resultado (calorias queimadas e prêmio em dinheiro pela colocação) → lobby de novo.
 * O cliente só manda acelerar/virar; quem move os carros é o servidor.
 */
const TEST_HOOKS = process.env.NFBMC_TEST_HOOKS === "1";

export class RaceRoom extends Room<{ state: RaceState }> {
  maxClients = MAX_PLAYERS;
  state = new RaceState();
  patchRate = 1000 / 30;

  private controls = new Map<string, DriveInput>();
  /** Último setor por onde o carro passou, para contar as voltas. */
  private sectors = new Map<string, number>();
  private brains = new Map<string, Brain>();
  private tokens = new Map<string, string>();
  /** Motor e câmbio de cada carro (giro, marcha, acelerador). */
  private drives = new Map<string, DriveState>();
  private motions = new Motions();
  /** Peças de cada carro (tunagem) e a ficha já com elas. */
  private tunes = new Map<string, Tune>();
  private specs = new Map<string, CarSpec>();
  private nitros = new Nitros();
  private lastReset = new Map<string, number>();
  private lastHorn = new Map<string, number>();
  private joinCount = 0;
  private track: Track = RACES.autodromo.track;
  /** Speedtrap: distância de cada radar numa volta (vazio nas corridas normais). */
  private radars: number[] = [];
  /** Arrancada: largada, distância e faixas (null nas outras corridas), e o estado de cada carro. */
  private drag: DragInfo | null = null;
  private dragCars = new Map<string, DragCar>();
  private dragBrains = new Map<string, DragBrain>();
  /** Todos os humanos chegaram: a corrida acaba neste instante (depois da câmera de chegada). */
  private finishCamUntil = Infinity;
  /** Corrida de evento: quantos jogadores esperar e até quando. */
  private expected = 0;
  /** Rival do duelo do modo história (null = corrida normal). */
  private rival: { name: string; car: string; skill: number; tune: Tune } | null = null;
  private age = 0;

  messages = {
    input: (client: Client, message: InputMessage) => {
      const input = readInput(message);
      if (input) this.controls.set(client.sessionId, input);
    },
    horn: (client: Client) => this.horn(client),
    // Ganchos dos testes (só com NFBMC_TEST_HOOKS=1): cruzar a chegada e passar num radar.
    ...(TEST_HOOKS && {
      debugFinish: (client: Client) => {
        const player = this.state.players.get(client.sessionId);
        if (!player || !player.racing || player.finished || this.state.phase !== "racing") return;
        player.lap = this.state.laps;
        player.progress = this.state.laps * this.track.length;
        player.finished = true;
        player.finishTime = this.state.raceTime;
        if (!this.racers().some(([, p]) => p.finished && p !== player)) this.state.timer = this.drag ? DRAG_GRACE_SECONDS : FINISH_GRACE_SECONDS;
        if (this.racers().every(([, p]) => p.bot || p.finished)) this.finishCamUntil = this.state.raceTime + FINISH_CAM_SECONDS;
      },
      debugRadar: (client: Client, message: { speed?: unknown }) => {
        const player = this.state.players.get(client.sessionId);
        if (!player || !this.radars.length || this.state.phase !== "racing" || typeof message?.speed !== "number") return;
        const lap = Math.floor(player.traps / this.radars.length);
        player.progress = lap * this.track.length + this.radars[player.traps % this.radars.length] + 1;
        player.speed = message.speed;
        this.checkRadar(player);
      },
    }),
    pause: (_client: Client, message: { paused?: unknown }) => {
      // Só sala de um jogador só; com mais gente, o jogo não para.
      if (this.state.pausable && typeof message?.paused === "boolean") this.state.paused = message.paused;
    },
    reset: (client: Client) => {
      // Voltar para a pista (quando empaca), no máximo a cada 3 s.
      const player = this.state.players.get(client.sessionId);
      const last = this.lastReset.get(client.sessionId) ?? -Infinity;
      // Na arrancada não tem como sair da faixa (e voltar para a "rua" seria trapaça).
      if (!player || this.drag || this.age - last < 3) return;
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
      if (!player || !drive || !Number.isFinite(message?.direction)) return;
      if (this.drag) this.dragShift(client.sessionId, player, message.direction);
      else requestShift(drive, this.specOf(client.sessionId, player), message.direction);
    },
    gearbox: (client: Client, message: { manual?: unknown }) => {
      const player = this.state.players.get(client.sessionId);
      const drive = this.drives.get(client.sessionId);
      // Na arrancada o câmbio é sempre manual.
      if (!player || !drive || this.drag || typeof message?.manual !== "boolean") return;
      player.manual = drive.manual = message.manual;
    },
    setBots: (_client: Client, message: { count?: unknown }) => {
      if (this.state.phase !== "lobby" || typeof message?.count !== "number") return;
      this.state.botCount = clamp(Math.round(message.count), 0, this.maxCars() - 1);
    },
    setDifficulty: (_client: Client, message: { level?: unknown }) => {
      if (this.state.phase !== "lobby" || !isDifficulty(message?.level)) return;
      this.state.difficulty = message.level;
    },
  };

  onCreate(options?: CreateOptions & Partial<EventRaceOptions>) {
    const race = RACES[isRaceId(options?.raceId) ? options.raceId : "autodromo"];
    this.track = race.track;
    this.state.raceId = race.id;
    this.state.laps = race.laps;
    this.state.kind = race.kind ?? "circuito";
    this.radars = race.radars ?? [];
    this.drag = race.drag ?? null;
    // Barreiras: calcula o corredor já na criação (o rodoanel leva ~0,1 s). A
    // arrancada não precisa: a direção é automática, cada um na sua faixa.
    if (!this.drag) trackCorridor(this.track);

    if (options?.solo) {
      // Sala solo: some da busca do "entrar" e só cabe quem criou.
      this.setPrivate(true);
      this.maxClients = 1;
      this.state.solo = true;
      this.state.botCount = SOLO_DEFAULT_BOTS;
      const rival = options.rival;
      if (rival && typeof rival.name === "string" && carSpec(rival.car).id === rival.car && Number.isFinite(rival.skill)) {
        this.rival = {
          name: rival.name.slice(0, NAME_MAX_LENGTH + 4), car: rival.car, skill: clamp(rival.skill, 0.5, 1.05), tune: sanitizeTune(rival.tune),
        };
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
    if (this.state.kind === "radar") {
      // Speedtrap é desafio solo, contra as metas: sem bots e sem mais ninguém na sala.
      this.state.botCount = 0;
      if (!this.state.event) {
        this.setPrivate(true);
        this.maxClients = 1;
        this.state.solo = true;
      }
    } else if (this.drag) {
      // Arrancada: dois carros lado a lado (o outro é bot, se não tiver mais ninguém).
      this.maxClients = Math.min(this.maxClients, 2);
      if (!this.state.event) this.state.botCount = 1;
    }
    this.state.pausable = this.maxClients === 1;
    this.setSimulationInterval(realTimeSteps((dt) => {
      if (!this.state.paused) this.update(dt);
    }));
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
    const tune = sanitizeTune(options?.tune);
    this.tunes.set(client.sessionId, tune);
    this.specs.set(client.sessionId, tunedSpec(carSpec(player.car), tune));
    this.nitros.fill(client.sessionId, tune);
    this.drives.set(client.sessionId, createPlayerDrive(this.specOf(client.sessionId, player), player.manual));

    this.placeOnGrid(player, this.state.players.size, client.sessionId);
    this.state.players.set(client.sessionId, player);
    this.updateGoals();
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
    this.tunes.delete(client.sessionId);
    this.specs.delete(client.sessionId);
    this.nitros.delete(client.sessionId);
    this.dragCars.delete(client.sessionId);
  }

  /** Quantos carros cabem numa largada (a arrancada é de dois). */
  private maxCars() {
    return this.drag ? 2 : MAX_PLAYERS;
  }

  /** Ficha do carro (com a tunagem, se tiver). */
  private specOf(id: string, player: Player) {
    return this.specs.get(id) ?? carSpec(player.car);
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

  private placeOnGrid(player: Player, slot: number, id?: string) {
    if (this.drag && id) {
      // Arrancada: cada um na sua faixa, com o bico na linha de largada.
      const lane = this.drag.lanes[slot % this.drag.lanes.length];
      const spot = dragPoint(this.track, this.drag.start - carHalfSize(player.car).halfLength, lane);
      player.x = spot.x;
      player.z = spot.z;
      player.heading = spot.heading;
      player.speed = 0;
      player.gear = 0;
      player.rpm = carSpec(player.car).idleRpm;
      this.dragCars.set(id, createDragCar(lane));
      const [lo, hi] = launchZone(this.specOf(id, player));
      player.zoneLo = lo;
      player.zoneHi = hi;
      player.shiftRpm = Math.round(shiftPoint(this.specOf(id, player), 1));
      return;
    }
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
      this.tunes.delete(id);
      this.specs.delete(id);
      this.dragCars.delete(id);
    }
    this.brains.clear();
    this.dragBrains.clear();
  }

  /** Coloca os bots da próxima corrida, até completar o limite de carros. */
  private addBots() {
    this.removeBots();
    const humans = this.state.players.size;
    // Speedtrap: sem bots (é contra as metas).
    const count = this.state.kind === "radar" ? 0 : Math.min(this.state.botCount, this.maxCars() - humans);
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
      // O rival também mexeu no carro (shared/src/tuning.ts, rivalTune).
      this.tunes.set("bot-0", this.rival.tune);
      this.specs.set("bot-0", tunedSpec(carSpec(bot.car), this.rival.tune));
      this.drives.set("bot-0", createDrive(this.specOf("bot-0", bot)));
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
      if (this.drag) this.dragBrains.set(id, createDragBrain(this.state.difficulty as Difficulty, carSpec(bot.car)));
    }
  }

  private startCountdown() {
    this.addBots();
    // Bots largam na frente: quem joga sai de trás e tem que ultrapassar.
    const grid = [...this.state.players.entries()].sort(([, a], [, b]) => Number(b.bot) - Number(a.bot));
    let slot = 0;
    grid.forEach(([sessionId, player]) => {
      this.placeOnGrid(player, slot++, sessionId);
      const spec = this.specOf(sessionId, player);
      this.drives.set(sessionId, player.bot ? createDrive(spec, !!this.drag) : createPlayerDrive(spec, player.manual || !!this.drag));
      if (this.drag) player.manual = true;
      this.motions.reset(sessionId);
      // Largada com o cilindro de nitro cheio.
      this.nitros.fill(sessionId, this.tunes.get(sessionId));
      player.racing = true;
      player.lap = 0;
      player.progress = 0;
      player.place = slot;
      player.calories = 0;
      player.boost = 0;
      player.finished = false;
      player.finishTime = 0;
      player.trapTotal = 0;
      player.traps = 0;
      player.lastTrap = 0;
      player.launched = false;
      player.reaction = 0;
      player.jumped = false;
      player.launchGrade = "";
      player.shiftGrade = "";
      player.shifts = 0;
      // O grid fica antes da linha, no último setor: cruzar a linha começa a volta 1.
      this.sectors.set(sessionId, SECTORS - 1);
    });
    this.state.raceTime = 0;
    this.finishCamUntil = Infinity;
    this.updateGoals();
    this.setPhase("countdown", COUNTDOWN_SECONDS);
  }

  /**
   * Speedtrap: metas pela conta da pista com o carro de quem corre (a ficha de
   * fábrica: a tunagem ajuda a bater). Sala solo, então é o carro do único humano.
   */
  private updateGoals() {
    if (this.state.kind !== "radar") return;
    const human = [...this.state.players.values()].find((p) => !p.bot);
    if (!human) return;
    const goals = radarGoals(this.track, this.radars, this.state.laps, carSpec(human.car));
    this.state.goalBronze = goals.bronze;
    this.state.goalSilver = goals.prata;
    this.state.goalGold = goals.ouro;
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
        // Arrancada: na contagem dá para acelerar parado (e queimar a largada).
        if (this.drag) this.driveDrag(dt, this.racers());
        if (this.state.timer <= 0) this.setPhase("racing");
        break;

      case "racing":
        this.state.raceTime += dt;
        this.drive(dt, this.racers());
        this.updateRace(dt);
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
      this.controls.set(id, botInput(brain, this.track, bot, this.specOf(id, bot), dt, others, pace));
    }
  }

  private drive(dt: number, cars: [string, Player][]) {
    if (this.drag) return this.driveDrag(dt, cars);
    const racing = this.state.phase === "racing";
    this.driveBots(dt);

    for (const [sessionId, player] of cars) {
      const input = this.controls.get(sessionId) ?? { throttle: 0, steer: 0 };
      const onGrass = !isOnRoad(player.x, player.z);

      const spec = this.specOf(sessionId, player);
      let drive = this.drives.get(sessionId);
      if (!drive) this.drives.set(sessionId, (drive = player.bot ? createDrive(spec) : createPlayerDrive(spec, player.manual)));
      const motion = this.motions.get(sessionId);
      // Nitro só durante a corrida (no lobby e na contagem fica guardado).
      const nitro = this.nitros.step(sessionId, this.tunes.get(sessionId), this.state.phase === "racing" ? input : { ...input, nitro: false }, player, dt);
      player.boost = nitro.power > 0 ? 1 : 0;
      player.nitro = nitro.fill;
      stepCar(player, drive, spec, input, dt, onGrass, nitro.power, motion, gradeAt(player.x, player.z, player.heading));
      const size = carHalfSize(player.car);
      collideWorld(player, size.halfLength, size.halfWidth, motion);
      // Barreiras da corrida: ninguém sai do traçado (shared/src/barriers.ts).
      keepInCorridor(player, this.track, size.halfWidth, motion);
      player.rpm = Math.round(drive.rpm);
      player.gear = drive.gear;

      if (racing && !player.finished) this.countLaps(sessionId, player);
    }

    // Batidas entre carros: caixas do tamanho de cada um, com impulso e giro.
    collideCars(cars.map(([id, p]) => ({ ...carBody(p, this.motions.get(id), p.car), mass: this.specOf(id, p).mass })));
  }

  // --- Arrancada --------------------------------------------------------------

  /**
   * Arrancada: parado na linha, o motor gira solto (dá para segurar o giro na
   * faixa verde). Soltou a embreagem (E), o carro sai reto na faixa dele, com
   * a direção automática: quem joga só acelera, freia e troca de marcha.
   */
  private driveDrag(dt: number, cars: [string, Player][]) {
    const drag = this.drag!;
    const phase = this.state.phase as Phase;
    for (const [id, player] of cars) {
      const spec = this.specOf(id, player);
      let drive = this.drives.get(id);
      if (!drive) this.drives.set(id, (drive = player.bot ? createDrive(spec, true) : createPlayerDrive(spec, true)));
      drive.manual = true;
      let car = this.dragCars.get(id);
      if (!car) this.dragCars.set(id, (car = createDragCar(drag.lanes[0])));
      const brain = this.dragBrains.get(id);
      const input = this.controls.get(id) ?? { throttle: 0, steer: 0 };

      if (!car.launched) {
        // Bot: larga com a reação dele (ou queima, se for o dia dele).
        if (brain && player.racing) {
          const jumpNow = phase === "countdown" && brain.jump !== null && this.state.timer <= brain.jump;
          if (jumpNow || (phase === "racing" && this.state.raceTime >= brain.reaction)) this.dragLaunch(id, player);
        }
        // Humano que não larga: sai sozinho depois de um tempo (com a reação ruim).
        if (!brain && player.racing && phase === "racing" && this.state.raceTime >= DRAG_AUTO_LAUNCH) this.dragLaunch(id, player);
      }
      if (!car.launched) {
        freeRev(drive, spec, brain ? dragBotRev(brain, drive) : Math.max(0, input.throttle), dt);
        player.speed = 0;
        player.rpm = Math.round(drive.rpm);
        player.gear = 0;
        player.boost = 0;
        continue;
      }

      car.since += dt;
      drive.traction = dragTraction(car);
      if (brain && dragBotShift(brain, drive, spec, car)) this.dragShift(id, player, 1);
      // Depois da chegada (ou fora da corrida), freia sozinho.
      const done = player.finished || !player.racing || phase === "results";
      const throttle = done ? -1 : brain ? 1 : input.throttle;
      const steer = dragSteer(this.track, player, car.lane);
      const motion = this.motions.get(id);
      const wantNitro = !done && !!input.nitro && phase === "racing";
      const nitro = this.nitros.step(id, this.tunes.get(id), { throttle, steer, nitro: wantNitro }, player, dt);
      player.boost = nitro.power > 0 ? 1 : 0;
      player.nitro = nitro.fill;
      // Freado depois da chegada, não engata a ré.
      if (done && Math.abs(player.speed) < 0.5) {
        player.speed = 0;
        drive.pedal = 0;
      } else {
        stepCar(player, drive, spec, { throttle, steer }, dt, false, nitro.power, motion, gradeAt(player.x, player.z, player.heading));
      }
      const size = carHalfSize(player.car);
      collideWorld(player, size.halfLength, size.halfWidth, motion);
      // "Batendo no limitador": o giro pula logo abaixo do corte (o flag do limitador pisca): soma enquanto bate e desconta devagar.
      car.limiterFor = drive.limiter || drive.rpm >= spec.redline * 0.995 ? car.limiterFor + dt : Math.max(0, car.limiterFor - dt * 0.5);
      player.rpm = Math.round(drive.rpm);
      player.gear = drive.gear;
      player.shiftRpm = Math.round(shiftPoint(spec, drive.gear));

      if (player.racing && !player.finished && (phase === "racing" || phase === "countdown")) {
        // Distância do bico até a linha de largada.
        player.progress = dragDistance(this.track, player.x, player.z) + size.halfLength - drag.start;
        if (player.progress >= drag.distance && phase === "racing") {
          player.progress = drag.distance;
          player.lap = 1;
          player.finished = true;
          player.finishTime = this.state.raceTime;
          player.lastTrap = Math.round(Math.abs(player.speed) * 3.6);
          if (!this.racers().some(([, p]) => p.finished && p !== player)) this.state.timer = DRAG_GRACE_SECONDS;
          if (this.racers().every(([, p]) => p.bot || p.finished)) this.finishCamUntil = this.state.raceTime + FINISH_CAM_SECONDS;
        }
      }
    }
    collideCars(cars.map(([id, p]) => ({ ...carBody(p, this.motions.get(id), p.car), mass: this.specOf(id, p).mass })));
  }

  /** Solta a embreagem: a reação conta do verde (antes dele, queimou). */
  private dragLaunch(id: string, player: Player) {
    const car = this.dragCars.get(id);
    const drive = this.drives.get(id);
    if (!car || !drive || car.launched || !player.racing) return;
    const phase = this.state.phase as Phase;
    if (phase !== "countdown" && phase !== "racing") return;
    const spec = this.specOf(id, player);
    const jumped = phase === "countdown";
    const launch = gradeLaunch(spec, drive.rpm);
    car.launched = true;
    car.since = 0;
    car.penalty = launch.penalty;
    car.recover = launch.recover;
    drive.gear = 1;
    drive.shiftTimer = 0;
    player.launched = true;
    player.jumped = jumped;
    player.reaction = jumped ? -this.state.timer : this.state.raceTime;
    player.launchGrade = jumped ? "queimou" : launch.grade;
  }

  /**
   * Câmbio da arrancada: antes de largar, "E" solta a embreagem; depois, cada
   * troca para cima ganha uma nota pelo giro (a perfeita troca mais rápido).
   */
  private dragShift(id: string, player: Player, direction: number) {
    const car = this.dragCars.get(id);
    const drive = this.drives.get(id);
    if (!car || !drive) return;
    if (!car.launched) {
      if (direction > 0) this.dragLaunch(id, player);
      return;
    }
    if (player.finished) return;
    const spec = this.specOf(id, player);
    const before = drive.gear;
    const rpm = drive.rpm;
    requestShift(drive, spec, direction);
    if (drive.gear <= before) return;
    const grade = gradeShift(spec, before, rpm, car.limiterFor);
    if (grade === "perfeita") drive.shiftTimer *= 0.5;
    car.limiterFor = 0;
    player.shiftGrade = grade;
    player.shifts = (player.shifts + 1) % 256;
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
          // Último humano a chegar: a câmera enquadra o carro e o resultado sai
          // logo (os bots que ainda correm têm o tempo projetado).
          if (this.racers().every(([, p]) => p.bot || p.finished)) {
            this.finishCamUntil = this.state.raceTime + FINISH_CAM_SECONDS;
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
    this.checkRadar(player);
  }

  /**
   * Speedtrap: ao passar pelo próximo radar, a velocidade (km/h) entra na soma.
   * Quem corta caminho e pula um radar leva 0 nele.
   */
  private checkRadar(player: Player) {
    if (!this.radars.length || player.traps >= this.radars.length * this.state.laps) return;
    const lap = Math.floor(player.traps / this.radars.length);
    const at = lap * this.track.length + this.radars[player.traps % this.radars.length];
    if (player.progress < at) return;
    const speed = player.progress - at < 60 ? Math.round(Math.abs(player.speed) * 3.6) : 0;
    player.trapTotal += speed;
    player.traps++;
    player.lastTrap = speed;
  }

  private finishRace() {
    const racers = this.racers();
    const total = this.state.laps * this.track.length;
    const radarCount = this.radars.length * this.state.laps;
    const radar = this.state.kind === "radar";
    const drag = this.drag;
    // "Fast-forward": quem ainda corria (bot) ganha um tempo projetado pelo ritmo
    // médio dele (na arrancada, pela velocidade de agora).
    const outcome = new Map<string, { time: number; trap: number; projected: boolean }>();
    for (const [sessionId, p] of racers) {
      if (p.finished) {
        outcome.set(sessionId, { time: p.finishTime, trap: p.trapTotal, projected: false });
      } else if (p.bot) {
        const remaining = drag ? drag.distance - p.progress : total - p.progress;
        const pace = drag ? Math.max(5, p.speed) : Math.max(5, p.progress / Math.max(1, this.state.raceTime));
        const time = this.state.raceTime + Math.max(0, remaining) / pace;
        outcome.set(sessionId, { time, trap: p.trapTotal, projected: true });
      }
    }
    // Colocação: pelo tempo (na arrancada, quem queimou a largada fica atrás de
    // todo mundo). No speedtrap é contra as metas: bateu a de bronze, venceu.
    const goals = { bronze: this.state.goalBronze, prata: this.state.goalSilver, ouro: this.state.goalGold };
    const jumped = (id: string) => (drag ? Number(this.state.players.get(id)?.jumped ?? false) : 0);
    const order = [...outcome.entries()].sort(([a, ra], [b, rb]) => jumped(a) - jumped(b) || ra.time - rb.time);
    const placeOf = new Map(order.map(([id], i) => [id, i + 1]));

    const rows: Result[] = [];
    const distance = drag ? drag.distance : this.state.laps * this.track.length;
    racers.forEach(([sessionId, p]) => {
      const done = outcome.get(sessionId);
      const trap = Math.round(done?.trap ?? p.trapTotal);
      const medal: RadarMedal | null = radar && done ? radarMedal(trap, goals) : null;
      // Speedtrap: 1º = bateu a meta (vitória, para a carreira também); 2º = não bateu.
      // Arrancada: queimou a largada, desclassificado (sem colocação nem prêmio).
      const place = radar ? (done ? (medal ? 1 : 2) : 0) : drag && p.jumped ? 0 : placeOf.get(sessionId) ?? 0;
      p.place = place || p.place;
      const row = new Result();
      row.sessionId = sessionId;
      row.name = p.name;
      row.color = p.color;
      row.bot = p.bot;
      row.place = place;
      row.time = done?.time ?? 0;
      row.projected = done?.projected ?? false;
      row.trap = trap;
      row.medal = medal ?? "";
      row.goal = radar ? goals.bronze : 0;
      row.reaction = p.reaction;
      row.speed = p.finished ? p.lastTrap : 0;
      row.jumped = p.jumped;
      // Sem comida na pista: as calorias são as "queimadas" na prova, mais para quem
      // chega na frente, e o prêmio em dinheiro também é pela colocação. Só ganha
      // quem terminou (ou teria terminado, no caso dos bots). No speedtrap, o
      // prêmio é o da medalha; na arrancada, quem queimou não leva nada.
      row.calories = 0;
      row.bonus = raceCalories(place, distance);
      row.total = row.bonus;
      row.cash = radar ? (medal ? Math.round((raceCash(1, distance) * RADAR_MEDAL_CASH[medal]) / 10) * 10 : 0) : raceCash(place, distance);
      rows.push(row);
      // As calorias da corrida entram na conta do jogador no mundo aberto.
      if (!p.bot) recordRace(this.tokens.get(sessionId), row.total, place === 1);
    });
    rows.sort((a, b) => (a.place || 99) - (b.place || 99));
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

    // (Também quando quem faltava saiu da sala: os que ficaram já chegaram.)
    if (this.finishCamUntil === Infinity && racers.some((p) => !p.bot) && racers.every((p) => p.bot || p.finished)) {
      this.finishCamUntil = this.state.raceTime + FINISH_CAM_SECONDS;
    }
    if (this.state.raceTime >= this.finishCamUntil || (someoneFinished && this.state.timer <= 0)) {
      this.finishRace();
    }
  }
}
