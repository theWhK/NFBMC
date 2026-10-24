// Cena 3D: pista, cenário, carros e comidas. Só desenha; o estado vem do servidor.
import * as THREE from "three";
import { TRACK, nearestSample, type FoodKind } from "@nfbmc/shared";

import { makeBurger, makeCar, makeFood, type CarModel } from "./models.ts";

/** O que a cena precisa saber de cada carro (vem do estado da sala). */
export interface CarView {
  name: string;
  color: string;
  x: number;
  z: number;
  heading: number;
  speed: number;
  boost: number;
  visible: boolean;
}

export interface FoodView {
  kind: string;
  x: number;
  z: number;
  active: boolean;
}

interface CarEntry {
  model: CarModel;
  x: number;
  z: number;
  heading: number;
  key: string;
}

const SKY = "#8fd3ff";

/** Aproxima `current` de `target` de forma suave e independente do FPS. */
const damp = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

function dampAngle(current: number, target: number, rate: number, dt: number) {
  const diff = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + diff * (1 - Math.exp(-rate * dt));
}

/** Gerador pseudoaleatório com semente, para o cenário ser igual para todo mundo. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** Faixa ao longo da pista, entre `inner` e `outer` metros do centro (negativo = lado direito). */
function ribbon(inner: number, outer: number, y: number, colorAt?: (i: number) => THREE.Color) {
  const samples = TRACK.samples;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= samples.length; i++) {
    const s = samples[i % samples.length];
    // Esquerda de quem corre: (tz, -tx).
    positions.push(s.x + s.tz * inner, y, s.z - s.tx * inner);
    positions.push(s.x + s.tz * outer, y, s.z - s.tx * outer);
    if (colorAt) {
      const c = colorAt(i);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    if (i < samples.length) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (colorAt) geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function checkerTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 16;
  const ctx = canvas.getContext("2d")!;
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? "#111111" : "#ffffff";
      ctx.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildTrack(scene: THREE.Scene) {
  const half = TRACK.width / 2;
  // Material dupla face: assim não importa para que lado a faixa foi montada.
  const asphalt = new THREE.MeshLambertMaterial({ color: "#4a4a4f", side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(ribbon(-half, half, 0.02), asphalt));

  const red = new THREE.Color("#d62828");
  const white = new THREE.Color("#f5f5f5");
  const curb = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const stripe = (i: number) => (Math.floor(i / 2) % 2 ? red : white);
  scene.add(new THREE.Mesh(ribbon(half, half + 1.2, 0.04, stripe), curb));
  scene.add(new THREE.Mesh(ribbon(-half - 1.2, -half, 0.04, stripe), curb));

  const start = TRACK.samples[0];
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(TRACK.width, 2),
    new THREE.MeshLambertMaterial({ map: checkerTexture() }),
  );
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = Math.atan2(start.tx, start.tz) + Math.PI / 2;
  line.position.set(start.x, 0.05, start.z);
  scene.add(line);

  // Pórtico de largada: duas colunas e uma faixa em cima.
  const post = new THREE.MeshLambertMaterial({ color: "#333333" });
  const banner = new THREE.MeshLambertMaterial({ color: "#e63946" });
  const gate = new THREE.Group();
  gate.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), post).translateX(half + 2).translateY(3.5));
  gate.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), post).translateX(-half - 2).translateY(3.5));
  gate.add(new THREE.Mesh(new THREE.BoxGeometry(TRACK.width + 4.6, 1.6, 0.4), banner).translateY(7));
  gate.rotation.y = Math.atan2(start.tx, start.tz);
  gate.position.set(start.x, 0, start.z);
  scene.add(gate);
}

function buildScenery(scene: THREE.Scene) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 800),
    new THREE.MeshLambertMaterial({ color: "#6ab04c" }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Árvores de brócolis, porque toda dieta precisa de um vegetal (de enfeite).
  const random = seeded(42);
  const spots: THREE.Vector3[] = [];
  while (spots.length < 160) {
    const x = (random() - 0.5) * 460;
    const z = (random() - 0.5) * 460;
    if (nearestSample(TRACK, x, z).distance < TRACK.width / 2 + 7) continue;
    spots.push(new THREE.Vector3(x, 0, z));
  }

  const stem = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.5, 0.8, 3, 8),
    new THREE.MeshLambertMaterial({ color: "#9bc25b" }),
    spots.length,
  );
  const crown = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(2.4, 1),
    new THREE.MeshLambertMaterial({ color: "#2f7d32", flatShading: true }),
    spots.length * 3,
  );
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  spots.forEach((spot, i) => {
    const s = 0.7 + random() * 0.8;
    scale.setScalar(s);
    matrix.compose(new THREE.Vector3(spot.x, 1.5 * s, spot.z), quat, scale);
    stem.setMatrixAt(i, matrix);
    for (let k = 0; k < 3; k++) {
      const angle = (k / 3) * Math.PI * 2 + i;
      const pos = new THREE.Vector3(
        spot.x + Math.cos(angle) * 1.1 * s,
        (3.4 + (k === 0 ? 0.6 : 0)) * s,
        spot.z + Math.sin(angle) * 1.1 * s,
      );
      matrix.compose(pos, quat, scale);
      crown.setMatrixAt(i * 3 + k, matrix);
    }
  });
  scene.add(stem, crown);

  // Hambúrgueres gigantes pelo infield, como estátuas.
  for (const [x, z, size] of [[30, -40, 14], [-50, 50, 18], [85, -30, 10], [-80, -50, 12]] as const) {
    const statue = makeBurger();
    statue.scale.setScalar(size);
    statue.position.set(x, 0, z);
    statue.rotation.y = x;
    scene.add(statue);
  }
}

