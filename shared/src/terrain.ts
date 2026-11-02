// Relevo de Porto Gordo: a altura do chão (m) em cada ponto do plano XZ.
// É uma função lisa (morros em forma de sino + uma ondulação suave), igual no
// servidor e no cliente: a física usa a inclinação (subida segura, descida
// embala) e o cliente levanta o chão, as ruas, os prédios e os carros.
//
// Porto, cais, lago, autódromo e aeroporto ficam planos (altura 0). A Serra do
// Açúcar e o Morro do Torresmo são os lugares mais altos (com os dois túneis
// por dentro); a cidade velha tem só ladeiras suaves. O Rio Banha corre num
// vale (a várzea), do norte até o mar. As rampas foram conferidas por
// simulação (scripts/planta.ts).
//
// Pontes, viadutos e túneis têm o próprio perfil de altura (levels.ts): ali o
// carro não usa o `heightAt`.
import { AIRPORT, LAKE, QUAY_Z, RIVER } from "./map.ts";

/** Morros: centro, altura (negativa = baixada) e raio (desvio do sino). */
const HILLS: [number, number, number, number][] = [
  // Serra do Açúcar: o Pico do Açúcar (com o túnel) e as serras em volta
  [-280, 2320, 58, 240], [-900, 2180, 46, 360], [480, 2360, 30, 330], [-1450, 2260, 44, 400], [120, 2050, 14, 260],
  // Morro do Torresmo (com o túnel) e o morrinho da praia
  [-1170, 100, 40, 260], [-1500, -190, 16, 240], [-880, 380, 10, 200],
  // Alto da Picanha
  [-1200, 1150, 30, 380], [-900, 1500, 14, 260],
  // Roça do Milho: coxilhas
  [1300, 2150, 18, 420], [900, 2450, 12, 300],
  // Liberdade do Yakisoba: sobe devagar para o norte
  [0, 1520, 10, 380], [-350, 900, 5, 240],
  // Cidade velha: ladeiras do Jardim e da Vila, centro quase plano
  [-150, 470, 8, 220], [-440, -40, 6, 200], [60, -60, 4, 260],
  // Distrito: um morrinho
  [1540, 220, 6, 350],
];

/** Lugares planos: centro, raio onde é 100% plano e largura da transição. */
const FLAT: [number, number, number, number][] = [
  [LAKE.x, LAKE.z, Math.max(LAKE.rx, LAKE.rz) + 25, 220],
  [400, 405, 175, 220], // autódromo
  [(AIRPORT.area.minX + AIRPORT.area.maxX) / 2, (AIRPORT.area.minZ + AIRPORT.area.maxZ) / 2, 720, 260], // aeroporto
];

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** 0 = plano obrigatório, 1 = relevo livre. */
function freedom(x: number, z: number) {
  // Beira-mar plana (porto, cais e a praia), subindo a partir de ~200 m do cais.
  let f = smooth((z - (QUAY_Z + 90)) / 420);
  for (const [cx, cz, r, edge] of FLAT) {
    const d2 = (x - cx) ** 2 + (z - cz) ** 2;
    if (d2 > (r + edge) ** 2) continue;
    f *= smooth((Math.sqrt(d2) - r) / edge);
  }
  return f;
}

const RIVER_PTS = RIVER.points;
const RIVER_MIN_X = Math.min(...RIVER_PTS.map((p) => p[0])) - 400;
const RIVER_MAX_X = Math.max(...RIVER_PTS.map((p) => p[0])) + 400;
const RIVER_MAX_Z = Math.max(...RIVER_PTS.map((p) => p[1])) + 400;

/** Distância até o eixo do rio, e a meia largura e a altura da várzea no ponto mais perto. */
export function riverAt(x: number, z: number) {
  if (x < RIVER_MIN_X || x > RIVER_MAX_X || z > RIVER_MAX_Z) return { distance: Infinity, half: 0, floor: 0, t: 0 };
  let best = Infinity;
  let half = 0;
  let floor = 0;
  let along = 0;
  for (let i = 1; i < RIVER_PTS.length; i++) {
    const [ax, az] = RIVER_PTS[i - 1];
    const [bx, bz] = RIVER_PTS[i];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) {
      best = d;
      half = (RIVER.width[i - 1] + (RIVER.width[i] - RIVER.width[i - 1]) * t) / 2;
      floor = RIVER.floor[i - 1] + (RIVER.floor[i] - RIVER.floor[i - 1]) * t;
      along = i - 1 + t;
    }
  }
  return { distance: best, half, floor, t: along };
}

/** O rio molha o ponto? (`margin` alarga a margem.) */
export function inRiver(x: number, z: number, margin = 0) {
  const r = riverAt(x, z);
  if (r.t <= 0 && z > RIVER_PTS[0][1]) return false;
  return r.distance < r.half + margin;
}

/** Altura da água do rio (um pouco abaixo da várzea). */
export const RIVER_WATER_DROP = 1.1;
/** Fundo do rio, abaixo da várzea. */
const RIVER_BED = 3.2;

/** Altura do relevo sem o vale do rio. */
function hills(x: number, z: number) {
  let h = 2.2 * Math.sin(x / 190 + 1.3) * Math.sin(z / 230 + 0.7) + 1.4 * Math.sin((x + z) / 170);
  for (const [cx, cz, height, radius] of HILLS) {
    const d2 = (x - cx) ** 2 + (z - cz) ** 2;
    if (d2 > 16 * radius * radius) continue;
    h += height * Math.exp(-d2 / (2 * radius * radius));
  }
  return h * freedom(x, z);
}

/** Altura do chão (m) no ponto. */
export function heightAt(x: number, z: number) {
  const h = hills(x, z);
  const r = riverAt(x, z);
  if (r.distance === Infinity) return h;
  // Antes da nascente o vale vai sumindo.
  const source = r.t <= 0 ? smooth(1 - (z - RIVER_PTS[0][1]) / 420) : 1;
  if (source <= 0) return h;
  // Várzea: plana até 30 m da margem, subindo até o relevo normal a ~480 m.
  const bank = r.half + 30;
  const v = smooth((r.distance - bank) / 450);
  let ground = r.floor + (h - r.floor) * v;
  // Calha do rio (fundo abaixo da água).
  if (r.distance < r.half + 4) ground -= RIVER_BED * smooth(1 - (r.distance - r.half * 0.35) / (r.half * 0.65 + 4));
  return h + (ground - h) * source;
}

/** Inclinação do chão: quanto sobe por metro andando em +X e em +Z. */
export function slopeAt(x: number, z: number): [number, number] {
  const e = 1.5;
  return [(heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e)];
}

/** Rampa na direção em que o carro aponta (m por m; positivo = subida). */
export function gradeAt(x: number, z: number, heading: number) {
  const [sx, sz] = slopeAt(x, z);
  return sx * Math.sin(heading) + sz * Math.cos(heading);
}
