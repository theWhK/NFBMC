// Cena 3D: cidade, traçado da corrida, carros, comidas e pontos de encontro.
// Só desenha; o estado vem do servidor.
import * as THREE from "three";
import {
  MARKER_RADIUS,
  RACES,
  pointOnTrack,
  RACE_IDS,
  carSpec,
  GROUND,
  STRUCTURES,
  TUNNEL_HEIGHT,
  heightAt,
  locate,
  slopeAt,
  surfaceSlope,
  surfaceY,
  isOnRoad,
  rampSteer,
  yawRate,
  raceMarker,
  type CarSpec,
  type FoodKind,
  type RaceId,
  type TrafficKind,
} from "@nfbmc/shared";

import { Effects } from "./effects.ts";
import { forgetFlags, waveFlags } from "./flag.ts";
import { makeCar, makeFood, type CarModel } from "./models.ts";
import { LOD_CHUNKS } from "./chunks.ts";
import { applyLook, surface, type Look } from "./look.ts";
import { RealPass, skyEnvironment } from "./realism.ts";
import { CHUNKS, SUN_DIRECTION, buildScenery, glowTexture, waterNormal } from "./scenery.ts";
import { InkPass, type Quality } from "./toon.ts";
import { animateBarriers, buildBarriers, buildGpsRibbon, buildTrackMesh, gpsDrawFrom } from "./track-mesh.ts";

/** O que a cena precisa saber de cada carro (vem do estado da sala). */
export interface CarView {
  name: string;
  color: string;
  x: number;
  z: number;
  heading: number;
  speed: number;
  boost: number;
  /** Giro do motor (só os jogadores e bots mandam; o som estima o resto). */
  rpm?: number;
  visible: boolean;
  /** Carro da garagem (id em CARS). */
  car?: string;
  /** Viatura da Vigilância Sanitária. */
  cop?: boolean;
  /** Carro do trânsito, e de que tipo. */
  traffic?: TrafficKind;
  /** Nível (-1 = chão; senão a ponte, viaduto ou túnel em STRUCTURES). */
  level?: number;
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
  /** Volante previsto do próprio carro (o mesmo `rampSteer` do servidor). */
  steer: number;
  /** Altura do chão embaixo do carro (relevo, ou o tabuleiro da ponte/túnel em que ele está). */
  y: number;
  /** Nível do carro (GROUND ou a obra de arte), como o servidor mandou. */
  level: number;
}

/**
 * Diretor de cinemática (modo história, client/src/cinematic.ts): enquanto
 * estiver ligado, é ele quem posiciona a câmera (posição, alvo e lente) a cada
 * quadro. Recebe o tempo do quadro em segundos.
 */
export type CineDirector = (dt: number, camera: THREE.PerspectiveCamera, target: THREE.Vector3) => void;

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
  group.position.set(spot.x, heightAt(spot.x, spot.z), spot.z);
  return group;
}

/**
 * Qualidade gráfica: a escolhida nas Opções ou, sem escolha, automática
 * (sem placa de vídeo → baixa; celular → média; computador → alta).
 */
function chooseQuality(renderer: THREE.WebGLRenderer, choice?: string): Quality {
  let saved: string | null = choice ?? null;
  if (choice === undefined) {
    try {
      saved = localStorage.getItem("nfbmc:quality");
    } catch {
      // Sem localStorage: automática.
    }
  }
  if (saved === "alto" || saved === "medio" || saved === "baixo") return saved;
  if (isSoftwareRenderer(renderer)) return "baixo";
  return window.matchMedia?.("(pointer: coarse)").matches ? "medio" : "alto";
}

/** Visual escolhido nas Opções (padrão: realista). */
function chooseLook(choice?: string): Look {
  let saved: string | null = choice ?? null;
  if (choice === undefined) {
    try {
      saved = localStorage.getItem("nfbmc:look");
    } catch {
      // Sem localStorage: o padrão.
    }
  }
  return saved === "quadrinho" ? "quadrinho" : "realista";
}

/**
 * Até onde (m) os blocos da cidade aparecem com todos os detalhes (casas com
 * janelas, telhas, sinalização miúda); além disso, a versão simples.
 */
const DETAIL_RANGE: Record<Quality, number> = { alto: 340, medio: 190, baixo: 0 };

/**
 * Câmeras (tecla C), nesta ordem: capô, primeira pessoa, terceira pessoa perto
 * e longe. `back` (metros atrás do centro do carro) negativo = presa ao carro,
 * no capô; `seat` = deslocada para o lado do motorista (esquerda), dentro do
 * carro, com o painel e o volante.
 */
const CAMERAS: { name: string; back: number; height: number; ahead: number; lookHeight: number; showCar: boolean; seat?: number }[] = [
  { name: "Capô", back: -0.7, height: 1.2, ahead: 25, lookHeight: 1.0, showCar: false },
  { name: "Primeira pessoa", back: 0.1, height: 1.2, ahead: 20, lookHeight: 0.9, showCar: false, seat: 0.36 },
  { name: "Terceira pessoa perto", back: 5.2, height: 2.25, ahead: 6, lookHeight: 1.15, showCar: true },
  { name: "Terceira pessoa longe", back: 7, height: 3.2, ahead: 6, lookHeight: 1.3, showCar: true },
];
/** Câmera de quem nunca trocou (a de trás, longe). */
const DEFAULT_CAMERA = 3;
/** A ordem das câmeras mudou: a escolha antiga (outro índice) não vale mais. */
const CAMERA_KEY = "nfbmc:camera-v2";

