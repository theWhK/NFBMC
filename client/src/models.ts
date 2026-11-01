// Modelos 3D feitos só com formas simples do Three.js (sem arquivos externos).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { CROSSFIT_CAR, carSpec, type FoodKind, type TrafficKind } from "@nfbmc/shared";

import { roundRect, type MatName, type P2 } from "./car-kit.ts";
import { bodyGeometry, roofPeak, topStripe, trafficGeometry, wheelGeometry, type BuiltBody, type Kit, type WheelSpec } from "./car-models.ts";
import { surface, type Surface } from "./look.ts";

const lambert = (color: THREE.ColorRepresentation) => new THREE.MeshLambertMaterial({ color });

const MATERIALS = {
  bun: lambert("#d9973f"),
  bunTop: lambert("#e0a24a"),
  patty: lambert("#5a3418"),
  cheese: lambert("#f6c945"),
  lettuce: lambert("#5cb83a"),
  tomato: lambert("#e2412f"),
  fry: lambert("#f7d154"),
  carton: lambert("#d62828"),
  cup: lambert("#e63946"),
  lid: lambert("#f1f1f1"),
  straw: lambert("#f1f1f1"),
  flame: new THREE.MeshBasicMaterial({ color: "#ff9f1c", transparent: true, opacity: 0.85 }),
};

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  return m;
}

const bakedMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

/**
 * Funde as peças de um modelo numa malha só, com a cor de cada peça gravada nos
 * vértices. Um hambúrguer de 6 peças vira 1 chamada de desenho em vez de 6, o
 * que faz muita diferença com dezenas de comidas na cidade.
 */
export function bake(group: THREE.Object3D): THREE.Mesh {
  group.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = (object.geometry as THREE.BufferGeometry).clone().applyMatrix4(object.matrixWorld);
    const color = ((object.material as THREE.MeshLambertMaterial).color ?? new THREE.Color("#ffffff")).clone();
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([color.r, color.g, color.b], i);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    parts.push(geometry.index ? geometry.toNonIndexed() : geometry);
  });
  return new THREE.Mesh(mergeGeometries(parts), bakedMaterial);
}

/** Hambúrguer de tamanho 1 (cerca de 1 de diâmetro), com a base em y = 0. */
export function makeBurger() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.5, 0.48, 0.18, 20), MATERIALS.bun, 0, 0.09));
  g.add(mesh(new THREE.CylinderGeometry(0.54, 0.54, 0.06, 20), MATERIALS.lettuce, 0, 0.21));
  g.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.16, 20), MATERIALS.patty, 0, 0.32));
  g.add(mesh(new THREE.BoxGeometry(0.78, 0.04, 0.78), MATERIALS.cheese, 0, 0.42));
  g.add(mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.05, 20), MATERIALS.tomato, 0, 0.47));
  const top = mesh(new THREE.SphereGeometry(0.52, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), MATERIALS.bunTop, 0, 0.5);
  top.scale.y = 0.75;
  g.add(top);
  return g;
}

function makeFries() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.7, 0.6, 0.45), MATERIALS.carton, 0, 0.3));
  const stick = new THREE.BoxGeometry(0.08, 0.6, 0.08);
  for (let i = 0; i < 9; i++) {
    const fry = mesh(stick, MATERIALS.fry, -0.25 + (i % 5) * 0.12, 0.75 + (i % 3) * 0.05, i < 5 ? -0.08 : 0.08);
    fry.rotation.z = (i % 3 - 1) * 0.15;
    g.add(fry);
  }
  return g;
}

function makeSoda() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.35, 0.26, 1, 16), MATERIALS.cup, 0, 0.5));
  g.add(mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.06, 16), MATERIALS.lid, 0, 1.02));
  const straw = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6), MATERIALS.straw, 0.08, 1.3);
  straw.rotation.z = -0.25;
  g.add(straw);
  return g;
}

const foodCache = new Map<FoodKind, THREE.BufferGeometry>();

