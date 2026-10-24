// Carrocerias dos carros da garagem. Cada uma sai do perfil lateral do carro
// de verdade (capô, para-brisa, teto, traseira) extrudado na largura, mais a
// "estufa" de vidro, rodas do tamanho certo e a piada de comida de cada um.
// No perfil, x vai da traseira (-) para a frente (+) e y é a altura, em metros.
import * as THREE from "three";
import type { BodyStyle } from "@nfbmc/shared";

type Profile = [number, number][];

interface Design {
  length: number;
  width: number;
  /** Carroceria (do para-choque à linha da cintura) e estufa (vidros). */
  lower: Profile;
  cabin: Profile;
  /** Rodas: posição (x) do eixo traseiro e dianteiro, raio e bitola. */
  wheels: { rear: number; front: number; radius: number; track: number };
  /** Enfeites: aerofólio, comida, faixas... */
  extras?: (add: Adder, color: THREE.Color) => void;
}

interface Adder {
  box: (w: number, h: number, l: number, color: THREE.ColorRepresentation, x: number, y: number, z: number, rotX?: number) => void;
  cylinder: (r: number, len: number, color: THREE.ColorRepresentation, x: number, y: number, z: number, axis?: "x" | "y" | "z") => void;
  sphere: (r: number, color: THREE.ColorRepresentation, x: number, y: number, z: number, scale?: [number, number, number]) => void;
  cone: (r: number, h: number, color: THREE.ColorRepresentation, x: number, y: number, z: number, rotX?: number) => void;
  /** Material emissivo (brilha mesmo no escuro), ex.: neon. */
  glow: (w: number, l: number, color: THREE.ColorRepresentation, y: number) => void;
}

/** Aerofólio: duas colunas e a lâmina, na traseira (z negativo = trás). */
const wing = (add: Adder, z: number, height: number, width: number, color: THREE.ColorRepresentation) => {
  add.box(0.08, height, 0.12, "#1b1b1b", -width * 0.35, height / 2 + 0.85, z);
  add.box(0.08, height, 0.12, "#1b1b1b", width * 0.35, height / 2 + 0.85, z);
  add.box(width, 0.06, 0.38, color, 0, height + 0.88, z - 0.05);
};

/** Altura do contorno superior de um perfil numa posição x (0 se fora). */
function heightAt(profile: Profile, x: number) {
  let best = 0;
  for (let i = 0; i < profile.length; i++) {
    const [ax, ay] = profile[i];
    const [bx, by] = profile[(i + 1) % profile.length];
    if ((x >= ax && x <= bx) || (x >= bx && x <= ax)) {
      const t = bx === ax ? 0 : (x - ax) / (bx - ax);
      best = Math.max(best, ay + (by - ay) * t);
    }
  }
  return best;
}

