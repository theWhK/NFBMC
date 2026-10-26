// Co-op no mundo aberto: o painel "Online agora" do mapa (quem está na cidade,
// a que distância, e quem está jogando em outro lugar) com o botão de desafiar
// para um pega, e o cartão de convite de quem foi desafiado.
import {
  CHALLENGE_SECONDS,
  RACES,
  RACE_IDS,
  atRace,
  isRaceId,
  raceMarker,
  type ChallengeInvite,
  type OnlinePilot,
  type RaceId,
} from "@nfbmc/shared";

import type { Sound } from "./audio.ts";
import { fetchOnline, type WorldRoom } from "./net.ts";
import { $, escapeHtml, kcal } from "./ui.ts";

/** Onde o piloto está, em português ("em Porto Gordo", "correndo: Volta do Lago"...). */
export function whereLabel(pilot: Pick<OnlinePilot, "where" | "raceId">) {
  const race = pilot.raceId && pilot.raceId in RACES ? RACES[pilot.raceId as RaceId].name : "";
  switch (pilot.where) {
    case "world": return "em Porto Gordo";
    case "story": return "no modo história";
    case "solo": return "jogando sozinho";
    case "duel": return "num duelo da Lista Gorda";
    case "event": return race ? `correndo: ${race}` : "correndo";
    default: return race ? `na corrida rápida (${race})` : "na corrida rápida";
  }
}

const distanceLabel = (meters: number) =>
  meters < 1000 ? `a ${Math.round(meters / 10) * 10} m` : `a ${(meters / 1000).toFixed(1).replace(".", ",")} km`;

interface CarLike {
  name: string;
  color: string;
  x: number;
  z: number;
  calories: number;
}

export class CoopPanel {
  private room: WorldRoom;
  private sound: Sound;
  private focusMap: (x: number, z: number) => void;
  private list = $("online-list");
  private select = $<HTMLSelectElement>("challenge-race");
  private hint = $("online-hint");
  private card = $("challenge-card");
  private rows = new Map<string, HTMLLIElement>();
  /** Pilotos de outras salas (da API), atualizados a cada poucos segundos com o mapa aberto. */
  private remote: OnlinePilot[] = [];
  private lastRender = 0;
  private lastFetch = -Infinity;
  private mapWasOpen = false;
  /** O jogador escolheu a pista; senão, vai a do ponto de encontro mais perto. */
  private raceChosen = false;
  private invite: ChallengeInvite | null = null;
  private inviteTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(room: WorldRoom, sound: Sound, focusMap: (x: number, z: number) => void) {
    this.room = room;
    this.sound = sound;
    this.focusMap = focusMap;
    this.select.innerHTML = RACE_IDS.map((id) => `<option value="${id}">${escapeHtml(RACES[id].name)}</option>`).join("");
    this.select.onchange = () => {
      this.raceChosen = true;
      this.select.blur();
    };
    // Um clique só no painel inteiro: o botão desafia, o resto da linha mostra o piloto no mapa.
    this.list.onclick = (e) => {
      const target = e.target as HTMLElement;
      const button = target.closest<HTMLButtonElement>("button[data-to]");
      if (button) {
        this.sound.click();
        this.room.send("challenge", { to: button.dataset.to!, raceId: this.select.value });
        button.blur();
        return;
      }
      const id = target.closest<HTMLLIElement>("li")?.dataset.key;
      const car = id ? this.room.state.players?.get(id) : undefined;
      if (car) this.focusMap(car.x, car.z);
    };

    room.onMessage("challenge", (invite: ChallengeInvite) => this.showInvite(invite));
    room.onMessage("challengeGone", (message: { id: string }) => {
      if (this.invite?.id === message.id) this.hideInvite();
    });
    $("challenge-accept").onclick = () => this.answer(true);
    $("challenge-decline").onclick = () => this.answer(false);
  }

  /** Y aceita e X recusa o desafio que estiver na tela. Devolve se usou a tecla. */
  answerKey(code: string) {
    if (!this.invite || (code !== "KeyY" && code !== "KeyX")) return false;
    this.answer(code === "KeyY");
    return true;
  }

  private showInvite(invite: ChallengeInvite) {
    this.invite = invite;
    const where = isRaceId(invite.raceId) ? atRace(invite.raceId) : "na cidade";
    $("challenge-text").innerHTML =
      `<span class="dot" style="background:${escapeHtml(invite.color)}"></span><strong>${escapeHtml(invite.fromName)}</strong> ` +
      `chamou você para um pega ${escapeHtml(where)}.`;
    // A barra esvazia no tempo que o servidor dá para responder.
    const fill = $("challenge-fill");
    fill.style.transition = "none";
    fill.style.width = "100%";
    this.card.hidden = false;
    void fill.offsetWidth;
    fill.style.transition = `width ${invite.seconds}s linear`;
    fill.style.width = "0%";
    this.sound.horn(0.6);
    if (document.body.classList.contains("touch")) navigator.vibrate?.([60, 40, 60]);
    if (this.inviteTimer) clearTimeout(this.inviteTimer);
    this.inviteTimer = setTimeout(() => this.hideInvite(), invite.seconds * 1000 + 1000);
  }