export function makeFood(kind: FoodKind) {
  // A geometria fundida de cada tipo é feita uma vez e reaproveitada.
  let geometry = foodCache.get(kind);
  if (!geometry) {
    const inner = kind === "burger" ? makeBurger() : kind === "fries" ? makeFries() : makeSoda();
    inner.scale.setScalar(kind === "soda" ? 1.5 : 1.9);
    geometry = bake(inner).geometry;
    foodCache.set(kind, geometry);
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geometry, bakedMaterial));
  return g;
}

/** Placa com o nome do jogador, que sempre olha para a câmera. */
function makeLabel(text: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 34px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = Math.min(250, ctx.measureText(text).width + 28);
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.beginPath();
  ctx.roundRect(128 - width / 2, 6, width, 52, 14);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 33, 230);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set(4, 1, 1);
  sprite.renderOrder = 10;
  return sprite;
}

export interface CarModel {
  group: THREE.Group;
  flame: THREE.Mesh;
  wheels: THREE.Object3D[];
  /** Giroflex (só nas viaturas): luz vermelha e azul, que piscam alternadas. */
  lights?: [THREE.Mesh, THREE.Mesh];
}

export interface CarOptions {
  /** Carro da garagem (id em CARS). Sem ele, usa o padrão. */
  car?: string;
  /** Viatura da Vigilância Sanitária (com pintura e giroflex). */
  cop?: boolean;
  /** Carro do trânsito (modelo mais leve, rodas fundidas, sem nome). */
  traffic?: TrafficKind;
}

// --- Materiais dos carros ------------------------------------------------------
//
// Tudo é Lambert (o material "de autoria"); `surface` diz o que cada um é no
// visual realista (look.ts). A pintura é um material por cor, guardado; o resto
// é igual para todos os carros.

const PAINT: Surface = { clearcoat: 1, clearcoatRoughness: 0.06, roughness: 0.36, metalness: 0.2 };
const offset = <M extends THREE.Material>(m: M) => {
  // Peças coladas na lataria (vidros, faróis, frisos) ficam um tiquinho na frente.
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -2;
  return m;
};
const CAR_MATERIALS: Record<Exclude<MatName, "paint">, THREE.Material> = {
  accent: offset(surface(new THREE.MeshLambertMaterial({ color: "#ffffff", vertexColors: true }), PAINT)),
  glass: offset(surface(new THREE.MeshLambertMaterial({ color: "#121a22" }), { roughness: 0.05, metalness: 0, envMapIntensity: 1.5 })),
  chrome: offset(surface(new THREE.MeshLambertMaterial({ color: "#d9dee3" }), { metalness: 1, roughness: 0.15 })),
  trim: offset(surface(new THREE.MeshLambertMaterial({ color: "#ffffff", vertexColors: true }), { roughness: 0.6 })),
  lamp: offset(surface(new THREE.MeshBasicMaterial({ color: "#ffffff", vertexColors: true }), { glow: 2.5 })),
  food: surface(new THREE.MeshLambertMaterial({ color: "#ffffff", vertexColors: true }), { roughness: 0.7 }),
  rubber: surface(new THREE.MeshLambertMaterial({ color: "#1d1d1f" }), { roughness: 0.95 }),
  metal: surface(new THREE.MeshLambertMaterial({ color: "#ffffff", vertexColors: true }), { metalness: 0.9, roughness: 0.3 }),
};
for (const [name, m] of Object.entries(CAR_MATERIALS)) m.name = `carro-${name}`;

const paints = new Map<string, THREE.MeshLambertMaterial>();
/** Pintura de uma cor (uma por cor, reaproveitada). */
function paintMaterial(color: string) {
  let m = paints.get(color);
  if (!m) {
    m = surface(new THREE.MeshLambertMaterial({ color }), PAINT);
    m.name = `pintura-${color}`;
    paints.set(color, m);
  }
  return m;
}

const materialOf = (mat: MatName, color: string) => (mat === "paint" ? paintMaterial(color) : CAR_MATERIALS[mat]);

/** Malhas de uma carroceria pronta (uma por material). */
function bodyMeshes(parts: Map<MatName, THREE.BufferGeometry>, color: string) {
  const group = new THREE.Group();
  for (const [mat, geometry] of parts) {
    const m = new THREE.Mesh(geometry, materialOf(mat, color));
    m.name = mat;
    group.add(m);
  }
  return group;
}

