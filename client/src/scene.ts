// Cena 3D: cidade, traçado da corrida, carros, comidas e pontos de encontro.
// Só desenha; o estado vem do servidor.
import * as THREE from "three";
import {
  MARKER_RADIUS,
  RACES,
  pointOnTrack,
  RACE_IDS,
  isOnRoad,
  raceMarker,
  type FoodKind,
  type RaceId,
  type TrafficKind,
} from "@nfbmc/shared";

import { Effects } from "./effects.ts";
import { makeCar, makeFood, type CarModel } from "./models.ts";
import { SUN_DIRECTION, buildScenery, glowTexture } from "./scenery.ts";
import { InkPass, toonify, type Quality } from "./toon.ts";
import { buildTrackMesh } from "./track-mesh.ts";

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
  /** Carro da garagem (id em CARS). */
  car?: string;
  /** Viatura da Vigilância Sanitária. */
  cop?: boolean;
  /** Carro do trânsito, e de que tipo. */
  traffic?: TrafficKind;
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
  /** Última posição recebida do servidor e quando ela chegou (para extrapolar). */
  serverX: number;
  serverZ: number;
  serverHeading: number;
  receivedAt: number;
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

/** Placa flutuante com o nome da corrida, sobre o ponto de encontro. */
function markerLabel(title: string, subtitle: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const draw = () => {
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 512, 160);
    ctx.fillStyle = "rgba(22, 17, 13, 0.8)";
    ctx.beginPath();
    ctx.roundRect(8, 8, 496, 144, 18);
    ctx.fill();
    ctx.strokeStyle = "#ff7a00";
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffc42e";
    ctx.font = "50px 'Russo One', sans-serif";
    ctx.fillText(title, 256, 78, 470);
    ctx.fillStyle = "#ffffff";
    ctx.font = "30px 'Russo One', sans-serif";
    ctx.fillText(subtitle, 256, 124, 470);
    texture.needsUpdate = true;
  };
  draw();
  document.fonts?.load("50px 'Russo One'").then(draw).catch(() => {});
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, fog: false }));
  sprite.scale.set(24, 7.5, 1);
  sprite.renderOrder = 20;
  return sprite;
}

/** Ponto de encontro: anel no chão, coluna de luz e placa com o nome. */
function makeMarker(id: RaceId) {
  const race = RACES[id];
  const spot = raceMarker(id);
  const group = new THREE.Group();
  const light = new THREE.MeshBasicMaterial({
    color: "#ff9a1f",
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(MARKER_RADIUS - 1.2, MARKER_RADIUS, 48), light);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.15;
  group.add(ring);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 90, 24, 1, true), light.clone());
  pillar.position.y = 45;
  group.add(pillar);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture("rgba(255,170,60,1)"),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  glow.scale.setScalar(26);
  glow.position.y = 3;
  group.add(glow);
  const km = (race.track.length / 1000).toFixed(1).replace(".", ",");
  const label = markerLabel(race.name, `${race.laps} voltas · ${km} km`);
  label.position.y = 22;
  group.add(label);
  group.position.set(spot.x, 0, spot.z);
  return group;
}

/**
 * Qualidade gráfica: a escolhida nas Opções ou, sem escolha, automática
 * (sem placa de vídeo → baixa; celular → média; computador → alta).
 */
