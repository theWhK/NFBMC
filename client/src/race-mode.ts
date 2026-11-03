// Modo corrida: HUD, lobby, contagem, placar e sons de evento de uma RaceRoom.
import {
  carSpec,
  DIFFICULTY_LABELS,
  type InputMessage,
  MAX_PLAYERS,
  RACES,
  isRaceId,
  raceCash,
  type Difficulty,
  type Phase,
  type RaceId,
  LAUNCH_LABELS,
  RADAR_MEDAL_LABELS,
  SHIFT_LABELS,
  type LaunchGrade,
  type RadarMedal,
  type ShiftGrade,
} from "@nfbmc/shared";

import type { ModeContext, PlayerSnapshot } from "./mode.ts";
import type { RaceRoom } from "./net.ts";
import type { CarView } from "./scene.ts";
import { money } from "./economy.ts";
import { $, escapeHtml, kcal, ordinal, setHtml, showNitro, ui } from "./ui.ts";

export interface RaceFinish {
  /** Colocação na chegada (0 = não terminou). */
  place: number;
  total: number;
  /** Prêmio em dinheiro da colocação. */
  cash: number;
  event: boolean;
  challenge: boolean;
}

/** Medalha do speedtrap com o ícone. */
const MEDAL_ICON: Record<RadarMedal, string> = { bronze: "🥉", prata: "🥈", ouro: "🥇" };
const medalText = (medal: string) => (medal in MEDAL_ICON ? `${MEDAL_ICON[medal as RadarMedal]} ${RADAR_MEDAL_LABELS[medal as RadarMedal]}` : "");
/** Segundos com três casas (reação, tempo da arrancada): 0,231 s. */
const seconds = (value: number, digits = 3) => `${value.toFixed(digits).replace(".", ",")} s`;
/** Nota boa/ruim (cor do aviso da arrancada). */
const gradeClass = (grade: string) => (grade === "perfeita" ? "perfeita" : grade === "boa" ? "boa" : "ruim");

/** Tempo de prova: 1:23,45. */
const raceTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const rest = seconds - m * 60;
  return `${m}:${rest.toFixed(2).padStart(5, "0").replace(".", ",")}`;
};

export class RaceMode {
  readonly room: RaceRoom;
  private ctx: ModeContext;
  /** Pista já desenhada na cena (o estado pode chegar um instante depois da conexão). */
  private drawnRace: RaceId | null = null;
  /** Radares já mostrados (para o flash aparecer uma vez por radar). */
  private seenTraps = 0;
  private flashTimer: ReturnType<typeof setTimeout> | undefined;
  /** Arrancada: última largada e troca já mostradas (o aviso aparece uma vez cada). */
  private seenLaunch = "";
  private seenShifts = 0;
  private gradeTimer: ReturnType<typeof setTimeout> | undefined;
  /** Valores do quadro anterior, para perceber eventos (deu volta, chegou, nitro, bateu...). */
  private previous = { phase: "", countdown: 0, lap: 0, finished: false, boost: 0, speed: 0, bumpAt: 0 };

  /** Avisado uma vez quando a corrida termina (para o modo história). */
  private onFinish?: (result: RaceFinish) => void;
  private reportedFinish = false;

