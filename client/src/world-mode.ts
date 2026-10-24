// Modo mundo aberto: dirigir por Porto Gordo, comer nas barraquinhas e
// disparar corridas nos pontos de encontro.
import {
  DIFFICULTY_LABELS,
  DISTRICTS,
  districtAt,
  POLICE,
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
  private bannerTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bairro onde o carro estava no quadro anterior (para mostrar a placa ao trocar). */
  private district: string | null = null;

  constructor(room: WorldRoom, ctx: ModeContext, onGoRace: (message: GoRaceMessage) => void, onToken: (token: string) => void) {
    this.room = room;
    this.ctx = ctx;
    room.onMessage("profile", (message: { token: string; races: number; wins: number; bestRace: number }) => {
      onToken(message.token);
      ui.worldStats.textContent = message.races > 0
        ? `${message.races} ${message.races === 1 ? "corrida" : "corridas"} · ${message.wins} ${message.wins === 1 ? "vitória" : "vitórias"} · melhor corrida: ${kcal(message.bestRace)} kcal`
        : "Nenhuma corrida ainda: procure uma coluna de luz 🏁";
    });
    room.onMessage("goRace", (message: GoRaceMessage) => onGoRace(message));
    room.onMessage("notice", (message: { text: string }) => showPopup(message.text));
    room.onMessage("pursuit", (message: { result: "escaped" | "busted"; calories: number }) => {
      // O número que sobe/desce aqui já é o da Vigilância; não é comida.
      this.previous.calories = -1;
      if (message.result === "escaped") {
        ctx.sound.escaped();
        this.showBanner("escaped", "Escapou!", `A Vigilância perdeu você de vista. +${kcal(message.calories)} kcal`);
      } else {
        ctx.sound.busted();
        this.showBanner("busted", "Autuado!", message.calories > 0
          ? `A Vigilância Sanitária confiscou ${kcal(message.calories)} kcal`
          : "Sorte que você não tinha nada para confiscar");
      }
    });

    const changeBots = (delta: number) => {
      ctx.sound.click();
      this.bots = Math.max(0, Math.min(MAX_PLAYERS - 1, this.bots + delta));
    };
    ui.markerBotsMinus.onclick = () => changeBots(-1);
    ui.markerBotsPlus.onclick = () => changeBots(1);
    ui.markerDifficulty.onchange = () => ui.markerDifficulty.blur();
    ui.startRace.onclick = () => this.startRace();
  }

  private showBanner(kind: "escaped" | "busted", title: string, subtitle: string) {
    ui.banner.className = kind;
    setHtml(ui.banner, `${escapeHtml(title)}<small>${escapeHtml(subtitle)}</small>`);
    ui.banner.hidden = false;
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => (ui.banner.hidden = true), 3500);
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
    room.state.cops?.forEach((c, id) => {
      cars.set(`cop:${id}`, {
        name: "🚨 Vigilância", color: "#f4f4f0", x: c.x, z: c.z, heading: c.heading,
        speed: c.speed, boost: c.boost, visible: true, cop: true,
      });
    });
    const me = room.state.players?.get(room.sessionId);
    const followed = ctx.scene
      ? (ctx.scene.syncCars(cars), ctx.scene.syncFoods([...(room.state.stands ?? [])]), ctx.scene.render(cars, room.sessionId))
      : null;
    if (!me) return;

    const myCops = [...(room.state.cops?.values() ?? [])].filter((c) => c.target === room.sessionId);
    const nearestCop = myCops.length ? Math.min(...myCops.map((c) => Math.hypot(c.x - me.x, c.z - me.z))) : null;
    ctx.sound.song(myCops.length ? "pursuit" : "lobby");
    ctx.sound.updateSiren(myCops.length ? nearestCop : null);
    this.updatePursuitUi(me, myCops.length > 0);
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
    this.updateDistrict(me.x, me.z);
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
      ui.startRace.disabled = this.calling || myCops.length > 0;
      ui.startRace.textContent = myCops.length > 0
        ? "Despiste a Vigilância primeiro!"
        : this.calling ? "Chamando a galera…" : "Começar corrida (Enter)";
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

  private updateDistrict(x: number, z: number) {
    const id = districtAt(x, z);
    if (id === this.district) return;
    this.district = id;
    // Reinicia a animação da placa trocando o texto e re-exibindo o elemento.
    ui.district.hidden = true;
    ui.district.textContent = DISTRICTS.find((d) => d.id === id)?.name ?? "";
    void ui.district.offsetWidth;
    ui.district.hidden = false;
  }

  /** Estrelas de procurado e a barra de perseguição/fuga/autuação. */
  private updatePursuitUi(me: { heat: number; chased: boolean; escape: number; bust: number }, pursued: boolean) {
    const stars = Math.floor(me.heat);
    ui.wanted.hidden = me.heat < 0.05;
    if (!ui.wanted.hidden) {
      setHtml(ui.wanted, Array.from({ length: POLICE.maxHeat }, (_, i) =>
        `<span class="${i < stars ? "" : "off"}">🚨</span>`).join(""));
      ui.wanted.title = `Nível de procurado: ${stars}`;
      ui.wanted.dataset.stars = String(stars);
    }

    ui.pursuit.hidden = !pursued;
    ui.vignette.classList.toggle("chase", pursued && me.chased);
    if (!pursued) return;
    let kind: "chase" | "escape" | "bust" = me.chased ? "chase" : "escape";
    if (me.bust > 0.05) kind = "bust";
    ui.pursuit.className = kind;
    ui.pursuitLabel.textContent = kind === "bust" ? "Autuação!" : kind === "escape" ? "Despistando…" : "Perseguição";
    ui.pursuitFill.style.width = `${Math.round((kind === "bust" ? me.bust : me.escape) * 100)}%`;
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

  /** Viaturas e nível de procurado, para os testes. */
  policeSnapshot() {
    const me = this.room.state.players?.get(this.room.sessionId);
    return {
      heat: me?.heat ?? 0,
      chased: me?.chased ?? false,
      cops: [...(this.room.state.cops?.values() ?? [])].map((c) => ({ x: c.x, z: c.z, target: c.target })),
    };
  }

  /** Mensagem direta para a sala (os testes usam com os ganchos de teste do servidor). */
  send(type: string, message: unknown) {
    this.room.send(type as "input", message as InputMessage);
  }

  dispose() {
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    ui.markerBotsMinus.onclick = ui.markerBotsPlus.onclick = ui.startRace.onclick = null;
    ui.markerDifficulty.onchange = null;
  }
}
