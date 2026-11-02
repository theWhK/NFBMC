// O cais de Porto Gordo: navios atracados e fundeados (porta-contêiner com
// contêineres coloridos, navio-tanque, rebocador e barcos de pesca), os
// guindastes de pórtico "Ketchup & Mostarda" no cais, cabeços com as amarras e
// as defensas. Os navios balançam de leve na água (`animateHarbor`).
//
// Onde fica cada coisa vem do mapa em tempo de execução: o trecho do cais é o
// contorno do bairro do porto que encosta no mar (QUAY, em shared/src/props.ts),
// os guindastes (com colisão nos pés) são os GANTRIES, e os navios procuram
// lugar livre ao longo do cais. Nada de coordenada fixa. Os navios ficam na
// água, fora das ruas: não precisam de colisão.
import * as THREE from "three";
import { GANTRIES, QUAY, QUAY_Z, heightAt, quayDepth, seeded } from "@nfbmc/shared";

import { TILE, addChunk } from "./chunks.ts";
import { surface } from "./look.ts";
import { bar, beam, box, cylinder, glass, merge, put } from "./prop-kit.ts";
import { drawLogo, teamById } from "./teams.ts";

/** Nível da água do mar (o plano do mar, em scenery.ts). */
const SEA_Y = -0.6;

// --- Navios que balançam ------------------------------------------------------

interface Bobber {
  group: THREE.Object3D;
  heave: number;
  roll: number;
  pitch: number;
  yaw: number;
  phase: number;
  speed: number;
  baseYaw: number;
}

const bobbers: Bobber[] = [];

/** Balanço dos navios (chamado a cada quadro; só mexe nos que estão aparecendo). */
export function animateHarbor(time: number) {
  for (const b of bobbers) {
    if (!b.group.visible) continue;
    const t = time * b.speed + b.phase;
    b.group.position.y = SEA_Y + Math.sin(t) * b.heave;
    b.group.rotation.set(Math.sin(t * 0.83 + 1.3) * b.pitch, b.baseYaw + Math.sin(t * 0.21) * b.yaw, Math.sin(t * 0.67) * b.roll, "YXZ");
  }
}

function float(scene: THREE.Scene, group: THREE.Object3D, x: number, z: number, yaw: number, radius: number, motion: Partial<Bobber>) {
  group.position.set(x, SEA_Y, z);
  group.rotation.y = yaw;
  addChunk(scene, group, [x, z], radius);
  bobbers.push({ group, heave: 0.06, roll: 0.003, pitch: 0.001, yaw: 0, phase: x * 0.13, speed: 0.6, baseYaw: yaw, ...motion });
}

// --- Texturas ------------------------------------------------------------------

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const paint = () => {
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    draw(ctx);
    texture.needsUpdate = true;
  };
  paint();
  document.fonts?.load("64px 'Black Ops One'").then(paint).catch(() => {});
  return texture;
}

const OPS = "'Black Ops One', 'Russo One', sans-serif";
const RUSSO = "'Russo One', sans-serif";

/** Marcas dos contêineres (paródias das companhias de navegação). */
const BRANDS = [
  { name: "MÃERSK MARMITAS", bg: "#3d9bd0", fg: "#ffffff", code: "MMRU" },
  { name: "MSG CONDIMENTOS", bg: "#c9a35a", fg: "#2b2014", code: "MSGU" },
  { name: "EVERGRÃO", bg: "#1f7a3c", fg: "#f4f1e8", code: "EGRU" },
  { name: "RAPADURA-LLOYD", bg: "#e8611a", fg: "#ffffff", code: "RAPU" },
  { name: "COXCO", bg: "#26509e", fg: "#ffffff", code: "CXCU" },
  { name: "FEIJOADA LINE", bg: "#9e2a22", fg: "#f4e3c2", code: "FJLU" },
  { name: "TAPIOCA SHIPPING", bg: "#e9e4d8", fg: "#2c3e50", code: "TAPU" },
];

/** Lateral do contêiner: chapa ondulada e a marca. A faixa da esquerda (u < 0,1) é só chapa (pontas e teto). */
function containerMaterial(brand: (typeof BRANDS)[number], index: number) {
  const map = canvasTexture(512, 128, (ctx) => {
    ctx.fillStyle = brand.bg;
    ctx.fillRect(0, 0, 512, 128);
    for (let x = 0; x < 512; x += 8) {
      ctx.fillStyle = "rgba(0,0,0,0.16)";
      ctx.fillRect(x, 0, 3, 128);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(x + 4, 0, 2, 128);
    }
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(56, 0, 4, 128);
    ctx.fillRect(508, 0, 4, 128);
    ctx.fillStyle = brand.fg;
    ctx.font = `44px ${OPS}`;
    ctx.fillText(brand.name, 290, 62, 400);
    ctx.font = `14px ${RUSSO}`;
    ctx.textAlign = "left";
    ctx.fillText(`${brand.code} ${String(100000 + index * 7919).slice(0, 6)} 4`, 72, 16);
  });
  return surface(new THREE.MeshLambertMaterial({ map }), { roughness: 0.6, metalness: 0.3 });
}