/** Vitrine da garagem: quanto tempo o carro leva para entrar (freando) e para sair (arrancando). */
const SHOWROOM_IN = 1.1;
const SHOWROOM_OUT = 1.4;

/** Mostrador de painel (conta-giros ou velocímetro), desenhado em canvas. */
function dialTexture(marks: number, redFrom: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0b0b0d";
  ctx.beginPath();
  ctx.arc(64, 64, 64, 0, Math.PI * 2);
  ctx.fill();
  for (let k = 0; k <= marks; k++) {
    const angle = Math.PI * 0.75 + (k / marks) * Math.PI * 1.5;
    ctx.strokeStyle = k >= redFrom ? "#ff3a2a" : "#f2efe8";
    ctx.lineWidth = k % 2 ? 2 : 4;
    ctx.beginPath();
    ctx.moveTo(64 + Math.cos(angle) * 46, 64 + Math.sin(angle) * 46);
    ctx.lineTo(64 + Math.cos(angle) * 58, 64 + Math.sin(angle) * 58);
    ctx.stroke();
  }
  ctx.strokeStyle = "#ff7a1a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(64, 64);
  ctx.lineTo(64 + Math.cos(Math.PI * 1.1) * 44, 64 + Math.sin(Math.PI * 1.1) * 44);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Painel, volante, console e colunas do para-brisa, para a câmera em primeira
 * pessoa. No grupo do carro, +Z é a frente e +X é a esquerda (lado do motorista).
 */
function makeCockpit() {
  const group = new THREE.Group();
  const soft = surface(new THREE.MeshLambertMaterial({ color: "#2b2724" }), { roughness: 0.78 });
  const black = surface(new THREE.MeshLambertMaterial({ color: "#121110" }), { roughness: 0.55 });
  const metal = surface(new THREE.MeshLambertMaterial({ color: "#9a9ca0" }), { roughness: 0.3, metalness: 1 });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };

  // Painel: perfil lateral arredondado, extrudado na largura da cabine.
  const profile = new THREE.Shape();
  profile.moveTo(0.52, 0.5);
  profile.lineTo(0.56, 0.74);
  profile.quadraticCurveTo(0.6, 0.86, 0.74, 0.88);
  profile.lineTo(1.08, 0.91);
  profile.quadraticCurveTo(1.3, 0.9, 1.38, 0.84);
  profile.lineTo(1.38, 0.5);
  profile.closePath();
  const dash = new THREE.ExtrudeGeometry(profile, { depth: 1.56, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3, curveSegments: 10 });
  dash.rotateY(-Math.PI / 2);
  dash.translate(0.78, 0, 0);
  add(dash, soft, 0, 0, 0);
  // Capelinha dos mostradores, na frente do motorista, e os dois mostradores.
  const hood = new THREE.CylinderGeometry(0.17, 0.17, 0.2, 24, 1, true, -Math.PI / 2, Math.PI);
  hood.rotateX(Math.PI / 2);
  add(hood, black, 0.36, 0.86, 0.7).scale.set(1.25, 0.55, 1);
  for (const [dx, marks, red] of [[0.075, 8, 7], [-0.075, 12, 13]] as const) {
    const dial = add(new THREE.CircleGeometry(0.068, 32), surface(new THREE.MeshBasicMaterial({ map: dialTexture(marks, red) }), { glow: 1.3 }), 0.36 + dx, 0.87, 0.71);
    dial.rotation.set(-0.35, Math.PI, 0);
  }
  // Saídas de ar e o rádio no meio.
  for (const x of [0.62, -0.62, 0.1, -0.1]) add(new THREE.BoxGeometry(0.16, 0.06, 0.02), black, x, 0.8, 0.6);
  add(new THREE.BoxGeometry(0.22, 0.1, 0.02), black, 0, 0.7, 0.58);
  // Console central com a alavanca de câmbio.
  add(new THREE.BoxGeometry(0.26, 0.3, 0.7), soft, 0, 0.42, 0.3);
  add(new THREE.CylinderGeometry(0.012, 0.016, 0.2, 8), metal, 0, 0.64, 0.2);
  add(new THREE.SphereGeometry(0.035, 14, 10), black, 0, 0.75, 0.2);

  // Colunas do para-brisa, o teto e o retrovisor interno.
  for (const side of [1, -1]) {
    const pillar = add(new THREE.BoxGeometry(0.08, 0.66, 0.1), black, side * 0.8, 1.2, 1.02);
    pillar.rotation.set(-0.6, 0, side * 0.12);
  }
  add(new THREE.BoxGeometry(1.48, 0.06, 0.16), black, 0, 1.5, 0.78);
  add(new THREE.CylinderGeometry(0.01, 0.01, 0.08, 6), black, 0, 1.44, 0.82);
  add(new THREE.BoxGeometry(0.26, 0.075, 0.025), black, 0, 1.39, 0.83);
  // Capô lá fora, visto pelo para-brisa.
  add(new THREE.BoxGeometry(1.5, 0.04, 1.1), soft, 0, 0.84, 1.95);

  // Volante: aro, três raios e o miolo, na coluna de direção.
  const wheel = new THREE.Group();
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 12, 48), black));
  for (const angle of [0, Math.PI, -Math.PI / 2]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.02), metal);
    spoke.position.set(Math.cos(angle) * 0.085, Math.sin(angle) * 0.085, 0);
    spoke.rotation.z = angle;
    wheel.add(spoke);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.04, 20), black);
  hub.rotation.x = Math.PI / 2;
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.3, 10), black);
  column.rotation.x = Math.PI / 2;
  column.position.z = 0.15;
  wheel.add(hub, column);
  wheel.position.set(0.36, 0.82, 0.58);
  // Inclinado para o motorista.
  wheel.rotation.x = -0.5;
  group.add(wheel);
  group.visible = false;
  return { group, wheel };
}

