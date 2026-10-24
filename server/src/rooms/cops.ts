// Viaturas da Vigilância Sanitária. Como os bots, elas "apertam botões" (a
// saída é um DriveInput) e usam a mesma física dos jogadores.
//
// Navegação: longe do alvo, a viatura segue pelas ruas (caminho mais curto no
// grafo de ruas, passando pelos pontos de cada rua, inclusive nas curvas); com
// o alvo à vista, vai direto para cima dele, mirando onde ele vai estar.
import {
  CAR,
  NAV,
  insideBuilding,
  routeBetween,
  type CarState,
  type DriveInput,
} from "@nfbmc/shared";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Dá para ver (em linha reta, sem prédio no meio) de A até B? */
export function lineOfSight(ax: number, az: number, bx: number, bz: number) {
  const dist = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(dist / 5);
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    if (insideBuilding(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
  }
  return true;
}

/**
 * Onde nasce uma viatura: num cruzamento a uma distância "de chegar logo, mas
 * sem aparecer na cara do jogador".
 */
export function spawnPoint(targetX: number, targetZ: number, random: () => number = Math.random) {
  const usable = NAV.filter((n) => n.links.length > 0);
  const candidates = usable.filter((n) => {
    const d = Math.hypot(n.x - targetX, n.z - targetZ);
    return d > 100 && d < 220;
  });
  const pool = candidates.length ? candidates : usable;
  const node = pool[Math.floor(random() * pool.length)];
  return { x: node.x, z: node.z, heading: Math.atan2(targetX - node.x, targetZ - node.z) };
}

/** Pontos a seguir pelas ruas, de onde a viatura está até perto do alvo (um a cada ~16 m). */
function routePoints(fromX: number, fromZ: number, toX: number, toZ: number): [number, number][] {
  const points = routeBetween(fromX, fromZ, toX, toZ);
  return points.filter((_, i) => i % 4 === 0 || i === points.length - 1);
}

// --- Piloto da viatura -------------------------------------------------------

export interface CopBrain {
  path: [number, number][];
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

/** Decide acelerar/virar neste tick. Retorna também se a viatura deve usar o "turbo". */
export function copInput(brain: CopBrain, cop: CarState, target: CarState, stars: number, dt: number): { input: DriveInput; boost: boolean } {
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
    brain.seesTarget = distance < 40 || (distance < 170 && lineOfSight(cop.x, cop.z, target.x, target.z));
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
      brain.replanIn = 0.8;
      // O caminho já começa na rua onde a viatura está, no trecho em que ela está.
      brain.path = routePoints(cop.x, cop.z, target.x, target.z);
      if (brain.path.length === 0) brain.path = [[target.x, target.z]];
    }
    while (brain.path.length > 1 && Math.hypot(brain.path[0][0] - cop.x, brain.path[0][1] - cop.z) < 10) brain.path.shift();
    [aimX, aimZ] = brain.path[0];
    // Curva forte logo à frente: freia antes.
    const after = brain.path[1];
    if (after) {
      const inAngle = Math.atan2(aimX - cop.x, aimZ - cop.z);
      const outAngle = Math.atan2(after[0] - aimX, after[1] - aimZ);
      const turn = Math.abs(wrap(outAngle - inAngle));
      const toTurn = Math.hypot(aimX - cop.x, aimZ - cop.z);
      if (turn > 0.6 && toTurn < Math.max(18, cop.speed * 1.2)) slowFor = turn > 1.2 ? 14 : 20;
    }
  }

  const want = wrap(Math.atan2(aimX - cop.x, aimZ - cop.z) - cop.heading);
  const steer = clamp(-want * 3, -1, 1);
  // Quanto maior o nível, mais rápido a viatura anda: com 1★ dá para despistar.
  const topSpeed = CAR.maxSpeed * Math.min(1, 0.76 + 0.06 * stars);
  const desired = slowFor || (Math.abs(want) > 1 ? 14 : topSpeed);
  let throttle = 0;
  if (cop.speed < desired - 1) throttle = 1;
  else if (cop.speed > desired + 3) throttle = -1;

  // A partir de 3 estrelas, a viatura "pisa fundo" (turbo) quando está longe e em linha reta.
  const boost = stars >= 3 && distance > 60 && Math.abs(want) < 0.3 && !slowFor;
  return { input: { throttle, steer }, boost };
}
