// Relevo de Porto Gordo: a altura do chão (m) em cada ponto do plano XZ.
// É uma função lisa (morros em forma de sino + uma ondulação suave), igual no
// servidor e no cliente: a física usa a inclinação (subida segura, descida
// embala) e o cliente levanta o chão, as ruas, os prédios e os carros.
//
// Porto, cais, lago, autódromo e aeroporto ficam planos (altura 0). A Serra do
// Açúcar e o Morro do Torresmo são os lugares mais altos; a cidade velha tem
// só ladeiras suaves. As rampas foram conferidas por simulação: nenhuma rua
// passa de ~14% de inclinação.
import { LAKE, QUAY_Z } from "./map.ts";

/** Morros: centro, altura (negativa = baixada) e raio (desvio do sino). */
const HILLS: [number, number, number, number][] = [
  // Serra do Açúcar
  [-900, 2150, 62, 480], [-250, 2230, 46, 420], [320, 2380, 32, 380], [-1420, 2260, 48, 440],
  // Morro do Torresmo
  [-1080, 160, 36, 360], [-1380, -20, 16, 300],
  // Alto da Picanha
  [-1150, 1100, 30, 480], [-800, 1450, 12, 320],
  // Roça do Milho: coxilhas
  [1120, 2020, 18, 460], [780, 2330, 12, 340],
  // Liberdade do Yakisoba: uma subida para o norte e uma baixada perto do aeroporto
  [-280, 1320, 12, 340], [320, 860, -6, 280],
  // Cidade velha: ladeiras do Jardim e da Vila, centro quase plano
  [-150, 430, 9, 220], [-440, -40, 7, 230], [60, -60, 4, 260],
  // Distrito: um morrinho
  [1150, 180, 5, 320],
];

/** Lugares planos: centro, raio onde é 100% plano e largura da transição. */
const FLAT: [number, number, number, number][] = [
  [LAKE.x, LAKE.z, Math.max(LAKE.rx, LAKE.rz) + 25, 220],
  [400, 405, 175, 220], // autódromo
  [1060, 1125, 420, 260], // aeroporto (pista e hangares)
];

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** 0 = plano obrigatório, 1 = relevo livre. */
function freedom(x: number, z: number) {
  // Beira-mar plana (porto, cais e a praia), subindo a partir de ~200 m do cais.
  let f = smooth((z - (QUAY_Z + 90)) / 420);
  for (const [cx, cz, r, edge] of FLAT) f *= smooth((Math.hypot(x - cx, z - cz) - r) / edge);
  return f;
}

/** Altura do chão (m) no ponto. */
export function heightAt(x: number, z: number) {
  let h = 2.2 * Math.sin(x / 190 + 1.3) * Math.sin(z / 230 + 0.7) + 1.4 * Math.sin((x + z) / 170);
  for (const [cx, cz, height, radius] of HILLS) {
    const d2 = (x - cx) ** 2 + (z - cz) ** 2;
    h += height * Math.exp(-d2 / (2 * radius * radius));
  }
  return h * freedom(x, z);
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