const containerMaterials = BRANDS.map(containerMaterial);

/** Contêiner de 40 pés (eixo comprido em x), com as pontas e o teto na faixa sem letra. */
const containerGeometry = (() => {
  const g = new THREE.BoxGeometry(12.1, 2.55, 2.42);
  const uv = g.attributes.uv;
  // Faces: +x, −x, +y, −y, +z, −z (4 vértices cada). Só as laterais (±z) mostram a marca.
  for (let face = 0; face < 4; face++) {
    for (let k = 0; k < 4; k++) {
      const i = face * 4 + k;
      uv.setXY(i, uv.getX(i) * 0.1, uv.getY(i));
    }
  }
  g.userData.shared = true;
  return g;
})();

/** Nome do navio (letras brancas, fundo transparente). */
function nameMaterial(name: string, port: string, color = "#f4f1e8") {
  const map = canvasTexture(1024, 160, (ctx) => {
    ctx.fillStyle = color;
    ctx.font = `92px ${OPS}`;
    ctx.fillText(name, 512, 64, 1000);
    if (port) {
      ctx.font = `36px ${RUSSO}`;
      ctx.fillText(port, 512, 136, 1000);
    }
  });
  return new THREE.MeshLambertMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}

/** Marca da chaminé: o emblema da companhia num disco. */
function funnelMaterial(bg: string, draw: (ctx: CanvasRenderingContext2D) => void) {
  const map = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 256);
    ctx.save();
    ctx.translate(128, 128);
    draw(ctx);
    ctx.restore();
  });
  return surface(new THREE.MeshLambertMaterial({ map }), { roughness: 0.5, metalness: 0.3 });
}

/** Marmita branca (a "estrela" da Mãersk Marmitas). */
const marmitaFunnel = funnelMaterial("#3d9bd0", (ctx) => {
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect?.(-62, -30, 124, 70, 14);
  if (!ctx.roundRect) ctx.rect(-62, -30, 124, 70);
  ctx.fill();
  ctx.fillRect(-72, -44, 144, 18);
  ctx.fillStyle = "#3d9bd0";
  ctx.fillRect(-62, -6, 124, 6);
  ctx.fillRect(-18, -58, 36, 12);
});
const petrolancheFunnel = funnelMaterial("#00a19b", (ctx) => drawLogo(ctx, teamById("petrolanche"), 0, 0, 200));

/** Janelas em fileiras (paredes brancas da superestrutura). */
const windowsMaterial = (() => {
  const map = canvasTexture(128, 64, (ctx) => {
    ctx.fillStyle = "#f2f0ea";
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = "#2c3a48";
    for (let x = 6; x < 128; x += 22) ctx.fillRect(x, 20, 14, 18);
    ctx.fillStyle = "rgba(255,190,120,0.55)";
    ctx.fillRect(28, 20, 14, 18);
  });
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return surface(new THREE.MeshLambertMaterial({ map, emissive: "#ffb060", emissiveIntensity: 0.05 }), { roughness: 0.6 });
})();

/** Caixa de superestrutura com janelas (cada andar de 2,8 m vira uma fileira). */
function deckhouse(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  // UV em metros: uma janela a cada ~5 m, uma fileira por andar.
  const uv = g.attributes.uv;
  const normal = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const span = ny > 0.5 ? 0 : nx > 0.5 ? d : w;
    uv.setXY(i, uv.getX(i) * (span / 5), ny > 0.5 ? 0.1 : uv.getY(i) * (h / 2.8));
  }
  return put(parent, g, windowsMaterial, x, y + h / 2, z);
}

// --- Casco ------------------------------------------------------------------------

interface HullSpec {
  length: number;
  beam: number;
  /** Do fundo até o convés. */
  depth: number;
  /** Quanto fica embaixo d'água. */
  draft: number;
  hull: string;
  bottom: string;
  deck: string;
  /** Onde começa a proa afinando (0 = popa, 1 = bico). */
  bowStart?: number;
  /** Quanto a proa avança no alto (bico lançado), em fração do comprimento. */
  rake?: number;
  /** Proa mais alta (castelo), em metros a mais no bico. */
  sheer?: number;
}

/** Meia boca do casco na estação `u` (0 = popa, 1 = bico). */
function halfBeam(spec: HullSpec, u: number) {
  const bow = spec.bowStart ?? 0.72;
  if (u > bow) {
    const t = (u - bow) / (1 - bow);
    return (spec.beam / 2) * Math.sqrt(Math.max(0, 1 - t * t));
  }
  if (u < 0.06) return (spec.beam / 2) * (0.86 + 0.14 * (u / 0.06));
  return spec.beam / 2;
}

/**
 * Casco por seções ao longo do comprimento (eixo x, popa em −x), com o fundo
 * arredondado no bojo, a proa afinando e lançada, o espelho de popa e o convés.
 * Abaixo da linha d'água (y = 0) é a cor do fundo; acima, a do costado.
 */
