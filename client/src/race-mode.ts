// Modo corrida: HUD, lobby, contagem, placar e sons de evento de uma RaceRoom.
import {
  DIFFICULTY_LABELS,
  type InputMessage,
  MAX_PLAYERS,
  RACES,
  isRaceId,
  type Difficulty,
  type Phase,
  type RaceId,
} from "@nfbmc/shared";

import type { ModeContext, PlayerSnapshot } from "./mode.ts";
import type { RaceRoom } from "./net.ts";
import type { CarView } from "./scene.ts";
import { escapeHtml, foodByCalories, kcal, ordinal, setHtml, showPopup, ui } from "./ui.ts";

export class RaceMode {
  readonly room: RaceRoom;
  private ctx: ModeContext;
  /** Pista já desenhada na cena (o estado pode chegar um instante depois da conexão). */
  private drawnRace: RaceId | null = null;
  /** Valores do quadro anterior, para perceber eventos (comeu, deu volta, bateu...). */
  private previous = { phase: "", countdown: 0, lap: 0, finished: false, calories: 0, boost: 0, speed: 0, bumpAt: 0 };

  constructor(room: RaceRoom, ctx: ModeContext, onBackToWorld?: (raceId: RaceId) => void) {
    this.room = room;
    this.ctx = ctx;
    // Botões do lobby (onclick substitui o handler de uma corrida anterior).
    const changeBots = (delta: number) => {
      ctx.sound.click();
      room.send("setBots", { count: room.state.botCount + delta });
    };
    ui.botsMinus.onclick = () => changeBots(-1);
    ui.botsPlus.onclick = () => changeBots(1);
    ui.difficulty.onchange = () => {
      room.send("setDifficulty", { level: ui.difficulty.value });
      ui.difficulty.blur();
    };
    ui.start.onclick = () => {
      ctx.sound.click();
      room.send("start");
      ui.start.blur();
    };

    room.onMessage("backToWorld", (message: { raceId?: string }) => {
      onBackToWorld?.(isRaceId(message?.raceId) ? message.raceId : this.raceId);
    });
  }

  get raceId(): RaceId {
    return isRaceId(this.room.state.raceId) ? this.room.state.raceId : "autodromo";
  }

  phase(): Phase {
    return (this.room.state.phase ?? "lobby") as Phase;
  }

  /** Transforma o estado da sala no que a cena precisa desenhar. */
  private carViews() {
    const views = new Map<string, CarView>();
    const showAll = this.phase() === "lobby" || this.phase() === "results";
    this.room.state.players?.forEach((p, id) => {
      views.set(id, {
        name: p.bot ? `🤖 ${p.name}` : p.name,
        color: p.color,
        x: p.x,
        z: p.z,
        heading: p.heading,
        speed: p.speed,
        boost: p.boost,
        visible: showAll || p.racing,
      });
    });
    return views;
  }

  frame() {
    const { room, ctx } = this;
    if (this.drawnRace !== this.raceId) {
      this.drawnRace = this.raceId;
      ctx.scene?.setRace(this.raceId);
    }
    const cars = this.carViews();
    const me = room.state.players?.get(room.sessionId);
    let followId: string | undefined = room.sessionId;
    if (me && this.phase() !== "lobby" && !me.racing) {
      // Esperando a próxima corrida: a câmera acompanha quem está na frente.
      followId = [...(room.state.players?.entries() ?? [])].find(([, p]) => p.racing && p.place === 1)?.[0];
    }
    const followed = ctx.scene
      ? (ctx.scene.syncCars(cars), ctx.scene.syncFoods([...(room.state.foods ?? [])]), ctx.scene.render(cars, followId))
      : null;
    if (!me) return;

    ctx.sound.updateMine(followId === room.sessionId && followed ? {
      speed: me.speed,
      throttle: ctx.input().throttle,
      skid: followed.skid,
      offroad: followed.offroad,
      boost: me.boost > 0,
    } : null);
    ctx.updateOtherEngines(cars, room.sessionId, me);
    ctx.drawMinimap({ cars, myId: room.sessionId, race: this.raceId });
    this.updateUi();
  }