/** Navegador desenhando o 3D na CPU (sem placa de vídeo): começa em resolução baixa. */
function isSoftwareRenderer(renderer: THREE.WebGLRenderer) {
  const gl = renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  return /swiftshader|llvmpipe|software/i.test(name);
}

/** Poste de radar do speedtrap: braço sobre a pista, a câmera e a faixa listrada. */
function makeRadar(x: number, z: number, heading: number) {
  const group = new THREE.Group();
  const grey = new THREE.MeshLambertMaterial({ color: "#d9d4cc" });
  const dark = new THREE.MeshLambertMaterial({ color: "#2c2a2e" });
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.35, 6, 0.35), grey);
  pole.position.y = 3;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 0.3), grey);
  // O braço avança por cima da pista (para o lado de dentro).
  arm.position.set(-2, 5.8, 0);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 1.2), dark);
  box.position.set(-3.6, 5.3, 0);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.2, 10), new THREE.MeshBasicMaterial({ color: "#3fd4ff" }));
  lens.rotation.x = Math.PI / 2;
  lens.position.set(-3.6, 5.3, -0.65);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.4), new THREE.MeshLambertMaterial({ color: "#c1121f" }));
  stripe.position.y = 1.2;
  group.add(pole, arm, box, lens, stripe);
  group.position.set(x, heightAt(x, z), z);
  // A lente olha para quem vem pela pista.
  group.rotation.y = heading;
  return group;
}

