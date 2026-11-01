// Rodas dos carros: pneu de verdade (flanco arredondado, ombro e banda com
// sulcos, feito no torno), aro de cada estilo (cinco raios, multirraios, tipo
// BBS em malha, calota de aço...), tambor/disco de freio e a pinça, que fica
// presa à carroceria. A roda gira em torno do eixo X e a face de fora olha
// para +x (o lado esquerdo do carro usa a mesma roda virada).
import * as THREE from "three";

import { Bin, type MatName, type P2 } from "./car-kit.ts";

export type RimKind =
  | "five" | "twin5" | "six" | "seven" | "multi" | "turbine" | "mesh" | "deep" | "steel" | "hubcap" | "rally" | "y5" | "star";

export interface WheelSpec {
  radius: number;
  /** Largura do pneu (m). */
  width: number;
  rim: RimKind;
  /** Cor do aro (prata, grafite, dourado...). */
  rimColor?: string;
  /** Diâmetro do aro em relação ao pneu (0,6 = pneu alto, 0,75 = perfil baixo). */
  rimRatio?: number;
  /** Cor da pinça de freio (sem = tambor, carro antigo). */
  caliper?: string | null;
}

/** Contorno do pneu: (raio, posição no eixo), de fora para dentro. */
function tireProfile(R: number, Rr: number, W: number, detail: boolean): THREE.Vector2[] {
  const h = R - Rr;
  const half = W / 2;
  const pts: P2[] = [];
  // Flanco de fora: sai do talão (no aro), estufa e faz a curva do ombro.
  const side = (s: number) => {
    const out: P2[] = [];
    const steps = detail ? 5 : 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const r = Rr + h * (0.02 + 0.8 * t);
      const bulge = Math.sin(t * Math.PI * 0.85) * 0.07 * W;
      out.push([r, s * (half * 0.86 + bulge)]);
    }
    // Ombro arredondado.
    const shoulder = detail ? 3 : 1;
    for (let i = 1; i <= shoulder; i++) {
      const a = (i / shoulder) * (Math.PI / 2);
      out.push([R - h * 0.18 + Math.sin(a) * h * 0.18, s * (half * 0.92 - (1 - Math.cos(a)) * half * 0.12 + 0.0)]);
    }
    return out;
  };
  const outer = side(1);
  pts.push(...outer);
  // Banda de rodagem com sulcos.
  const tread = detail ? [0.6, 0.5, 0.12, -0.12, -0.5, -0.6] : [];
  for (let i = 0; i < tread.length; i++) {
    const groove = i % 2 === 1 ? 0 : 0;
    const a = tread[i] * half;
    const r = i === 1 || i === tread.length - 2 ? R - 0.007 : R;
    pts.push([r - groove, a]);
  }
  const inner = side(-1).reverse();
  pts.push(...inner);
  return pts.map(([r, a]) => new THREE.Vector2(r, a));
}

/** Janela entre dois raios: setor de rIn a rOut, com raios de largura constante `w`. */
function window(n: number, i: number, rIn: number, rOut: number, w: number, offset = 0, twist = 0, fine = true): P2[] {
  const center = ((i + 0.5) / n) * Math.PI * 2 + offset;
  const halfSector = Math.PI / n;
  const pts: P2[] = [];
  const steps = fine ? 5 : 2;
  const edge = (r: number) => halfSector - Math.asin(Math.min(0.99, w / 2 / r));
  // Lado A (de dentro para fora), arco de fora, lado B (de fora para dentro), arco de dentro.
  for (let k = 0; k <= steps; k++) {
    const r = rIn + ((rOut - rIn) * k) / steps;
    const tw = twist * (r - rIn) / (rOut - rIn);
    pts.push([r, center - edge(r) + tw]);
  }
  const arc = fine ? 6 : 3;
  for (let k = 1; k < arc; k++) {
    const e = edge(rOut);
    pts.push([rOut, center - e + twist + (2 * e * k) / arc]);
  }
  for (let k = steps; k >= 0; k--) {
    const r = rIn + ((rOut - rIn) * k) / steps;
    const tw = twist * (r - rIn) / (rOut - rIn);
    pts.push([r, center + edge(r) + tw]);
  }
  for (let k = arc - 1; k > 0; k--) {
    const e = edge(rIn);
    pts.push([rIn, center - e + (2 * e * k) / arc]);
  }
  // Polar → cartesiano, com as quinas arredondadas.
  const cart = pts.map(([r, a]) => [Math.cos(a) * r, Math.sin(a) * r] as P2);
  return fine ? roundCorners(cart) : cart;
}