  private updateUi() {
    const { room, ctx } = this;
    const players = room.state.players;
    const me = players?.get(room.sessionId);
    if (!players || !me) return;
    const current = this.phase();
    const spectating = current !== "lobby" && !me.racing;
    const racers = [...players.values()].filter((p) => p.racing);
    const laps = room.state.laps || RACES[this.raceId].laps;

    ui.count.textContent = String([...players.values()].filter((p) => !p.bot).length);
    ctx.sound.song(current === "racing" ? "race" : current === "countdown" ? null : "lobby");

    // Lobby (corridas de evento largam sozinhas, sem lobby)
    ui.lobby.hidden = current !== "lobby" || room.state.event;
    if (current === "lobby" && !room.state.event) {
      const humans = [...players.entries()].filter(([, p]) => !p.bot);
      const difficulty = room.state.difficulty as Difficulty;
      const bots = Math.min(room.state.botCount, MAX_PLAYERS - humans.length);
      setHtml(
        ui.lobbyList,
        humans
          .map(([id, p]) =>
            `<li><span class="dot" style="background:${p.color}"></span>${escapeHtml(p.name)}${id === room.sessionId ? " (você)" : ""}</li>`)
          .join("") +
          (bots > 0 ? `<li>🤖 ${bots} ${bots === 1 ? "bot" : "bots"} da Lista Gorda (${DIFFICULTY_LABELS[difficulty]})</li>` : ""),
      );
      ui.lobbyTitle.textContent = room.state.solo ? "Corrida solo" : "Lobby";
      ui.lobbyHint.textContent = room.state.solo
        ? "Você contra os bots. Escolha quantos e a dificuldade."
        : "Dirija à vontade enquanto a galera chega.";
      ui.botsCount.textContent = String(bots);
      ui.botsMinus.disabled = bots <= 0;
      ui.botsPlus.disabled = bots >= MAX_PLAYERS - humans.length;
      if (document.activeElement !== ui.difficulty) ui.difficulty.value = difficulty;
    }

    // HUD da corrida
    const inRace = (current === "countdown" || current === "racing") && me.racing;
    ui.hud.hidden = !inRace;
    if (inRace) {
      ui.lap.textContent = `${Math.max(1, me.lap)}/${laps}`;
      ui.place.textContent = `${ordinal(me.place)}/${racers.length}`;
      ui.calories.textContent = kcal(me.calories);
    }
    ui.dash.hidden = spectating;
    if (!spectating) {
      ctx.drawTacho(me.speed);
      ui.nitroFill.style.width = `${Math.min(100, (me.boost / 2.5) * 100)}%`;
    }
    ui.speedlines.hidden = !(me.boost > 0 && !spectating);

    // Contagem regressiva
    let countdown = "";
    if (current === "countdown") countdown = String(Math.max(1, Math.ceil(room.state.timer)));
    else if (current === "racing" && room.state.raceTime < 1) countdown = "VAI!";
    ui.countdown.hidden = !countdown;
    ui.countdown.textContent = countdown;

    // Mensagem no meio da tela
    let message = "";
    const firstDone = racers.find((p) => p.finished);
    const secondsLeft = Math.ceil(room.state.timer);
    if (current === "lobby" && room.state.event) {
      message = `${escapeHtml(RACES[this.raceId].name)}: esperando a galera chegar…`;
    } else if (spectating && current !== "results") {
      message = "Corrida em andamento: você entra na próxima! 🍟";
    } else if (current === "racing" && me.finished) {
      message = `Você chegou em ${ordinal(me.place)}! Esperando os outros… ${secondsLeft}s`;
    } else if (current === "racing" && firstDone) {
      message = `${escapeHtml(firstDone.name)} já chegou! Você tem ${secondsLeft}s`;
    }
    ui.message.hidden = !message;
    setHtml(ui.message, message);

    // Resultado
    ui.results.hidden = current !== "results";
    if (current === "results") {
      const rows = [...(room.state.results ?? [])];
      const winner = rows[0];
      setHtml(
        ui.winner,
        winner && winner.total > 0 ? `🏆 ${escapeHtml(winner.name)} é o mais calórico!` : "Ninguém comeu nada?! 🥗",
      );
      setHtml(
        ui.resultsBody,
        rows
          .map((row, i) =>
            `<tr class="${row.sessionId === room.sessionId ? "me" : ""}"><td>${i + 1}</td>` +
            `<td><span class="dot" style="background:${row.color}"></span>${row.bot ? "🤖 " : ""}${escapeHtml(row.name)}</td>` +
            `<td>${row.place ? ordinal(row.place) : "—"}</td><td>${kcal(row.calories)}</td>` +
            `<td>+${kcal(row.bonus)}</td><td>${kcal(row.total)}</td></tr>`)
          .join(""),
      );
      ui.resultsTimer.textContent = room.state.event
        ? Number.isFinite(room.state.timer) && secondsLeft > 0
          ? `Voltando para Porto Gordo em ${secondsLeft}s (as calorias vão para a sua conta)`
          : "Voltando para Porto Gordo…"
        : `Voltando para o lobby em ${secondsLeft}s`;
    }

    this.playEventSounds(me);
  }

  private playEventSounds(me: { lap: number; finished: boolean; calories: number; boost: number; speed: number; racing: boolean }) {
    const { ctx, previous } = this;
    const current = this.phase();

    if (current === "countdown") {
      const count = Math.ceil(this.room.state.timer);
      if (count !== previous.countdown && count > 0) ctx.sound.beep();
      previous.countdown = count;
    }
    if (current === "racing" && previous.phase === "countdown" && me.racing) ctx.sound.beep(true);

    if (current === "racing" && me.racing) {
      if (me.lap > previous.lap && me.lap > 1) ctx.sound.lap();
      if (me.finished && !previous.finished) ctx.sound.finish();
      if (me.calories > previous.calories) {
        const gained = me.calories - previous.calories;
        const food = foodByCalories(gained);
        ctx.sound.eat(food?.kind);
        showPopup(`+${kcal(gained)} kcal${food ? ` ${food.label.toLowerCase()}` : ""}`);
      }
      if (me.boost > previous.boost + 0.9) ctx.sound.boost();
    }
    ctx.detectBump(previous, me.speed);

    previous.phase = current;
    previous.lap = me.lap;
    previous.finished = me.finished;
    previous.calories = me.calories;
    previous.boost = me.boost;
    previous.speed = me.speed;
  }

  sendInput(input: InputMessage) {
    this.room.send("input", input);
  }

  snapshot() {
    const result: Record<string, PlayerSnapshot> = {};
    this.room.state.players?.forEach((p, id) => {
      result[id] = {
        name: p.name, bot: p.bot, x: p.x, z: p.z, speed: p.speed, racing: p.racing,
        lap: p.lap, place: p.place, calories: p.calories, finished: p.finished,
      };
    });
    return result;
  }

  dispose() {
    ui.botsMinus.onclick = ui.botsPlus.onclick = ui.start.onclick = null;
    ui.difficulty.onchange = null;
  }
}