function hull(parent: THREE.Object3D, spec: HullSpec) {
  const { length: L, depth: D, draft } = spec;
  const N = 40;
  const bow = spec.bowStart ?? 0.72;
  const rake = (spec.rake ?? 0.05) * L;
  const sheer = spec.sheer ?? 0;
  /** Largura relativa em cada altura (0 = fundo, 1 = convés): bojo arredondado. */
  const widthAt = (f: number) => (f >= 0.2 ? 1 : 0.5 + 0.5 * Math.sqrt(f / 0.2));
  const point = (i: number, f: number, side: number) => {
    const u = i / N;
    const t = u > bow ? (u - bow) / (1 - bow) : 0;
    // O fundo da proa recua (proa lançada) e o convés sobe um pouco no bico.
    const x = -L / 2 + u * L - rake * (1 - f) * t ** 1.5;
    const top = D + sheer * t * t;
    const y = -draft + f * top;
    const b = halfBeam(spec, Math.min(1, (x + L / 2) / L)) * widthAt(f);
    return new THREE.Vector3(x, y, side * b);
  };
  // Duas faixas de altura: fundo (até a linha d'água) e costado (dali ao convés).
  const water = draft / D;
  const bands: [number[], string][] = [
    [[0, 0.05, 0.12, 0.2, water * 0.6, water], spec.bottom],
    [[water, water + (1 - water) * 0.5, 1], spec.hull],
  ];
  for (const [levels, color] of bands) {
    const positions: number[] = [];
    for (const side of [1, -1]) {
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < levels.length - 1; j++) {
          const a = point(i, levels[j], side);
          const b = point(i + 1, levels[j], side);
          const c = point(i, levels[j + 1], side);
          const d = point(i + 1, levels[j + 1], side);
          const quad = side > 0 ? [a, b, c, b, d, c] : [a, c, b, b, c, d];
          for (const p of quad) positions.push(p.x, p.y, p.z);
        }
      }
      // Espelho de popa.
      for (let j = 0; j < levels.length - 1; j++) {
        const a = point(0, levels[j], 1);
        const b = point(0, levels[j + 1], 1);
        const c = point(0, levels[j + 1], -1);
        const d = point(0, levels[j], -1);
        if (side > 0) for (const p of [a, b, c, a, c, d]) positions.push(p.x, p.y, p.z);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    put(parent, geometry, { metal: color });
  }
  // Convés.
  const deck: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = point(i, 1, 1);
    const b = point(i + 1, 1, 1);
    const c = point(i, 1, -1);
    const d = point(i + 1, 1, -1);
    for (const p of [a, b, c, b, d, c]) deck.push(p.x, p.y, p.z);
  }
  const deckGeometry = new THREE.BufferGeometry();
  deckGeometry.setAttribute("position", new THREE.Float32BufferAttribute(deck, 3));
  deckGeometry.computeVertexNormals();
  put(parent, deckGeometry, spec.deck);
  // Borda falsa (amurada) na proa: chapa baixa em volta do castelo.
  const deckY = D - draft;
  return { deckY, halfBeam: (x: number) => halfBeam(spec, (x + L / 2) / L), point };
}

/** Nome dos dois lados do casco, perto da proa, e o nome com o porto na popa. */
function shipName(parent: THREE.Object3D, spec: HullSpec, deckY: number, name: string, width: number) {
  const material = nameMaterial(name, "");
  const x = spec.length * 0.22;
  const h = width * 0.16;
  for (const side of [1, -1]) {
    put(parent, new THREE.PlaneGeometry(width, h), material, x, deckY - h * 0.75, side * (spec.beam / 2 + 0.03), side > 0 ? 0 : Math.PI);
  }
  const stern = nameMaterial(name, "PORTO GORDO");
  const sw = spec.beam * 0.7;
  put(parent, new THREE.PlaneGeometry(sw, sw * 0.16), stern, -spec.length / 2 - 0.03, deckY - sw * 0.12, 0, -Math.PI / 2);
}

/** Mastro com radar e as luzes. */
function mast(parent: THREE.Object3D, x: number, y: number, height: number) {
  cylinder(parent, 0.25, height, x, y, 0, "#f2f0ea", 8, 0.18);
  box(parent, 0.3, 0.3, 4, x, y + height * 0.7, 0, "#f2f0ea");
  box(parent, 0.4, 0.25, 3.2, x + 0.3, y + height * 0.85, 0, "#2b2b2b");
  box(parent, 0.3, 0.3, 0.3, x, y + height, 0, { glow: "#fff2c0" });
}

// --- Navios ------------------------------------------------------------------------

