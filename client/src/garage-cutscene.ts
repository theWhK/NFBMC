// Entrar e sair da garagem no mundo aberto (esconderijo e oficina): a porta de
// enrolar sobe, o carro entra sozinho com a câmera de cinema acompanhando, a
// porta desce e a oficina abre com o carro no meio do interior
// (client/src/garage-interior.ts). Na saída, o contrário: a porta sobe, o carro
// sai (de ré, se entrou de frente) até o lugar exato em que está no servidor, a
// porta desce e o controle volta.
//
// O servidor continua autoritativo: o carro de verdade fica parado no pátio o
// tempo todo (escondido só nesta tela) e quem anda é um carro "de cena" igual a
// ele. Para a galera, o carro só fica parado no pátio.
import * as THREE from "three";
import { heightAt, slopeAt, type Landmark } from "@nfbmc/shared";

import "./garage-cutscene.css";
import { buildGarageInterior, garageRotation, type GarageInterior } from "./garage-interior.ts";
import { garageDoor } from "./landmarks.ts";
import { makeCar, type CarModel } from "./models.ts";
import type { GameScene } from "./scene.ts";

export interface Pose {
  x: number;
  z: number;
  heading: number;
}

export type GaragePhase = "entrando" | "dentro" | "saindo";

/** Tempo da porta de enrolar subir ou descer (s). */
const DOOR_SECONDS = 1.4;
/** Onde o carro para lá dentro (no referencial do prédio: fachada em +z). */
const PARK_Z = -0.9;

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Caminho do pátio até a vaga lá dentro, medido em metros. */
interface Path {
  points: { x: number; z: number; d: number }[];
  length: number;
  /** +1: entra de frente; −1: entra de ré (o carro estava de costas para a porta). */
  sign: number;
}

/**
 * Do lugar do carro no pátio até a vaga: uma curva (Hermite) que sai na direção
 * do carro e chega reta na porta, e depois a reta até a vaga. Tudo no
 * referencial do prédio.
 */
function buildPath(start: { x: number; z: number; heading: number }, front: number): Path {
  const fx = Math.sin(start.heading);
  const fz = Math.cos(start.heading);
  // De costas para a porta (olhando para a rua): entra de ré, como quem estaciona.
  const sign = fz > 0.2 ? -1 : 1;
  const door = { x: 0, z: front + 0.6 };
  const reach = Math.max(3, Math.hypot(door.x - start.x, door.z - start.z) * 1.1);
  const m0 = { x: sign * fx * reach, z: sign * fz * reach };
  const m1 = { x: 0, z: -reach };
  const raw: { x: number; z: number }[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
    const h10 = t ** 3 - 2 * t ** 2 + t;
    const h01 = -2 * t ** 3 + 3 * t ** 2;
    const h11 = t ** 3 - t ** 2;
    raw.push({
      x: h00 * start.x + h10 * m0.x + h01 * door.x + h11 * m1.x,
      z: h00 * start.z + h10 * m0.z + h01 * door.z + h11 * m1.z,
    });
  }
  for (let i = 1; i <= 12; i++) raw.push({ x: 0, z: mix(door.z, PARK_Z, i / 12) });
  let d = 0;
  const points = raw.map((p, i) => {
    if (i > 0) d += Math.hypot(p.x - raw[i - 1].x, p.z - raw[i - 1].z);
    return { ...p, d };
  });
  return { points, length: d, sign };
}

/** Ponto e direção do movimento a `d` metros do começo do caminho. */
function along(path: Path, d: number) {
  const { points } = path;
  const target = Math.min(path.length, Math.max(0, d));
  let i = 1;
  while (i < points.length - 1 && points[i].d < target) i++;
  const a = points[i - 1];
  const b = points[i];
  const t = b.d > a.d ? (target - a.d) / (b.d - a.d) : 0;
  return { x: mix(a.x, b.x, t), z: mix(a.z, b.z, t), dx: b.x - a.x, dz: b.z - a.z };
}

