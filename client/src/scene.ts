// Cena 3D: pista, cenário, carros e comidas. Só desenha; o estado vem do servidor.
import * as THREE from "three";
import { TRACK, nearestSample, type FoodKind } from "@nfbmc/shared";

import { Effects } from "./effects.ts";
import { makeCar, makeFood, type CarModel } from "./models.ts";
import { buildScenery } from "./scenery.ts";

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
  /** Inclinação da carroceria nas curvas. */
  lean: number;
  /** 0 a 1: quanto o pneu está cantando agora. */
  skid: number;
  offroad: boolean;
}

/** O que a cena sabe do carro seguido pela câmera, para os sons. */
export interface FollowedInfo {
  skid: number;
  offroad: boolean;
}

/** Aproxima `current` de `target` de forma suave e independente do FPS. */
const damp = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

function dampAngle(current: number, target: number, rate: number, dt: number) {
  const diff = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + diff * (1 - Math.exp(-rate * dt));
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

/** Navegador desenhando o 3D na CPU (sem placa de vídeo): começa em resolução baixa. */
function isSoftwareRenderer(renderer: THREE.WebGLRenderer) {
  const gl = renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  return /swiftshader|llvmpipe|software/i.test(name);
}

export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(70, 1, 0.5, 1500);
  private cars = new Map<string, CarEntry>();
  private foods: THREE.Group[] = [];
  private foodActive: boolean[] = [];
  private effects: Effects;
  private cameraTarget = new THREE.Vector3();
  private clock = new THREE.Clock();
  private time = 0;
  /** Resolução adaptativa: cai quando o FPS fica baixo (PC fraco ou sem placa de vídeo). */
  private pixelRatio = Math.min(window.devicePixelRatio, 2);
  private fpsFrames = 0;
  private fpsTime = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    if (isSoftwareRenderer(this.renderer)) this.pixelRatio = 0.5;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    buildScenery(this.scene);
    buildTrack(this.scene);
    this.effects = new Effects(this.scene);

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

  private adaptResolution(rawDt: number) {
    this.fpsFrames++;
    this.fpsTime += rawDt;
    if (this.fpsTime < 2) return;
    const fps = this.fpsFrames / this.fpsTime;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    // Aba em segundo plano não conta (o navegador pausa os quadros).
    if (fps < 38 && fps > 3 && this.pixelRatio > 0.5) {
      this.pixelRatio = Math.max(0.5, this.pixelRatio * 0.75);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
    }
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
        const model = makeCar(car.color, car.name);
        model.group.rotation.order = "YXZ";
        entry = { model, x: car.x, z: car.z, heading: car.heading, key, lean: 0, skid: 0, offroad: false };
        this.scene.add(model.group);
        this.cars.set(id, entry);
      }
    }
  }

  syncFoods(foods: FoodView[]) {
    while (this.foods.length < foods.length) {
      const food = makeFood(foods[this.foods.length].kind as FoodKind);
      this.scene.add(food);
      this.foods.push(food);
      this.foodActive.push(true);
    }
    foods.forEach((f, i) => {
      if (this.foodActive[i] && !f.active) this.effects.burst(f.x, f.z);
      this.foodActive[i] = f.active;
      this.foods[i].visible = f.active;
      this.foods[i].position.x = f.x;
      this.foods[i].position.z = f.z;
    });
  }

  /** Desenha um quadro. `followId` é o carro que a câmera persegue. */
  render(cars: Map<string, CarView>, followId: string | undefined): FollowedInfo | null {
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.1);
    this.time += dt;
    this.adaptResolution(rawDt);

    for (const [id, entry] of this.cars) {
      const car = cars.get(id);
      if (!car) continue;
      // Teleporte (voltou para o grid): pula direto, sem atravessar o mapa.
      if (Math.hypot(car.x - entry.x, car.z - entry.z) > 25) {
        entry.x = car.x;
        entry.z = car.z;
        entry.heading = car.heading;
      }
      const previousHeading = entry.heading;
      entry.x = damp(entry.x, car.x, 18, dt);
      entry.z = damp(entry.z, car.z, 18, dt);
      entry.heading = dampAngle(entry.heading, car.heading, 18, dt);

      // Força lateral = velocidade de giro × velocidade. Acima de um limite o pneu canta.
      const turnRate = dt > 0 ? Math.atan2(Math.sin(entry.heading - previousHeading), Math.cos(entry.heading - previousHeading)) / dt : 0;
      const lateral = turnRate * car.speed;
      entry.skid = damp(entry.skid, Math.min(1, Math.max(0, (Math.abs(lateral) - 30) / 25)), 12, dt);
      entry.offroad = nearestSample(TRACK, entry.x, entry.z).distance > TRACK.width / 2 + 1;
      entry.lean = damp(entry.lean, Math.max(-0.12, Math.min(0.12, lateral * 0.0025)), 8, dt);

      const { group, flame, wheels } = entry.model;
      group.visible = car.visible;
      group.position.set(entry.x, 0, entry.z);
      group.rotation.y = entry.heading;
      group.rotation.z = entry.lean;
      for (const wheel of wheels) wheel.rotation.x += (car.speed * dt) / 0.45;
      flame.visible = car.boost > 0;
      if (flame.visible) flame.scale.setScalar(0.8 + Math.random() * 0.5);

      if (car.visible) {
        const dusty = entry.offroad && Math.abs(car.speed) > 6;
        const amount = dusty ? Math.min(1, Math.abs(car.speed) / 25) * 0.6 : entry.skid;
        if (amount > 0.15) this.effects.wheelTrail(entry.x, entry.z, entry.heading, amount, entry.offroad);
      }
    }
    this.effects.update(dt);

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
      // Com turbo a lente abre e a câmera treme, para dar sensação de velocidade.
      const boosting = followedCar.boost > 0;
      const fov = boosting ? 84 : 70 + Math.min(8, Math.abs(followedCar.speed) / 6);
      this.camera.fov = damp(this.camera.fov, fov, 4, dt);
      this.camera.updateProjectionMatrix();
      if (boosting) {
        this.cameraTarget.x += (Math.random() - 0.5) * 0.25;
        this.cameraTarget.y += (Math.random() - 0.5) * 0.25;
      }
    } else {
      // Sem carro para seguir (menu): sobrevoa a pista devagar, como numa vinheta.
      const angle = this.time * 0.08;
      this.camera.position.set(Math.sin(angle) * 150, 45, Math.cos(angle) * 150);
      this.cameraTarget.set(0, 10, 20);
      this.camera.fov = 60;
      this.camera.updateProjectionMatrix();
    }
    this.camera.lookAt(this.cameraTarget);

    this.renderer.render(this.scene, this.camera);
    return followed ? { skid: followed.skid, offroad: followed.offroad } : null;
  }
}