/** Porta-contêiner: casco escuro, superestrutura na popa e pilhas de contêiner. */
function containerShip(name: string, length: number, seed: number, mix: number[]) {
  const root = new THREE.Group();
  const spec: HullSpec = { length, beam: length * 0.16, depth: length * 0.09, draft: length * 0.05, hull: "#1d2c4a", bottom: "#a3322a", deck: "#6b7078", bowStart: 0.74, rake: 0.05, sheer: 2 };
  const { deckY, halfBeam: hb } = hull(root, spec);
  const B = spec.beam;
  shipName(root, spec, deckY, name, B * 1.1);
  // Superestrutura (casario) na popa, com a ponte de comando larga em cima.
  const hx = -length / 2 + length * 0.12;
  const houseL = length * 0.07;
  const floors = 6;
  deckhouse(root, houseL, floors * 2.8, B - 6, hx, deckY, 0);
  deckhouse(root, houseL * 0.9, 2.6, B + 0.6, hx + houseL * 0.05, deckY + floors * 2.8, 0);
  put(root, new THREE.BoxGeometry(0.15, 1.1, B - 1), glass, hx + houseL * 0.5 + 0.02, deckY + floors * 2.8 + 1.5, 0);
  box(root, houseL, 0.3, B + 0.8, hx, deckY + floors * 2.8 + 2.6, 0, "#f2f0ea");
  mast(root, hx, deckY + floors * 2.8 + 2.9, 7);
  // Chaminé atrás, com a marmita.
  const fx = hx - houseL * 0.75;
  put(root, new THREE.BoxGeometry(houseL * 0.6, 9, B * 0.32), marmitaFunnel, fx, deckY + floors * 2.8 - 1, 0);
  box(root, houseL * 0.62, 1.2, B * 0.33, fx, deckY + floors * 2.8 + 3.4, 0, "#1a1a1a");
  // Baleeira laranja (bote salva-vidas de queda livre) na popa.
  put(root, new THREE.CapsuleGeometry(1.4, 5.5, 4, 10).rotateZ(Math.PI / 2 - 0.5), "#ff6a13", -length / 2 + 3.5, deckY + 3.5, 0);
  box(root, 2, 4, 3.4, -length / 2 + 1.5, deckY, 0, "#f2f0ea");
  // Castelo de proa: o quebra-mar e o mastro da proa.
  const bowX = length / 2 - length * 0.1;
  box(root, 1.2, 2.2, hb(bowX) * 1.7, bowX, deckY, 0, "#e6e3dc");
  mast(root, length / 2 - length * 0.06, deckY + 1.5, 6);
  // Pilhas de contêiner, baía por baía, mais baixas nas pontas.
  const random = seeded(seed);
  const from = hx + houseL * 0.5 + 2;
  const to = bowX - 2;
  const bays = Math.floor((to - from) / 12.6);
  const perBrand: THREE.Matrix4[][] = BRANDS.map(() => []);
  const matrix = new THREE.Matrix4();
  for (let k = 0; k < bays; k++) {
    const x = from + 6.3 + k * 12.6;
    // Lascas de proteção (hatch) embaixo de cada baía.
    box(root, 12.2, 0.6, B - 2.5, x, deckY, 0, "#54595f");
    const rows = Math.floor((Math.min(hb(x - 6), hb(x + 6)) * 2 - 2) / 2.5);
    for (let r = 0; r < rows; r++) {
      const z = (r - (rows - 1) / 2) * 2.5;
      const edge = Math.abs(z) / (B / 2);
      const top = Math.max(1, Math.round(2 + random() * 3.5 - edge * 1.5 - (k === bays - 1 ? 1.5 : 0)));
      for (let t = 0; t < top; t++) {
        const brand = mix[Math.floor(random() * mix.length)];
        matrix.makeTranslation(x, deckY + 0.6 + 1.3 + t * 2.6, z);
        perBrand[brand].push(matrix.clone());
      }
    }
  }
  perBrand.forEach((list, brand) => {
    if (!list.length) return;
    const instanced = new THREE.InstancedMesh(containerGeometry, containerMaterials[brand], list.length);
    list.forEach((m, i) => instanced.setMatrixAt(i, m));
    instanced.computeBoundingSphere();
    instanced.userData.keep = true;
    root.add(instanced);
  });
  return { group: merge(root), spec, deckY };
}