/** Tela preta por cima do jogo (para trocar de câmera sem pulo) e as faixas de cinema. */
function overlay() {
  let el = document.getElementById("garage-cut");
  if (!el) {
    el = document.createElement("div");
    el.id = "garage-cut";
    el.hidden = true;
    el.dataset.testid = "garage-cutscene";
    el.innerHTML = '<div class="bar top"></div><div class="bar bottom"></div><div class="fade"></div><p class="skip">Esc pula</p>';
    document.body.append(el);
  }
  return {
    el,
    fade: el.querySelector<HTMLElement>(".fade")!,
    skip: el.querySelector<HTMLElement>(".skip")!,
  };
}

export interface GarageCutscene {
  phase(): GaragePhase | null;
  /** Animação de entrar; resolve com o carro lá dentro (Esc pula). */
  enter(): Promise<void>;
  /** Animação de sair até `pose` (onde o carro está no servidor); resolve quando o controle pode voltar. */
  exit(pose: Pose): Promise<void>;
  /** Some com tudo na hora (troca de sala no meio). */
  abort(): void;
}

/**
 * Prepara a cena da garagem `l`: o interior, o carro de cena (cor e modelo do
 * jogador) e a porta animada. `pose`: onde o carro está parado no pátio.
 */
export function createGarageCutscene(
  scene: GameScene,
  l: Landmark,
  pose: Pose,
  look: { color: string; car: string },
  sound: { garageDoor(seconds: number, volume?: number): void },
): GarageCutscene {
  const rotation = garageRotation(l);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const toWorld = (x: number, z: number) => ({ x: l.x + x * cos + z * sin, z: l.z - x * sin + z * cos });
  const toLocal = (x: number, z: number) => {
    const dx = x - l.x;
    const dz = z - l.z;
    return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
  };
  const localPose = (p: Pose) => ({ ...toLocal(p.x, p.z), heading: p.heading - rotation });
  const front = l.d / 2;

  const interior: GarageInterior = buildGarageInterior(l);
  scene.addProp(interior.group);
  const cityDoor = garageDoor(l.id);
  if (cityDoor) cityDoor.visible = false;
  const model: CarModel = makeCar(look.color, "", { car: look.car });
  model.flame.visible = false;
  scene.addProp(model.group);
  const ui = overlay();
  ui.fade.style.opacity = "0";
  ui.el.hidden = false;
  ui.el.classList.remove("bars");
  ui.skip.hidden = false;

  let phase: GaragePhase | null = "entrando";
  let path = buildPath(localPose(pose), front);
  let door = 0;
  let disposed = false;

  /** Põe o carro de cena a `d` metros do começo do caminho (com a inclinação do chão). */
  let lastD = 0;
  const placeCar = (d: number) => {
    const p = along(path, d);
    const w = toWorld(p.x, p.z);
    const heading = Math.atan2(path.sign * p.dx, path.sign * p.dz) + rotation;
    const [sx, sz] = slopeAt(w.x, w.z);
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    model.group.position.set(w.x, heightAt(w.x, w.z), w.z);
    model.group.rotation.set(-Math.atan(sx * fx + sz * fz), heading, Math.atan(sx * fz - sz * fx), "YXZ");
    const moved = d - lastD;
    lastD = d;
    for (const wheel of model.wheels) wheel.rotation.x += (path.sign * moved) / ((wheel.userData.radius as number | undefined) ?? 0.33);
  };
  const setDoor = (open: number) => {
    door = open;
    interior.setDoor(open);
  };

  /** Câmera num ponto do referencial (altura acima do chão daquele ponto). */
  const camAt = (camera: THREE.PerspectiveCamera, x: number, y: number, z: number) => {
    const w = toWorld(x, z);
    camera.position.set(w.x, heightAt(w.x, w.z) + y, w.z);
  };
  const lookAt = (target: THREE.Vector3, x: number, y: number, z: number) => {
    const w = toWorld(x, z);
    target.set(w.x, heightAt(w.x, w.z) + y, w.z);
  };

  // Lado da câmera de fora: o oposto de onde o carro está no pátio (para ver ele atravessar).
  const side = localPose(pose).x > 0.5 ? -1 : 1;

  /** Câmera de dentro: balança devagar na frente do carro, com a parede do fundo atrás dele. */
  let insideTime = 0;
  const insideCamera = (camera: THREE.PerspectiveCamera, target: THREE.Vector3) => {
    const a = 1.0 * Math.sin(insideTime * 0.16 + 0.6);
    const r = 6.4;
    const cx = Math.sin(a) * r;
    const cz = PARK_Z + Math.cos(a) * r;
    camAt(camera, cx, 1.45 + 0.2 * Math.sin(insideTime * 0.27), cz);
    // O alvo vai um pouco para a direita da tela: o carro fica à esquerda (a ficha da oficina fica à direita).
    const right = 1.25;
    lookAt(target, Math.cos(a) * right, 0.75, PARK_Z - Math.sin(a) * right);
    camera.fov = 52;
    camera.near = 0.1;
  };

  /** Câmera de fora: de lado no pátio, olhando o carro e a porta. */
  const outsideCamera = (camera: THREE.PerspectiveCamera, target: THREE.Vector3, t: number, carWeight: number) => {
    const k = smooth(t / 6);
    camAt(camera, side * mix(8.5, 6.5, k), mix(2.3, 2.9, k), front + mix(13.5, 11.5, k));
    const p = model.group.position;
    const doorCenter = toWorld(0, front);
    target.set(
      mix(doorCenter.x, p.x, carWeight),
      mix(heightAt(doorCenter.x, doorCenter.z) + 2.0, p.y + 0.8, carWeight),
      mix(doorCenter.z, p.z, carWeight),
    );
    camera.fov = 46;
    camera.near = 0.3;
  };

  // --- Relógio próprio: com o jogo pausado (solo) a cena para, mas a animação não. ---
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    // Com quadros lentos (3D na CPU) a animação pula, mas não demora mais que o normal.
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    return dt;
  };

  /** Teclas: Esc pula; o resto não chega ao jogo durante a animação. */
  let onSkip: (() => void) | null = null;
  const onKey = (e: KeyboardEvent) => {
    if (!phase || phase === "dentro") return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.type === "keydown" && e.code === "Escape") onSkip?.();
  };
  window.addEventListener("keydown", onKey, true);
  // No celular: tocar na tela pula.
  ui.el.onpointerdown = (e) => {
    e.preventDefault();
    onSkip?.();
  };

  const finishInside = () => {
    phase = "dentro";
    onSkip = null;
    ui.skip.hidden = true;
    ui.el.classList.remove("bars");
    ui.el.style.pointerEvents = "none";
    setDoor(0);
    placeCar(path.length);
    scene.setIndoor(true);
    insideTime = 0;
    scene.setDirector((_dt, camera, target) => {
      const dt = tick();
      insideTime += dt;
      insideCamera(camera, target);
      // Volta da tela preta.
      const o = Number(ui.fade.style.opacity);
      if (o > 0) ui.fade.style.opacity = String(Math.max(0, o - dt * 2.2));
    });
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    phase = null;
    window.removeEventListener("keydown", onKey, true);
    ui.el.onpointerdown = null;
    ui.el.hidden = true;
    ui.fade.style.opacity = "0";
    scene.setIndoor(false);
    scene.removeProp(model.group);
    scene.removeProp(interior.group);
    interior.dispose();
    if (cityDoor) cityDoor.visible = true;
  };

  return {
    phase: () => phase,

    enter() {
      return new Promise<void>((resolve) => {
        const drive = Math.min(4.6, Math.max(2.6, path.length / 3.3));
        const moveAt = 0.9;
        const closeAt = moveAt + drive + 0.15;
        const fadeAt = closeAt + DOOR_SECONDS - 0.3;
        const doneAt = fadeAt + 0.45;
        let t = 0;
        let closing = false;
        ui.el.classList.add("bars");
        ui.el.style.pointerEvents = "auto";
        sound.garageDoor(DOOR_SECONDS);
        placeCar(0);
        last = performance.now();
        const done = () => {
          if (phase !== "entrando") return;
          ui.fade.style.opacity = "1";
          finishInside();
          resolve();
        };
        onSkip = done;
        scene.setDirector((_dt, camera, target) => {
          const dt = tick();
          t += dt;
          if (t < closeAt) setDoor(smooth(t / DOOR_SECONDS));
          else {
            if (!closing) {
              closing = true;
              sound.garageDoor(DOOR_SECONDS);
            }
            setDoor(1 - smooth((t - closeAt) / DOOR_SECONDS));
          }
          const progress = smooth((t - moveAt) / drive);
          placeCar(progress * path.length);
          outsideCamera(camera, target, t, 1 - smooth((t - moveAt - drive * 0.55) / (drive * 0.6)));
          if (t > fadeAt) ui.fade.style.opacity = String(Math.min(1, (t - fadeAt) / 0.4));
          if (t >= doneAt) done();
        });
      });
    },

    exit(next: Pose) {
      return new Promise<void>((resolve) => {
        if (disposed) return resolve();
        phase = "saindo";
        // O carro sai até onde ele está no servidor (que pode ter sido empurrado, jogando com a galera).
        path = buildPath(localPose(next), front);
        lastD = path.length;
        const drive = Math.min(4.6, Math.max(2.6, path.length / 3.0));
        const openAt = 0.4;
        const moveAt = openAt + 0.9;
        const handAt = moveAt + drive;
        let t = 0;
        let switched = false;
        let handed = false;
        let closeStart = 0;
        ui.el.classList.add("bars");
        ui.el.style.pointerEvents = "auto";
        ui.skip.hidden = false;
        last = performance.now();
        // Câmera de trás (a terceira pessoa padrão) no fim, para a troca ficar sem pulo.
        const follow = (camera: THREE.PerspectiveCamera, target: THREE.Vector3, weight: number) => {
          if (weight <= 0) return;
          const h = next.heading;
          const fx = Math.sin(h);
          const fz = Math.cos(h);
          const y = heightAt(next.x, next.z);
          const bx = next.x - fx * 7;
          const bz = next.z - fz * 7;
          camera.position.lerp(new THREE.Vector3(bx, Math.max(y, heightAt(bx, bz) + 1) + 3.2, bz), weight);
          target.lerp(new THREE.Vector3(next.x + fx * 6, y + 1.3, next.z + fz * 6), weight);
          camera.fov = mix(camera.fov, 70, weight);
        };
        const handOver = () => {
          if (handed) return;
          handed = true;
          onSkip = null;
          ui.el.classList.remove("bars");
          ui.el.style.pointerEvents = "none";
          ui.el.hidden = true;
          // O carro de verdade volta a aparecer no quadro seguinte (no mesmo lugar): só então o de cena sai.
          requestAnimationFrame(() => scene.removeProp(model.group));
          scene.setDirector(null);
          // A porta termina de descer sozinha; depois o interior vai embora.
          closeStart = performance.now();
          sound.garageDoor(DOOR_SECONDS, 0.8);
          const close = () => {
            if (disposed) return;
            const k = (performance.now() - closeStart) / 1000 / DOOR_SECONDS;
            setDoor(Math.min(door, 1 - smooth(k)));
            if (k >= 1) dispose();
            else requestAnimationFrame(close);
          };
          requestAnimationFrame(close);
          resolve();
        };
        onSkip = () => {
          setDoor(0);
          handOver();
          dispose();
        };
        scene.setDirector((_dt, camera, target) => {
          const dt = tick();
          t += dt;
          if (!switched) {
            // Escurece, troca para a câmera de fora (porta fechada, carro lá dentro) e clareia.
            ui.fade.style.opacity = String(Math.min(1, t / 0.35));
            insideTime += dt;
            insideCamera(camera, target);
            if (t >= 0.35) {
              switched = true;
              scene.setIndoor(false);
              sound.garageDoor(DOOR_SECONDS);
            }
            return;
          }
          ui.fade.style.opacity = String(Math.max(0, 1 - (t - 0.35) / 0.4));
          setDoor(smooth((t - openAt) / DOOR_SECONDS));
          const progress = smooth((t - moveAt) / drive);
          placeCar((1 - progress) * path.length);
          outsideCamera(camera, target, t + 2, smooth((t - moveAt + 0.3) / 1.2));
          follow(camera, target, smooth((t - handAt + 1.1) / 1.1));
          if (t >= handAt) handOver();
        });
      });
    },

    abort() {
      if (phase) scene.setDirector(null);
      dispose();
    },
  };
}