function chooseQuality(renderer: THREE.WebGLRenderer): Quality {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem("nfbmc:quality");
  } catch {
    // Sem localStorage: automática.
  }
  if (saved === "alto" || saved === "medio" || saved === "baixo") return saved;
  if (isSoftwareRenderer(renderer)) return "baixo";
  return window.matchMedia?.("(pointer: coarse)").matches ? "medio" : "alto";
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
  private camera = new THREE.PerspectiveCamera(70, 1, 0.8, 2600);
  private sky: THREE.Object3D;
  private sun: THREE.Object3D;
  private raceOverlay: THREE.Object3D | null = null;
  private markers: THREE.Group;
  private light: THREE.DirectionalLight;
  private clouds: THREE.Object3D;
  readonly quality: Quality;
  private ink: InkPass | null = null;
  private sunDirection = SUN_DIRECTION;
  /** Carro de vitrine do menu (girando na reta do autódromo). */
  private showcase: { model: CarModel; key: string } | null = null;
  private cars = new Map<string, CarEntry>();
  private foods: THREE.Group[] = [];
  private foodActive: boolean[] = [];
  private effects: Effects;
  private cameraTarget = new THREE.Vector3();
  private clock = new THREE.Clock();
  private time = 0;
  /** Resolução adaptativa: cai quando o FPS fica baixo (PC fraco ou sem placa de vídeo). */
  // No celular começa um pouco mais baixa: a tela é pequena e a bateria agradece.
  private pixelRatio = Math.min(window.devicePixelRatio, window.matchMedia?.("(pointer: coarse)").matches ? 1.5 : 2);
  private fpsFrames = 0;
  private fpsTime = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    if (isSoftwareRenderer(this.renderer)) this.pixelRatio = 0.5;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    const { sky, sun, light, clouds } = buildScenery(this.scene);
    this.clouds = clouds;
    this.sky = sky;
    this.sun = sun;
    this.light = light;
    this.effects = new Effects(this.scene);
    this.markers = new THREE.Group();
    for (const id of RACE_IDS) this.markers.add(makeMarker(id));
    this.markers.visible = false;
    this.scene.add(this.markers);

    // Visual de quadrinho: cel-shading sempre; contorno de tinta e sombras conforme a qualidade.
    this.quality = chooseQuality(this.renderer);
    toonify(this.scene);
    if (this.quality !== "baixo") this.ink = new InkPass(this.renderer);
    if (this.quality === "alto") this.enableShadows();

    this.camera.position.set(0, 60, -160);
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private enableShadows() {
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    const area = this.light.shadow.camera;
    area.left = area.bottom = -90;
    area.right = area.top = 90;
    area.near = 10;
    area.far = 500;
    this.light.shadow.bias = -0.0008;
    this.light.shadow.normalBias = 0.04;
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !(mesh.material instanceof THREE.MeshToonMaterial)) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
  }

  /** Objeto novo na cena (carro, comida): mesmo visual do resto. */
  private dress(object: THREE.Object3D) {
    toonify(object);
    if (this.quality === "alto") {
      object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && mesh.material instanceof THREE.MeshToonMaterial) mesh.castShadow = mesh.receiveShadow = true;
      });
    }
  }

  private resize() {
    const { innerWidth: w, innerHeight: h } = window;
    this.renderer.setSize(w, h);
    this.ink?.setSize(w, h, this.pixelRatio);
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

  /**
   * Corrida em andamento (null = mundo aberto). Nas corridas de rua, as zebras
   * marcam o traçado por cima das ruas; o autódromo já está sempre desenhado.
   */
  setRace(raceId: RaceId | null) {
    if (this.raceOverlay) this.scene.remove(this.raceOverlay);
    this.raceOverlay = null;
    if (raceId && raceId !== "autodromo") {
      this.raceOverlay = buildTrackMesh(RACES[raceId].track, { asphalt: false, bannerColor: "#ff7a00" });
      this.dress(this.raceOverlay);
      this.scene.add(this.raceOverlay);
    }
    this.markers.visible = raceId === null;
    this.clearFoods();
    // Troca de sala: os carros da sala anterior somem.
    for (const entry of this.cars.values()) this.scene.remove(entry.model.group);
    this.cars.clear();
  }

  /** Mostra (ou tira, com null) o carro na vitrine do menu, na cor escolhida. */
  setShowcase(color: string | null, car?: string) {
    const key = `${color}|${car ?? ""}`;
    if (this.showcase && this.showcase.key === key) return;
    if (this.showcase) this.scene.remove(this.showcase.model.group);
    this.showcase = null;
    if (!color) return;
    const model = makeCar(color, "", { car });
    this.dress(model.group);
    const spot = pointOnTrack(RACES.autodromo.track, -14, 0);
    model.group.position.set(spot.x, 0, spot.z);
    model.group.rotation.y = spot.heading;
    this.scene.add(model.group);
    this.showcase = { model, key };
  }

  private clearFoods() {
    for (const food of this.foods) this.scene.remove(food);
    this.foods = [];
    this.foodActive = [];
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
      const key = `${car.name}|${car.color}|${car.car ?? ""}|${car.cop ? "cop" : ""}|${car.traffic ?? ""}`;
      let entry = this.cars.get(id);
      if (entry && entry.key !== key) {
        this.scene.remove(entry.model.group);
        entry = undefined;
      }
      if (!entry) {
        const model = makeCar(car.color, car.name, { car: car.car, cop: car.cop, traffic: car.traffic });
        this.dress(model.group);
        model.group.rotation.order = "YXZ";
        entry = {
          model, x: car.x, z: car.z, heading: car.heading, key, lean: 0, skid: 0, offroad: false,
          serverX: car.x, serverZ: car.z, serverHeading: car.heading, receivedAt: this.time,
        };
        this.scene.add(model.group);
        this.cars.set(id, entry);
      }
    }
  }

  syncFoods(foods: FoodView[]) {
    while (this.foods.length < foods.length) {
      const food = makeFood(foods[this.foods.length].kind as FoodKind);
      this.dress(food);
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
      // Chegou posição nova do servidor (30 vezes por segundo).
      if (car.x !== entry.serverX || car.z !== entry.serverZ || car.heading !== entry.serverHeading) {
        entry.serverX = car.x;
        entry.serverZ = car.z;
        entry.serverHeading = car.heading;
        entry.receivedAt = this.time;
      }
      // Teleporte (voltou para o grid): pula direto, sem atravessar o mapa.
      if (Math.hypot(car.x - entry.x, car.z - entry.z) > 25) {
        entry.x = car.x;
        entry.z = car.z;
        entry.heading = car.heading;
      }
      const previousHeading = entry.heading;
      // Extrapolação: entre uma atualização e outra o carro segue andando com a
      // velocidade e a direção que o servidor mandou, e só o erro pequeno é
      // corrigido aos poucos. Antes, o carro "corria atrás" de cada atualização
      // nova e a câmera tremia 30 vezes por segundo.
      const age = Math.min(this.time - entry.receivedAt, 0.15);
      const predictedX = entry.serverX + Math.sin(entry.serverHeading) * car.speed * age;
      const predictedZ = entry.serverZ + Math.cos(entry.serverHeading) * car.speed * age;
      entry.x += Math.sin(entry.heading) * car.speed * dt;
      entry.z += Math.cos(entry.heading) * car.speed * dt;
      entry.x = damp(entry.x, predictedX, 8, dt);
      entry.z = damp(entry.z, predictedZ, 8, dt);
      entry.heading = dampAngle(entry.heading, entry.serverHeading, 14, dt);

      // Força lateral = velocidade de giro × velocidade. Acima de um limite o pneu canta.
      const turnRate = dt > 0 ? Math.atan2(Math.sin(entry.heading - previousHeading), Math.cos(entry.heading - previousHeading)) / dt : 0;
      const lateral = turnRate * car.speed;
      entry.skid = damp(entry.skid, Math.min(1, Math.max(0, (Math.abs(lateral) - 30) / 25)), 12, dt);
      entry.offroad = !isOnRoad(entry.x, entry.z);
      entry.lean = damp(entry.lean, Math.max(-0.12, Math.min(0.12, lateral * 0.0025)), 8, dt);

      const { group, flame, wheels } = entry.model;
      group.visible = car.visible;
      group.position.set(entry.x, 0, entry.z);
      group.rotation.y = entry.heading;
      group.rotation.z = entry.lean;
      for (const wheel of wheels) wheel.rotation.x += (car.speed * dt) / 0.45;
      if (entry.model.lights) {
        // Giroflex: vermelho e azul alternando rápido.
        const on = Math.floor(this.time * 6) % 2 === 0;
        entry.model.lights[0].visible = on;
        entry.model.lights[1].visible = !on;
      }
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
    if (this.markers.visible) {
      // A coluna pulsa de longe e some quando a câmera chega perto (de dentro dela, a
      // luz lavava a tela inteira de amarelo). O anel no chão continua visível.
      const pulse = 0.25 + Math.sin(this.time * 3) * 0.08;
      for (const marker of this.markers.children) {
        const [ring, pillar, glow] = marker.children as [THREE.Mesh, THREE.Mesh, THREE.Sprite];
        const near = Math.min(1, Math.max(0, (this.camera.position.distanceTo(marker.position) - 25) / 50));
        (ring.material as THREE.MeshBasicMaterial).opacity = pulse;
        pillar.visible = glow.visible = near > 0.02;
        (pillar.material as THREE.MeshBasicMaterial).opacity = pulse * near;
        (glow.material as THREE.SpriteMaterial).opacity = near;
      }
    }

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
    } else if (this.showcase) {
      // Menu: a câmera gira devagar em volta do carro da vitrine.
      const center = this.showcase.model.group.position;
      const angle = this.time * 0.25;
      this.camera.position.set(center.x + Math.sin(angle) * 8.5, 2.6, center.z + Math.cos(angle) * 8.5);
      // Mira um pouco à esquerda do carro, para ele aparecer à direita da tela
      // (a lista do menu fica à esquerda, como no jogo original).
      const fx = center.x - this.camera.position.x;
      const fz = center.z - this.camera.position.z;
      const len = Math.hypot(fx, fz) || 1;
      this.cameraTarget.set(center.x + (fz / len) * 4.6, 1.1, center.z - (fx / len) * 4.6);
      this.camera.fov = 50;
      this.camera.updateProjectionMatrix();
      for (const wheel of this.showcase.model.wheels) wheel.rotation.x = 0;
    } else {
      // Sem carro para seguir: sobrevoa o centro da cidade devagar, como numa vinheta.
      const angle = this.time * 0.05;
      this.camera.position.set(Math.sin(angle) * 260, 70, Math.cos(angle) * 260);
      this.cameraTarget.set(0, 25, 0);
      this.camera.fov = 60;
      this.camera.updateProjectionMatrix();
    }
    this.camera.lookAt(this.cameraTarget);
    // Céu e sol acompanham a câmera, para nunca chegar perto da borda do céu.
    this.sky.position.copy(this.camera.position);
    // As nuvens acompanham a câmera no chão (ficam sempre no horizonte) e andam devagar.
    this.clouds.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.clouds.rotation.y = this.time * 0.004;
    this.sun.position.copy(this.camera.position).addScaledVector(this.sunDirection, 1200);

    // A luz do sol (e a área de sombra) acompanha o que a câmera está olhando.
    if (this.quality === "alto") {
      this.light.target.position.copy(this.cameraTarget).setY(0);
      this.light.position.copy(this.light.target.position).addScaledVector(this.sunDirection, 250);
    }
    if (this.ink) this.ink.render(this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
    return followed ? { skid: followed.skid, offroad: followed.offroad } : null;
  }
}