/** Navio-tanque: convés vermelho com a tubulação, passarela e o casario branco na popa. */
function tanker(name: string, length: number) {
  const root = new THREE.Group();
  const spec: HullSpec = { length, beam: length * 0.17, depth: length * 0.085, draft: length * 0.055, hull: "#23262c", bottom: "#a3322a", deck: "#8a3a2a", bowStart: 0.8, rake: 0.03, sheer: 1.2 };
  const { deckY, halfBeam: hb } = hull(root, spec);
  const B = spec.beam;
  shipName(root, spec, deckY, name, B * 1.15);
  const hx = -length / 2 + length * 0.09;
  const houseL = length * 0.08;
  deckhouse(root, houseL, 5 * 2.8, B - 4, hx, deckY, 0);
  deckhouse(root, houseL * 0.9, 2.6, B + 0.4, hx, deckY + 14, 0);
  put(root, new THREE.BoxGeometry(0.15, 1.1, B - 1), glass, hx + houseL * 0.45 + 0.02, deckY + 15.4, 0);
  mast(root, hx, deckY + 16.6, 6);
  put(root, new THREE.BoxGeometry(houseL * 0.5, 7, B * 0.3), petrolancheFunnel, hx - houseL * 0.7, deckY + 11, 0);
  box(root, houseL * 0.52, 1, B * 0.31, hx - houseL * 0.7, deckY + 18, 0, "#1a1a1a");
  // Tubulação ao longo do convés (três canos verdes) e a passarela por cima.
  const from = hx + houseL / 2 + 1;
  const to = length / 2 - length * 0.1;
  for (const z of [-1.4, 0, 1.4]) {
    put(root, new THREE.CylinderGeometry(0.35, 0.35, to - from, 8).rotateZ(Math.PI / 2), { metal: "#3f7a4a" }, (from + to) / 2, deckY + 0.9, z);
  }
  box(root, to - from, 0.2, 1.4, (from + to) / 2, deckY + 2.6, -3.2, "#d9d4c4");
  for (let x = from; x <= to; x += 8) {
    box(root, 0.3, 2.6, 0.3, x, deckY, -3.2, "#d9d4c4");
    box(root, 0.3, 0.6, 4.2, x, deckY, -0.2, "#6d6f73");
  }
  // Coletor no meio do navio: canos atravessando e o guindastinho das mangueiras.
  const mid = (from + to) / 2;
  for (const dx of [-1.5, 0, 1.5]) put(root, new THREE.CylinderGeometry(0.3, 0.3, B - 2, 8).rotateX(Math.PI / 2), { metal: "#3f7a4a" }, mid + dx, deckY + 1.4, 0);
  cylinder(root, 0.45, 6, mid + 4, deckY, B / 2 - 3, { metal: "#e8b923" });
  beam(root, new THREE.Vector3(mid + 4, deckY + 6, B / 2 - 3), new THREE.Vector3(mid - 6, deckY + 9, B / 2 - 1), 0.5, { metal: "#e8b923" });
  // Respiros das tampas dos tanques.
  for (let x = from + 6; x < to - 3; x += 12) cylinder(root, 0.5, 0.9, x, deckY, 4.5, "#c9c4b8", 8);
  const bowX = length / 2 - length * 0.07;
  box(root, 1, 1.8, hb(bowX) * 1.6, bowX, deckY, 0, "#e6e3dc");
  mast(root, length / 2 - length * 0.04, deckY + 1, 5);
  return { group: merge(root), spec, deckY };
}

/** Rebocador: casco vermelho com pneus de defensa, casa do leme alta e chaminés amarelas. */
function tug(name: string) {
  const root = new THREE.Group();
  const spec: HullSpec = { length: 24, beam: 9, depth: 4.6, draft: 2.4, hull: "#c1272d", bottom: "#23262c", deck: "#5b5f66", bowStart: 0.62, rake: 0.08, sheer: 1.2 };
  const { deckY, halfBeam: hb } = hull(root, spec);
  shipName(root, spec, deckY, name, 7);
  // Pneus pendurados no costado e a defensa de borracha na proa.
  for (let x = -9; x <= 6; x += 3) {
    for (const side of [1, -1]) put(root, new THREE.TorusGeometry(0.45, 0.2, 6, 12), "#151515", x, deckY - 0.9, side * (hb(x) + 0.2));
  }
  box(root, 1.6, 1.6, 3, 12.2, deckY - 1.6, 0, "#151515");
  // Casaria em dois andares, com vidro em volta.
  box(root, 9, 2.6, 6.4, 0.5, deckY, 0, "#f2f0ea");
  box(root, 5.5, 2.4, 5.4, 1.6, deckY + 2.6, 0, "#f2f0ea");
  put(root, new THREE.BoxGeometry(5.6, 1.1, 5.5), glass, 1.6, deckY + 4.1, 0);
  box(root, 6, 0.25, 6, 1.6, deckY + 5, 0, "#c1272d");
  mast(root, 1.0, deckY + 5.2, 4);
  for (const z of [-1.6, 1.6]) {
    box(root, 1.2, 3.2, 0.9, -3.4, deckY + 1.5, z, "#ffd23f");
    box(root, 1.25, 0.4, 0.95, -3.4, deckY + 4.7, z, "#151515");
  }
  // Gancho de reboque na popa.
  box(root, 0.6, 1.6, 0.6, -8, deckY, 0, "#2b2b2b");
  box(root, 2.4, 0.4, 0.4, -8, deckY + 1.6, 0, "#2b2b2b");
  return { group: merge(root), spec, deckY };
}

