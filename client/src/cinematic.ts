// Cinemáticas do modo história: cenas em 3D de verdade, na própria cidade, com
// faixas pretas de cinema, câmera roteirizada (sobrevoo, travelling, órbita,
// grua), câmera lenta, carros seguindo caminhos pelas ruas, a sirene do
// Couve-vette do Sargento Cross-fit e o salto da ponte inacabada do Cais.
//
// O texto vem do roteiro (shared/src/story.ts): cada quadro com `shot` vira um
// plano da cinemática, com a fala na legenda. Sem WebGL (e nos testes), os
// mesmos quadros aparecem como quadrinhos (`playComic`). Clique, toque, Enter
// ou espaço passam para o próximo plano; Esc ou "Pular" pulam a cena toda.
import * as THREE from "three";
import {
  CROSSFIT_CAR,
  FINALE_BRIDGE,
  QUAY_Z,
  ROADS,
  carSpec,
  routeBetween,
  type CineShot,
  type ComicPanel,
} from "@nfbmc/shared";

import "./cinematic.css";
import { makeCar, type CarModel } from "./models.ts";
import type { GameScene } from "./scene.ts";
import { graphemes, playComic } from "./story.ts";
import { escapeHtml } from "./ui.ts";

/** Quem aparece nas cenas: o seu carro (e cor) e, no duelo, o carro do rival. */
export interface Cast {
  hero: string;
  heroColor: string;
  rival?: string;
}

export interface CineHooks {
  /** Começou um plano (null = acabou a cinemática): o main liga sirene, música, efeitos. */
  onShot?: (shot: CineShot | null) => void;
}

// --- Caminhos pelas ruas -------------------------------------------------------

interface Pose {
  x: number;
  z: number;
  heading: number;
}

/** Linha de pontos com a distância acumulada: `at(s)` dá a posição a `s` metros do começo. */
class Path {
  private points: [number, number][];
  private acc: number[] = [0];
  readonly length: number;

  constructor(points: [number, number][]) {
    this.points = points.length > 1 ? points : [[0, 0], [0, 1]];
    for (let i = 1; i < this.points.length; i++) {
      const [ax, az] = this.points[i - 1];
      const [bx, bz] = this.points[i];
      this.acc.push(this.acc[i - 1] + Math.hypot(bx - ax, bz - az));
    }
    this.length = this.acc[this.acc.length - 1];
  }

  /** Posição a `s` metros (antes do começo ou depois do fim, segue em linha reta). */
  at(s: number, lateral = 0): Pose {
    let i = 1;
    while (i < this.points.length - 1 && this.acc[i] < s) i++;
    const [ax, az] = this.points[i - 1];
    const [bx, bz] = this.points[i];
    const segment = this.acc[i] - this.acc[i - 1] || 1;
    const t = (s - this.acc[i - 1]) / segment;
    const heading = Math.atan2(bx - ax, bz - az);
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    // Direita de quem olha para o heading: (-cos, sin).
    return { x: x - Math.cos(heading) * lateral, z: z + Math.sin(heading) * lateral, heading };
  }
}

/** Um ponto relativo a um carro: `fwd` metros à frente, `right` à direita, `up` de altura. */
function rel(p: Pose, fwd: number, right: number, up: number, out = new THREE.Vector3()) {
  return out.set(
    p.x + Math.sin(p.heading) * fwd - Math.cos(p.heading) * right,
    up,
    p.z + Math.cos(p.heading) * fwd + Math.sin(p.heading) * right,
  );
}

/** Distância percorrida com velocidade inicial `v0` freando a `a` m/s² (para quando zera). */
const braking = (t: number, v0: number, a: number) => (t < v0 / a ? v0 * t - (a * t * t) / 2 : (v0 * v0) / (2 * a));
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (u: number) => 1 - (1 - clamp01(u)) ** 3;
const smooth = (a: number, b: number, v: number) => {
  const u = clamp01((v - a) / (b - a));
  return u * u * (3 - 2 * u);
};

/** Onde as cenas acontecem: a avenida reta mais central (mão direita) e o caminho até a ponte. */
interface Layout {
  avenue: Path;
  /** Últimos ~400 m de rua até a ponte inacabada do Cais. */
  escape: Path;
}

let layoutCache: Layout | null = null;

