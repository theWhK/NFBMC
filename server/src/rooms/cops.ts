// Viaturas da Vigilância Sanitária. Como os bots, elas "apertam botões" (a
// saída é um DriveInput) e usam a mesma física dos jogadores.
//
// Navegação: longe do alvo, a viatura segue pelas ruas (caminho mais curto no
// grafo de ruas, passando pelos pontos de cada rua, inclusive nas curvas); com
// o alvo à vista, vai direto para cima dele, mirando onde ele vai estar.
import {
  NAV,
  cachedTopSpeed,
  cornerSpeed,
  insideBuilding,
  routeBetween,
  type CarSpec,
  type CarState,
  type DriveInput,
} from "@nfbmc/shared";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * Dá para ir em linha reta de A até B sem passar por prédio? Confere um
 * "corredor" da largura do carro (três linhas), em passos curtos, para não
 * deixar escapar quina de casa.
 */
export function lineOfSight(ax: number, az: number, bx: number, bz: number) {
  const dist = Math.hypot(bx - ax, bz - az);
  if (dist < 1) return true;
  const steps = Math.ceil(dist / 2.5);
  const sx = ((bz - az) / dist) * 2;
  const sz = (-(bx - ax) / dist) * 2;
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    if (insideBuilding(x, z) || insideBuilding(x + sx, z + sz) || insideBuilding(x - sx, z - sz)) return false;
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

/** Velocidade alvo seguindo `path`: para cada curva à frente, a velocidade dela mais o que dá para frear até lá. */
function plannedSpeed(path: [number, number][], cop: CarState, spec: CarSpec) {
  const brake = spec.brake * 0.7;
  const look = (cop.speed * cop.speed) / (2 * brake) + 30;
  let desired = Infinity;
  let travelled = Math.hypot(path[0][0] - cop.x, path[0][1] - cop.z);
  let previous: [number, number] = [cop.x, cop.z];
  for (let i = 0; i < path.length - 1 && travelled < look; i++) {
    const a = previous;
    const b = path[i];
    const c = path[i + 1];
    const inAngle = Math.atan2(b[0] - a[0], b[1] - a[1]);
    const outAngle = Math.atan2(c[0] - b[0], c[1] - b[1]);
    const turn = Math.abs(wrap(outAngle - inAngle));
    const segment = Math.min(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1]));
    if (turn > 0.05) {
      const corner = cornerSpeed(spec, Math.max(8, segment / turn)) * 0.9;
      desired = Math.min(desired, Math.sqrt(corner * corner + 2 * brake * Math.max(0, travelled - 6)));
    }
    travelled += Math.hypot(c[0] - b[0], c[1] - b[1]);
    previous = b;
  }
  return desired;
}

// --- Piloto da viatura -------------------------------------------------------

export interface CopBrain {
  path: [number, number][];
  replanIn: number;
  seesTarget: boolean;
  sightCheckIn: number;
  stuckFor: number;
  reverseFor: number;
  /** Depois de se desatolar, segue pela rua um tempo antes de tentar ir direto de novo. */
  roadOnlyFor: number;
}

export const createCopBrain = (): CopBrain => ({
  roadOnlyFor: 0,
  path: [],
  replanIn: 0,
  seesTarget: false,
  sightCheckIn: 0,
  stuckFor: 0,
  reverseFor: 0,
});

/** Decide acelerar/virar neste tick. Retorna também se a viatura deve usar o "turbo". */
export function copInput(brain: CopBrain, cop: CarState, spec: CarSpec, target: CarState, stars: number, dt: number): { input: DriveInput; boost: boolean } {
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
    brain.roadOnlyFor = 3;
  }
  brain.roadOnlyFor = Math.max(0, brain.roadOnlyFor - dt);

  // Enxerga o alvo? (A checagem de prédios no caminho é cara: 4× por segundo basta.)
  brain.sightCheckIn -= dt;
  if (brain.sightCheckIn <= 0) {
    brain.sightCheckIn = 0.25;
    brain.seesTarget = brain.roadOnlyFor <= 0
      && (distance < 20 || (distance < 170 && lineOfSight(cop.x, cop.z, target.x, target.z)));
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
    // Velocidade pela curvatura do caminho à frente e pelo espaço para frear até cada curva.
    slowFor = plannedSpeed(brain.path, cop, spec);
  }  const want = wrap(Math.atan2(aimX - cop.x, aimZ - cop.z) - cop.heading);
  const steer = clamp(-want * 3, -1, 1);
  // Quanto maior o nível, mais rápido a viatura anda: com 1★ dá para despistar.
  const topSpeed = cachedTopSpeed(spec) * Math.min(1, 0.76 + 0.06 * stars);
  const desired = Math.min(slowFor || Infinity, Math.abs(want) > 1 ? 14 : topSpeed);
  let throttle = 0;
  if (cop.speed < desired - 1) throttle = 1;
  else if (cop.speed > desired + 3) throttle = -1;
  // Chegando no alvo: no máximo a velocidade dele mais um pouco (para encostar
  // e cercar) mais o que dá para frear até ficar a ~6 m dele. Sem isso, com a
  // colisão de verdade, a viatura chegava a toda e saía empurrando o carro rua
  // afora em vez de cercar e autuar.
  if (brain.seesTarget) {
    // Já colada (menos de 8 m), fica um pouco abaixo da velocidade dele: se mirasse
    // acima, empurraria o carro, ele ganharia velocidade e ela aceleraria mais.
    const margin = distance < 8 ? -2 : 3;
    const closing = Math.max(0, target.speed) + margin + Math.sqrt(2 * spec.brake * 0.6 * Math.max(0, distance - 6));
    if (cop.speed > closing + 1) throttle = cop.speed > 0.5 ? -1 : 0;
    else if (cop.speed > closing - 1 && throttle > 0) throttle = 0;
  }

  // A partir de 2 estrelas, a viatura "pisa fundo" (turbo) quando está longe, alinhada
  // e com folga até a próxima curva.
  const boost = stars >= 2 && distance > 60 && Math.abs(want) < 0.3 && desired > cop.speed + 12 && throttle > 0;
  return { input: { throttle, steer }, boost };
}