/** Barco de pesca: casco pequeno, cabine, mastro com a retranca e a rede. */
function fishingBoat(name: string, hullColor: string, seed: number) {
  const root = new THREE.Group();
  const spec: HullSpec = { length: 12, beam: 4, depth: 2.4, draft: 1.0, hull: hullColor, bottom: "#9b2b24", deck: "#a07a4e", bowStart: 0.6, rake: 0.1, sheer: 0.7 };
  const { deckY } = hull(root, spec);
  shipName(root, spec, deckY, name, 3.6);
  box(root, 3, 2.1, 2.8, 1.6, deckY, 0, "#f2f0ea");
  put(root, new THREE.BoxGeometry(0.1, 0.7, 2.4), glass, 3.12, deckY + 1.4, 0);
  box(root, 3.3, 0.18, 3.1, 1.6, deckY + 2.1, 0, seed % 2 ? "#1f7a3c" : "#2a6bff");
  cylinder(root, 0.1, 6.5, -1.2, deckY, 0, "#d9d4cc", 6);
  bar(root, new THREE.Vector3(-1.2, deckY + 4.5, 0), new THREE.Vector3(-5.2, deckY + 2.2, 0), 0.07, "#d9d4cc");
  box(root, 1.6, 0.6, 1.4, -3.6, deckY, 0.3, "#3d5a40");
  box(root, 0.8, 0.4, 0.8, -4.2, deckY, -0.9, "#f2b705");
  return { group: merge(root), spec, deckY };
}

// --- Guindaste de pórtico ("Ketchup & Mostarda") -----------------------------------

const KETCHUP = { metal: "#c62d1f" };
const MUSTARD = { metal: "#f2b705" };

/**
 * Guindaste do cais (x ao longo do cais, −z para o mar): quatro pés vermelhos
 * com o pórtico, a lança amarela por cima do navio, o "A" com os estais, a casa
 * de máquinas e o carrinho com o spreader segurando um contêiner.
 */
function gantryCrane(spot: (typeof GANTRIES)[number], reach: number, hookY: number, brand: number) {
  const root = new THREE.Group();
  const s = spot.halfSpan;
  const sea = spot.seaZ;
  const land = spot.landZ;
  const top = 28;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  for (const x of [-s, s]) {
    for (const z of [sea, land]) box(root, 1.4, top, 1.4, x, 0, z, KETCHUP);
    // Truque das rodas no trilho.
    for (const z of [sea, land]) box(root, 2.6, 0.9, 1.6, x, 0, z, "#2b2b2b");
    // Travessa do pórtico (alta, por cima dos carros) e o "X" de travamento.
    beam(root, v(x, 18, sea), v(x, 18, land), 1.0, KETCHUP);
    beam(root, v(x, top, sea), v(x, top, land), 1.2, KETCHUP);
    bar(root, v(x, 18.5, sea), v(x, top - 0.5, land), 0.25, KETCHUP);
    bar(root, v(x, 18.5, land), v(x, top - 0.5, sea), 0.25, KETCHUP);
  }
  for (const z of [sea, land]) beam(root, v(-s, top, z), v(s, top, z), 1.4, KETCHUP);
  // Lança: duas vigas da traseira (por cima da terra) até a ponta (por cima do mar).
  const boomY = top + 3;
  const back = land + 16;
  const tip = sea - reach;
  for (const x of [-2.6, 2.6]) {
    beam(root, v(x, boomY, back), v(x, boomY, tip), 1.6, MUSTARD);
    beam(root, v(x, boomY - 1, sea + 2), v(x, top, sea), 1.0, MUSTARD);
    beam(root, v(x, boomY - 1, land - 2), v(x, top, land), 1.0, MUSTARD);
  }
  for (let z = tip + 1; z <= back - 1; z += 6) beam(root, v(-2.6, boomY + 0.6, z), v(2.6, boomY + 0.6, z), 0.4, MUSTARD);
  for (let z = tip + 1; z <= back - 7; z += 6) {
    for (const x of [-2.6, 2.6]) bar(root, v(x, boomY - 0.6, z), v(x, boomY + 0.7, z + 6), 0.12, MUSTARD);
  }
  // O "A" em cima e os estais até a ponta e a traseira.
  const apex = v(0, boomY + 22, land - 1);
  for (const x of [-s + 1, s - 1]) {
    beam(root, v(x, top, land), apex, 0.9, KETCHUP);
    beam(root, v(x, top, sea), v(0, boomY + 18, sea + 1), 0.7, KETCHUP);
  }
  bar(root, apex, v(-2.6, boomY + 0.8, tip + 2), 0.12, "#2b2b2b");
  bar(root, apex, v(2.6, boomY + 0.8, tip + 2), 0.12, "#2b2b2b");
  bar(root, v(0, boomY + 18, sea + 1), v(0, boomY + 0.8, tip + reach * 0.45), 0.12, "#2b2b2b");
  bar(root, apex, v(0, boomY + 0.8, back - 1), 0.14, "#2b2b2b");
  box(root, 0.6, 0.6, 0.6, apex.x, apex.y, apex.z, { glow: "#ff2a2a" });
  box(root, 0.5, 0.5, 0.5, 0, boomY + 1, tip, { glow: "#ff2a2a" });
  // Casa de máquinas na traseira, com o nome.
  box(root, 7, 4.2, 10, 0, boomY + 0.8, back - 6, "#f2f0ea");
  box(root, 7.2, 0.4, 10.2, 0, boomY + 5, back - 6, KETCHUP);
  // Carrinho com a cabine do operador e o spreader com um contêiner pendurado.
  const tz = sea - reach * 0.55;
  box(root, 6.4, 1.6, 6, 0, boomY - 1.8, tz, "#e6e3dc");
  put(root, new THREE.BoxGeometry(2.6, 2.2, 2.6), glass, 0, boomY - 3.4, tz - 1.2);
  for (const [x, z] of [[-1.6, -0.8], [1.6, -0.8], [-1.6, 0.8], [1.6, 0.8]]) bar(root, v(x, boomY - 2, tz + z), v(x * 2.6, hookY + 1.4, tz + z), 0.05, "#1a1a1a");
  box(root, 12.4, 0.6, 2.6, 0, hookY + 1.2, tz, MUSTARD);
  const container = new THREE.InstancedMesh(containerGeometry, containerMaterials[brand], 1);
  container.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, hookY - 0.1, tz));
  container.userData.keep = true;
  root.add(container);
  // Rodapé: plaquinha com a marca dos guindastes.
  put(root, new THREE.PlaneGeometry(9, 2.2), craneSign, 0, boomY + 2.9, back - 0.95);
  return root;
}