function roundCorners(p: P2[]): P2[] {
  let pts = p;
  for (let k = 0; k < 1; k++) {
    const next: P2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    pts = next;
  }
  return pts;
}

/** Furos da face do aro, conforme o estilo. */
function rimHoles(kind: RimKind, Rf: number): P2[][] {
  const holes: P2[][] = [];
  const hub = Rf * 0.3;
  switch (kind) {
    case "five":
      for (let i = 0; i < 5; i++) holes.push(window(5, i, hub, Rf * 0.86, Rf * 0.26));
      break;
    case "twin5":
      for (let i = 0; i < 10; i++) holes.push(window(10, i, hub + (i % 2 ? Rf * 0.12 : 0), Rf * 0.86, Rf * 0.11, 0));
      break;
    case "y5":
      for (let i = 0; i < 5; i++) holes.push(window(5, i, hub, Rf * 0.56, Rf * 0.24));
      for (let i = 0; i < 10; i++) holes.push(window(10, i, Rf * 0.64, Rf * 0.87, Rf * 0.12, Math.PI / 10));
      break;
    case "six":
      for (let i = 0; i < 6; i++) holes.push(window(6, i, hub, Rf * 0.86, Rf * 0.2));
      break;
    case "seven":
      for (let i = 0; i < 7; i++) holes.push(window(7, i, hub, Rf * 0.87, Rf * 0.16));
      break;
    case "star":
      for (let i = 0; i < 5; i++) holes.push(window(5, i, hub * 1.1, Rf * 0.86, Rf * 0.4));
      break;
    case "multi":
      for (let i = 0; i < 14; i++) holes.push(window(14, i, hub, Rf * 0.88, Rf * 0.07, 0, 0, false));
      break;
    case "turbine":
      for (let i = 0; i < 12; i++) holes.push(window(12, i, hub, Rf * 0.87, Rf * 0.08, 0, 0.35, false));
      break;
    case "deep":
      for (let i = 0; i < 16; i++) holes.push(window(16, i, hub * 0.9, Rf * 0.9, Rf * 0.06, 0, 0, false));
      break;
    case "mesh":
      // Raios cruzados (tipo BBS): um anel de janelas por dentro e dois por fora.
      for (let i = 0; i < 10; i++) holes.push(window(10, i, hub, Rf * 0.5, Rf * 0.07, 0, 0, false));
      for (let i = 0; i < 20; i++) holes.push(window(20, i, Rf * 0.56, Rf * 0.72, Rf * 0.05, Math.PI / 20, 0, false));
      for (let i = 0; i < 20; i++) holes.push(window(20, i, Rf * 0.77, Rf * 0.9, Rf * 0.05, 0, 0, false));
      break;
    case "rally":
      for (let i = 0; i < 6; i++) holes.push(window(6, i, Rf * 0.52, Rf * 0.74, Rf * 0.36));
      break;
    case "steel":
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const pts: P2[] = [];
        for (let k = 0; k < 14; k++) {
          const b = (k / 14) * Math.PI * 2;
          pts.push([Math.cos(a) * Rf * 0.66 + Math.cos(b) * Rf * 0.075, Math.sin(a) * Rf * 0.66 + Math.sin(b) * Rf * 0.075]);
        }
        holes.push(pts);
      }
      break;
    case "hubcap":
      break;
  }
  return holes;
}

const cache = new Map<string, Map<MatName, THREE.BufferGeometry>>();

/**
 * Geometria de uma roda (pneu em borracha; aro, disco e cubo em metal), feita
 * uma vez por estilo e tamanho. `detail` = carro da garagem; sem ele, o modelo
 * leve do trânsito.
 */