const DESIGNS: Record<BodyStyle, Design> = {
  fusca: {
    length: 4.05, width: 1.55,
    lower: [[-2.0, 0.35], [2.0, 0.35], [2.05, 0.62], [1.6, 0.92], [0.9, 1.0], [-1.1, 1.0], [-1.8, 0.86], [-2.05, 0.58]],
    cabin: [[-1.15, 0.98], [-0.65, 1.5], [0.3, 1.52], [0.95, 0.98]],
    wheels: { rear: -1.25, front: 1.2, radius: 0.33, track: 1.45 },
    extras: (add, c) => {
      // Para-lamas redondos, a marca do Fusca.
      for (const [x, z] of [[-0.75, -1.25], [0.75, -1.25], [-0.75, 1.2], [0.75, 1.2]]) add.sphere(0.48, c, x, 0.55, z, [0.55, 0.8, 1.15]);
      // Um pão de queijo gigante no teto.
      add.sphere(0.5, "#e8b04a", 0, 1.62, -0.15, [1.1, 0.55, 1.1]);
      for (const [x, z] of [[0.2, 0], [-0.25, -0.3], [0.1, -0.45], [-0.15, 0.15]]) add.sphere(0.06, "#b9762a", x, 1.86, z - 0.15);
    },
  },
  uno: {
    length: 3.65, width: 1.55,
    lower: [[-1.82, 0.32], [1.82, 0.32], [1.86, 0.75], [1.4, 0.86], [-1.82, 0.92]],
    cabin: [[-1.76, 0.9], [-1.7, 1.48], [0.6, 1.48], [1.25, 0.86]],
    wheels: { rear: -1.15, front: 1.2, radius: 0.29, track: 1.38 },
    extras: (add) => {
      // Coxinha no teto: o corpo (gota) e a pontinha.
      add.sphere(0.42, "#d98a2b", 0, 1.86, -0.4, [1, 1.05, 1]);
      add.cone(0.34, 0.6, "#d98a2b", 0, 2.4, -0.4);
      add.cylinder(0.05, 0.25, "#f2d0a0", 0, 2.75, -0.4, "y");
    },
  },
  gol: {
    length: 3.8, width: 1.6,
    lower: [[-1.9, 0.32], [1.9, 0.32], [1.94, 0.72], [1.35, 0.85], [-1.9, 0.9]],
    cabin: [[-1.82, 0.88], [-1.65, 1.36], [0.5, 1.36], [1.2, 0.85]],
    wheels: { rear: -1.2, front: 1.25, radius: 0.3, track: 1.42 },
    extras: (add) => {
      // Bagageiro com bolinhas de queijo.
      add.box(0.04, 0.06, 1.6, "#1b1b1b", -0.55, 1.42, -0.5);
      add.box(0.04, 0.06, 1.6, "#1b1b1b", 0.55, 1.42, -0.5);
      for (const [x, z] of [[-0.3, -0.9], [0.3, -0.9], [0, -0.5], [-0.3, -0.1], [0.3, -0.1]]) add.sphere(0.22, "#f0b43c", x, 1.62, z);
    },
  },
  sedan: {
    length: 4.5, width: 1.75,
    lower: [[-2.25, 0.33], [2.25, 0.33], [2.28, 0.62], [1.4, 0.8], [-1.5, 0.86], [-2.25, 0.8]],
    cabin: [[-1.6, 0.84], [-0.9, 1.36], [0.5, 1.36], [1.3, 0.8]],
    wheels: { rear: -1.35, front: 1.35, radius: 0.31, track: 1.55 },
    extras: (add) => {
      // Sushi: a alga (faixa preta) em volta do meio e o salmão no teto.
      add.box(1.9, 0.5, 0.55, "#141414", 0, 0.62, -0.2);
      add.box(1.0, 0.08, 1.2, "#f28c5a", 0, 1.4, -0.2);
      for (let z = -0.7; z <= 0.3; z += 0.25) add.box(1.02, 0.02, 0.05, "#fde2d0", 0, 1.45, z);
      add.box(1.5, 0.05, 0.3, "#7ab55c", 0, 0.92, -2.15); // spoiler de wasabi
    },
  },
  hatch: {
    length: 4.2, width: 1.78,
    lower: [[-2.1, 0.33], [2.1, 0.33], [2.13, 0.66], [1.3, 0.86], [-2.1, 0.92]],
    cabin: [[-2.0, 0.9], [-1.85, 1.42], [0.35, 1.42], [1.15, 0.85]],
    wheels: { rear: -1.3, front: 1.32, radius: 0.32, track: 1.56 },
    extras: (add) => {
      // Romeu e Julieta: faixas de queijo sobre a goiabada.
      add.box(0.18, 0.02, 4.0, "#f6d36b", -0.25, 0.94, 0);
      add.box(0.18, 0.02, 4.0, "#f6d36b", 0.25, 0.94, 0);
      add.box(1.78, 0.08, 0.04, "#d00000", 0, 0.6, 2.13); // frisos vermelhos da grade
    },
  },
  opala: {
    length: 4.8, width: 1.8,
    lower: [[-2.4, 0.35], [2.4, 0.35], [2.43, 0.7], [0.9, 0.82], [-1.8, 0.8], [-2.4, 0.76]],
    cabin: [[-1.9, 0.8], [-1.0, 1.32], [0.0, 1.32], [0.8, 0.82]],
    wheels: { rear: -1.5, front: 1.45, radius: 0.33, track: 1.6 },
    extras: (add) => {
      // Picanha: a capa de gordura branca por cima e as marcas da grelha.
      add.box(1.2, 0.05, 2.4, "#f3ead8", 0, 0.86, 1.2);
      for (let z = 0.3; z <= 2.1; z += 0.4) add.box(1.22, 0.02, 0.08, "#3a1a10", 0, 0.9, z);
    },
  },
  muscle: {
    length: 4.8, width: 1.9,
    lower: [[-2.4, 0.36], [2.4, 0.36], [2.45, 0.72], [1.0, 0.9], [-2.0, 0.9], [-2.4, 0.85]],
    cabin: [[-2.1, 0.88], [-0.8, 1.32], [0.1, 1.33], [0.9, 0.88]],
    wheels: { rear: -1.5, front: 1.45, radius: 0.34, track: 1.65 },
    extras: (add) => {
      // Faixas pretas de corrida e a tomada de ar do capô.
      add.box(0.25, 0.02, 4.7, "#111111", -0.3, 0.94, 0);
      add.box(0.25, 0.02, 4.7, "#111111", 0.3, 0.94, 0);
      add.box(0.6, 0.12, 0.7, "#111111", 0, 0.97, 1.4);
      add.box(1.7, 0.05, 0.3, "#111111", 0, 0.95, -2.3);
    },
  },
  supra: {
    length: 4.5, width: 1.81,
    lower: [[-2.25, 0.3], [2.25, 0.3], [2.3, 0.55], [1.2, 0.78], [-1.8, 0.8], [-2.25, 0.72]],
    cabin: [[-1.6, 0.78], [-0.7, 1.22], [0.2, 1.24], [1.0, 0.76]],
    wheels: { rear: -1.35, front: 1.3, radius: 0.33, track: 1.58 },
    extras: (add) => {
      // Cachorro-quente: a salsicha em cima e o zigue-zague de mostarda.
      add.cylinder(0.22, 2.6, "#b5442a", 0, 1.32, -0.1, "z");
      add.sphere(0.22, "#b5442a", 0, 1.32, 1.2);
      add.sphere(0.22, "#b5442a", 0, 1.32, -1.4);
      for (let z = -1.2; z <= 1.0; z += 0.3) add.box(0.36, 0.03, 0.08, "#f2c200", (Math.round(z * 10) % 2 ? 0.1 : -0.1), 1.55, z);
      wing(add, -2.05, 0.35, 1.7, "#e76f2a");
    },
  },
  skyline: {
    length: 4.6, width: 1.79,
    lower: [[-2.3, 0.32], [2.3, 0.32], [2.32, 0.68], [1.3, 0.84], [-2.3, 0.88]],
    cabin: [[-1.7, 0.86], [-1.0, 1.34], [0.4, 1.36], [1.2, 0.83]],
    wheels: { rear: -1.4, front: 1.38, radius: 0.33, track: 1.58 },
    extras: (add) => {
      // Shoyu: faixa marrom e o vidrinho de molho no porta-malas.
      add.box(1.92, 0.12, 4.62, "#5a2e12", 0, 0.5, 0);
      add.cylinder(0.12, 0.35, "#3b1d0e", 0.5, 1.05, -1.9, "y");
      add.cylinder(0.07, 0.12, "#c1121f", 0.5, 1.29, -1.9, "y");
      wing(add, -2.1, 0.32, 1.65, "#2b2d42");
    },
  },
  porsche: {
    length: 4.45, width: 1.85,
    lower: [[-2.22, 0.32], [2.22, 0.32], [2.25, 0.6], [1.5, 0.78], [0.9, 0.84], [-1.6, 0.95], [-2.22, 0.7]],
    cabin: [[-1.9, 0.86], [-0.9, 1.3], [0.0, 1.3], [0.85, 0.84]],
    wheels: { rear: -1.3, front: 1.32, radius: 0.34, track: 1.6 },
    extras: (add) => {
      // Pururuca: casquinha estalando (manchas claras) e o rabo de pato.
      for (const [x, z] of [[-0.4, 1.5], [0.3, 1.2], [-0.1, 0.9], [0.45, 1.8], [-0.5, -1.4], [0.2, -1.7]]) add.sphere(0.16, "#e0a35c", x, 0.86, z, [1, 0.25, 1]);
      add.box(1.6, 0.06, 0.35, "#a35b2a", 0, 1.0, -2.05, -0.3);
    },
  },
  wedge: {
    length: 4.6, width: 2.0,
    lower: [[-2.3, 0.3], [2.3, 0.3], [2.35, 0.45], [0.6, 0.8], [-2.3, 0.9]],
    cabin: [[-1.2, 0.85], [-0.4, 1.16], [0.3, 1.13], [1.3, 0.66]],
    wheels: { rear: -1.45, front: 1.35, radius: 0.35, track: 1.7 },
    extras: (add) => {
      // Lasanha: camadas de massa, molho e queijo nas laterais.
      for (const [y, color] of [[0.42, "#f2c14e"], [0.52, "#c1121f"], [0.62, "#f7f1e1"], [0.72, "#f2c14e"]] as const) {
        add.box(2.13, 0.07, 3.6, color, 0, y, 0);
      }
    },
  },
  ferrari: {
    length: 4.7, width: 2.0,
    lower: [[-2.35, 0.3], [2.35, 0.3], [2.45, 0.42], [1.6, 0.62], [0.8, 0.75], [-1.8, 0.86], [-2.35, 0.78]],
    cabin: [[-1.0, 0.8], [-0.3, 1.12], [0.3, 1.12], [1.1, 0.72]],
    wheels: { rear: -1.45, front: 1.4, radius: 0.35, track: 1.7 },
    extras: (add) => {
      // Farofa: farelinhos espalhados pelo capô e pela traseira.
      for (let i = 0; i < 26; i++) {
        const x = (Math.sin(i * 12.9) * 0.5) * 1.6;
        const z = (i % 2 ? 1 : -1) * (0.9 + (Math.cos(i * 7.1) * 0.5 + 0.5) * 1.2);
        add.box(0.07, 0.04, 0.07, i % 3 ? "#e6c27a" : "#b5793a", x, z > 0 ? 0.7 : 0.86, z);
      }
    },
  },
  veyron: {
    length: 4.46, width: 2.0,
    lower: [[-2.23, 0.3], [2.23, 0.3], [2.27, 0.5], [1.4, 0.75], [-1.9, 0.88], [-2.23, 0.8]],
    cabin: [[-1.3, 0.86], [-0.4, 1.2], [0.4, 1.18], [1.25, 0.74]],
    wheels: { rear: -1.35, front: 1.35, radius: 0.36, track: 1.7 },
    extras: (add) => {
      // Brigadeiro de duas cores (frente mais clara) com granulado colorido.
      add.box(2.13, 0.4, 1.9, "#8a5a3c", 0, 0.5, 1.2);
      const sprinkles = ["#ff5ca8", "#4cc9f0", "#ffd23f", "#7ae582", "#ffffff"];
      for (let i = 0; i < 30; i++) {
        const x = Math.sin(i * 3.7) * 0.8;
        const z = Math.cos(i * 5.3) * 1.9;
        add.box(0.04, 0.04, 0.14, sprinkles[i % sprinkles.length], x, Math.max(heightAt(DESIGNS.veyron.lower, z), heightAt(DESIGNS.veyron.cabin, z)) + 0.03, z);
      }
    },
  },
  hyper: {
    length: 4.3, width: 2.0,
    lower: [[-2.15, 0.28], [2.15, 0.28], [2.2, 0.42], [0.9, 0.7], [-2.15, 0.84]],
    cabin: [[-0.9, 0.78], [-0.2, 1.1], [0.4, 1.08], [1.2, 0.66]],
    wheels: { rear: -1.35, front: 1.3, radius: 0.36, track: 1.72 },
    extras: (add) => {
      // Kibe: corpo marrom, detalhes de hortelã e a rodela de limão.
      add.box(2.13, 0.06, 4.1, "#7ab55c", 0, 0.46, 0);
      add.box(0.06, 0.45, 1.2, "#6b4a2b", 0, 1.25, -1.2); // barbatana
      add.cylinder(0.28, 0.05, "#d7e35a", 0, 1.13, 0.0, "y");
      wing(add, -1.95, 0.45, 1.9, "#6b4a2b");
    },
  },
  m3: {
    length: 4.5, width: 1.86,
    lower: [[-2.25, 0.26], [2.25, 0.26], [2.3, 0.56], [1.3, 0.76], [-1.7, 0.82], [-2.25, 0.74]],
    cabin: [[-1.6, 0.8], [-0.8, 1.26], [0.3, 1.27], [1.1, 0.77]],
    wheels: { rear: -1.38, front: 1.36, radius: 0.35, track: 1.66 },
    extras: (add) => {
      // Gorgonzola: veias azuis pela carroceria prata (a pintura clássica de corrida, versão queijo).
      const veins: [number, number, number][] = [[-0.5, 1.6, 0.4], [0.3, 1.1, -0.3], [0.6, 0.2, 0.5], [-0.2, -0.6, -0.4], [0.45, -1.5, 0.3], [-0.6, -1.0, 0.6]];
      for (const [x, z, rot] of veins) {
        const y = Math.max(heightAt(DESIGNS.m3.lower, z), heightAt(DESIGNS.m3.cabin, z)) + 0.02;
        for (let k = 0; k < 4; k++) add.box(0.07, 0.02, 0.32, k % 2 ? "#2a4fd1" : "#3a6bff", x + Math.sin(rot) * k * 0.25, y, z + Math.cos(rot) * k * 0.25);
      }
      add.box(1.88, 0.16, 4.52, "#2a4fd1", 0, 0.42, 0); // faixa azul lateral
      wing(add, -2.05, 0.4, 1.75, "#c9ced6");
      add.box(1.8, 0.05, 0.3, "#1b1b1b", 0, 0.26, 2.32);
    },
  },
  a3: {
    length: 4.2, width: 1.76,
    lower: [[-2.1, 0.24], [2.1, 0.24], [2.14, 0.58], [1.3, 0.77], [-2.1, 0.84]],
    cabin: [[-2.0, 0.82], [-1.8, 1.3], [0.3, 1.32], [1.1, 0.79]],
    wheels: { rear: -1.28, front: 1.3, radius: 0.36, track: 1.66 },
    extras: (add) => {
      // "Todo mexido": rebaixado, aerofólio de caminhão, saias, para-choque de
      // corrida, escapamento canhão, neon embaixo e tiras de bacon no capô.
      wing(add, -1.95, 0.6, 1.9, "#111111");
      add.box(1.9, 0.06, 0.25, "#111111", 0, 0.24, 2.18); // splitter
      add.box(0.08, 0.14, 2.6, "#111111", -0.9, 0.3, 0);
      add.box(0.08, 0.14, 2.6, "#111111", 0.9, 0.3, 0);
      add.cylinder(0.14, 0.5, "#9aa0a6", 0.5, 0.36, -2.25, "z");
      add.glow(1.6, 3.6, "#b84cff", 0.12);
      for (const x of [-0.35, 0, 0.35]) {
        for (let z = 1.0; z <= 2.0; z += 0.2) add.box(0.14, 0.02, 0.18, Math.round(z * 5) % 2 ? "#c1442e" : "#f2b8a0", x + Math.sin(z * 6) * 0.04, 0.8, z);
      }
      add.box(0.5, 0.15, 0.5, "#111111", 0, 1.38, 0.1); // tomada de ar no teto
    },
  },
};