const craneSign = (() => {
  const map = canvasTexture(512, 128, (ctx) => {
    ctx.fillStyle = "#c62d1f";
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = "#f2b705";
    ctx.fillRect(0, 96, 512, 32);
    ctx.fillStyle = "#ffffff";
    ctx.font = `46px ${OPS}`;
    ctx.fillText("KETCHUP & MOSTARDA", 256, 52, 490);
    ctx.fillStyle = "#c62d1f";
    ctx.font = `20px ${RUSSO}`;
    ctx.fillText("GUINDASTES · PORTO GORDO", 256, 112, 490);
  });
  return new THREE.MeshLambertMaterial({ map, emissive: "#ffffff", emissiveMap: map, emissiveIntensity: 0.25 });
})();

// --- Cais: cabeços, defensas e amarras ---------------------------------------------

const ROPE = "#d8c79a";

/** Cabeço de amarração (a base em y = 0). */
function bollard(parent: THREE.Object3D, x: number, y: number, z: number) {
  cylinder(parent, 0.32, 0.65, x, y, z, { metal: "#2e3033" }, 10, 0.26);
  cylinder(parent, 0.4, 0.14, x, y + 0.65, z, { metal: "#2e3033" }, 10);
}

/** Amarra de `a` a `b`, caindo um pouco no meio. */
function rope(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y -= 0.4 + a.distanceTo(b) * 0.025;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  put(parent, new THREE.TubeGeometry(curve, 14, 0.09, 5), ROPE);
}

interface Berth {
  x: number;
  length: number;
}

/** Procura no cais um trecho livre de `length` m perto de `prefer`, com chão para os cabeços. */
function findBerth(taken: Berth[], length: number, prefer: number, minDepth = 3): Berth | null {
  if (!QUAY) return null;
  let best: Berth | null = null;
  for (let x = QUAY.minX + length / 2 + 6; x <= QUAY.maxX - length / 2 - 6; x += 5) {
    if (taken.some((t) => Math.abs(t.x - x) < (t.length + length) / 2 + 12)) continue;
    if (quayDepth(x - length / 2 + 4) < minDepth || quayDepth(x + length / 2 - 4) < minDepth) continue;
    if (!best || Math.abs(x - prefer) < Math.abs(best.x - prefer)) best = { x, length };
  }
  if (best) taken.push(best);
  return best;
}

/** Guarda as peças do cais em blocos de TILE m (como os outros enfeites da cidade). */
class QuayBatch {
  private tiles = new Map<number, THREE.Group>();
  at(x: number) {
    const k = Math.floor(x / TILE);
    let g = this.tiles.get(k);
    if (!g) this.tiles.set(k, (g = new THREE.Group()));
    return g;
  }
  flush(scene: THREE.Scene) {
    for (const [k, g] of this.tiles) addChunk(scene, merge(g), [(k + 0.5) * TILE, QUAY_Z], TILE * 0.71 + 40);
  }
}

/**
 * Atraca o navio no cais: casco a 2,6 m do muro (com as defensas), cabeços e
 * quatro amarras (lançante de proa e de popa e os dois espringues).
 */