/** Roda que gira: o grupo gira em x; dentro, a roda virada para o lado de fora. */
function makeWheel(spec: WheelSpec, side: number): THREE.Object3D {
  const wheel = new THREE.Group();
  const inner = new THREE.Group();
  for (const [mat, geometry] of wheelGeometry(spec)) inner.add(new THREE.Mesh(geometry, materialOf(mat, "#ffffff")));
  if (side < 0) inner.rotation.y = Math.PI;
  wheel.add(inner);
  return wheel;
}

// --- Pinturas das viaturas ------------------------------------------------------

/** Faixa lateral numa altura relativa (0 = embaixo, 1 = em cima da lataria) e com uma espessura. */
function sideStripe(k: Kit, at: number, height: number, color: string, mat: MatName = "accent") {
  const spec = k.body.spec;
  const z0 = -k.L / 2 + 0.22;
  const z1 = k.L / 2 - 0.22;
  k.both((side) => {
    const surf = k.s.side(side);
    const path: P2[] = [];
    for (let i = 0; i <= 24; i++) {
      const z = z0 + ((z1 - z0) * i) / 24;
      const y = spec.bottom(z) + (spec.top(z) - spec.bottom(z)) * at;
      path.push([z, y]);
    }
    k.strip(surf, path, height, mat, color, { off: 0.005 });
  });
}

/** Barra do giroflex (a base fica fundida na carroceria; as luzes são à parte, porque piscam). */
function lightbarBase(k: Kit, roofZ: number) {
  const y = k.topAt(roofZ);
  k.box("trim", "#1a1a1c", [1.12, 0.06, 0.3], [0, y + 0.02, roofZ], { r: 0.02 });
  k.both((side) => k.box("trim", "#2a2a2c", [0.05, 0.05, 0.26], [side * 0.5, y - 0.005, roofZ], { r: 0.01 }));
}

/** Cruz verde da "saúde" (emblema da Vigilância) na porta. */
function healthCross(k: Kit, z: number, y: number, size: number) {
  k.both((side) => {
    const surf = k.s.side(side);
    k.patch(surf, roundRect(z - size, y - size, z + size, y + size, size * 0.3), "accent", "#ffffff", { off: 0.006 });
    k.rect(surf, z - size * 0.75, z + size * 0.75, y - size * 0.22, y + size * 0.22, "accent", "#1f8f43", { off: 0.009, na: 3, nb: 1 });
    k.rect(surf, z - size * 0.22, z + size * 0.22, y - size * 0.75, y + size * 0.75, "accent", "#1f8f43", { off: 0.009, na: 1, nb: 3 });
  });
}

/** Pintura de viatura: branca, faixa verde (cor de "saúde"), a cruz nas portas e o giroflex. */
const copLivery = {
  key: "cop",
  draw: (k: Kit) => {
    sideStripe(k, 0.5, 0.16, "#22994a");
    sideStripe(k, 0.32, 0.035, "#0f5c2a");
    healthCross(k, 0.0, k.body.spec.bottom(0) + (k.body.spec.top(0) - k.body.spec.bottom(0)) * 0.5, 0.11);
    // Capô com a faixa e o para-choque preto de impulsão.
    k.rect(k.s.hood, -0.18, 0.18, k.L / 2 - 0.9, k.L / 2 - 0.15, "accent", "#22994a", { off: 0.005 });
    lightbarBase(k, roofPeak(k));
  },
};

/**
 * Couve-vette do Sargento Cross-fit: verde-couve escuro, faixa verde-limão
 * (suco detox), halter amarrado no teto e folhas de couve no para-choque.
 */
