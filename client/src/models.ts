// Modelos 3D feitos só com formas simples do Three.js (sem arquivos externos).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { carSpec, type FoodKind, type TrafficKind } from "@nfbmc/shared";

import { buildBody } from "./car-models.ts";

const lambert = (color: THREE.ColorRepresentation) => new THREE.MeshLambertMaterial({ color });

const MATERIALS = {
  bun: lambert("#d9973f"),
  bunTop: lambert("#e0a24a"),
  patty: lambert("#5a3418"),
  cheese: lambert("#f6c945"),
  lettuce: lambert("#5cb83a"),
  tomato: lambert("#e2412f"),
  tire: lambert("#222222"),
  rim: lambert("#c9cdd2"),
  rimDark: lambert("#2c2f33"),
  caliper: lambert("#c1121f"),
  window: lambert("#2a3540"),
  light: new THREE.MeshBasicMaterial({ color: "#fff3b0" }),
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
  /** Carro do trânsito (modelo simples, sem nome). */
  traffic?: TrafficKind;
}

/** Carroceria de cada tipo de carro do trânsito, montada no grupo `shell`. */
function trafficBody(shell: THREE.Group, kind: TrafficKind, body: THREE.Material) {
  if (kind === "kombi") {
    // Kombi: caixa alta e arredondada, com a faixa branca no meio.
    shell.add(mesh(new THREE.BoxGeometry(2.1, 1.7, 4.2), body, 0, 1.25));
    shell.add(mesh(new THREE.BoxGeometry(2.14, 0.5, 4.24), lambert("#f4f1e6"), 0, 1.75));
    shell.add(mesh(new THREE.BoxGeometry(1.9, 0.55, 0.1), MATERIALS.window, 0, 1.8, 2.11));
  } else if (kind === "picape") {
    // Picape: cabine na frente e caçamba aberta atrás.
    shell.add(mesh(new THREE.BoxGeometry(2.1, 0.7, 4.4), body, 0, 0.75));
    shell.add(mesh(new THREE.BoxGeometry(1.9, 0.7, 1.6), body, 0, 1.45, 0.8));
    shell.add(mesh(new THREE.BoxGeometry(1.7, 0.45, 0.1), MATERIALS.window, 0, 1.5, 1.61));
    shell.add(mesh(new THREE.BoxGeometry(1.9, 0.12, 1.9), lambert("#2a2a2a"), 0, 1.11, -1.1));
  } else {
    shell.add(mesh(new THREE.BoxGeometry(2.0, 0.65, 4.2), body, 0, 0.72));
    shell.add(mesh(new THREE.BoxGeometry(1.75, 0.55, 2.0), MATERIALS.window, 0, 1.3, -0.2));
    shell.add(mesh(new THREE.BoxGeometry(1.8, 0.1, 2.0), body, 0, 1.62, -0.2));
  }
}

/** Pintura de viatura: branca, faixa verde (cor de "saúde") e "VIGILÂNCIA" escrito. */
const copLivery: Parameters<typeof buildBody>[2] = (add, design) => {
  add.box(design.width + 0.14, 0.22, design.length - 0.3, "#2a9d4a", 0, 0.62, 0);
  add.box(1.4, 0.16, 0.5, "#222222", 0, 1.42, -0.2);
};

/**
 * Roda: pneu com banda e flanco, aro de cinco raios com cubo e a pinça de freio
 * vermelha atrás. `side` (+1/-1) diz para que lado fica a face de fora.
 * O conjunto gira em torno do eixo X (a pinça fica parada, presa ao carro, no
 * modelo do trânsito, que é fundido).
 */
function makeWheel(radius: number, side: number, simple: boolean): THREE.Object3D {
  const wheel = new THREE.Group();
  const tire = new THREE.CylinderGeometry(radius, radius, 0.3, 20);
  tire.rotateZ(Math.PI / 2);
  wheel.add(new THREE.Mesh(tire, MATERIALS.tire));
  const rim = new THREE.CylinderGeometry(radius * 0.66, radius * 0.66, 0.06, 20);
  rim.rotateZ(Math.PI / 2);
  const rimMesh = new THREE.Mesh(rim, MATERIALS.rimDark);
  rimMesh.position.x = side * 0.13;
  wheel.add(rimMesh);
  if (!simple) {
    for (let k = 0; k < 5; k++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, radius * 1.22, 0.07), MATERIALS.rim);
      spoke.position.x = side * 0.165;
      spoke.rotation.x = (k / 5) * Math.PI * 2;
      wheel.add(spoke);
    }
    const hub = new THREE.CylinderGeometry(radius * 0.18, radius * 0.18, 0.08, 10);
    hub.rotateZ(Math.PI / 2);
    const hubMesh = new THREE.Mesh(hub, MATERIALS.rim);
    hubMesh.position.x = side * 0.17;
    wheel.add(hubMesh);
  }
  return wheel;
}