  private hideInvite() {
    this.invite = null;
    this.card.hidden = true;
    if (this.inviteTimer) clearTimeout(this.inviteTimer);
    this.inviteTimer = null;
  }

  private answer(accept: boolean) {
    if (!this.invite) return;
    this.sound.click();
    this.room.send("challengeReply", { id: this.invite.id, accept });
    this.hideInvite();
  }

  /** A cada quadro: só trabalha com o mapa aberto (e no máximo 4 vezes por segundo). */
  frame(myId: string, me: CarLike) {
    const open = !$("fullmap").hidden;
    if (!open) {
      this.mapWasOpen = false;
      return;
    }
    const now = performance.now();
    if (!this.mapWasOpen) {
      // Acabou de abrir: pista sugerida = ponto de encontro mais perto, e busca quem está fora.
      this.mapWasOpen = true;
      this.lastFetch = -Infinity;
      if (!this.raceChosen) {
        const nearest = [...RACE_IDS].sort((a, b) => {
          const ma = raceMarker(a);
          const mb = raceMarker(b);
          return Math.hypot(ma.x - me.x, ma.z - me.z) - Math.hypot(mb.x - me.x, mb.z - me.z);
        })[0];
        this.select.value = nearest;
      }
    }
    if (now - this.lastFetch > 5000) {
      this.lastFetch = now;
      void fetchOnline().then((pilots) => (this.remote = pilots));
    }
    if (now - this.lastRender < 250) return;
    this.lastRender = now;
    this.render(myId, me);
  }

  private render(myId: string, me: CarLike) {
    const state = this.room.state;
    const solo = state.solo;
    const chasedIds = new Set([...(state.cops?.values() ?? [])].map((c) => c.target));
    const iAmChased = chasedIds.has(myId);
    const keys: string[] = [];

    const update = (key: string, color: string, name: string, detail: string, challenge: { to: string; disabled: boolean; why: string } | null) => {
      let li = this.rows.get(key);
      if (!li) {
        li = document.createElement("li");
        li.dataset.key = key;
        li.innerHTML = `<span class="dot"></span><span class="who"><strong></strong><small></small></span><button type="button" class="small">Desafiar</button>`;
        this.rows.set(key, li);
      }
      (li.querySelector(".dot") as HTMLElement).style.background = color;
      li.querySelector("strong")!.textContent = name;
      li.querySelector("small")!.textContent = detail;
      const button = li.querySelector("button")!;
      button.hidden = !challenge;
      if (challenge) {
        button.dataset.to = challenge.to;
        button.disabled = challenge.disabled;
        button.title = challenge.why;
      }
      keys.push(key);
    };

    update(myId, me.color, `${me.name} (você)`, `${kcal(me.calories)} kcal`, null);

    // Quem está nesta cidade, do mais perto para o mais longe.
    const here = [...(state.players?.entries() ?? [])]
      .filter(([id]) => id !== myId)
      .map(([id, p]) => ({ id, p, distance: Math.hypot(p.x - me.x, p.z - me.z) }))
      .sort((a, b) => a.distance - b.distance);
    for (const { id, p, distance } of here) {
      const chased = chasedIds.has(id);
      const why = iAmChased ? "Despiste a Vigilância primeiro" : chased ? "Fugindo da Vigilância" : "Desafiar para um pega";
      update(id, p.color, p.name, `${distanceLabel(distance)} · ${kcal(p.calories)} kcal${chased ? " · 🚨" : ""}`, {
        to: id, disabled: iAmChased || chased, why,
      });
    }

    // Quem está jogando em outro lugar (corrida, modo solo...). Tira da lista da
    // API quem já apareceu acima (a própria cidade, inclusive você).
    const remote = [...this.remote];
    for (const p of [me, ...here.map((h) => h.p)]) {
      const index = remote.findIndex((r) => r.name === p.name && (r.where === "world" || r.where === "solo" || r.where === "story"));
      if (index >= 0) remote.splice(index, 1);
    }
    remote.forEach((p, i) => update(`api:${i}`, p.color, p.name, whereLabel(p), null));

    // Tira quem saiu e acerta a ordem (sem refazer as linhas, para não perder o clique).
    for (const [key, li] of this.rows) {
      if (keys.includes(key)) continue;
      li.remove();
      this.rows.delete(key);
    }
    keys.forEach((key, i) => {
      const li = this.rows.get(key)!;
      if (this.list.children[i] !== li) this.list.insertBefore(li, this.list.children[i] ?? null);
    });

    this.select.disabled = solo;
    this.hint.textContent = solo
      ? "Esta cidade é só sua. Para desafiar a galera, entre no Co-op pelo menu."
      : here.length === 0
        ? `Ninguém mais na cidade agora. Chame a galera: ${location.host}`
        : `Clique num piloto para ver no mapa. O desafiado tem ${CHALLENGE_SECONDS} s para aceitar.`;
  }

  dispose() {
    this.hideInvite();
    this.list.onclick = null;
    this.select.onchange = null;
    $("challenge-accept").onclick = $("challenge-decline").onclick = null;
    for (const li of this.rows.values()) li.remove();
    this.rows.clear();
  }
}