  constructor(room: RaceRoom, ctx: ModeContext, onBackToWorld?: (raceId: RaceId) => void, onFinish?: (result: RaceFinish) => void) {
    this.room = room;
    this.ctx = ctx;
    this.onFinish = onFinish;
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

  /** Arrancada: câmbio sempre manual (o E solta a embreagem na largada). */
  manualOnly() {
    return this.room.state.kind === "drag";
  }

  phase(): Phase {
    return (this.room.state.phase ?? "lobby") as Phase;
  }

  /** Transforma o estado da sala no que a cena precisa desenhar. */
  private carViews() {
    const views = new Map<string, CarView>();
    const showAll = this.phase() === "lobby" || this.phase() === "results";
    // Jogando sozinho, o seu nome não fica em cima do seu carro (só o dos bots).
    const alone = !!this.room.state.pausable;
    this.room.state.players?.forEach((p, id) => {
      views.set(id, {
        name: p.bot ? `🤖 ${p.name}` : alone && id === this.room.sessionId ? "" : p.name,
        color: p.color,
        car: p.car,
        x: p.x,
        z: p.z,
        heading: p.heading,
        speed: p.speed,
        boost: p.boost,
        rpm: p.rpm,
        visible: showAll || p.racing,
        level: p.level,
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
      ? (ctx.scene.syncCars(cars), ctx.scene.render(cars, followId, room.sessionId))
      : null;
    if (!me) return;

    // Pausado: motores calados (a música continua).
    const paused = this.paused();
    ctx.sound.updateMine(followId === room.sessionId && followed && !paused ? {
      speed: me.speed,
      rpm: me.rpm,
      redline: carSpec(me.car).redline,
      throttle: ctx.input().throttle,
      skid: followed.skid,
      offroad: followed.offroad,
      boost: me.boost > 0,
      car: me.car,
      gear: me.gear,
    } : null);
    if (paused) ctx.sound.updateOthers(new Map());
    else ctx.updateOtherEngines(cars, room.sessionId, me);
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
    // Duelo da Lista Gorda tem a trilha de chefão.
    ctx.sound.song(current === "racing" ? (room.state.challenge ? "duel" : "race") : current === "countdown" ? null : "lobby");

    // Lobby (corridas de evento largam sozinhas, sem lobby)
    // Corridas de evento e duelos largam sozinhos, sem lobby.
    const autoStart = room.state.event || room.state.challenge;
    ui.lobby.hidden = current !== "lobby" || autoStart;
    const kind = room.state.kind;
    const radar = kind === "radar";
    const drag = kind === "drag";
    if (current === "lobby" && !autoStart) {
      const humans = [...players.entries()].filter(([, p]) => !p.bot);
      const difficulty = room.state.difficulty as Difficulty;
      // Arrancada: dois carros; speedtrap: só você (sem bots).
      const seats = drag ? 2 : MAX_PLAYERS;
      const bots = radar ? 0 : Math.min(room.state.botCount, seats - humans.length);
      setHtml(
        ui.lobbyList,
        humans
          .map(([id, p]) =>
            `<li><span class="dot" style="background:${p.color}"></span>${escapeHtml(p.name)}${id === room.sessionId ? " (você)" : ""}</li>`)
          .join("") +
          (bots > 0 ? `<li>🤖 ${bots} ${bots === 1 ? "bot" : "bots"} da Lista Gorda (${DIFFICULTY_LABELS[difficulty]})</li>` : ""),
      );
      ui.lobbyTitle.textContent = radar ? "Speedtrap" : drag ? "Arrancada" : room.state.solo ? "Corrida solo" : "Lobby";
      ui.lobbyHint.textContent = radar
        ? `Desafio solo: some ${kcal(room.state.goalBronze)} km/h nos radares para vencer (🥉). Prata: ${kcal(room.state.goalSilver)} · Ouro: ${kcal(room.state.goalGold)}.`
        : drag
          ? "Câmbio manual e direção automática. Na contagem, segure o giro na faixa verde e aperte E no verde (antes queima a largada)."
          : room.state.solo
            ? "Você contra os bots. Escolha quantos e a dificuldade."
            : "Dirija à vontade enquanto a galera chega.";
      for (const el of [ui.botsCount, ui.difficulty]) (el.closest(".setting") as HTMLElement).hidden = radar;
      ui.botsCount.textContent = String(bots);
      ui.botsMinus.disabled = bots <= 0;
      ui.botsPlus.disabled = bots >= seats - humans.length;
      if (document.activeElement !== ui.difficulty) ui.difficulty.value = difficulty;
    }

    // HUD da corrida
    const inRace = (current === "countdown" || current === "racing") && me.racing;
    ui.hud.hidden = !inRace;
    const dragInfo = RACES[this.raceId].drag;
    $("lap-row").hidden = drag;
    if (inRace) {
      ui.lap.textContent = `${Math.max(1, me.lap)}/${laps}`;
      const medal = this.medalOf(me.trapTotal);
      ui.place.textContent = radar ? (medal ? medalText(medal) : "—") : `${ordinal(me.place)}/${racers.length}`;
      // Prêmio se a corrida acabasse agora, nesta posição (no speedtrap, pela meta batida).
      const distance = dragInfo ? dragInfo.distance : laps * RACES[this.raceId].track.length;
      ui.racePrize.textContent = money(radar ? (medal ? raceCash(1, distance) : 0) : raceCash(me.place, distance));
    }
    // Speedtrap: soma dos radares e as metas no HUD, e o flash a cada radar passado.
    const radarCount = (RACES[this.raceId].radars?.length ?? 0) * laps;
    $("trap-row").hidden = !(inRace && radar);
    $("radar-goal-row").hidden = !(inRace && radar);
    if (radar && inRace) {
      $("trap").textContent = `${kcal(Math.round(me.trapTotal))} km/h · ${me.traps}/${radarCount}`;
      const goals: [string, number][] = [["🥉", room.state.goalBronze], ["🥈", room.state.goalSilver], ["🥇", room.state.goalGold]];
      const next = goals.find(([, goal]) => me.trapTotal < goal);
      $("radar-goals").textContent = next
        ? `${next[0]} ${kcal(next[1])} km/h (faltam ${kcal(Math.ceil(next[1] - me.trapTotal))})`
        : `🥇 ouro garantido! (${kcal(room.state.goalGold)})`;
    }
    // Arrancada: reação, distância, faixa verde no conta-giros e a nota de cada troca.
    $("drag-row").hidden = !(inRace && drag);
    if (drag && inRace && dragInfo) {
      const left = Math.max(0, Math.ceil(dragInfo.distance - Math.max(0, me.progress)));
      $("drag-info").textContent = me.launched
        ? `reação ${seconds(me.reaction)} · ${me.finished ? "chegou!" : `faltam ${left} m`}`
        : `${dragInfo.distance} m · aperte E no verde`;
    }
    if (drag) this.showDragGrades(me, current);
    if (current !== "racing") this.seenTraps = 0;
    else if (me.traps > this.seenTraps) {
      this.seenTraps = me.traps;
      const flash = $("trap-flash");
      flash.textContent = `📸 ${Math.round(me.lastTrap)} km/h`;
      flash.hidden = true;
      void flash.offsetWidth;
      flash.hidden = false;
      ctx.sound.click();
      clearTimeout(this.flashTimer);
      this.flashTimer = setTimeout(() => (flash.hidden = true), 1000);
    }

    // Chegada: faixas de cinema, posição e tempo, e a câmera girando em volta do carro.
    const finishing = current === "racing" && me.racing && me.finished;
    ctx.scene?.setFinishCam(finishing);
    $("finish-cam").hidden = !finishing;
    if (finishing) {
      if (radar) {
        const medal = this.medalOf(me.trapTotal);
        const margin = Math.round(me.trapTotal - room.state.goalBronze);
        $("finish-place").textContent = medal ? medalText(medal) : "Não bateu a meta";
        $("finish-time").textContent = `${kcal(Math.round(me.trapTotal))} km/h · meta ${kcal(room.state.goalBronze)} (${margin >= 0 ? "+" : "−"}${kcal(Math.abs(margin))})`;
      } else if (drag) {
        $("finish-place").textContent = me.jumped ? "Queimou a largada!" : `${ordinal(me.place)} lugar`;
        $("finish-time").textContent = `${seconds(me.finishTime - me.reaction, 2)} · ${kcal(Math.round(me.lastTrap))} km/h · reação ${seconds(me.reaction)}`;
      } else {
        $("finish-place").textContent = `${ordinal(me.place)} lugar`;
        $("finish-time").textContent = raceTime(me.finishTime);
      }
    }
    ui.dash.hidden = spectating;
    if (!spectating) {
      ctx.drawTacho({
        speed: me.speed, rpm: me.rpm, gear: me.gear, car: me.car, manual: me.manual || drag,
        // Arrancada: faixa verde até largar; depois, a marca do giro ideal de troca.
        zone: drag && !me.launched ? [me.zoneLo, me.zoneHi] : undefined,
        shiftAt: drag && me.launched && !me.finished ? me.shiftRpm : undefined,
      });
      showNitro(ctx.hasNitro() ? me.nitro : -1, me.boost > 0);
    }
    ui.speedlines.hidden = !(me.boost > 0 && !spectating);

    // Contagem regressiva
    let countdown = "";
    if (current === "countdown") countdown = String(Math.max(1, Math.ceil(room.state.timer)));
    else if (current === "racing" && room.state.raceTime < 1) countdown = drag ? "VERDE!" : "VAI!";
    ui.countdown.hidden = !countdown;
    ui.countdown.textContent = countdown;

    // Mensagem no meio da tela
    let message = "";
    const firstDone = racers.find((p) => p.finished);
    const secondsLeft = Math.ceil(room.state.timer);
    if (drag && (current === "countdown" || current === "racing") && me.racing && !me.launched) {
      message = document.body.classList.contains("touch")
        ? "Segure o giro na faixa <b>verde</b> e toque na marcha + no verde!"
        : "Segure o giro na faixa <b>verde</b> e aperte <b>E</b> no verde!";
    } else if (current === "lobby" && room.state.event) {
      message = `${escapeHtml(RACES[this.raceId].name)}: esperando a galera chegar…`;
    } else if (spectating && current !== "results") {
      message = "Corrida em andamento: você entra na próxima! 🍟";
    } else if (current === "racing" && me.finished) {
      // Só humanos fazem esperar: contra bots, a corrida acaba logo (o tempo deles é projetado).
      const humansRacing = racers.some((p) => !p.bot && !p.finished);
      message = humansRacing ? `Esperando a galera chegar… ${secondsLeft}s` : "";
    } else if (current === "racing" && firstDone) {
      message = `${escapeHtml(firstDone.name)} já chegou! Você tem ${secondsLeft}s`;
    }
    ui.message.hidden = !message;
    setHtml(ui.message, message);

    // Fim da corrida: avisa uma vez (modo história) e, no duelo, o placar fica com a tela do duelo.
    if (current !== "results") this.reportedFinish = false;
    else if (!this.reportedFinish && this.onFinish) {
      this.reportedFinish = true;
      const mine = [...(room.state.results ?? [])].find((r) => r.sessionId === room.sessionId);
      this.onFinish({ place: mine?.place ?? 0, total: mine?.total ?? 0, cash: mine?.cash ?? 0, event: room.state.event, challenge: room.state.challenge });
    }

    // Resultado
    ui.results.hidden = current !== "results" || room.state.challenge;
    ui.results.classList.toggle("radar-off", !radar && !drag);
    if (current === "results") {
      const rows = [...(room.state.results ?? [])];
      const winner = rows[0];
      const mine = rows.find((r) => r.sessionId === room.sessionId);
      $("trap-col-title").textContent = drag ? "Reação · final" : "Radares";
      if (radar && mine) {
        // Speedtrap: contra as metas, não contra os outros.
        const margin = Math.round(mine.trap - mine.goal);
        setHtml(ui.winner, mine.medal
          ? `${medalText(mine.medal)}! ${kcal(Math.round(mine.trap))} km/h, ${kcal(margin)} acima da meta`
          : `Faltaram ${kcal(-margin)} km/h para a meta (${kcal(mine.goal)}) 🥗`);
      } else {
        setHtml(
          ui.winner,
          winner && winner.place > 0 ? `🏆 ${escapeHtml(winner.name)} levou essa!` : "Ninguém chegou?! 🥗",
        );
      }
      setHtml(
        ui.resultsBody,
        rows
          .map((row, i) =>
            `<tr class="${row.sessionId === room.sessionId ? "me" : ""}"><td>${i + 1}</td>` +
            `<td><span class="dot" style="background:${row.color}"></span>${row.bot ? "🤖 " : ""}${escapeHtml(row.name)}</td>` +
            `<td>${radar ? (row.medal ? medalText(row.medal) : "Sem meta") : drag && row.jumped ? "Queimou" : row.place ? ordinal(row.place) : "—"}</td>` +
            // Arrancada: o tempo é o da reta (sem a reação), como na placa do drag.
            `<td>${row.time ? `${row.projected ? "~" : ""}${drag ? seconds(row.time - row.reaction, 2) : raceTime(row.time)}` : "—"}</td>` +
            `<td class="trap-col">${drag
              ? `${seconds(row.reaction)}${row.speed ? ` · ${kcal(Math.round(row.speed))} km/h` : ""}`
              : `${kcal(Math.round(row.trap))} km/h${radar ? ` <small>(meta ${kcal(row.goal)})</small>` : ""}`}</td><td>${kcal(row.total)}</td>` +
            `<td>${row.cash ? money(row.cash) : "—"}</td></tr>`)
          .join(""),
      );
      ui.resultsTimer.textContent = room.state.challenge ? "" : room.state.event
        ? Number.isFinite(room.state.timer) && secondsLeft > 0
          ? `Voltando para Porto Gordo em ${secondsLeft}s (as calorias e o prêmio vão para a sua conta)`
          : "Voltando para Porto Gordo…"
        : `Voltando para o lobby em ${secondsLeft}s`;
    }

    this.playEventSounds(me);
  }

  private playEventSounds(me: { lap: number; finished: boolean; boost: number; speed: number; racing: boolean; place: number }) {
    const { ctx, previous } = this;
    const current = this.phase();

    if (current === "countdown") {
      const count = Math.ceil(this.room.state.timer);
      // A trilha da corrida começa a ser gravada na contagem (toca assim que largar).
      if (previous.phase !== "countdown") ctx.sound.prefetchSong(this.room.state.challenge ? "duel" : "race");
      if (count !== previous.countdown && count > 0) ctx.sound.beep(false, count);
      previous.countdown = count;
    }
    if (current === "racing" && previous.phase === "countdown" && me.racing) ctx.sound.beep(true);

    if (current === "racing" && me.racing) {
      const laps = this.room.state.laps || RACES[this.raceId].laps;
      if (me.lap > previous.lap && me.lap > 1 && !me.finished) ctx.sound.lap(laps > 1 && me.lap === laps);
      if (me.finished && !previous.finished) ctx.sound.finish(me.place === 1);
      if (me.boost > previous.boost + 0.9) ctx.sound.boost();
    }
    ctx.detectBump(previous, me.speed);

    previous.phase = current;
    previous.lap = me.lap;
    previous.finished = me.finished;
    previous.boost = me.boost;
    previous.speed = me.speed;
  }

  sendInput(input: InputMessage) {
    this.room.send("input", input);
  }

  sendShift(direction: number) {
    this.room.send("shift", { direction });
  }

  /** Câmbio trocado nas Opções (pela pausa): vale na hora. */
  sendGearbox(manual: boolean) {
    this.room.send("gearbox", { manual });
  }

  /** Sala de um jogador só: dá para pausar (o servidor para a simulação). */
  pausable() {
    return !!this.room.state.pausable;
  }

  paused() {
    return !!this.room.state.paused;
  }

  sendPause(paused: boolean) {
    this.room.send("pause", { paused });
  }

  sendHorn() {
    this.room.send("horn");
  }

  sendReset() {
    this.room.send("reset");
  }

  /** Buzina de outro jogador (o main toca o som com o volume pela distância). */
  onHorn(handler: (id: string) => void) {
    this.room.onMessage("horn", (message: { id: string }) => handler(message.id));
  }

  snapshot() {
    const result: Record<string, PlayerSnapshot> = {};
    this.room.state.players?.forEach((p, id) => {
      result[id] = {
        name: p.name, car: p.car, gear: p.gear, rpm: p.rpm, bot: p.bot, x: p.x, z: p.z, speed: p.speed, racing: p.racing,
        lap: p.lap, place: p.place, calories: p.calories, finished: p.finished, nitro: p.nitro, boost: p.boost > 0, level: p.level, manual: p.manual,
        launched: p.launched, reaction: p.reaction, jumped: p.jumped, launchGrade: p.launchGrade, shiftGrade: p.shiftGrade, shifts: p.shifts,
        progress: p.progress, finishTime: p.finishTime, trapTotal: p.trapTotal,
      };
    });
    return result;
  }

  /** Medalha da soma atual (null = ainda abaixo do bronze). */
  private medalOf(total: number): RadarMedal | null {
    const { goalBronze, goalSilver, goalGold } = this.room.state;
    if (!goalBronze) return null;
    return total >= goalGold ? "ouro" : total >= goalSilver ? "prata" : total >= goalBronze ? "bronze" : null;
  }

  /** Arrancada: mostra a nota da largada e de cada troca, uma vez cada. */
  private showDragGrades(me: { launchGrade: string; shiftGrade: string; shifts: number }, phase: Phase) {
    if (phase === "lobby") {
      this.seenLaunch = "";
      this.seenShifts = 0;
      return;
    }
    let text = "";
    let grade = "";
    if (me.launchGrade && me.launchGrade !== this.seenLaunch) {
      this.seenLaunch = me.launchGrade;
      this.seenShifts = me.shifts;
      grade = me.launchGrade;
      text = LAUNCH_LABELS[grade as LaunchGrade] ?? "";
    } else if (me.shifts !== this.seenShifts) {
      this.seenShifts = me.shifts;
      grade = me.shiftGrade;
      text = SHIFT_LABELS[grade as ShiftGrade] ?? "";
    }
    if (!text) return;
    const el = $("drag-grade");
    el.textContent = text;
    el.className = gradeClass(grade);
    el.dataset.grade = grade;
    el.hidden = true;
    void el.offsetWidth;
    el.hidden = false;
    if (grade === "perfeita") this.ctx.sound.click();
    clearTimeout(this.gradeTimer);
    this.gradeTimer = setTimeout(() => (el.hidden = true), 1100);
  }

  dispose() {
    this.ctx.scene?.setFinishCam(false);
    clearTimeout(this.flashTimer);
    clearTimeout(this.gradeTimer);
    $("drag-grade").hidden = true;
    ui.botsMinus.onclick = ui.botsPlus.onclick = ui.start.onclick = null;
    ui.difficulty.onchange = null;
  }
}