function layout(): Layout {
  if (layoutCache) return layoutCache;
  // A avenida: reta (o comprimento quase igual à distância entre as pontas),
  // comprida, e a mais perto do centro da cidade.
  let best: { points: [number, number][]; score: number } | null = null;
  for (const road of ROADS) {
    const [a, b] = [road.points[0], road.points[road.points.length - 1]];
    const straight = Math.hypot(b[0] - a[0], b[1] - a[1]) / road.length;
    if (road.length < 150 || straight < 0.995) continue;
    const mid = Math.hypot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    const score = mid - road.length * 0.3 - (road.kind === "avenida" ? 120 : 0);
    if (!best || score < best.score) best = { points: [a, b], score };
  }
  const [a, b] = best?.points ?? [[-40, -200], [-40, 200]];
  const heading = Math.atan2(b[0] - a[0], b[1] - a[1]);
  // Mão direita: 3,5 m para a direita do meio da rua.
  const lane = (p: [number, number]): [number, number] => [p[0] - Math.cos(heading) * 3.5, p[1] + Math.sin(heading) * 3.5];
  const avenue = new Path([lane(a), lane(b)]);

  // A fuga: pelas ruas, do centro até a ponte; ficam só os últimos ~400 m.
  const route = routeBetween(0, 0, FINALE_BRIDGE.x, FINALE_BRIDGE.z) as [number, number][];
  const full = new Path(route.length > 1 ? route : [[FINALE_BRIDGE.x, FINALE_BRIDGE.z + 400], [FINALE_BRIDGE.x, FINALE_BRIDGE.z]]);
  const start = Math.max(0, full.length - 400);
  const tail: [number, number][] = [];
  for (let s = start; s < full.length; s += 4) {
    const p = full.at(s);
    tail.push([p.x, p.z]);
  }
  tail.push([FINALE_BRIDGE.x, FINALE_BRIDGE.z]);
  layoutCache = { avenue, escape: new Path(tail) };
  return layoutCache;
}

// --- A ponte inacabada do Cais ------------------------------------------------

/** Medidas da ponte, a partir do muro do cais (z = QUAY_Z), indo para o sul (mar). */
const BRIDGE = {
  rampLength: 55,
  rampHeight: 6,
  gap: 45,
  far: 80,
  farHeight: 5.2,
  width: 14,
};

/**
 * A ponte inacabada do Cais: rampa subindo do muro do cais, o vão (obra
 * parada) e o outro pedaço, mais adiante, sobre o mar. Com `beacon`, uma
 * coluna de luz verde marca o lugar na fuga final.
 */
export function makeBridge(beacon = false) {
  const group = new THREE.Group();
  const concrete = new THREE.MeshLambertMaterial({ color: "#a39d94" });
  const rail = new THREE.MeshLambertMaterial({ color: "#e2dacb" });
  const rebar = new THREE.MeshLambertMaterial({ color: "#b5651d" });
  const stripeA = new THREE.MeshLambertMaterial({ color: "#ffc42e" });
  const stripeB = new THREE.MeshLambertMaterial({ color: "#16110d" });
  const cone = new THREE.MeshLambertMaterial({ color: "#ff7a00" });
  const x = FINALE_BRIDGE.x;
  const { rampLength, rampHeight, gap, far, farHeight, width } = BRIDGE;

  // Rampa: sobe do cais até a ponta quebrada.
  const slope = Math.atan2(rampHeight, rampLength);
  const deckLength = Math.hypot(rampLength, rampHeight);
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(width, 1, deckLength), concrete);
  ramp.rotation.x = slope;
  ramp.position.set(x, rampHeight / 2 - 0.45, QUAY_Z - rampLength / 2);
  group.add(ramp);
  for (const side of [-1, 1]) {
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.9, deckLength), rail);
    guard.rotation.x = slope;
    guard.position.set(x + side * (width / 2 - 0.2), rampHeight / 2 + 0.4, QUAY_Z - rampLength / 2);
    group.add(guard);
  }
  // Pedaço de longe, onde o carro aterrissa.
  const farDeck = new THREE.Mesh(new THREE.BoxGeometry(width, 1, far), concrete);
  farDeck.position.set(x, farHeight - 0.5, QUAY_Z - rampLength - gap - far / 2);
  group.add(farDeck);
  // Pilares (o mar fica um pouco abaixo de zero).
  const pillar = (z: number, top: number) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, top + 3, 10), concrete);
    p.position.set(x, (top - 3) / 2, z);
    group.add(p);
  };
  for (const k of [0.35, 0.7, 0.98]) pillar(QUAY_Z - rampLength * k, rampHeight * k - 0.9);
  for (const k of [0.05, 0.5, 0.95]) pillar(QUAY_Z - rampLength - gap - far * k, farHeight - 1);
  // Ferragem para fora das duas pontas quebradas.
  for (let i = 0; i < 7; i++) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 5), rebar);
    bar.rotation.x = Math.PI / 2 + (i % 2 ? 0.2 : -0.1);
    bar.position.set(x - width / 2 + 1 + i * ((width - 2) / 6), rampHeight - 0.6, QUAY_Z - rampLength - 1.2);
    group.add(bar);
    const back = bar.clone();
    back.position.set(bar.position.x, farHeight - 0.6, QUAY_Z - rampLength - gap + 1.2);
    group.add(back);
  }
  // "OBRA PARADA": cavaletes listrados (já arrastados para os lados) e cones na entrada.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.2), i % 2 ? stripeB : stripeA);
      stripe.position.set(x + side * (width / 2 + 0.6 + i * 1.2), 1.1, QUAY_Z + 2);
      stripe.rotation.y = side * 0.3;
      group.add(stripe);
    }
  }
  for (const side of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 8), cone);
      c.position.set(x + side * 5.6, 0.4 + (k * 10 * rampHeight) / rampLength, QUAY_Z - 2 - k * 10);
      group.add(c);
    }
  }
  if (beacon) {
    const light = new THREE.MeshBasicMaterial({
      color: "#8cff5a", transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const column = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 120, 24, 1, true), light);
    column.position.set(FINALE_BRIDGE.x, 60, FINALE_BRIDGE.z);
    group.add(column);
    const ring = new THREE.Mesh(new THREE.RingGeometry(FINALE_BRIDGE.radius - 1.5, FINALE_BRIDGE.radius, 48), light.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(FINALE_BRIDGE.x, 0.15, FINALE_BRIDGE.z);
    group.add(ring);
  }
  return group;
}