export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(70, 1, 0.5, 900);
  private cars = new Map<string, CarEntry>();
  private foods: THREE.Group[] = [];
  private cameraTarget = new THREE.Vector3();
  private clock = new THREE.Clock();
  private time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 150, 420);
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#5a7d3a", 1.6));
    const sun = new THREE.DirectionalLight("#fff4dd", 1.8);
    sun.position.set(80, 150, 40);
    this.scene.add(sun);

    buildTrack(this.scene);
    buildScenery(this.scene);

    this.camera.position.set(0, 60, -160);
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private resize() {
    const { innerWidth: w, innerHeight: h } = window;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Sincroniza os carros com o estado: cria os novos e remove quem saiu. */
  syncCars(cars: Map<string, CarView>) {
    for (const [id, entry] of this.cars) {
      if (!cars.has(id)) {
        this.scene.remove(entry.model.group);
        this.cars.delete(id);
      }
    }
    for (const [id, car] of cars) {
      const key = `${car.name}|${car.color}`;
      let entry = this.cars.get(id);
      if (entry && entry.key !== key) {
        this.scene.remove(entry.model.group);
        entry = undefined;
      }
      if (!entry) {
        entry = { model: makeCar(car.color, car.name), x: car.x, z: car.z, heading: car.heading, key };
        this.scene.add(entry.model.group);
        this.cars.set(id, entry);
      }
    }
  }

  syncFoods(foods: FoodView[]) {
    while (this.foods.length < foods.length) {
      const food = makeFood(foods[this.foods.length].kind as FoodKind);
      this.scene.add(food);
      this.foods.push(food);
    }
    foods.forEach((f, i) => {
      this.foods[i].visible = f.active;
      this.foods[i].position.x = f.x;
      this.foods[i].position.z = f.z;
    });
  }

  /** Desenha um quadro. `followId` é o carro que a câmera persegue. */
  render(cars: Map<string, CarView>, followId: string | undefined) {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.time += dt;

    for (const [id, entry] of this.cars) {
      const car = cars.get(id);
      if (!car) continue;
      // Teleporte (voltou para o grid): pula direto, sem atravessar o mapa.
      if (Math.hypot(car.x - entry.x, car.z - entry.z) > 25) {
        entry.x = car.x;
        entry.z = car.z;
        entry.heading = car.heading;
      }
      entry.x = damp(entry.x, car.x, 18, dt);
      entry.z = damp(entry.z, car.z, 18, dt);
      entry.heading = dampAngle(entry.heading, car.heading, 18, dt);

      const { group, flame, wheels } = entry.model;
      group.visible = car.visible;
      group.position.set(entry.x, 0, entry.z);
      group.rotation.y = entry.heading;
      for (const wheel of wheels) wheel.rotation.x += (car.speed * dt) / 0.45;
      flame.visible = car.boost > 0;
      if (flame.visible) flame.scale.setScalar(0.8 + Math.random() * 0.5);
    }

    this.foods.forEach((food, i) => {
      food.rotation.y = this.time * 2 + i;
      food.position.y = 0.6 + Math.sin(this.time * 3 + i) * 0.3;
    });

    const followed = followId ? this.cars.get(followId) : undefined;
    const followedCar = followId ? cars.get(followId) : undefined;
    if (followed && followedCar) {
      const forwardX = Math.sin(followed.heading);
      const forwardZ = Math.cos(followed.heading);
      const desired = new THREE.Vector3(followed.x - forwardX * 11, 5.5, followed.z - forwardZ * 11);
      this.camera.position.lerp(desired, 1 - Math.exp(-6 * dt));
      this.cameraTarget.set(followed.x + forwardX * 6, 1.5, followed.z + forwardZ * 6);
      // Com turbo a lente abre, para dar sensação de velocidade.
      const fov = followedCar.boost > 0 ? 82 : 70 + Math.min(8, Math.abs(followedCar.speed) / 6);
      this.camera.fov = damp(this.camera.fov, fov, 4, dt);
      this.camera.updateProjectionMatrix();
    } else {
      // Sem carro para seguir: sobrevoa a pista devagar.
      const angle = this.time * 0.1;
      this.camera.position.set(Math.sin(angle) * 200, 110, Math.cos(angle) * 200);
      this.cameraTarget.set(0, 0, 20);
    }
    this.camera.lookAt(this.cameraTarget);

    this.renderer.render(this.scene, this.camera);
  }
}