const crossfitLivery = {
  key: "crossfit",
  draw: (k: Kit) => {
    sideStripe(k, 0.42, 0.12, "#9be22d");
    k.rect(k.s.top, -0.16, 0.16, -k.L / 2 + 0.2, k.L / 2 - 0.12, "accent", "#9be22d", { off: 0.006, step: 0.05 });
    const roofZ = roofPeak(k);
    const y = k.topAt(roofZ) + 0.2;
    // Halter: a barra, as anilhas e as cintas que prendem no teto.
    k.cyl("chrome", null, 0.03, 1.5, [0, y, roofZ - 0.15], { rot: [0, 0, Math.PI / 2], seg: 12 });
    for (const x of [-0.55, -0.45, 0.45, 0.55]) k.cyl("trim", "#151515", Math.abs(x) > 0.5 ? 0.17 : 0.2, 0.08, [x, y, roofZ - 0.15], { rot: [0, 0, Math.PI / 2], seg: 24 });
    k.both((side) => k.box("trim", "#c9a227", [0.04, 0.2, 0.05], [side * 0.3, y - 0.1, roofZ - 0.15]));
    // Folhas de couve no para-choque (crespas: esferas achatadas em leque).
    for (let i = 0; i < 7; i++) {
      const x = -0.6 + i * 0.2;
      const z = k.frontAt(x, 0.45) + 0.03;
      k.sphere("food", i % 2 ? "#2f7d32" : "#3f9a3a", 0.13, [x, 0.42 + (i % 2) * 0.04, z], { scale: [1.2, 0.8, 0.3], rot: [0.3, 0, (i - 3) * 0.2], seg: 12 });
    }
    lightbarBase(k, roofZ);
  },
};

// --- Peças compartilhadas --------------------------------------------------------

const flameGeometry = new THREE.ConeGeometry(0.4, 1.6, 12).rotateX(-Math.PI / 2);
const shadowGeometry = new THREE.CircleGeometry(1.2, 24).rotateX(-Math.PI / 2);
const shadowMaterial = new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.28, depthWrite: false });
const lightGeometry = new RoundedBoxGeometry(0.5, 0.1, 0.24, 2, 0.03);
const LIGHT_RED = surface(new THREE.MeshBasicMaterial({ color: "#ff1a1a" }), { glow: 3 });
const LIGHT_BLUE = surface(new THREE.MeshBasicMaterial({ color: "#1f5bff" }), { glow: 3 });
for (const g of [flameGeometry, shadowGeometry, lightGeometry]) g.userData.shared = true;

/** Carro de um jogador, bot, viatura ou do trânsito. A frente aponta para +Z. */
export function makeCar(color: string, name: string, options: CarOptions = {}): CarModel {
  const { cop, traffic } = options;
  const group = new THREE.Group();
  let built: BuiltBody;
  let paint = color;
  if (traffic) {
    built = trafficGeometry(traffic);
  } else {
    const spec = carSpec(options.car ?? (cop ? "viatura" : undefined));
    const crossfit = cop && spec.id === CROSSFIT_CAR;
    paint = crossfit ? spec.color : cop ? "#f4f4f0" : color;
    built = bodyGeometry(spec.body, crossfit ? crossfitLivery : cop ? copLivery : undefined);
  }
  group.add(bodyMeshes(built.parts, paint));

  let lights: [THREE.Mesh, THREE.Mesh] | undefined;
  if (cop) {
    const y = built.roofY + 0.1;
    const red = new THREE.Mesh(lightGeometry, LIGHT_RED);
    red.position.set(-0.28, y, built.roofZ);
    const blue = new THREE.Mesh(lightGeometry, LIGHT_BLUE);
    blue.position.set(0.28, y, built.roofZ);
    lights = [red, blue];
    group.add(red, blue);
  }

  const wheels: THREE.Object3D[] = [];
  if (!traffic) {
    for (const spot of built.wheels) {
      const wheel = makeWheel(built.wheel, spot.x > 0 ? 1 : -1);
      wheel.position.set(spot.x, spot.radius, spot.z);
      wheel.userData.radius = spot.radius;
      wheels.push(wheel);
    }
    group.add(...wheels);
  }

  const flame = new THREE.Mesh(flameGeometry, MATERIALS.flame);
  flame.position.set(0, 0.5, -built.length / 2 - 0.8);
  flame.visible = false;
  group.add(flame);

  // Sombra falsa: um círculo escuro no chão, bem mais barato que sombra de verdade.
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadow.position.y = 0.04;
  shadow.scale.set(1.0, 1, built.length / 2.2);
  group.add(shadow);

  if (name) {
    const label = makeLabel(name, color);
    label.position.y = Math.max(built.roofY, 1.2) + 1.7;
    group.add(label);
  }

  return { group, flame, wheels, lights };
}