/** Altura e inclinação do carro a `s` metros do começo do salto (velocidade `v`). */
function jumpProfile(s: number, v: number, start: number) {
  const { rampLength, rampHeight, gap, farHeight } = BRIDGE;
  const rampStart = start;
  const rampEnd = rampStart + rampLength;
  const landing = rampEnd + gap;
  if (s < rampStart) return { y: 0, pitch: 0 };
  if (s < rampEnd) return { y: ((s - rampStart) / rampLength) * rampHeight, pitch: Math.atan2(rampHeight, rampLength) };
  if (s < landing) {
    const tau = (s - rampEnd) / v;
    const vy = (v * rampHeight) / rampLength;
    return { y: Math.max(farHeight, rampHeight + vy * tau - 4.9 * tau * tau), pitch: Math.atan2(vy - 9.8 * tau, v) * 0.8 };
  }
  return { y: farHeight, pitch: 0 };
}

// --- Elenco: carros e cenário das cenas ----------------------------------------

interface Actor {
  model: CarModel;
  x: number;
  z: number;
}

class Stage {
  private actors = new Map<string, Actor>();
  private props = new Map<string, THREE.Object3D>();
  time = 0;
  private scene: GameScene;

  constructor(scene: GameScene) {
    this.scene = scene;
  }

  /** Esconde tudo (cada plano mostra só o que usa). */
  hideAll() {
    for (const actor of this.actors.values()) actor.model.group.visible = false;
    for (const prop of this.props.values()) prop.visible = false;
  }

  /**
   * Põe o carro `key` (cria na primeira vez) na posição dada. `y` e `pitch`
   * servem para o salto; as rodas giram pela distância andada desde o último quadro.
   */
  car(key: string, car: string, color: string, pose: Pose, opts: { cop?: boolean; y?: number; pitch?: number; roll?: number } = {}) {
    let actor = this.actors.get(key);
    if (!actor) {
      const model = makeCar(color, "", { car, cop: opts.cop });
      model.group.rotation.order = "YXZ";
      this.scene.addProp(model.group);
      actor = { model, x: pose.x, z: pose.z };
      this.actors.set(key, actor);
    }
    const { group, wheels, lights } = actor.model;
    const moved = Math.hypot(pose.x - actor.x, pose.z - actor.z);
    actor.x = pose.x;
    actor.z = pose.z;
    group.visible = true;
    group.position.set(pose.x, opts.y ?? 0, pose.z);
    group.rotation.y = pose.heading;
    group.rotation.x = -(opts.pitch ?? 0);
    group.rotation.z = opts.roll ?? 0;
    if (moved < 5) for (const wheel of wheels) wheel.rotation.x += moved / 0.34;
    if (lights) {
      // Giroflex: vermelho e azul alternando.
      const on = Math.floor(this.time * 6) % 2 === 0;
      lights[0].visible = on;
      lights[1].visible = !on;
    }
    return actor;
  }

  cop(key: string, car: string, pose: Pose, opts: { y?: number; pitch?: number } = {}) {
    return this.car(key, car, "#f4f4f0", pose, { ...opts, cop: true });
  }

