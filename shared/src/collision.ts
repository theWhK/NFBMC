// Colisão entre carros: cada carro é uma caixa girada do tamanho dele (não um
// círculo). Quando duas caixas se tocam, elas são separadas e trocam um impulso
// que conserva o momento (carro pesado empurra o leve), com um pouco de quique,
// atrito no ponto de contato e giro quando a batida é fora do centro. Sem dano:
// é arcade.
import type { CarMotion, CarState } from "./physics.ts";

export interface CarBody {
  car: CarState;
  motion: CarMotion;
  /** Meio comprimento e meia largura (m). */
  halfLength: number;
  halfWidth: number;
  mass: number;
}

export interface Impact {
  a: number;
  b: number;
  /** Velocidade de aproximação no momento da batida (m/s). */
  speed: number;
}

/** Coeficiente de restituição: 0 = cola, 1 = bola de bilhar. Carro amassa: quase não quica. */
const RESTITUTION = 0.08;
/** Atrito no ponto de contato (raspar de lado tira velocidade dos dois). */
const FRICTION = 0.4;
/** Quanto do torque da batida vira giro (o resto os pneus seguram) e o giro máximo (rad/s, ~140°/s). */
const SPIN_SHARE = 0.3;
const MAX_SPIN = 2.5;

type Vec = [number, number];

const forwardOf = (car: CarState): Vec => [Math.sin(car.heading), Math.cos(car.heading)];
const rightOf = (car: CarState): Vec => [-Math.cos(car.heading), Math.sin(car.heading)];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];

function corners(body: CarBody): Vec[] {
  const f = forwardOf(body.car);
  const r = rightOf(body.car);
  const { x, z } = body.car;
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([sf, sr]) => [
    x + f[0] * body.halfLength * sf + r[0] * body.halfWidth * sr,
    z + f[1] * body.halfLength * sf + r[1] * body.halfWidth * sr,
  ]);
}

/** Velocidade (vetor) de um carro: a da direção dele mais o empurrão lateral. */
function velocity(body: CarBody): Vec {
  const f = forwardOf(body.car);
  return [f[0] * body.car.speed + body.motion.vx, f[1] * body.car.speed + body.motion.vz];
}

/**
 * Teste de eixos separadores entre duas caixas giradas. Devolve a normal (de A
 * para B), a profundidade e um ponto de contato aproximado, ou null se não tocam.
 */
function overlap(a: CarBody, b: CarBody) {
  const ca = corners(a);
  const cb = corners(b);
  let depth = Infinity;
  let normal: Vec = [0, 0];
  for (const axis of [forwardOf(a.car), rightOf(a.car), forwardOf(b.car), rightOf(b.car)]) {
    const pa = ca.map((p) => dot(p, axis));
    const pb = cb.map((p) => dot(p, axis));
    const d = Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb));
    if (d <= 0) return null;
    if (d < depth) {
      depth = d;
      normal = axis;
    }
  }
  // Normal apontando de A para B.
  if (dot([b.car.x - a.car.x, b.car.z - a.car.z], normal) < 0) normal = [-normal[0], -normal[1]];
  // Ponto de contato: o canto de cada caixa que mais entrou na outra, na média.
  const deepest = (points: Vec[], dir: Vec) => points.reduce((best, p) => (dot(p, dir) > dot(best, dir) ? p : best));
  const pa = deepest(ca, normal);
  const pb = deepest(cb, [-normal[0], -normal[1]]);
  return { normal, depth, contact: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2] as Vec };
}

/** Aplica uma mudança de velocidade (vetor) num carro: parte vira velocidade, parte vira empurrão lateral. */
function applyVelocity(body: CarBody, dv: Vec) {
  const f = forwardOf(body.car);
  const along = dot(dv, f);
  body.car.speed += along;
  body.motion.vx += dv[0] - f[0] * along;
  body.motion.vz += dv[1] - f[1] * along;
}

/**
 * Resolve as colisões entre todos os carros. Devolve as batidas (para sons,
 * nível de procurado etc.).
 */
export function collideCars(bodies: CarBody[]): Impact[] {
  const impacts: Impact[] = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      // Filtro rápido: longe demais para se tocar.
      const reach = Math.hypot(a.halfLength, a.halfWidth) + Math.hypot(b.halfLength, b.halfWidth);
      if (Math.abs(a.car.x - b.car.x) > reach || Math.abs(a.car.z - b.car.z) > reach) continue;
      const hit = overlap(a, b);
      if (!hit) continue;
      const { normal: n, depth, contact } = hit;
      const ia = 1 / a.mass;
      const ib = 1 / b.mass;

      // Separa as caixas (o mais leve anda mais).
      const push = depth / (ia + ib);
      a.car.x -= n[0] * push * ia;
      a.car.z -= n[1] * push * ia;
      b.car.x += n[0] * push * ib;
      b.car.z += n[1] * push * ib;

      // Impulso só se estão se aproximando.
      const va = velocity(a);
      const vb = velocity(b);
      const rel: Vec = [vb[0] - va[0], vb[1] - va[1]];
      const approach = dot(rel, n);
      if (approach >= 0) continue;
      const jn = (-(1 + RESTITUTION) * approach) / (ia + ib);
      // Atrito: freia o deslizamento tangencial entre os dois.
      const tangent: Vec = [rel[0] - n[0] * approach, rel[1] - n[1] * approach];
      const tLen = Math.hypot(tangent[0], tangent[1]);
      const jt = tLen > 1e-3 ? Math.min(FRICTION * jn, tLen / (ia + ib)) : 0;
      const t: Vec = tLen > 1e-3 ? [tangent[0] / tLen, tangent[1] / tLen] : [0, 0];
      const impulse: Vec = [n[0] * jn + t[0] * jt, n[1] * jn + t[1] * jt];
      applyVelocity(a, [-impulse[0] * ia, -impulse[1] * ia]);
      applyVelocity(b, [impulse[0] * ib, impulse[1] * ib]);

      // Giro: batida fora do centro faz o carro rodar (torque = braço × impulso).
      for (const [body, sign] of [[a, -1], [b, 1]] as const) {
        const arm: Vec = [contact[0] - body.car.x, contact[1] - body.car.z];
        const torque = (arm[0] * impulse[1] - arm[1] * impulse[0]) * sign;
        const inertia = (body.mass * ((body.halfLength * 2) ** 2 + (body.halfWidth * 2) ** 2)) / 12;
        // No plano XZ com o ângulo do jogo (0 = +Z, cresce para +X), o giro tem o sinal invertido.
        body.motion.spin = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, body.motion.spin - (torque / inertia) * SPIN_SHARE));
      }
      impacts.push({ a: i, b: j, speed: -approach });
    }
  }
  return impacts;
}
