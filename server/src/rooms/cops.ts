// Viaturas da Vigilância Sanitária. Como os bots, elas "apertam botões" (a
// saída é um DriveInput) e usam a mesma física dos jogadores.
//
// Navegação: longe do alvo, a viatura segue pelas ruas, de cruzamento em
// cruzamento (caminho mais curto na grade); com o alvo à vista, vai direto
// para cima dele, mirando onde ele vai estar daqui a pouco.
import {
  BUILDINGS,
  CAR,
  STREET_LINES,
  isOnRoad,
  type CarState,
  type DriveInput,
} from "@nfbmc/shared";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

// --- Grafo de ruas -----------------------------------------------------------

interface Node {
  x: number;
  z: number;
  neighbors: number[];
}

/** Cruzamentos da grade, ligados quando há rua entre eles. */
export const NODES: Node[] = (() => {
  const nodes: Node[] = [];
  const index = new Map<string, number>();
  for (const x of STREET_LINES) {
    for (const z of STREET_LINES) {
      if (!isOnRoad(x, z)) continue;
      index.set(`${x},${z}`, nodes.length);
      nodes.push({ x, z, neighbors: [] });
    }
  }
  for (const node of nodes) {
    const i = STREET_LINES.indexOf(node.x as (typeof STREET_LINES)[number]);
    const j = STREET_LINES.indexOf(node.z as (typeof STREET_LINES)[number]);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = STREET_LINES[i + di];
      const nz = STREET_LINES[j + dj];
      if (nx === undefined || nz === undefined) continue;
      const other = index.get(`${nx},${nz}`);
      // Só liga se o meio do caminho também é rua.
      if (other !== undefined && isOnRoad((node.x + nx) / 2, (node.z + nz) / 2)) node.neighbors.push(other);
    }
  }
  return nodes;
})();

export function nearestNode(x: number, z: number) {
  let best = 0;
  let bestDist = Infinity;
  NODES.forEach((n, i) => {
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

/** Caminho mais curto (em cruzamentos) de `from` até `to`, por busca em largura. */
function route(from: number, to: number): number[] {
  const previous = new Map<number, number>([[from, -1]]);
  const queue = [from];
  while (queue.length) {
    const current = queue.shift()!;
    if (current === to) break;
    for (const next of NODES[current].neighbors) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      queue.push(next);
    }
  }
  if (!previous.has(to)) return [to];
  const path: number[] = [];
  for (let at = to; at !== -1; at = previous.get(at)!) path.unshift(at);
  return path;
}

/** Dá para ver (em linha reta, sem prédio no meio) de A até B? */
export function lineOfSight(ax: number, az: number, bx: number, bz: number) {
  const dist = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(dist / 5);
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    if (BUILDINGS.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ)) return false;
  }
  return true;
}

/**
 * Onde nasce uma viatura: num cruzamento a uma distância "de chegar logo, mas
 * sem aparecer na cara do jogador".
 */
export function spawnPoint(targetX: number, targetZ: number, random: () => number = Math.random) {
  const candidates = NODES.filter((n) => {
    const d = Math.hypot(n.x - targetX, n.z - targetZ);
    return d > 100 && d < 190;
  });
  const pool = candidates.length ? candidates : NODES;
  const node = pool[Math.floor(random() * pool.length)];
  return { x: node.x, z: node.z, heading: Math.atan2(targetX - node.x, targetZ - node.z) };
}

// --- Piloto da viatura -------------------------------------------------------

export interface CopBrain {
  path: number[];
  replanIn: number;
  seesTarget: boolean;
  sightCheckIn: number;
  stuckFor: number;
  reverseFor: number;
}

export const createCopBrain = (): CopBrain => ({
  path: [],
  replanIn: 0,
  seesTarget: false,
  sightCheckIn: 0,
  stuckFor: 0,
  reverseFor: 0,
});

export interface CopTarget extends CarState {}

