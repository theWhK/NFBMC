// Modo mundo aberto: dirigir por Porto Gordo, comer nas barraquinhas e
// disparar corridas nos pontos de encontro.
import {
  DIFFICULTY_LABELS,
  MARKER_RADIUS,
  MAX_PLAYERS,
  RACES,
  RACE_IDS,
  raceMarker,
  type Difficulty,
  type GoRaceMessage,
  type InputMessage,
  type RaceId,
} from "@nfbmc/shared";

import type { ModeContext, PlayerSnapshot } from "./mode.ts";
import type { WorldRoom } from "./net.ts";
import type { CarView } from "./scene.ts";
import { escapeHtml, foodByCalories, kcal, setHtml, showPopup, ui } from "./ui.ts";

export class WorldMode {
  readonly room: WorldRoom;
  private ctx: ModeContext;
  private bots = 3;
  private calling = false;
  private sceneReady = false;
  private previous = { calories: -1, boost: 0, speed: 0, bumpAt: 0 };

  constructor(room: WorldRoom, ctx: ModeContext, onGoRace: (message: GoRaceMessage) => void, onToken: (token: string) => void) {
    this.room = room;
    this.ctx = ctx;
    room.onMessage("profile", (message: { token: string }) => onToken(message.token));
    room.onMessage("goRace", (message: GoRaceMessage) => onGoRace(message));

    const changeBots = (delta: number) => {
      ctx.sound.click();
      this.bots = Math.max(0, Math.min(MAX_PLAYERS - 1, this.bots + delta));
    };
    ui.markerBotsMinus.onclick = () => changeBots(-1);
    ui.markerBotsPlus.onclick = () => changeBots(1);
    ui.markerDifficulty.onchange = () => ui.markerDifficulty.blur();
    ui.startRace.onclick = () => this.startRace();
  }

  /** Ponto de encontro onde o carro está agora, se estiver em algum. */
  private markerHere(): RaceId | null {
    const me = this.room.state.players?.get(this.room.sessionId);
    if (!me) return null;
    return RACE_IDS.find((id) => {
      const m = raceMarker(id);
      return Math.hypot(me.x - m.x, me.z - m.z) <= MARKER_RADIUS;
    }) ?? null;
  }

  startRace() {
    const raceId = this.markerHere();
    if (!raceId || this.calling) return;
    this.calling = true;
    this.ctx.sound.click();
    this.room.send("startRace", {
      raceId,
      bots: this.bots,
      difficulty: ui.markerDifficulty.value as Difficulty,
    });
    ui.startRace.blur();
    // Se o servidor não chamar (ex.: saiu do ponto bem na hora), libera o botão de novo.
    setTimeout(() => (this.calling = false), 4000);
  }

  handleKey(code: string) {
    if (code === "Enter") this.startRace();
  }

  frame() {
    const { room, ctx } = this;
    if (!this.sceneReady) {
      this.sceneReady = true;
      ctx.scene?.setRace(null);
    }
    const cars = new Map<string, CarView>();
    room.state.players?.forEach((p, id) => {
      cars.set(id, { name: p.name, color: p.color, x: p.x, z: p.z, heading: p.heading, speed: p.speed, boost: p.boost, visible: true });
    });
    const me = room.state.players?.get(room.sessionId);
    const followed = ctx.scene
      ? (ctx.scene.syncCars(cars), ctx.scene.syncFoods([...(room.state.stands ?? [])]), ctx.scene.render(cars, room.sessionId))
      : null;
    if (!me) return;

    ctx.sound.song("lobby");
    ctx.sound.updateMine(followed ? {
      speed: me.speed,
      throttle: ctx.input().throttle,
      skid: followed.skid,
      offroad: followed.offroad,
      boost: me.boost > 0,
    } : null);
    ctx.updateOtherEngines(cars, room.sessionId, me);
    ctx.drawMinimap({ cars, myId: room.sessionId, race: null });
    ctx.drawTacho(me.speed);
    ui.nitroFill.style.width = `${Math.min(100, (me.boost / 2.5) * 100)}%`;
    ui.speedlines.hidden = !(me.boost > 0);

    // HUD e Lista Gorda (quem está online, do mais calórico para o menos).
    ui.worldHud.hidden = false;
    ui.dash.hidden = false;
    ui.leaderboard.hidden = false;
    ui.count.textContent = String(room.state.players.size);
    ui.worldCalories.textContent = kcal(me.calories);
    const ranking = [...room.state.players.entries()].sort(([, a], [, b]) => b.calories - a.calories).slice(0, 6);
    setHtml(
      ui.leaderboard.querySelector("ol")!,
      ranking
        .map(([id, p]) =>
          `<li><span class="dot" style="background:${p.color}"></span>${escapeHtml(p.name)}${id === room.sessionId ? " (você)" : ""}<strong>${kcal(p.calories)}</strong></li>`)
        .join(""),
    );

    // Painel do ponto de encontro.
    const raceId = this.markerHere();
    ui.markerPanel.hidden = !raceId;
    if (raceId) {
      const race = RACES[raceId];
      const marker = raceMarker(raceId);
      const people = [...room.state.players.values()].filter((p) => Math.hypot(p.x - marker.x, p.z - marker.z) <= MARKER_RADIUS);
      const bots = Math.min(this.bots, MAX_PLAYERS - people.length);
      ui.markerTitle.textContent = race.name;
      ui.markerInfo.textContent = `${race.laps} voltas · ${(race.track.length / 1000).toFixed(1).replace(".", ",")} km por volta`;
      setHtml(
        ui.markerPeople,
        `No ponto: ${people.map((p) => `<span class="dot" style="background:${p.color}"></span>${escapeHtml(p.name)}`).join(", ")}` +
          (bots > 0 ? ` + 🤖 ${bots} (${DIFFICULTY_LABELS[ui.markerDifficulty.value as Difficulty]})` : ""),
      );
      ui.markerBots.textContent = String(bots);
      ui.markerBotsMinus.disabled = bots <= 0;
      ui.markerBotsPlus.disabled = bots >= MAX_PLAYERS - people.length;
      ui.startRace.disabled = this.calling;
      ui.startRace.textContent = this.calling ? "Chamando a galera…" : "Começar corrida (Enter)";
    }

    // Comeu numa barraquinha.
    if (this.previous.calories >= 0 && me.calories > this.previous.calories) {
      const gained = me.calories - this.previous.calories;
      const food = foodByCalories(gained);
      ctx.sound.eat(food?.kind);
      showPopup(`+${kcal(gained)} kcal${food ? ` ${food.label.toLowerCase()}` : ""}`);
    }
    if (me.boost > this.previous.boost + 0.9) ctx.sound.boost();
    ctx.detectBump(this.previous, me.speed);
    this.previous.calories = me.calories;
    this.previous.boost = me.boost;
    this.previous.speed = me.speed;
  }

  sendInput(input: InputMessage) {
    this.room.send("input", input);
  }

  snapshot() {
    const result: Record<string, PlayerSnapshot> = {};
    this.room.state.players?.forEach((p, id) => {
      result[id] = {
        name: p.name, bot: false, x: p.x, z: p.z, speed: p.speed, racing: false,
        lap: 0, place: 0, calories: p.calories, finished: false,
      };
    });
    return result;
  }

  dispose() {
    ui.markerBotsMinus.onclick = ui.markerBotsPlus.onclick = ui.startRace.onclick = null;
    ui.markerDifficulty.onchange = null;
  }
}