  prop(key: string, make: () => THREE.Object3D) {
    let prop = this.props.get(key);
    if (!prop) {
      prop = make();
      this.scene.addProp(prop);
      this.props.set(key, prop);
    }
    prop.visible = true;
    return prop;
  }

  dispose() {
    for (const actor of this.actors.values()) this.scene.removeProp(actor.model.group);
    for (const prop of this.props.values()) this.scene.removeProp(prop);
    this.actors.clear();
    this.props.clear();
  }
}

// --- Planos ----------------------------------------------------------------------

/** Câmera de um quadro: posição, para onde olha e a lente (graus). */
interface CamPose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  /** Tremida da câmera (0 = firme). */
  shake: number;
}

interface ShotContext {
  stage: Stage;
  scene: GameScene;
  cast: Cast;
  /** Quantas vezes este plano já apareceu seguido (para variar o ângulo). */
  repeat: number;
  lay: Layout;
}

interface Shot {
  /** Duração mínima (s, tempo real) e máxima. */
  min: number;
  max?: number;
  /** Câmera lenta: escala do tempo pelo tempo da cena. */
  slow?: (t: number) => number;
  /** Monta o quadro no tempo `t` da cena (`dt` = quanto andou desde o anterior). */
  frame: (t: number, dt: number, cam: CamPose) => void;
}

const CROSSFIT_COLOR = carSpec(CROSSFIT_CAR).color;

