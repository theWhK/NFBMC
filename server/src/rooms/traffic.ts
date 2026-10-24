// Trânsito de Porto Gordo: carros NPC que circulam pelas ruas, na mão direita,
// escolhendo caminhos ao acaso nos cruzamentos. Como os bots e as viaturas, eles
// "apertam botões" (a saída é um DriveInput) e usam a mesma física de todos.
import {
  NAV,
  ROADS,
  linkPoints,
  type CarState,
  type DriveInput,
  type NavNode,
} from "@nfbmc/shared";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

type Link = NavNode["links"][number];

/** Velocidade de cruzeiro por tipo de rua (m/s). */
const CRUISE = { avenida: 17, rua: 13, viela: 9 } as const;

export interface TrafficBrain {
  /** Nó de onde o carro saiu e a ligação que ele está percorrendo. */
  from: number;
  link: Link;
  /** Pontos da faixa (já deslocados para a mão direita) e onde ele está nela. */
  lane: [number, number][];
  index: number;
  stuckFor: number;
  /** Tempo fora da faixa (bateu, foi empurrado); demais = some e reaparece. */
  lostFor: number;
}

/** Faixa da mão direita ao longo da ligação: a rua deslocada 1/4 da largura para a direita. */
function lanePoints(link: Link): [number, number][] {
  const points = linkPoints(link);
  const offset = ROADS[link.road].width * 0.25;
  return points.map(([x, z], i) => {
    const [px, pz] = points[Math.max(0, i - 1)];
    const [nx, nz] = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(nx - px, nz - pz) || 1;
    // Direita de quem anda em (dx, dz): (-dz, dx).
    return [x - ((nz - pz) / len) * offset, z + ((nx - px) / len) * offset];
  });
}

function enterLink(brain: Pick<TrafficBrain, "from" | "link" | "lane" | "index">, from: number, link: Link) {
  brain.from = from;
  brain.link = link;
  brain.lane = lanePoints(link);
  brain.index = 0;
}

/**
 * Cria um carro numa ligação perto dos jogadores: entre 60 e 220 m, e, se for
 * a menos de 120 m, só atrás do jogador (para ninguém ver o carro surgir do nada).
 */
export function spawnTraffic(near: CarState[], random: () => number = Math.random) {
  const options: { from: number; link: Link; mid: [number, number] }[] = [];
  NAV.forEach((node, from) => {
    for (const link of node.links) {
      const points = linkPoints(link);
      const mid = points[Math.floor(points.length / 2)];
      const ok = near.every((p) => {
        const d = Math.hypot(p.x - mid[0], p.z - mid[1]);
        const ahead = (mid[0] - p.x) * Math.sin(p.heading) + (mid[1] - p.z) * Math.cos(p.heading);
        return d > 60 && (d > 120 || ahead < 0);
      });
      const closest = Math.min(...near.map((p) => Math.hypot(p.x - mid[0], p.z - mid[1])));
      if (ok && closest < 220) options.push({ from, link, mid });
    }
  });
  if (!options.length) return null;
  const choice = options[Math.floor(random() * options.length)];
  const brain = { stuckFor: 0, lostFor: 0 } as TrafficBrain;
  enterLink(brain, choice.from, choice.link);
  brain.index = Math.floor(brain.lane.length / 2);
  const [x, z] = brain.lane[brain.index];
  const [nx, nz] = brain.lane[Math.min(brain.lane.length - 1, brain.index + 1)];
  return { brain, car: { x, z, heading: Math.atan2(nx - x, nz - z), speed: CRUISE[ROADS[choice.link.road].kind] * 0.8 } };
}

/** Próxima ligação no cruzamento: qualquer uma, menos voltar (a não ser em rua sem saída). */
function nextLink(brain: TrafficBrain, random: () => number): Link {
  const node = brain.link.to;
  const options = NAV[node].links.filter((l) => l.to !== brain.from || NAV[node].links.length === 1);
  return options[Math.floor(random() * options.length)];
}

/**
 * Decide acelerar/virar neste tick. `others` são todos os outros carros (para
 * frear atrás de quem estiver na frente). Retorna false se o carro se perdeu e
 * deve ser removido.
 */
export function trafficInput(
  brain: TrafficBrain,
  car: CarState,
  others: CarState[],
  dt: number,
  random: () => number = Math.random,
): DriveInput | null {
  // Avança o índice na faixa conforme passa pelos pontos.
  while (brain.index < brain.lane.length - 1 && Math.hypot(brain.lane[brain.index][0] - car.x, brain.lane[brain.index][1] - car.z) < 6) {
    brain.index++;
  }
  if (brain.index >= brain.lane.length - 1 && Math.hypot(brain.lane[brain.lane.length - 1][0] - car.x, brain.lane[brain.lane.length - 1][1] - car.z) < 8) {
    enterLink(brain, brain.link.to, nextLink(brain, random));
  }

  const [tx, tz] = brain.lane[Math.min(brain.lane.length - 1, brain.index + 1)];
  const offLane = Math.hypot(brain.lane[brain.index][0] - car.x, brain.lane[brain.index][1] - car.z);
  brain.lostFor = offLane > 14 ? brain.lostFor + dt : 0;
  brain.stuckFor = Math.abs(car.speed) < 0.5 ? brain.stuckFor + dt : 0;
  if (brain.lostFor > 4 || brain.stuckFor > 12) return null;

  const want = wrap(Math.atan2(tx - car.x, tz - car.z) - car.heading);
  const steer = clamp(-want * 2.5, -1, 1);

  // Ritmo: cruzeiro da rua, devagar perto do fim da ligação (vai virar) e em curvas.
  const road = ROADS[brain.link.road];
  const end = brain.lane[brain.lane.length - 1];
  const toEnd = Math.hypot(end[0] - car.x, end[1] - car.z);
  let desired: number = CRUISE[road.kind];
  if (toEnd < 22) desired = Math.min(desired, 8);
  if (Math.abs(want) > 0.5) desired = Math.min(desired, 6);

  // Alguém logo à frente, na mesma direção da faixa: segue atrás ou para.
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  for (const other of others) {
    const dx = other.x - car.x;
    const dz = other.z - car.z;
    const ahead = dx * fx + dz * fz;
    if (ahead <= 0 || ahead > 16) continue;
    const side = Math.abs(dx * fz - dz * fx);
    if (side > 2.6) continue;
    desired = Math.min(desired, ahead < 7 ? 0 : Math.max(0, other.speed - 1));
  }

  let throttle = 0;
  if (car.speed < desired - 0.5) throttle = 0.7;
  // Freia só em movimento: segurar o freio parado engataria a ré.
  else if (car.speed > desired + 1) throttle = car.speed > 0.5 ? -1 : 0;
  return { throttle, steer };
}
