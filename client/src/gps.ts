// GPS do mundo aberto: o jogador marca um destino no mapa (M/Tab) e a rota
// pelas ruas aparece no minimapa, no mapa grande e no chão, com a próxima
// conversão no alto da tela. Saiu da rota, recalcula; chegou, avisa e apaga.
import { routeBetween } from "@nfbmc/shared";

type Point = [number, number];

export interface GpsTarget {
  x: number;
  z: number;
  /** Nome do destino ("Circuito do Centro", "Centro"...). */
  label: string;
}

export interface GpsGuidance {
  /** Próxima manobra: vira à esquerda/direita, segue, faz o retorno ou chegou. */
  turn: "left" | "right" | "straight" | "back" | "arrive";
  /** Metros até a manobra. */
  distance: number;
  /** Metros até o destino pela rota. */
  remaining: number;
}

/** Longe assim da rota, recalcula (m). */
const OFF_ROUTE = 22;
/** Perto assim do destino, chegou (m). */
const ARRIVE = 25;
/** Virada que conta como "vire" (rad, ~35°). */
const TURN_ANGLE = 0.6;

export function createGps(onChange: () => void) {
  let target: GpsTarget | null = null;
  let route: Point[] = [];
  /** Distância acumulada de cada ponto da rota desde o começo. */
  let cumulative: number[] = [];
  let progress = 0;
  let rerouteAt = 0;
  let guidance: GpsGuidance | null = null;

  const plan = (x: number, z: number) => {
    if (!target) return;
    route = [...routeBetween(x, z, target.x, target.z), [target.x, target.z]];
    cumulative = [0];
    for (let i = 1; i < route.length; i++) {
      cumulative.push(cumulative[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]));
    }
    progress = 0;
    onChange();
  };

  /** Ponto da rota mais perto de (x, z), procurando um pouco à frente do último. */
  const locate = (x: number, z: number) => {
    let best = progress;
    let bestDist = Infinity;
    const end = Math.min(route.length - 1, progress + 80);
    for (let i = progress; i < end; i++) {
      const [ax, az] = route[i];
      const [bx, bz] = route[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return { index: best, distance: bestDist };
  };

  /** Direção do trecho de rota de i até ~12 m à frente. */
  const directionAt = (i: number) => {
    let j = i + 1;
    while (j < route.length - 1 && cumulative[j] - cumulative[i] < 12) j++;
    return Math.atan2(route[j][0] - route[i][0], route[j][1] - route[i][1]);
  };

  const nextTurn = (heading: number): GpsGuidance => {
    const remaining = cumulative[cumulative.length - 1] - cumulative[progress];
    // A rota sai para trás do carro: retorno.
    const ahead = directionAt(progress);
    if (Math.abs(Math.atan2(Math.sin(ahead - heading), Math.cos(ahead - heading))) > 2.3) return { turn: "back", distance: 0, remaining };
    for (let i = progress + 1; i < route.length - 2; i++) {
      // Compara o rumo de ~12 m antes com o de ~12 m depois deste ponto.
      let back = i - 1;
      while (back > progress && cumulative[i] - cumulative[back] < 12) back--;
      const before = Math.atan2(route[i][0] - route[back][0], route[i][1] - route[back][1]);
      const after = directionAt(i);
      const delta = Math.atan2(Math.sin(after - before), Math.cos(after - before));
      if (Math.abs(delta) > TURN_ANGLE) {
        // Rumo 0 aponta para +Z e cresce para +X, que é a esquerda de quem dirige (Y para cima).
        return { turn: delta > 0 ? "left" : "right", distance: cumulative[i] - cumulative[progress], remaining };
      }
      if (cumulative[i] - cumulative[progress] > 600) break;
    }
    return { turn: remaining < 120 ? "arrive" : "straight", distance: remaining, remaining };
  };

  return {
    /** Marca (ou apaga, com null) o destino. A rota sai da posição atual. */
    setTarget(next: GpsTarget | null, from?: { x: number; z: number }) {
      target = next;
      route = [];
      cumulative = [];
      guidance = null;
      if (target && from) plan(from.x, from.z);
      else onChange();
    },
    target: () => target,
    route: () => route,
    /** Ponto da rota onde o carro está (o que já passou não é desenhado). */
    progress: () => progress,
    guidance: () => guidance,
    /**
     * A cada quadro, com a posição do carro: acompanha a rota, recalcula se
     * saiu dela e devolve true quando chegou.
     */
    update(x: number, z: number, heading: number, now: number): boolean {
      if (!target) return false;
      if (Math.hypot(target.x - x, target.z - z) < ARRIVE) {
        target = null;
        route = [];
        guidance = null;
        onChange();
        return true;
      }
      if (route.length < 2) plan(x, z);
      const here = locate(x, z);
      if (here.distance > OFF_ROUTE && now > rerouteAt) {
        // Saiu da rota: recalcula (no máximo uma vez por segundo).
        rerouteAt = now + 1000;
        plan(x, z);
      } else if (here.index !== progress) {
        progress = here.index;
      }
      guidance = nextTurn(heading);
      return false;
    },
  };
}

export type Gps = ReturnType<typeof createGps>;