/** Freada de chegada (rápido no começo, parando de leve no fim). */
const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(70, 1, 0.8, 2600);
  private sky: THREE.Object3D;
  private sun: THREE.Object3D;
  private raceOverlay: THREE.Object3D | null = null;
  /** Barreiras translúcidas da corrida (e a textura das setas, que andam). */
  private barriers: { mesh: THREE.Mesh; texture: THREE.Texture } | null = null;
  /** Rota do GPS no chão (mundo aberto). */
  private gpsRoute: THREE.Mesh | null = null;
  /** Nível do carro seguido (para a rota do GPS sair do tabuleiro, se ele está numa ponte). */
  private followLevel = GROUND;
  private markers: THREE.Group;
  private light: THREE.DirectionalLight;
  private ambient: THREE.HemisphereLight;
  private skyMaterial: THREE.Material;
  private clouds: THREE.Object3D;
  quality: Quality;
  /** Visual: realista (materiais físicos) ou quadrinho (cel-shading com contorno). */
  look: Look;
  private ink: InkPass | null = null;
  /** Pós-processamento do realista na qualidade alta (oclusão e brilho). */
  private real: RealPass | null = null;
  /** Reflexo do céu (gerado uma vez, na primeira vez que o realista liga). */
  private environment: THREE.Texture | null = null;
  private sunDirection = SUN_DIRECTION;
  /** Carro de vitrine do menu (girando na reta do autódromo). */
  private showcase: { model: CarModel; key: string; enteredAt: number } | null = null;
  /** Vitrine da garagem: câmera parada de lado, e os carros passam pela reta (um sai, o outro chega). */
  private showroom = false;
  /** Carros saindo da vitrine (arrancando para fora da tela). */
  private leaving: { model: CarModel; since: number }[] = [];
  /** Oficina no mundo aberto: a câmera gira devagar em volta do carro parado na garagem. */
  private garageCam = false;
  /** Ficha do próprio carro (com a tunagem), para a previsão da curva bater com a do servidor. */
  localSpec: CarSpec | null = null;
  /** Câmera atual (C troca): capô, primeira pessoa, terceira perto ou longe. */
  private cameraMode = DEFAULT_CAMERA;
  private cars = new Map<string, CarEntry>();
  private foods: THREE.Group[] = [];
  private foodActive: boolean[] = [];
  private effects: Effects;
  private cameraTarget = new THREE.Vector3();
  private clock = new THREE.Clock();
  private time = 0;
  private cockpit = makeCockpit();
  /** Câmera de chegada ligada desde este instante (null = câmera normal). */
  finishCam: number | null = null;
  /** Liga ou desliga a câmera de chegada (gira em volta do carro seguido). */
  setFinishCam(on: boolean) {
    if (on && this.finishCam === null) this.finishCam = this.time;
    else if (!on) this.finishCam = null;
  }
  /** O que o jogador está apertando (para prever a curva do próprio carro). */
  localInput: (() => { steer: number; handbrake?: boolean }) | null = null;
  /** Ida e volta até o servidor (s), medida pelo main. */
  latency = 0.05;
  /** Jogo pausado (modo solo/história): o quadro congela, sem extrapolar nada. */
  paused = false;
  /** Cinemática passando: a câmera é dela. */
  private director: CineDirector | null = null;
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

    const { sky, sun, light, clouds, ambient } = buildScenery(this.scene);
    this.clouds = clouds;
    this.ambient = ambient;
    this.skyMaterial = sky.material as THREE.Material;
    this.sky = sky;
    this.sun = sun;
    this.light = light;
    this.effects = new Effects(this.scene);
    this.markers = new THREE.Group();
    for (const id of RACE_IDS) this.markers.add(makeMarker(id));
    this.markers.visible = false;
    this.scene.add(this.markers);

    this.quality = chooseQuality(this.renderer);
    this.look = chooseLook();
    this.scene.add(this.cockpit.group);
    this.configure();

    try {
      const saved = localStorage.getItem(CAMERA_KEY);
      if (saved !== null && Number(saved) >= 0 && Number(saved) < CAMERAS.length) this.cameraMode = Math.floor(Number(saved));
    } catch {
      // Sem localStorage: começa na câmera padrão.
    }
    this.camera.position.set(0, 60, -160);
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  /**
   * Troca a qualidade na hora (Opções), sem recarregar a página: antes a
   * página recarregava e a abertura inteira tocava de novo a cada clique.
   * `choice` vazio = automática.
   */
  setQuality(choice: string) {
    const next = chooseQuality(this.renderer, choice);
    if (next === this.quality) return next;
    this.quality = next;
    this.configure();
    return next;
  }

  /** Troca o visual na hora (Opções): realista ou quadrinho. `choice` vazio = o padrão. */
  setLook(choice: string) {
    const next = chooseLook(choice);
    if (next === this.look) return next;
    this.look = next;
    this.configure();
    return next;
  }

  /** Realista na qualidade baixa: fica no material mais leve (Lambert), sem reflexo. */
  private get simple() {
    return this.look === "realista" && this.quality === "baixo";
  }

  /**
   * Monta tudo que depende do visual e da qualidade: materiais, contorno de
   * tinta (quadrinho), reflexo do céu e pós-processamento (realista), sombras.
   */
  private configure() {
    const real = this.look === "realista";
    const rich = real && !this.simple;
    if (!real && this.quality !== "baixo") this.ink ??= new InkPass(this.renderer);
    else this.ink = null;
    if (real && this.quality === "alto") this.real ??= new RealPass(this.renderer, this.scene, this.camera);
    else {
      this.real?.dispose();
      this.real = null;
    }
    if (rich) this.environment ??= skyEnvironment(this.renderer, this.skyMaterial, "#4a4032");
    this.scene.environment = rich ? this.environment : null;
    this.scene.environmentIntensity = 0.55;
    // Com o reflexo do céu iluminando tudo, a luz ambiente diminui (senão tudo fica lavado).
    this.ambient.intensity = rich ? 0.75 : 1.4;
    this.light.intensity = rich ? 2.8 : 2.4;
    for (const cloud of this.clouds.children) {
      const textures = cloud.userData.textures as Record<Look, THREE.Texture> | undefined;
      if (textures) (cloud as THREE.Sprite).material.map = textures[this.look];
    }
    applyLook(this.scene, this.look, this.simple);
    if (this.quality === "alto") this.enableShadows();
    else {
      this.renderer.shadowMap.enabled = false;
      this.light.castShadow = false;
    }
    // Ligar/desligar sombra muda o shader dos materiais: recompila.
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.needsUpdate = true;
    });
    this.resize();
  }

  private enableShadows() {
    const real = this.look === "realista";
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.light.castShadow = true;
    // No realista, mapa maior e borda macia (o raio espalha a borda da sombra).
    const size = real ? 4096 : 2048;
    if (this.light.shadow.mapSize.x !== size) {
      this.light.shadow.mapSize.set(size, size);
      this.light.shadow.map?.dispose();
      this.light.shadow.map = null;
    }
    this.light.shadow.radius = real ? 3 : 1;
    const area = this.light.shadow.camera;
    area.left = area.bottom = real ? -120 : -90;
    area.right = area.top = real ? 120 : 90;
    area.near = 10;
    area.far = 600;
    area.updateProjectionMatrix();
    this.light.shadow.bias = -0.0006;
    this.light.shadow.normalBias = 0.04;
    this.scene.traverse((object) => this.shadowsOn(object));
  }

  /** Liga as sombras de uma malha (as luzes e o que é transparente não fazem sombra). */
  private shadowsOn(object: THREE.Object3D) {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || object.userData.noShadow) return;
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
    if (material instanceof THREE.MeshBasicMaterial || material instanceof THREE.ShaderMaterial || material.transparent) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }

  /** Objeto novo na cena (carro, comida): mesmo visual do resto. */
  private dress(object: THREE.Object3D) {
    applyLook(object, this.look, this.simple);
    if (this.quality === "alto") object.traverse((o) => this.shadowsOn(o));
  }

  private resize() {
    const { innerWidth: w, innerHeight: h } = window;
    this.renderer.setSize(w, h);
    this.ink?.setSize(w, h, this.pixelRatio);
    this.real?.setSize(w, h, this.pixelRatio);
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
    // Primeiro sai a oclusão de ambiente (a parte mais pesada); só depois a resolução cai.
    if (fps < 38 && fps > 3 && this.real?.occlusion) this.real.occlusion = false;
    else if (fps < 38 && fps > 3 && this.pixelRatio > 0.5) {
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
    if (this.raceOverlay) {
      this.scene.remove(this.raceOverlay);
      forgetFlags(this.raceOverlay);
    }
    this.raceOverlay = null;
    if (this.barriers) {
      this.scene.remove(this.barriers.mesh);
      this.barriers.mesh.geometry.dispose();
      (this.barriers.mesh.material as THREE.Material).dispose();
      this.barriers.texture.dispose();
      this.barriers = null;
    }
    if (raceId && raceId !== "autodromo") {
      const race = RACES[raceId];
      this.raceOverlay = buildTrackMesh(race.track, { asphalt: false, bannerColor: race.kind === "radar" ? "#2a6bff" : "#ff7a00" });
      // Speedtrap: um poste de radar na beira da pista em cada ponto de medição.
      for (const dist of race.radars ?? []) {
        const spot = pointOnTrack(race.track, dist, race.track.width / 2 + 2.5);
        this.raceOverlay.add(makeRadar(spot.x, spot.z, spot.heading));
      }
      this.dress(this.raceOverlay);
      this.scene.add(this.raceOverlay);
    }
    if (raceId) {
      // Barreiras nas saídas e nas curvas (o autódromo também tem).
      this.barriers = buildBarriers(RACES[raceId].track);
      this.scene.add(this.barriers.mesh);
    }
    this.markers.visible = raceId === null;
    this.clearFoods();
    // Troca de sala: os carros da sala anterior somem.
    for (const entry of this.cars.values()) this.scene.remove(entry.model.group);
    this.cars.clear();
  }

  /** Rota do GPS no chão (lista vazia apaga). */
  /** Altura do teto (menos uma folga) se o carro seguido está dentro de um túnel; senão null. */
  private tunnelCeiling(entry: CarEntry) {
    if (entry.level < 0) return null;
    const st = STRUCTURES[entry.level];
    if (st.kind !== "tunel") return null;
    const loc = locate(st, entry.x, entry.z, 20);
    if (!loc || loc.ground - loc.y < 1) return null;
    return loc.y + TUNNEL_HEIGHT - 1.2;
  }

  setGpsRoute(route: [number, number][]) {
    if (this.gpsRoute) {
      this.scene.remove(this.gpsRoute);
      this.gpsRoute.geometry.dispose();
      const material = this.gpsRoute.material as THREE.MeshBasicMaterial;
      material.map?.dispose();
      material.dispose();
      this.gpsRoute = null;
    }
    if (route.length < 2) return;
    // A rota começa no nível do carro (se ele está na ponte, a rota sai do tabuleiro).
    this.gpsRoute = buildGpsRibbon(route, this.followLevel);
    this.scene.add(this.gpsRoute);
  }

  /** O carro está no ponto `from` da rota; em corrida (`visible` falso), a rota some. */
  setGpsProgress(from: number, visible: boolean) {
    if (!this.gpsRoute) return;
    this.gpsRoute.visible = visible;
    gpsDrawFrom(this.gpsRoute, from);
    const map = (this.gpsRoute.material as THREE.MeshBasicMaterial).map;
    if (map) map.offset.x = (map.offset.x - 0.012) % 1;
  }

  /** Troca a câmera (capô → primeira pessoa → terceira perto → terceira longe) e devolve o nome dela. */
  cycleCamera() {
    this.cameraMode = (this.cameraMode + 1) % CAMERAS.length;
    try {
      localStorage.setItem(CAMERA_KEY, String(this.cameraMode));
    } catch {
      // Sem localStorage: vale só nesta aba.
    }
    return CAMERAS[this.cameraMode].name;
  }

  /**
   * Mostra (ou tira, com null) o carro na vitrine do menu, na cor escolhida.
   * `pass`: troca de carro na garagem; o de antes arranca para fora e o novo
   * chega pela reta, freando (os carros "passam" pela vitrine).
   */
  setShowcase(color: string | null, car?: string, pass = false) {
    const key = `${color}|${car ?? ""}`;
    if (this.showcase && this.showcase.key === key) return;
    const animate = pass && this.showroom && !!this.showcase && !!color;
    if (this.showcase) {
      if (animate) this.leaving.push({ model: this.showcase.model, since: this.time });
      else this.scene.remove(this.showcase.model.group);
    }
    this.showcase = null;
    if (!color) return;
    const model = makeCar(color, "", { car });
    this.dress(model.group);
    const spot = pointOnTrack(RACES.autodromo.track, -14, 0);
    model.group.position.set(spot.x, 0, spot.z);
    model.group.rotation.y = spot.heading;
    this.scene.add(model.group);
    this.showcase = { model, key, enteredAt: animate ? this.time : -Infinity };
  }

  /** Vitrine da garagem (tela cheia): câmera parada de lado, carros passando. */
  setShowroom(on: boolean) {
    this.showroom = on;
    if (on) return;
    for (const car of this.leaving) this.scene.remove(car.model.group);
    this.leaving = [];
  }

  /** Oficina no mundo aberto: a câmera gira em volta do próprio carro. */
  setGarageCam(on: boolean) {
    this.garageCam = on;
  }

  /** Liga (ou desliga, com null) o diretor de cinemática. */
  setDirector(director: CineDirector | null) {
    this.director = director;
  }

  /** Põe um objeto avulso na cena (carros de cinemática, a ponte), com o mesmo visual do resto. */
  addProp(object: THREE.Object3D) {
    this.dress(object);
    this.scene.add(object);
  }

  removeProp(object: THREE.Object3D) {
    this.scene.remove(object);
  }

  /** Fumaça de pneu ou poeira no chão (as cinemáticas usam). */
  puff(x: number, z: number, heading: number, amount: number, dusty = false) {
    this.effects.wheelTrail(x, z, heading, amount, dusty);
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
          serverX: car.x, serverZ: car.z, serverHeading: car.heading, receivedAt: this.time, steer: 0,
          y: surfaceY(car.x, car.z, car.level ?? GROUND), level: car.level ?? GROUND,
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

  /**
   * Esconde os blocos da cidade (prédios, árvores, postes) que estão além da
   * neblina: com o mapa grande, desenhar tudo pesava demais no celular.
   */
  private cullChunks() {
    const fog = this.scene.fog as THREE.Fog | null;
    const far = fog?.far ?? 620;
    const { x, z } = this.camera.position;
    for (const chunk of CHUNKS) {
      const [cx, cz] = chunk.userData.center as [number, number];
      chunk.visible = Math.hypot(cx - x, cz - z) - (chunk.userData.radius as number) < far;
    }
    // Blocos com nível de detalhe: perto, a versão detalhada (montada na primeira
    // vez, no máximo uma por quadro, a mais perto primeiro); longe, a simples. A
    // detalhada de um bloco que ficou bem longe é descartada (memória).
    const range = DETAIL_RANGE[this.quality];
    let pending: (typeof LOD_CHUNKS)[number] | null = null;
    let pendingDistance = Infinity;
    for (const chunk of LOD_CHUNKS) {
      const distance = Math.hypot(chunk.center[0] - x, chunk.center[1] - z) - chunk.radius;
      chunk.group.visible = distance < far;
      const wantNear = distance < range;
      if (wantNear && !chunk.near && distance < pendingDistance) {
        pending = chunk;
        pendingDistance = distance;
      }
      if (chunk.near && distance > range + 260) {
        chunk.group.remove(chunk.near);
        // Geometria marcada com `userData.shared` é compartilhada (as formas das árvores): fica.
        chunk.near.traverse((o) => {
          if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
          const geometry = (o as THREE.Mesh).geometry;
          if (geometry && !geometry.userData.shared) geometry.dispose();
        });
        chunk.near = null;
      }
      if (chunk.near) chunk.near.visible = wantNear;
      if (chunk.far) chunk.far.visible = !(wantNear && chunk.near);
    }
    if (pending) {
      pending.near = pending.build();
      this.dress(pending.near);
      pending.group.add(pending.near);
      if (pending.far) pending.far.visible = false;
    }
  }

  /**
   * Garagem em tela cheia: a câmera fica parada ao lado da reta do autódromo
   * (balançando de leve) e os carros passam por ela. O que sai arranca e some
   * pela frente; o escolhido chega por trás, freando até parar no meio.
   */
  private renderShowroom(dt: number) {
    const spot = pointOnTrack(RACES.autodromo.track, -14, 0);
    const fx = Math.sin(spot.heading);
    const fz = Math.cos(spot.heading);
    const place = (model: CarModel, along: number, speed: number) => {
      model.group.position.set(spot.x + fx * along, 0, spot.z + fz * along);
      model.group.rotation.set(0, spot.heading, 0);
      for (const wheel of model.wheels) wheel.rotation.x += (speed * dt) / 0.33;
      model.flame.visible = false;
    };
    // Chegando: vem de 45 m atrás freando até o ponto da vitrine.
    const current = this.showcase!;
    const t = (this.time - current.enteredAt) / SHOWROOM_IN;
    const along = -45 * (1 - easeOut(t));
    const speed = t < 1 ? (45 * 3 * (1 - Math.min(1, t)) ** 2) / SHOWROOM_IN : 0;
    place(current.model, along, speed);
    // Saindo: arranca para a frente (aceleração constante) e some.
    this.leaving = this.leaving.filter((car) => {
      const age = this.time - car.since;
      if (age > SHOWROOM_OUT) {
        this.scene.remove(car.model.group);
        return false;
      }
      place(car.model, 30 * age * age, 60 * age);
      return true;
    });
    // Câmera de lado (à esquerda do carro), um pouco à frente, balançando devagar.
    const sway = Math.sin(this.time * 0.35) * 0.18;
    const side = 10.5;
    const ax = Math.cos(spot.heading) * Math.cos(sway) + fx * Math.sin(sway);
    const az = -Math.sin(spot.heading) * Math.cos(sway) + fz * Math.sin(sway);
    this.camera.position.set(spot.x + ax * side + fx * 1.5, 1.9, spot.z + az * side + fz * 1.5);
    // Vista do lado esquerdo do carro, a frente dele aponta para a esquerda da tela.
    // O alvo fica um pouco atrás do carro: ele aparece à esquerda do meio da tela
    // (a ficha e as peças ficam à direita).
    this.cameraTarget.set(spot.x - fx * 1.8, 0.75, spot.z - fz * 1.8);
    this.camera.fov = damp(this.camera.fov, 42, 4, dt);
    this.camera.near = 0.8;
    this.camera.updateProjectionMatrix();
  }

  /** Desenha um quadro. `followId` é o carro que a câmera persegue. */
  render(cars: Map<string, CarView>, followId: string | undefined, myId?: string): FollowedInfo | null {
    const rawDt = this.clock.getDelta();
    const dt = this.paused ? 0 : Math.min(rawDt, 0.1);
    this.time += dt;
    this.adaptResolution(rawDt);
    if (this.barriers) animateBarriers(this.barriers.texture, dt);

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
      // O próprio carro: o servidor só mostra o efeito do volante depois de ida e
      // volta pela rede. Para a curva responder na hora, a cena já gira o carro
      // com o volante que está sendo apertado agora, pelo tempo que falta chegar.
      let yaw = 0;
      let lead = age;
      if (id === myId && this.localInput && car.car) {
        const input = this.localInput();
        entry.steer = rampSteer(entry.steer, input.steer, dt);
        const spec = this.localSpec?.id === car.car ? this.localSpec : carSpec(car.car);
        yaw = yawRate(spec, car.speed, entry.steer, entry.offroad, !!input.handbrake && Math.abs(car.speed) > 3);
        lead = Math.min(age + this.latency, 0.3);
      }
      const predictedHeading = entry.serverHeading - yaw * lead;
      const midHeading = entry.serverHeading - (yaw * lead) / 2;
      const predictedX = entry.serverX + Math.sin(midHeading) * car.speed * lead;
      const predictedZ = entry.serverZ + Math.cos(midHeading) * car.speed * lead;
      entry.heading -= yaw * dt;
      entry.x += Math.sin(entry.heading) * car.speed * dt;
      entry.z += Math.cos(entry.heading) * car.speed * dt;
      entry.x = damp(entry.x, predictedX, 8, dt);
      entry.z = damp(entry.z, predictedZ, 8, dt);
      entry.heading = dampAngle(entry.heading, predictedHeading, 14, dt);

      // Força lateral = velocidade de giro × velocidade. Acima de um limite o pneu canta.
      const turnRate = dt > 0 ? Math.atan2(Math.sin(entry.heading - previousHeading), Math.cos(entry.heading - previousHeading)) / dt : 0;
      const lateral = turnRate * car.speed;
      entry.skid = damp(entry.skid, Math.min(1, Math.max(0, (Math.abs(lateral) - 30) / 25)), 12, dt);
      entry.level = car.level ?? GROUND;
      entry.offroad = !isOnRoad(entry.x, entry.z, entry.level);
      entry.lean = damp(entry.lean, Math.max(-0.12, Math.min(0.12, lateral * 0.0025)), 8, dt);

      const { group, flame, wheels } = entry.model;
      group.visible = car.visible;
      // No morro, o carro sobe e desce com o chão e inclina junto (frente/trás e de lado).
      // Em cima da ponte (ou dentro do túnel), segue o tabuleiro.
      const [sx, sz] = surfaceSlope(entry.x, entry.z, entry.level) ?? slopeAt(entry.x, entry.z);
      const fx = Math.sin(entry.heading);
      const fz = Math.cos(entry.heading);
      entry.y = surfaceY(entry.x, entry.z, entry.level);
      group.position.set(entry.x, entry.y, entry.z);
      group.rotation.set(-Math.atan(sx * fx + sz * fz), entry.heading, entry.lean + Math.atan(sx * fz - sz * fx), "YXZ");
      for (const wheel of wheels) wheel.rotation.x += (car.speed * dt) / ((wheel.userData.radius as number | undefined) ?? 0.45);
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
        if (amount > 0.15) this.effects.wheelTrail(entry.x, entry.z, entry.heading, amount, entry.offroad, entry.level);
      }
    }
    this.effects.update(dt);
    waveFlags(this.time);
    // A água corre devagar (o relevo das ondas desliza).
    waterNormal.offset.set(this.time * 0.004, this.time * 0.011);

    this.foods.forEach((food, i) => {
      food.rotation.y = this.time * 2 + i;
      food.position.y = heightAt(food.position.x, food.position.z) + 0.6 + Math.sin(this.time * 3 + i) * 0.3;
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
    this.followLevel = followed?.level ?? GROUND;
    const followedCar = followId ? cars.get(followId) : undefined;
    if (this.director) {
      this.director(dt, this.camera, this.cameraTarget);
      this.camera.updateProjectionMatrix();
    } else if (followed && followedCar && (this.finishCam !== null || this.garageCam)) {
      // Chegada: a câmera gira devagar em volta do carro, baixa, como nos replays da série.
      // Na oficina da garagem, o mesmo giro, um pouco mais aberto.
      const t = this.garageCam ? this.time * 0.6 : this.time - this.finishCam!;
      const angle = followed.heading + 2.4 - t * 0.45;
      const radius = this.garageCam ? 7.5 : 8 - Math.min(2.5, t * 0.8);
      const y = followed.y ?? 0;
      this.camera.position.lerp(new THREE.Vector3(followed.x + Math.sin(angle) * radius, y + 1.6 + t * 0.15, followed.z + Math.cos(angle) * radius), 1 - Math.exp(-5 * dt));
      this.cameraTarget.set(followed.x, y + 0.9, followed.z);
      followed.model.group.visible = followedCar.visible;
      this.cockpit.group.visible = false;
      this.camera.near = 0.8;
      this.camera.fov = damp(this.camera.fov, 45, 3, dt);
      this.camera.updateProjectionMatrix();
    } else if (followed && followedCar) {
      const forwardX = Math.sin(followed.heading);
      const forwardZ = Math.cos(followed.heading);
      const view = CAMERAS[this.cameraMode];
      // Lado do motorista (esquerda de quem dirige): (cos, -sin).
      const seat = view.seat ?? 0;
      const sideX = Math.cos(followed.heading) * seat;
      const sideZ = -Math.sin(followed.heading) * seat;
      // A câmera acompanha a altura do carro (e não entra no morro atrás dele numa subida).
      const camX = followed.x - forwardX * view.back + sideX;
      const camZ = followed.z - forwardZ * view.back + sideZ;
      // Em cima da ponte ou do viaduto, o chão lá embaixo não conta.
      const camHeight = view.seat || followed.level >= 0 ? followed.y : Math.max(followed.y, heightAt(camX, camZ) + 1);
      const desired = new THREE.Vector3(camX, camHeight + view.height, camZ);
      // Dentro do túnel a câmera não passa do teto.
      const ceiling = this.tunnelCeiling(followed);
      if (ceiling !== null) desired.y = Math.min(desired.y, ceiling);
      // No capô e no banco a câmera vai presa ao carro; nas outras, ela vem atrás com um pouco de atraso.
      if (view.back < 0 || view.seat) this.camera.position.copy(desired);
      else this.camera.position.lerp(desired, 1 - Math.exp(-6 * dt));
      this.cameraTarget.set(followed.x + forwardX * view.ahead + sideX, followed.y + view.lookHeight, followed.z + forwardZ * view.ahead + sideZ);
      followed.model.group.visible = view.showCar && followedCar.visible;
      // Primeira pessoa: painel e volante (que gira com o volante de verdade).
      this.cockpit.group.visible = !!view.seat && followedCar.visible;
      if (view.seat) {
        this.cockpit.group.position.copy(followed.model.group.position);
        this.cockpit.group.rotation.copy(followed.model.group.rotation);
        this.cockpit.wheel.rotation.z = followed.steer * 1.6;
      }
      // Lá dentro o painel fica a meio metro da lente: o plano de corte chega mais perto.
      this.camera.near = view.seat ? 0.08 : 0.8;
      // Com turbo a lente abre e a câmera treme, para dar sensação de velocidade.
      const boosting = followedCar.boost > 0;
      const fov = boosting ? 84 : 70 + Math.min(8, Math.abs(followedCar.speed) / 6);
      this.camera.fov = damp(this.camera.fov, fov, 4, dt);
      this.camera.updateProjectionMatrix();
      if (boosting) {
        this.cameraTarget.x += (Math.random() - 0.5) * 0.25;
        this.cameraTarget.y += (Math.random() - 0.5) * 0.25;
      }
    } else if (this.showcase && this.showroom) {
      this.renderShowroom(dt);
    } else if (this.showcase) {
      // Menu: a câmera gira devagar em volta do carro da vitrine.
      const center = this.showcase.model.group.position;
      const angle = this.time * 0.25;
      this.camera.position.set(center.x + Math.sin(angle) * 8.5, 2.6, center.z + Math.cos(angle) * 8.5);
      // Carro no meio da tela, um pouco acima do carrossel do menu (que fica embaixo).
      this.cameraTarget.set(center.x, -0.6, center.z);
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
    if (!this.showroom && this.leaving.length) this.setShowroom(false);
    this.camera.lookAt(this.cameraTarget);
    this.cullChunks();
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
    if (this.real) this.real.render();
    else if (this.ink) this.ink.render(this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
    return followed ? { skid: followed.skid, offroad: followed.offroad } : null;
  }
}