const lambert = (color: THREE.ColorRepresentation) => new THREE.MeshLambertMaterial({ color });

/** Suaviza um contorno fechado (Chaikin): quinas viram curvas, como numa carroceria de verdade. */
function smooth(profile: Profile, passes: number): Profile {
  let points = profile;
  for (let k = 0; k < passes; k++) {
    const next: Profile = [];
    for (let i = 0; i < points.length; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[(i + 1) % points.length];
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    points = next;
  }
  return points;
}

/**
 * Troca a borda de baixo do perfil (os dois primeiros pontos, da traseira para
 * a frente) por uma borda com as caixas de roda recortadas em arco.
 */
function cutWheelArches(design: Design): Profile {
  const [[rearX, bottom], [frontX]] = design.lower;
  const { rear, front, radius } = design.wheels;
  const arch = radius + 0.06;
  const bottomEdge: Profile = [[rearX, bottom]];
  for (const center of [rear, front]) {
    for (let k = 0; k <= 12; k++) {
      const angle = Math.PI - (k / 12) * Math.PI;
      const x = center + Math.cos(angle) * arch;
      // O arco não pode comer o capô: fica pelo menos 9 cm abaixo do contorno de cima.
      const y = Math.min(radius + Math.sin(angle) * arch, heightAt(design.lower, x) - 0.09);
      bottomEdge.push([x, Math.max(bottom, y)]);
    }
  }
  bottomEdge.push([frontX, bottom]);
  return [...bottomEdge, ...design.lower.slice(2)];
}

/**
 * Extruda um perfil lateral na largura; o resultado tem a frente para +Z.
 * `taper` fecha as laterais para cima (de 0 a `taper` entre `from` e `to` de
 * altura), como as laterais de um carro, que se inclinam para dentro.
 */
function extrudeProfile(profile: Profile, width: number, taper = 0, from = 0, to = 2) {
  const shape = new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(x, y)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 3, curveSegments: 4 });
  geometry.translate(0, 0, -width / 2);
  geometry.rotateY(-Math.PI / 2);
  if (taper > 0) {
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const t = Math.min(1, Math.max(0, (position.getY(i) - from) / (to - from)));
      position.setX(i, position.getX(i) * (1 - taper * t));
    }
    geometry.computeVertexNormals();
  }
  return geometry;
}