const SHOTS: Record<CineShot, (ctx: ShotContext) => Shot> = {
  // Sobrevoo da cidade no fim de tarde, com o seu carro lá embaixo.
  aereo: ({ stage, cast, lay }) => ({
    min: 4.5,
    frame(t, _dt, cam) {
      const center = lay.avenue.at(lay.avenue.length / 2);
      stage.car("hero", cast.hero, cast.heroColor, lay.avenue.at(10 + t * 22));
      const a = 0.6 + t * 0.07;
      cam.pos.set(center.x + Math.sin(a) * 210, 85 - t * 3, center.z + Math.cos(a) * 210);
      cam.look.set(center.x, 8, center.z);
      cam.fov = 55;
    },
  }),

  // Travelling ao lado do carro chegando na cidade.
  chegada: ({ stage, cast, lay, repeat }) => ({
    min: 4,
    frame(t, _dt, cam) {
      const hero = lay.avenue.at(30 + t * 20);
      stage.car("hero", cast.hero, cast.heroColor, hero);
      const side = repeat % 2 ? -1 : 1;
      rel(hero, 4 - t * 1.1, side * 7.5, 1.2, cam.pos);
      rel(hero, 0.8, 0, 0.9, cam.look);
      cam.fov = 46;
    },
  }),

  // O Couve-vette sai atrás, de sirene ligada, e manda encostar.
  sirene: ({ stage, cast, lay }) => ({
    min: 4,
    frame(t, _dt, cam) {
      const s = 70 + braking(t, 18, 3.2);
      const hero = lay.avenue.at(s, Math.min(1.5, t * 0.4));
      const cop = lay.avenue.at(s - 13, Math.min(1.2, t * 0.35));
      stage.car("hero", cast.hero, cast.heroColor, hero);
      stage.cop("crossfit", CROSSFIT_CAR, cop);
      rel(cop, -6.5, -1.6, 1.05, cam.pos);
      rel(hero, 0, 0, 1.0, cam.look);
      cam.fov = 38;
      cam.shake = 0.03;
    },
  }),

  // Os dois parados no meio-fio; a câmera dá a volta no Cross-fit.
  abordagem: ({ stage, cast, lay, repeat }) => ({
    min: 4,
    frame(t, _dt, cam) {
      const s = 70 + braking(99, 18, 3.2);
      const hero = lay.avenue.at(s, 1.5);
      const cop = lay.avenue.at(s - 13, 1.2);
      stage.car("hero", cast.hero, cast.heroColor, hero);
      stage.cop("crossfit", CROSSFIT_CAR, cop);
      const close = repeat % 2;
      const center = lay.avenue.at(s - (close ? 13 : 6.5), 1.3);
      const angle = (close ? 2.3 : 0.5) + t * 0.16;
      const radius = close ? 6.5 : 9;
      cam.pos.set(center.x + Math.sin(center.heading + angle) * radius, close ? 1.3 : 1.8, center.z + Math.cos(center.heading + angle) * radius);
      cam.look.set(center.x, 1.0, center.z);
      cam.fov = 40;
    },
  }),

  // Câmera lenta: o motor engasga, fumaça, e o A3 do Bruno passa voando.
  sabotagem: ({ stage, scene, cast, lay }) => ({
    min: 4.5,
    slow: () => 0.55,
    frame(t, _dt, cam) {
      const s = 40 + braking(t, 26, 2.6);
      const sway = Math.sin(t * 2.2);
      const base = lay.avenue.at(s, sway * 1.2);
      const hero = { ...base, heading: base.heading + Math.cos(t * 2.2) * 0.12 };
      stage.car("hero", cast.hero, cast.heroColor, hero);
      stage.car("bruno", "a3bruno", carSpec("a3bruno").color, lay.avenue.at(14 + t * 38, -7));
      scene.puff(hero.x - Math.sin(hero.heading) * 2.2, hero.z - Math.cos(hero.heading) * 2.2, hero.heading, 0.9, true);
      rel(lay.avenue.at(s), 10, 1.5, 0.7, cam.pos);
      rel(hero, 0, 0, 0.9, cam.look);
      cam.fov = 45;
      cam.shake = 0.05;
    },
  }),

  // O cerco: as viaturas fecham o carro de todos os lados; a grua desce.
  cerco: ({ stage, cast, lay }) => ({
    min: 4.5,
    frame(t, _dt, cam) {
      const s = 110;
      const hero = lay.avenue.at(s);
      stage.car("hero", cast.hero, cast.heroColor, hero);
      const u = easeOut(t / 2.4);
      const cops: [string, string, number, number, number, number, boolean, number][] = [
        // id, carro, s inicial, s final, lado inicial, lado final, vem de frente, giro final
        ["crossfit", CROSSFIT_CAR, 175, 119, -2, -1, true, 0.5],
        ["cop1", "viatura", 50, 102, 0, 0.5, false, -0.4],
        ["cop2", "viatura", 38, 104, -6, -4.5, false, 0.6],
        ["cop3", "viatura-tatica", 185, 117, -7, -5, true, -0.6],
      ];
      for (const [id, car, s0, s1, l0, l1, front, turn] of cops) {
        const p = lay.avenue.at(s0 + (s1 - s0) * u, l0 + (l1 - l0) * u);
        stage.cop(id, car, { ...p, heading: p.heading + (front ? Math.PI : 0) + turn * u });
      }
      const angle = 0.9 + t * 0.15;
      // Mira um pouco à frente do carro, para o Couve-vette (que vem de frente) entrar no quadro.
      const ahead = lay.avenue.at(s + 4, -2);
      cam.pos.set(ahead.x + Math.sin(angle) * (19 - 4 * u), 14 - 6 * u, ahead.z + Math.cos(angle) * (19 - 4 * u));
      cam.look.set(ahead.x, 1, ahead.z);
      cam.fov = 58;
    },
  }),

  // O Cross-fit no rádio: a câmera chega devagar no Couve-vette parado de sirene ligada.
  radio: ({ stage, lay, repeat }) => ({
    min: 4,
    frame(t, _dt, cam) {
      const side = repeat % 2 ? -1 : 1;
      const cop = lay.avenue.at(140 + repeat * 30, 2);
      stage.cop("crossfit", CROSSFIT_CAR, cop);
      rel(cop, 8.5 - t * 0.7, side * 3.2, 1.3, cam.pos);
      rel(cop, 0, 0, 1.0, cam.look);
      cam.fov = 36;
    },
  }),

  // O rival esquentando os pneus antes do duelo.
  rival: ({ stage, scene, cast, lay, repeat }) => ({
    min: 4,
    frame(t, _dt, cam) {
      const car = cast.rival ?? cast.hero;
      const p = lay.avenue.at(90);
      stage.car("rival", car, carSpec(car).color, p, { roll: Math.sin(t * 40) * 0.01 });
      scene.puff(p.x - Math.sin(p.heading) * 2, p.z - Math.cos(p.heading) * 2, p.heading, 0.7);
      const angle = 0.5 + t * 0.3 + repeat * 2;
      cam.pos.set(p.x + Math.sin(p.heading + angle) * 6.5, 0.9, p.z + Math.cos(p.heading + angle) * 6.5);
      cam.look.set(p.x, 0.8, p.z);
      cam.fov = 40;
    },
  }),

  // Os dois lado a lado na largada.
  duelo: ({ stage, cast, lay }) => ({
    min: 4,
    frame(t, _dt, cam) {
      const car = cast.rival ?? cast.hero;
      stage.car("rival", car, carSpec(car).color, lay.avenue.at(90));
      stage.car("hero", cast.hero, cast.heroColor, lay.avenue.at(90, -4.5));
      const mid = lay.avenue.at(90, -2.25);
      rel(mid, 10 - t * 1.2, 0, 1.0, cam.pos);
      rel(mid, 0, 0, 0.9, cam.look);
      cam.fov = 45;
    },
  }),

  // A fuga final: você na frente, o Cross-fit e as viaturas atrás, rumo à ponte.
  fuga: ({ stage, cast, lay }) => ({
    min: 4.5,
    frame(t, _dt, cam) {
      const end = lay.escape.length - 10;
      const s = Math.min(end, 20 + t * 38);
      const hero = lay.escape.at(s);
      stage.car("hero", cast.hero, cast.heroColor, hero);
      const chasers: [string, string, number, number][] = [
        ["crossfit", CROSSFIT_CAR, 14, 1.5], ["cop1", "viatura-tatica", 24, -2], ["cop2", "viatura-tatica", 31, 2.5], ["cop3", "viatura", 39, 0],
      ];
      for (const [id, car, back, lateral] of chasers) stage.cop(id, car, lay.escape.at(Math.max(0, s - back), lateral));
      rel(hero, 9, 3.2, 1.0, cam.pos);
      rel(hero, -6, 0, 1.0, cam.look);
      cam.fov = 58;
      cam.shake = 0.06;
    },
  }),

  // O salto: rampa, câmera lenta no ar, aterrissagem; as viaturas freiam na beira.
  ponte: ({ stage, cast }) => {
    const v = 42;
    const start = FINALE_BRIDGE.z - QUAY_Z + 12; // metros até o muro do cais
    const z0 = FINALE_BRIDGE.z + 12;
    const takeoff = start + BRIDGE.rampLength;
    const landing = takeoff + BRIDGE.gap;
    const heroS = (t: number) => (t * v < landing ? t * v : landing + braking(t - landing / v, v, 14));
    return {
      min: 9.5,
      max: 11,
      slow: (t) => 1 - 0.78 * smooth(takeoff - 18, takeoff - 4, t * v) * (1 - smooth(landing - 4, landing + 6, heroS(t))),
      frame(t, _dt, cam) {
        stage.prop("bridge", () => makeBridge());
        const s = heroS(t);
        const { y, pitch } = jumpProfile(s, v, start);
        const hero = { x: FINALE_BRIDGE.x, z: z0 - s, heading: Math.PI };
        stage.car("hero", cast.hero, cast.heroColor, hero, { y, pitch });
        // As viaturas chegam atrás e freiam no muro do cais.
        const chasers: [string, string, number][] = [["crossfit", CROSSFIT_CAR, 0], ["cop1", "viatura-tatica", -4], ["cop2", "viatura-tatica", 4], ["cop3", "viatura", -1.5]];
        chasers.forEach(([id, car, lateral], i) => {
          const u = easeOut(t / (2.8 + i * 0.2));
          const stop = start - 4 - (i === 3 ? 9 : 0);
          const cs = -22 - i * 7 + (stop + 22 + i * 7) * u;
          stage.cop(id, car, { x: FINALE_BRIDGE.x + lateral, z: z0 - cs, heading: Math.PI + (i % 2 ? 0.35 : -0.35) * u });
        });
        const tAir = takeoff / v;
        if (t < tAir - 0.3) {
          // Da rampa, olhando o carro chegar.
          cam.pos.set(FINALE_BRIDGE.x + 6.5, 2.4, QUAY_Z - 32);
          cam.look.set(hero.x, y + 1, hero.z);
          cam.fov = 50;
        } else if (s < landing + 4) {
          // No ar: a câmera, lá embaixo perto da água, gira em volta do carro contra o céu.
          // (Sempre do lado da ponte, para não entrar debaixo do outro pedaço.)
          const a = 0.8 + Math.min(1.4, (t - tAir) * 1.1);
          // Perto de aterrissar, sobe acima do outro pedaço da ponte.
          cam.pos.set(hero.x + Math.sin(a) * 11, 2.2 + 7 * smooth(landing - 22, landing, s), hero.z + Math.cos(a) * 11);
          cam.look.set(hero.x, y + 0.6, hero.z);
          cam.fov = 52;
        } else {
          // Depois de aterrissar: atrás do carro, freando do outro lado.
          cam.pos.set(hero.x + 6, y + 2.6, hero.z + 13);
          cam.look.set(hero.x, y + 1, hero.z);
          cam.fov = 50;
        }
      },
    };
  },

  // O Cross-fit parado na beira, olhando você ir embora do outro lado do vão.
  beira: ({ stage, cast }) => ({
    min: 5,
    frame(t, _dt, cam) {
      stage.prop("bridge", () => makeBridge());
      const start = FINALE_BRIDGE.z - QUAY_Z + 12;
      const z0 = FINALE_BRIDGE.z + 12;
      const landing = start + BRIDGE.rampLength + BRIDGE.gap;
      const heroZ = z0 - (landing + braking(99, 42, 14));
      stage.car("hero", cast.hero, cast.heroColor, { x: FINALE_BRIDGE.x, z: heroZ, heading: Math.PI }, { y: BRIDGE.farHeight });
      const cf = { x: FINALE_BRIDGE.x, z: z0 - (start - 4), heading: Math.PI - 0.35 };
      stage.cop("crossfit", CROSSFIT_CAR, cf);
      stage.cop("cop1", "viatura-tatica", { x: FINALE_BRIDGE.x - 4, z: z0 - (start - 11), heading: Math.PI + 0.35 });
      stage.cop("cop2", "viatura-tatica", { x: FINALE_BRIDGE.x + 4, z: z0 - (start - 18), heading: Math.PI - 0.35 });
      if (t < 2.4) {
        // De perto: o Cross-fit parado na beira, de sirene ligada.
        const a = 2.4 + t * 0.12;
        cam.pos.set(cf.x + Math.sin(a) * 6, 1.4, cf.z + Math.cos(a) * 6);
        cam.look.set(cf.x, 1.0, cf.z);
        cam.fov = 40;
      } else {
        // De longe e do alto: a beira do cais, o vão da obra e você do outro lado.
        const u = t - 2.4;
        cam.pos.set(FINALE_BRIDGE.x + 20 - u * 0.8, 13 + u * 0.4, QUAY_Z - 15 + u * 0.6);
        cam.look.set(FINALE_BRIDGE.x, 3, QUAY_Z - BRIDGE.rampLength - BRIDGE.gap / 2);
        cam.fov = 52;
      }
    },
  }),
};