function moor(scene: THREE.Scene, batch: QuayBatch, ship: { group: THREE.Group; spec: HullSpec; deckY: number }, berth: Berth, motion: Partial<Bobber>) {
  const { spec, deckY } = ship;
  const z = QUAY_Z - 2.6 - spec.beam / 2;
  // Proa para +x ou −x (de um navio para o outro, para variar).
  const flip = Math.round(berth.x / 37) % 2 === 0;
  const yaw = flip ? Math.PI : 0;
  float(scene, ship.group, berth.x, z, yaw, spec.length / 2 + 30, motion);
  const L = spec.length;
  const dir = flip ? -1 : 1;
  // Pontos de amarração no navio (borda do convés do lado do cais) e os cabeços em terra.
  const lines: [number, number][] = [
    [L * 0.42, L * 0.58],
    [L * 0.36, L * 0.22],
    [-L * 0.36, -L * 0.22],
    [-L * 0.44, -L * 0.6],
  ];
  const parent = batch.at(berth.x);
  const placed = new Set<number>();
  for (const [onShip, onLand] of lines) {
    const sx = berth.x + dir * onShip;
    const bx = berth.x + dir * onLand;
    const bollardY = heightAt(bx, QUAY_Z + 0.9);
    if (!placed.has(Math.round(bx))) bollard(parent, bx, bollardY, QUAY_Z + 0.9);
    placed.add(Math.round(bx));
    // Borda do convés ali (a proa afina e sobe um pouco).
    const u = 0.5 + onShip / L;
    const bow = spec.bowStart ?? 0.72;
    const t = u > bow ? (u - bow) / (1 - bow) : 0;
    const shipZ = z + halfBeam(spec, u) - 0.4;
    rope(parent, new THREE.Vector3(sx, SEA_Y + deckY + (spec.sheer ?? 0) * t * t + 0.5, shipZ), new THREE.Vector3(bx, bollardY + 0.7, QUAY_Z + 0.9));
  }
  // Defensas pretas no muro do cais, ao longo do navio.
  for (let dx = -L / 2 + 4; dx <= L / 2 - 4; dx += Math.max(8, L / 10)) {
    box(parent, 1.6, 1.8, 0.7, berth.x + dx, -0.9, QUAY_Z - 2.35, "#1a1a1a");
  }
}

/** Fundeado no meio da baía: balança mais e solta a corrente da âncora. */
function anchor(scene: THREE.Scene, ship: { group: THREE.Group; spec: HullSpec; deckY: number }, x: number, z: number, yaw: number) {
  const { spec, deckY } = ship;
  const chain = new THREE.Group();
  const bow = new THREE.Vector3(spec.length / 2 - spec.length * 0.06, deckY - 1, spec.beam * 0.3);
  bar(chain, bow, new THREE.Vector3(spec.length / 2 + 16, -0.2, spec.beam * 0.35), 0.18, "#2b2b2b");
  ship.group.add(merge(chain));
  float(scene, ship.group, x, z, yaw, spec.length / 2 + 25, { heave: 0.22, roll: 0.012, pitch: 0.004, yaw: 0.03, speed: 0.45 });
}

export function buildHarbor(scene: THREE.Scene) {
  const quay = QUAY;
  if (!quay) return;
  const batch = new QuayBatch();
  const taken: Berth[] = [];
  // Guindastes: alcance para cobrir o navio inteiro na largura.
  const mid = GANTRIES.length ? GANTRIES.reduce((s, g) => s + g.x, 0) / GANTRIES.length : (quay.minX + quay.maxX) / 2;
  const big = containerShip("BATATA FRITA EXPRESS", 168, 31, [0, 0, 0, 1, 2, 3, 4, 5, 6]);
  const containerBerth = findBerth(taken, big.spec.length, mid);
  if (containerBerth) {
    moor(scene, batch, big, containerBerth, {});
    // O carrinho para em cima do navio, o contêiner pendurado a 4 m das pilhas.
    const hookY = SEA_Y + big.deckY + 0.6 + 6 * 2.6 + 4;
    GANTRIES.forEach((spot, i) => {
      const crane = gantryCrane(spot, big.spec.beam + 18, hookY, (i * 2 + 1) % BRANDS.length);
      crane.position.set(spot.x, heightAt(spot.x, (spot.seaZ + spot.landZ) / 2), 0);
      const g = new THREE.Group();
      g.add(crane);
      addChunk(scene, merge(g), [spot.x, spot.seaZ], 80);
    });
  }
  const oil = tanker("MAIONESE PRINCESS", 136);
  const oilBerth = findBerth(taken, oil.spec.length, (quay.minX + quay.maxX) / 2 + 300);
  if (oilBerth) moor(scene, batch, oil, oilBerth, { heave: 0.05 });
  const tugboat = tug("TORRESMO");
  const tugBerth = findBerth(taken, tugboat.spec.length, (oilBerth?.x ?? mid) + 120, 2);
  if (tugBerth) moor(scene, batch, tugboat, tugBerth, { heave: 0.12, roll: 0.02, pitch: 0.006, speed: 0.9 });
  ([["PASTEL DO MAR", "#2a6bff"], ["SARDINHA III", "#f2f0ea"], ["ESPETINHO", "#1f7a3c"]] as const).forEach(([name, color], i) => {
    const boat = fishingBoat(name, color, i);
    const berth = findBerth(taken, boat.spec.length, quay.minX + 40 + i * 20, 1);
    if (berth) moor(scene, batch, boat, berth, { heave: 0.14, roll: 0.035, pitch: 0.01, speed: 1.1 + i * 0.13 });
  });
  // Fundeados na baía, esperando vaga (aparecem do cais, no meio da neblina).
  const cx = (quay.minX + quay.maxX) / 2;
  anchor(scene, containerShip("MARMITA MAJESTY", 150, 77, [1, 2, 4, 5, 3]), cx - 260, QUAY_Z - 260, 0.35);
  anchor(scene, tanker("AZEITE DE DENDÊ", 120), cx + 220, QUAY_Z - 330, -0.5);
  batch.flush(scene);
}