/** Pinça de freio (fica parada enquanto a roda gira). */
function makeCaliper(radius: number, side: number) {
  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.06, radius * 0.5, radius * 0.4), MATERIALS.caliper);
  caliper.position.set(side * 0.1, radius * 0.25, -radius * 0.25);
  return caliper;
}

/** Carro de um jogador, bot, viatura ou do trânsito. A frente aponta para +Z. */
export function makeCar(color: string, name: string, options: CarOptions = {}): CarModel {
  const { cop, traffic } = options;
  const group = new THREE.Group();
  const shell = new THREE.Group();
  let wheelSpots: { x: number; z: number; radius: number }[];
  let length = 4.2;
  let roofY = 1.8;

  if (traffic) {
    trafficBody(shell, traffic, lambert(color));
    shell.add(mesh(new THREE.BoxGeometry(0.4, 0.2, 0.1), MATERIALS.light, -0.65, 0.85, 2.11));
    shell.add(mesh(new THREE.BoxGeometry(0.4, 0.2, 0.1), MATERIALS.light, 0.65, 0.85, 2.11));
    wheelSpots = [[-1.1, 1.3], [1.1, 1.3], [-1.1, -1.3], [1.1, -1.3]].map(([x, z]) => ({ x, z, radius: 0.45 }));
  } else {
    const spec = carSpec(options.car ?? (cop ? "viatura" : undefined));
    const built = buildBody(spec.body, cop ? "#f4f4f0" : color, cop ? copLivery : undefined);
    shell.add(built.shell);
    wheelSpots = built.wheels;
    length = built.length;
    roofY = 1.6;
  }

  let lights: [THREE.Mesh, THREE.Mesh] | undefined;
  if (cop) {
    const red = mesh(new THREE.BoxGeometry(0.6, 0.2, 0.42), new THREE.MeshBasicMaterial({ color: "#ff2a2a" }), -0.35, 1.58, -0.2);
    const blue = mesh(new THREE.BoxGeometry(0.6, 0.2, 0.42), new THREE.MeshBasicMaterial({ color: "#2a6bff" }), 0.35, 1.58, -0.2);
    lights = [red, blue];
  }

  const wheels: THREE.Object3D[] = [];
  for (const spot of wheelSpots) {
    const wheel = makeWheel(spot.radius, spot.x > 0 ? 1 : -1, !!traffic);
    wheel.position.set(spot.x, spot.radius, spot.z);
    // No trânsito as rodas vão fundidas na carroceria (não giram, mas são dezenas de
    // carros: assim cada um custa uma chamada de desenho em vez de cinco).
    if (traffic) shell.add(wheel);
    else wheels.push(wheel);
  }
  if (!traffic) {
    for (const spot of wheelSpots) {
      const caliper = makeCaliper(spot.radius, spot.x > 0 ? 1 : -1);
      caliper.position.x += spot.x;
      caliper.position.y += spot.radius * 0.6;
      caliper.position.z += spot.z;
      shell.add(caliper);
    }
  }
  group.add(bake(shell));
  if (lights) group.add(...lights);
  if (wheels.length) group.add(...wheels);

  const flame = mesh(new THREE.ConeGeometry(0.4, 1.6, 10), MATERIALS.flame, 0, 0.6, -length / 2 - 0.8);
  flame.rotation.x = -Math.PI / 2;
  flame.visible = false;
  group.add(flame);

  // Sombra falsa: um círculo escuro no chão, bem mais barato que sombra de verdade.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.2, 20),
    new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.28, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.06;
  shadow.scale.set(1.0, length / 2.2, 1);
  group.add(shadow);

  if (name) {
    const label = makeLabel(name, color);
    label.position.y = roofY + 1.6;
    group.add(label);
  }

  return { group, flame, wheels, lights };
}