// --- Tela (faixas, legenda) e o diretor ---------------------------------------------

function overlay() {
  let el = document.getElementById("cine");
  if (el) return el;
  el = document.createElement("div");
  el.id = "cine";
  el.className = "cine";
  el.dataset.testid = "cine";
  el.hidden = true;
  el.innerHTML = `
    <div class="cine-bar top"></div>
    <div class="cine-bar bottom"></div>
    <div class="cine-flash"></div>
    <div class="cine-sfx"></div>
    <div class="cine-sub">
      <div class="cine-who"><span class="cine-art"></span><strong class="cine-speaker"></strong></div>
      <p class="cine-text"></p>
    </div>
    <div class="cine-controls">
      <span class="cine-hint"></span>
      <button type="button" class="link cine-skip" data-testid="cine-skip">Pular ▶▶</button>
    </div>`;
  document.body.append(el);
  return el;
}

/** Uma cinemática (quadros seguidos com `shot`). Resolve com true se pulou tudo (Esc). */
function playCinematic(panels: ComicPanel[], scene: GameScene, cast: Cast, hooks: CineHooks): Promise<boolean> {
  const el = overlay();
  const q = <T extends HTMLElement>(selector: string) => el.querySelector(selector) as T;
  const textEl = q<HTMLParagraphElement>(".cine-text");
  const touch = document.body.classList.contains("touch");
  q(".cine-hint").textContent = touch ? "Toque: próximo" : "Clique ou Enter: próximo · Esc: pular";
  const stage = new Stage(scene);
  const lay = layout();
  // Os carros da sala anterior saem de cena (o menu deixava eles parados lá).
  scene.syncCars(new Map());
  scene.setShowcase(null);

  return new Promise((resolve) => {
    let index = -1;
    let shot: Shot | null = null;
    let elapsed = 0;
    let sceneTime = 0;
    let duration = 0;
    let repeat = 0;
    let typing: ReturnType<typeof setInterval> | null = null;
    let safety: ReturnType<typeof setTimeout> | null = null;
    let full = "";
    const cam: CamPose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50, shake: 0 };

    const finishTyping = () => {
      if (typing) clearInterval(typing);
      typing = null;
      textEl.textContent = full;
    };

    const show = () => {
      const p = panels[index];
      const previous = panels[index - 1];
      repeat = previous?.shot === p.shot ? repeat + 1 : 0;
      stage.hideAll();
      shot = SHOTS[p.shot!]({ stage, scene, cast, repeat, lay });
      elapsed = 0;
      sceneTime = 0;
      const letters = graphemes(p.text);
      duration = Math.min(shot.max ?? 11, Math.max(shot.min, 2 + letters.length * 0.06));
      hooks.onShot?.(p.shot!);

      // Legenda: quem fala (com o "retrato" em emoji) e o texto em máquina de escrever.
      q(".cine-speaker").textContent = p.speaker ?? "";
      q(".cine-art").textContent = p.speaker ? graphemes(p.art).slice(0, 2).join("") : "";
      q(".cine-who").hidden = !p.speaker;
      const sfx = q(".cine-sfx");
      sfx.textContent = p.sfx ?? "";
      sfx.classList.remove("stamp");
      void sfx.offsetWidth;
      if (p.sfx) sfx.classList.add("stamp");
      const flash = q(".cine-flash");
      flash.classList.remove("on");
      void flash.offsetWidth;
      if (p.fx === "flash" || p.shot === "ponte") flash.classList.add("on");
      full = p.text;
      textEl.textContent = "";
      if (typing) clearInterval(typing);
      // ~45 letras por segundo, pelo relógio (com a máquina lenta, o intervalo atrasa).
      const typedAt = performance.now();
      typing = setInterval(() => {
        const shown = Math.floor((performance.now() - typedAt) / 22);
        textEl.textContent = letters.slice(0, shown).join("");
        if (shown >= letters.length) finishTyping();
      }, 30);
      // Se a cena 3D parar de desenhar (aba escondida, erro), o plano acaba sozinho.
      if (safety) clearTimeout(safety);
      safety = setTimeout(advance, (duration + 3) * 1000);
    };

    let done = false;
    const finish = (skipped: boolean) => {
      if (done) return;
      done = true;
      finishTyping();
      if (safety) clearTimeout(safety);
      scene.setDirector(null);
      stage.dispose();
      el.hidden = true;
      document.body.classList.remove("cine-on");
      window.removeEventListener("keydown", onKey, true);
      el.onpointerdown = null;
      skip.onclick = null;
      hooks.onShot?.(null);
      resolve(skipped);
    };

    function advance() {
      if (done) return;
      index++;
      if (index >= panels.length) finish(false);
      else show();
    }

    const next = () => {
      // Primeiro toque completa a legenda; o segundo passa de plano.
      if (typing) finishTyping();
      else advance();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Enter" || e.code === "Space" || e.code === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        next();
      } else if (e.code === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(true);
      }
    };

    const skip = q<HTMLButtonElement>(".cine-skip");
    skip.onclick = (e) => {
      e.stopPropagation();
      finish(true);
    };
    el.onpointerdown = (e) => {
      if ((e.target as HTMLElement).closest(".cine-skip")) return;
      e.preventDefault();
      next();
    };
    window.addEventListener("keydown", onKey, true);

    scene.setDirector((dt, camera, target) => {
      if (!shot) return;
      elapsed += dt;
      const scale = shot.slow ? shot.slow(sceneTime) : 1;
      sceneTime += dt * scale;
      stage.time += dt;
      cam.shake = 0;
      shot.frame(sceneTime, dt * scale, cam);
      camera.position.copy(cam.pos);
      target.copy(cam.look);
      if (cam.shake > 0) {
        target.x += (Math.random() - 0.5) * cam.shake * 4;
        target.y += (Math.random() - 0.5) * cam.shake * 4;
      }
      camera.fov = cam.fov;
      if (elapsed >= duration && !typing) advance();
    });

    document.body.classList.add("cine-on");
    el.hidden = false;
    advance();
  });
}