/** Decide acelerar/virar neste tick. Retorna também se a viatura deve usar o "turbo". */
export function copInput(brain: CopBrain, cop: CarState, target: CopTarget, stars: number, dt: number): { input: DriveInput; boost: boolean } {
  const distance = Math.hypot(target.x - cop.x, target.z - cop.z);

  // Desatolar: bateu e parou → ré virando por um tempo.
  if (brain.reverseFor > 0) {
    brain.reverseFor -= dt;
    const want = wrap(Math.atan2(target.x - cop.x, target.z - cop.z) - cop.heading);
    return { input: { throttle: -1, steer: want > 0 ? 1 : -1 }, boost: false };
  }
  brain.stuckFor = Math.abs(cop.speed) < 2 && distance > 12 ? brain.stuckFor + dt : 0;
  if (brain.stuckFor > 1) {
    brain.stuckFor = 0;
    brain.reverseFor = 0.9;
    brain.replanIn = 0;
  }

  // Enxerga o alvo? (A checagem de prédios no caminho é cara: 4× por segundo basta.)
  brain.sightCheckIn -= dt;
  if (brain.sightCheckIn <= 0) {
    brain.sightCheckIn = 0.25;
    brain.seesTarget = distance < 45 || (distance < 180 && lineOfSight(cop.x, cop.z, target.x, target.z));
  }

  let aimX: number;
  let aimZ: number;
  let slowFor = 0;
  if (brain.seesTarget) {
    // Mira onde o alvo vai estar (mais longe = prevê mais à frente).
    const lead = clamp(distance / 40, 0, 1.2);
    aimX = target.x + Math.sin(target.heading) * target.speed * lead;
    aimZ = target.z + Math.cos(target.heading) * target.speed * lead;
    brain.path = [];
  } else {
    brain.replanIn -= dt;
    if (brain.replanIn <= 0 || brain.path.length === 0) {
      brain.replanIn = 0.6;
      brain.path = route(nearestNode(cop.x, cop.z), nearestNode(target.x, target.z));
      // Se já passou do primeiro cruzamento (está mais perto do segundo que ele),
      // não volta nele: sem isso a viatura ficava indo e voltando no mesmo cruzamento.
      const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
      if (brain.path.length > 1 && dist(cop, NODES[brain.path[1]]) < dist(NODES[brain.path[0]], NODES[brain.path[1]])) {
        brain.path.shift();
      }
    }
    // Chegou perto do próximo cruzamento: segue para o seguinte.
    while (brain.path.length > 1 && Math.hypot(NODES[brain.path[0]].x - cop.x, NODES[brain.path[0]].z - cop.z) < 12) {
      brain.path.shift();
    }
    const next = NODES[brain.path[0]];
    aimX = next.x;
    aimZ = next.z;
    // Vai virar no cruzamento: freia antes.
    const after = brain.path[1] !== undefined ? NODES[brain.path[1]] : null;
    if (after) {
      const inAngle = Math.atan2(next.x - cop.x, next.z - cop.z);
      const outAngle = Math.atan2(after.x - next.x, after.z - next.z);
      const turn = Math.abs(wrap(outAngle - inAngle));
      const toCorner = Math.hypot(next.x - cop.x, next.z - cop.z);
      if (turn > 0.6 && toCorner < Math.max(20, cop.speed * 1.3)) slowFor = 17;
    }
  }

  const want = wrap(Math.atan2(aimX - cop.x, aimZ - cop.z) - cop.heading);
  const steer = clamp(-want * 3, -1, 1);
  const desired = slowFor || (Math.abs(want) > 1 ? 14 : CAR.maxSpeed);
  let throttle = 0;
  if (cop.speed < desired - 1) throttle = 1;
  else if (cop.speed > desired + 3) throttle = -1;

  // A partir de 3 estrelas, a viatura "pisa fundo" (turbo) quando está longe e em linha reta.
  const boost = stars >= 3 && distance > 60 && Math.abs(want) < 0.3 && !slowFor;
  return { input: { throttle, steer }, boost };
}