export interface BuiltBody {
  /** Peças da carroceria (para serem fundidas numa malha só). */
  shell: THREE.Group;
  /** Onde ficam as rodas e de que tamanho. */
  wheels: { x: number; z: number; radius: number }[];
  length: number;
}

const DARK_TRIM = "#1b1b1d";

/** Monta a carroceria de um estilo, na cor dada. */
export function buildBody(style: BodyStyle, colorValue: string, livery?: (add: Adder, design: { length: number; width: number }) => void): BuiltBody {
  const design = DESIGNS[style];
  const color = new THREE.Color(colorValue);
  const shell = new THREE.Group();
  const half = design.width / 2;

  const lowerTop = Math.max(...design.lower.map((p) => p[1]));
  const roofHeight = Math.max(...design.cabin.map((p) => p[1]));
  const cabinBase = Math.min(...design.cabin.map((p) => p[1]));

  // Carroceria: perfil com as caixas de roda recortadas e arredondado; as laterais fecham um pouco em cima.
  const body = new THREE.Mesh(extrudeProfile(smooth(cutWheelArches(design), 2), design.width, 0.06, lowerTop - 0.35, lowerTop), lambert(color));
  // Estufa: vidros, bem mais fechada em cima (as janelas se inclinam para dentro).
  const cabinTaper = 0.22;
  const glass = new THREE.Mesh(extrudeProfile(smooth(design.cabin, 1), design.width * 0.88, cabinTaper, cabinBase, roofHeight), lambert("#2a3a48"));
  const roofPoints = design.cabin.filter((p) => p[1] > roofHeight - 0.05).map((p) => p[0]);
  const roofFront = Math.max(...roofPoints);
  const roofRear = Math.min(...roofPoints);
  const roofWidth = design.width * 0.88 * (1 - cabinTaper);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(roofWidth, 0.05, Math.max(0.4, roofFront - roofRear + 0.1)), lambert(color));
  roof.position.set(0, roofHeight - 0.01, (roofFront + roofRear) / 2);
  shell.add(body, glass, roof);

  const add: Adder = {
    box: (w, h, l, c, x, y, z, rotX = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), lambert(c));
      m.position.set(x, y, z);
      m.rotation.x = rotX;
      shell.add(m);
    },
    cylinder: (r, len, c, x, y, z, axis = "y") => {
      const g = new THREE.CylinderGeometry(r, r, len, 14);
      if (axis === "x") g.rotateZ(Math.PI / 2);
      if (axis === "z") g.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(g, lambert(c));
      m.position.set(x, y, z);
      shell.add(m);
    },
    sphere: (r, c, x, y, z, scale = [1, 1, 1]) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), lambert(c));
      m.position.set(x, y, z);
      m.scale.set(...scale);
      shell.add(m);
    },
    cone: (r, h, c, x, y, z, rotX = 0) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 14), lambert(c));
      m.position.set(x, y, z);
      m.rotation.x = rotX;
      shell.add(m);
    },
    glow: (w, l, c, y) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: c }));
      m.position.y = y;
      shell.add(m);
    },
  };

  /** Barra fina de um ponto a outro (no perfil: z ao longo do carro, y altura), num lado x. */
  const strut = (x: number, from: [number, number], to: [number, number], thickness: number, c: THREE.ColorRepresentation) => {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const m = new THREE.Mesh(new THREE.BoxGeometry(thickness, thickness, length + thickness), lambert(c));
    m.position.set(x, (from[1] + to[1]) / 2, (from[0] + to[0]) / 2);
    m.rotation.x = -Math.atan2(to[1] - from[1], to[0] - from[0]);
    shell.add(m);
  };
  const cabinHalf = (y: number) => (design.width * 0.88 / 2) * (1 - cabinTaper * Math.min(1, Math.max(0, (y - cabinBase) / (roofHeight - cabinBase))));

  // Colunas na cor do carro (A na frente, C atrás e B no meio), dividindo os vidros.
  const cabinSorted = [...design.cabin].sort((a, b) => a[0] - b[0]);
  const aBase = cabinSorted[cabinSorted.length - 1];
  const cBase = cabinSorted[0];
  const aTop: [number, number] = [roofFront, roofHeight];
  const cTop: [number, number] = [roofRear, roofHeight];
  const bZ = (roofFront + roofRear) / 2 - 0.1;
  for (const side of [-1, 1]) {
    const midA = (aBase[1] + roofHeight) / 2;
    strut(side * (cabinHalf(midA) + 0.01), aBase, aTop, 0.09, color);
    strut(side * (cabinHalf((cBase[1] + roofHeight) / 2) + 0.01), cBase, cTop, 0.11, color);
    strut(side * (cabinHalf((cabinBase + roofHeight) / 2) + 0.01), [bZ, cabinBase], [bZ, roofHeight], 0.08, color);
    // Retrovisor na base da coluna A.
    add.box(0.16, 0.1, 0.18, color, side * (half + 0.06), aBase[1] + 0.06, aBase[0] - 0.12);
    add.box(0.02, 0.08, 0.14, "#9fb4c4", side * (half + 0.14), aBase[1] + 0.06, aBase[0] - 0.12);
    // Linha da porta e maçaneta.
    add.box(0.012, Math.max(0.2, cabinBase - 0.4), 0.012, DARK_TRIM, side * (half + 0.012), (cabinBase + 0.36) / 2 + 0.02, bZ);
    add.box(0.03, 0.035, 0.14, DARK_TRIM, side * (half + 0.02), cabinBase - 0.12, bZ + 0.3);
  }

  // Reflexo de desenho nos vidros (dois riscos brancos no para-brisa).
  const shineAngle = Math.atan2(aTop[1] - aBase[1], aTop[0] - aBase[0]);
  for (const [offset, widthShine] of [[-0.18, 0.1], [0.12, 0.05]] as const) {
    const shine = new THREE.Mesh(new THREE.PlaneGeometry(widthShine, 0.42), new THREE.MeshBasicMaterial({ color: "#eaf6ff", transparent: true, opacity: 0.55 }));
    shine.position.set(offset, (aBase[1] + roofHeight) / 2 + 0.01, (aBase[0] + roofFront) / 2 + 0.03);
    shine.rotation.order = "YXZ";
    shine.rotation.x = -(Math.PI / 2 - shineAngle);
    shine.rotation.z = 0.5;
    shell.add(shine);
  }

  // Frente e traseira: grade, para-choques, faróis, lanternas e placas.
  const front = design.lower.reduce((m, p) => Math.max(m, p[0]), -Infinity);
  const rear = design.lower.reduce((m, p) => Math.min(m, p[0]), Infinity);
  const bottom = design.lower[0][1];
  const frontTop = heightAt(design.lower, front - 0.08);
  const rearTop = heightAt(design.lower, rear + 0.08);
  add.box(design.width * 0.96, 0.12, 0.12, DARK_TRIM, 0, bottom + 0.08, front);
  add.box(design.width * 0.96, 0.12, 0.12, DARK_TRIM, 0, bottom + 0.08, rear);
  add.box(design.width * 0.42, Math.max(0.08, (frontTop - bottom) * 0.32), 0.05, "#111214", 0, bottom + (frontTop - bottom) * 0.42, front + 0.04);
  add.box(0.36, 0.12, 0.02, "#f4f4ef", 0, bottom + 0.2, front + 0.08);
  add.box(0.36, 0.12, 0.02, "#f4f4ef", 0, bottom + (rearTop - bottom) * 0.45, rear - 0.07);
  for (const side of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.06), new THREE.MeshBasicMaterial({ color: "#fff6c8" }));
    head.position.set(side * design.width * 0.33, bottom + (frontTop - bottom) * 0.72, front + 0.02);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.11, 0.06), new THREE.MeshBasicMaterial({ color: "#ff3a2a" }));
    tail.position.set(side * design.width * 0.34, bottom + (rearTop - bottom) * 0.75, rear - 0.02);
    shell.add(head, tail);
    // Saia lateral escura, entre as rodas.
    add.box(0.04, 0.07, Math.max(0.2, design.wheels.front - design.wheels.rear - (design.wheels.radius + 0.06) * 2), DARK_TRIM,
      side * (half + 0.01), bottom + 0.04, (design.wheels.front + design.wheels.rear) / 2);
  }

  // Fundo das caixas de roda, escuro (para não ver o chão através do arco).
  for (const z of [design.wheels.rear, design.wheels.front]) {
    add.box(design.width - 0.75, design.wheels.radius * 1.6, (design.wheels.radius + 0.06) * 2, "#0d0d0f", 0, design.wheels.radius + 0.05, z);
  }

  if (livery) livery(add, design);
  else design.extras?.(add, color);

  // Rodas rentes à lateral, aparecendo pelo arco.
  const { rear: wr, front: wf, radius } = design.wheels;
  const wheelX = half - 0.17;
  const wheels = [
    { x: -wheelX, z: wf, radius }, { x: wheelX, z: wf, radius },
    { x: -wheelX, z: wr, radius }, { x: wheelX, z: wr, radius },
  ];
  return { shell, wheels, length: design.length };
}

export type { Adder };