/**
 * Toca um trecho do roteiro: os quadros com `shot` viram cinemática 3D e os
 * outros, quadrinhos. Sem 3D, tudo vira quadrinho. Esc pula o trecho inteiro.
 */
export async function playStory(panels: ComicPanel[], scene: GameScene | null, cast: Cast, hooks: CineHooks = {}): Promise<void> {
  if (!panels.length) return;
  if (!scene) {
    await playComic(panels);
    return;
  }
  // Agrupa os quadros seguidos do mesmo tipo (cinemática ou quadrinho).
  const runs: ComicPanel[][] = [];
  for (const panel of panels) {
    const last = runs[runs.length - 1];
    if (last && !!last[0].shot === !!panel.shot) last.push(panel);
    else runs.push([panel]);
  }
  for (const run of runs) {
    const skipped = run[0].shot ? await playCinematic(run, scene, cast, hooks) : await playComic(run);
    if (skipped) return;
  }
}

/** Texto de rádio do Cross-fit na tela (perseguições do modo história). */
export function showRadio(speaker: string, text: string) {
  let el = document.getElementById("radio-call");
  if (!el) {
    el = document.createElement("div");
    el.id = "radio-call";
    el.className = "radio-call";
    el.dataset.testid = "radio-call";
    document.body.append(el);
  }
  el.innerHTML = `<span class="radio-icon">📻</span><div><strong>${escapeHtml(speaker)}</strong><p>${escapeHtml(text)}</p></div>`;
  el.hidden = true;
  void el.offsetWidth;
  el.hidden = false;
  const current = el;
  clearTimeout(Number(current.dataset.timer));
  current.dataset.timer = String(setTimeout(() => (current.hidden = true), 5000));
}