export function wheelGeometry(spec: WheelSpec, detail = true): Map<MatName, THREE.BufferGeometry> {
  const key = `${spec.rim}|${spec.radius}|${spec.width}|${spec.rimColor}|${spec.rimRatio}|${detail}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const R = spec.radius;
  const W = spec.width;
  const Rr = R * (spec.rimRatio ?? 0.68);
  const bin = new Bin();
  const radial = detail ? 44 : 14;

  // Pneu.
  const tire = new THREE.LatheGeometry(tireProfile(R, Rr, W, detail), radial);
  tire.rotateZ(-Math.PI / 2);
  bin.add("rubber", tire);

  const rimColor = new THREE.Color(spec.rimColor ?? "#c9ced4");
  const face = W / 2 * 0.78;

  // Tambor do aro (o "copo" por dentro, visto pelos furos) e a borda.
  const barrel: P2[] = [
    [Rr + 0.014, face + 0.012], [Rr + 0.016, face - 0.004], [Rr, face - 0.012], [Rr, -W * 0.42],
    [Rr - 0.012, -W * 0.42], [Rr - 0.012, face - 0.02], [Rr - 0.004, face + 0.01],
  ];
  if (detail) {
    const lip = new THREE.LatheGeometry(barrel.map(([r, a]) => new THREE.Vector2(r, a)), radial);
    lip.rotateZ(-Math.PI / 2);
    bin.add("metal", lip, spec.rim === "steel" || spec.rim === "hubcap" ? rimColor : rimColor.clone().lerp(new THREE.Color("#ffffff"), 0.25));
    // Fundo escuro por dentro do aro (não se vê o outro lado através dos raios).
    const back = new THREE.CircleGeometry(Rr - 0.01, radial);
    back.rotateY(-Math.PI / 2);
    back.translate(-W * 0.3, 0, 0);
    bin.add("metal", back, "#1a1b1d");
  }

  // Freio: disco (ou tambor, nos carros antigos) com o chapéu do cubo.
  if (!detail) {
    // Trânsito: sem freio (não aparece de longe).
  } else if (spec.caliper !== null && spec.caliper !== undefined) {
    const disc = new THREE.CylinderGeometry(Rr * 0.8, Rr * 0.8, 0.026, detail ? 40 : 14, 1);
    disc.rotateZ(Math.PI / 2);
    disc.translate(face - 0.075, 0, 0);
    bin.add("metal", disc, "#7c7f84");
    const hat = new THREE.CylinderGeometry(Rr * 0.34, Rr * 0.34, 0.05, detail ? 24 : 10);
    hat.rotateZ(Math.PI / 2);
    hat.translate(face - 0.05, 0, 0);
    bin.add("metal", hat, "#4a4c50");
  } else {
    const drum = new THREE.CylinderGeometry(Rr * 0.7, Rr * 0.7, 0.07, detail ? 32 : 12);
    drum.rotateZ(Math.PI / 2);
    drum.translate(face - 0.07, 0, 0);
    bin.add("metal", drum, "#3c3d40");
  }

  // Face do aro: disco com os furos do estilo, extrudado com chanfro e com
  // concavidade (os raios descem da borda para o cubo).
  const Rf = Rr - 0.004;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, Rf, 0, Math.PI * 2, false);
  const holes = detail ? rimHoles(spec.rim, Rf) : [];
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const depth = spec.rim === "steel" || spec.rim === "hubcap" ? 0.012 : 0.024;
  const faceGeo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: detail && holes.length <= 12, bevelThickness: 0.005, bevelSize: 0.004, bevelSegments: 1,
    curveSegments: detail ? 40 : 10,
  });
  faceGeo.rotateY(Math.PI / 2);
  // Concavidade: o centro fica para dentro (aros esportivos) ou para fora (calotas).
  const dish = spec.rim === "deep" ? 0.07 : spec.rim === "mesh" ? 0.05 : spec.rim === "steel" || spec.rim === "hubcap" ? -0.012 : 0.03;
  const p = faceGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getY(i), p.getZ(i)) / Rf;
    p.setX(i, p.getX(i) + face - depth - dish * (1 - Math.min(1, r)) * (1 - Math.min(1, r)));
  }
  faceGeo.computeVertexNormals();
  bin.add("metal", faceGeo, rimColor);

  // Cubo: miolo, porcas e a calota do centro.
  if (spec.rim === "steel" || spec.rim === "hubcap") {
    // Calota grande cromada (Fusca, Kombi) ou de plástico (Uno, Gol).
    const capR = spec.rim === "steel" ? Rf * 0.5 : Rf * 0.97;
    const prof: THREE.Vector2[] = [];
    const n = detail ? 12 : 3;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      prof.push(new THREE.Vector2(capR * Math.cos(t * Math.PI / 2) + 0.0001, face + 0.004 + Math.sin(t * Math.PI / 2) * capR * (spec.rim === "steel" ? 0.38 : 0.16)));
    }
    const cap = new THREE.LatheGeometry(prof, radial);
    cap.rotateZ(-Math.PI / 2);
    bin.add("metal", cap, spec.rim === "steel" ? "#e8ecef" : "#a7abb0");
    if (spec.rim === "hubcap" && detail) {
      // Furinhos da calota de plástico (fendas escuras em volta).
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const slot = new THREE.BoxGeometry(0.006, Rf * 0.22, Rf * 0.08);
        slot.translate(face + 0.012, Rf * 0.68, 0);
        slot.rotateX(a);
        bin.add("metal", slot, "#1c1d20");
      }
    }
  } else if (detail) {
    const hubDepth = face + 0.004 - dish;
    const center = new THREE.CylinderGeometry(Rf * 0.17, Rf * 0.2, 0.03, detail ? 24 : 8);
    center.rotateZ(Math.PI / 2);
    center.translate(hubDepth, 0, 0);
    bin.add("metal", center, rimColor);
    const badge = new THREE.CylinderGeometry(Rf * 0.1, Rf * 0.1, 0.008, detail ? 20 : 8);
    badge.rotateZ(Math.PI / 2);
    badge.translate(hubDepth + 0.017, 0, 0);
    bin.add("metal", badge, "#2b2d31");
    if (detail) {
      const lugs = spec.rim === "mesh" ? 1 : 5;
      for (let i = 0; i < lugs; i++) {
        const a = (i / lugs) * Math.PI * 2 + 0.3;
        const lug = new THREE.CylinderGeometry(0.011, 0.011, 0.022, 6);
        lug.rotateZ(Math.PI / 2);
        const rr = lugs === 1 ? 0 : Rf * 0.25;
        lug.translate(hubDepth + 0.006, Math.cos(a) * rr, Math.sin(a) * rr);
        bin.add("metal", lug, "#d9dde1");
      }
    }
  }

  // Na roda de corrida, os parafusos da borda (aros de duas peças).
  if (detail && (spec.rim === "mesh" || spec.rim === "deep")) {
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      const bolt = new THREE.CylinderGeometry(0.005, 0.005, 0.01, 5);
      bolt.rotateZ(Math.PI / 2);
      bolt.translate(face + 0.006, Math.cos(a) * Rf * 0.94, Math.sin(a) * Rf * 0.94);
      bin.add("metal", bolt, "#e6e8ea");
    }
  }

  const built = bin.build();
  for (const g of built.values()) g.userData.shared = true;
  cache.set(key, built);
  return built;
}

/** Pinça de freio do lado +x (fica parada, presa à carroceria), relativa ao centro da roda. */
export function caliperGeometry(spec: WheelSpec): THREE.BufferGeometry | null {
  if (!spec.caliper) return null;
  const R = spec.radius;
  const W = spec.width;
  const Rr = R * (spec.rimRatio ?? 0.68);
  const face = W / 2 * 0.78;
  const shape = new THREE.Shape();
  const r0 = Rr * 0.62;
  const r1 = Rr * 0.86;
  const a0 = 0.35;
  const a1 = 1.25;
  shape.absarc(0, 0, r1, a0, a1, false);
  shape.absarc(0, 0, r0, a1, a0, true);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 10 });
  // Atrás e em cima do eixo (z negativo = para trás), entre o disco e os raios.
  g.rotateY(Math.PI / 2);
  g.translate(face - 0.105, 0, 0);
  return g;
}
