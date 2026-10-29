// "Fotos do combo" da Lista Gorda: cada rival de braços cruzados na frente do
// carro dele, no pôr do sol de Porto Gordo, renderizado uma vez em 3D (com o
// mesmo cel-shading do jogo) e guardado como imagem. Sem WebGL, devolve null
// e a tela usa a arte de emoji do roteiro.
import * as THREE from "three";

import { lookOf, makeFigure } from "./figures.ts";
import { makeCar } from "./models.ts";
import { toonify } from "./toon.ts";

const WIDTH = 640;
const HEIGHT = 400;

let renderer: THREE.WebGLRenderer | null | undefined;
const cache = new Map<string, string>();

function getRenderer() {
  if (renderer !== undefined) return renderer;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(WIDTH, HEIGHT, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } catch {
    renderer = null;
  }
  return renderer;
}

/** Céu de fim de tarde (degradê) como fundo da foto. */
function skyTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, "#2a1a3a");
  gradient.addColorStop(0.45, "#c1442e");
  gradient.addColorStop(0.75, "#ff9a1f");
  gradient.addColorStop(1, "#ffd27a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Foto já pronta (ou undefined). */
export const cachedPortrait = (key: string) => cache.get(key);

/**
 * Foto do rival sem travar a tela: renderiza logo depois do próximo quadro e
 * chama `done` com a imagem (null sem WebGL).
 */
export function portraitLater(key: string, name: string, car: string, color: string, done: (url: string | null) => void) {
  requestAnimationFrame(() => setTimeout(() => done(rivalPortrait(key, name, car, color)), 0));
}

/**
 * Foto do rival (data URL, JPEG). `key` identifica a foto no cache (o nome do rival).
 * Devolve null sem WebGL.
 */
export function rivalPortrait(key: string, name: string, car: string, color: string): string | null {
  const hit = cache.get(key);
  if (hit) return hit;
  const r = getRenderer();
  if (!r) return null;

  const scene = new THREE.Scene();
  scene.background = skyTexture();
  scene.fog = new THREE.Fog("#ff9a1f", 30, 90);
  scene.add(new THREE.HemisphereLight("#ffd9a8", "#4a3b2a", 1.6));
  const sun = new THREE.DirectionalLight("#ffb36b", 2.6);
  sun.position.set(-6, 8, 10);
  scene.add(sun);

  // Asfalto, com a faixa amarela.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: "#3a3236" }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 60), new THREE.MeshBasicMaterial({ color: "#e8c547" }));
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.set(3.2, 0.01, 0);
  scene.add(stripe);
  // Silhueta de prédios no fundo.
  for (let i = 0; i < 14; i++) {
    const h = 8 + ((i * 37) % 23);
    const building = new THREE.Mesh(new THREE.BoxGeometry(6, h, 6), new THREE.MeshBasicMaterial({ color: "#2a1d24" }));
    building.position.set(-40 + i * 6.5, h / 2, -38 - (i % 3) * 5);
    scene.add(building);
  }

  // O carro de lado, meio de frente, e o rival na frente dele de braços cruzados.
  const model = makeCar(color, "", { car });
  model.group.rotation.y = -0.65;
  model.group.position.set(0.6, 0, -1.2);
  scene.add(model.group);
  const figure = makeFigure(lookOf(name));
  figure.group.position.set(-1.6, 0, 1.4);
  figure.group.rotation.y = 0.35;
  figure.update(0.1, { crossed: true });
  scene.add(figure.group);
  toonify(scene);

  // Câmera baixa (de baixo para cima, como pôster de filme).
  const camera = new THREE.PerspectiveCamera(32, WIDTH / HEIGHT, 0.1, 200);
  camera.position.set(-3.6, 1.05, 8.2);
  camera.lookAt(-0.4, 1.25, 0);

  r.render(scene, camera);
  const url = r.domElement.toDataURL("image/jpeg", 0.86);
  cache.set(key, url);

  // Libera a memória da cena (o renderizador fica para as próximas fotos).
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose?.();
  });
  return url;
}
