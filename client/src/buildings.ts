// Prédios, casas, lojas, galpões e contêineres de Porto Gordo. A planta (onde
// fica cada um, de que tipo e tamanho) vem do shared/world.ts; aqui só se desenha.
import * as THREE from "three";
import { BUILDINGS, heightAt, seeded, slopeAt, type BuildingKind } from "@nfbmc/shared";

import { addChunk, byTile } from "./chunks.ts";

const Y = new THREE.Vector3(0, 1, 0);

/** Fachada com janelas, umas acesas e outras apagadas. */
function windowsTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, 64, 128);
  const random = seeded(7);
  for (let y = 4; y < 128; y += 8) {
    for (let x = 4; x < 64; x += 8) {
      const lit = random() < 0.35;
      ctx.fillStyle = lit ? `hsl(${35 + random() * 15}, 100%, ${60 + random() * 20}%)` : "#000000";
      ctx.fillRect(x, y, 4, 5);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export const buildingMaterial = (color: string, fog = true) =>
  new THREE.MeshLambertMaterial({
    color,
    emissive: "#ffcf8a",
    emissiveMap: windowsTexture(),
    emissiveIntensity: 1.2,
    fog,
  });

const PALETTES: Record<BuildingKind, string[]> = {
  tower: ["#3e4450", "#4a3f48", "#2f3a48", "#544a3e"],
  office: ["#6b5a4a", "#5a4a44", "#4e5560", "#6a6058"],
  shop: ["#f1e3c6", "#e8d2b0", "#d9e4dc", "#f3d6c8"],
  house: ["#f4e1b8", "#e9c46a", "#f2a3a3", "#a8d5c2", "#c9b8e8", "#f7f3ea"],
  warehouse: ["#7d8794", "#8a7f6e", "#6e7f8a", "#9a8f80"],
  container: ["#c1121f", "#2a6bff", "#e9c46a", "#2a9d8f", "#f4a261", "#6c757d"],
};
const AWNINGS = ["#c1121f", "#2a9d8f", "#f4a261", "#1d3557"];
const ROOFS = ["#8d3b2a", "#6b3a2a", "#4a4f57", "#7a4b2a"];

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const instancedBoxes = (material: THREE.Material, list: { matrix: THREE.Matrix4; color: THREE.Color }[], geometry: THREE.BufferGeometry = unitBox) => {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, list.length));
  list.forEach(({ matrix, color }, i) => {
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, color);
  });
  mesh.count = list.length;
  return mesh;
};

const matrixXZ = (m: THREE.Matrix4): [number, number] => [m.elements[12], m.elements[14]];

/** Caixas instanciadas, uma malha por bloco. */
function addTiledBoxes(scene: THREE.Scene, material: THREE.Material, list: { matrix: THREE.Matrix4; color: THREE.Color }[], geometry?: THREE.BufferGeometry) {
  for (const tile of byTile(list, (item) => matrixXZ(item.matrix))) {
    const mesh = instancedBoxes(material, tile.items, geometry);
    mesh.computeBoundingSphere();
    addChunk(scene, mesh, tile.center);
  }
}

/** Matriz de uma caixa girada do mapa (base no chão). */
function boxMatrix(b: { x: number; z: number; w: number; d: number; angle: number }, height: number, y = 0, inset = 0) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(b.x, y + height / 2, b.z),
    new THREE.Quaternion().setFromAxisAngle(Y, b.angle),
    new THREE.Vector3(b.w - inset, height, b.d - inset),
  );
}

/** Telhado de duas águas: um prisma triangular de base 1×1 e altura 1, com a cumeeira ao longo de X. */
function roofGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0);
  shape.lineTo(0.5, 0);
  shape.lineTo(0, 1);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  geometry.translate(0, 0, -0.5);
  // Gira para a cumeeira ficar ao longo do eixo X (o "w" da casa).
  geometry.rotateY(Math.PI / 2);
  return geometry;
}

export function buildBuildings(scene: THREE.Scene) {
  const random = seeded(31);
  const windowed: { matrix: THREE.Matrix4; color: THREE.Color }[] = [];
  const plain: { matrix: THREE.Matrix4; color: THREE.Color }[] = [];
  const awnings: { matrix: THREE.Matrix4; color: THREE.Color }[] = [];
  const roofs: { matrix: THREE.Matrix4; color: THREE.Color }[] = [];
  const color = (kind: BuildingKind, tint: number) => new THREE.Color(PALETTES[kind][tint % PALETTES[kind].length]);

  for (const b of BUILDINGS) {
    // No morro, o prédio afunda no lado de baixo até o lado de cima encostar no chão.
    const ground = heightAt(b.x, b.z);
    const [sx, sz] = slopeAt(b.x, b.z);
    const sink = Math.hypot(sx, sz) * (Math.hypot(b.w, b.d) / 2) + 0.4;
    const base = ground - sink;
    switch (b.kind) {
      case "tower":
      case "office":
        windowed.push({ matrix: boxMatrix(b, b.height + sink, base), color: color(b.kind, b.tint) });
        break;
      case "shop": {
        windowed.push({ matrix: boxMatrix(b, b.height + sink, base), color: color(b.kind, b.tint) });
        // Toldo listrado na frente da loja, virado para a rua.
        const fx = Math.sin(b.angle) * b.front;
        const fz = Math.cos(b.angle) * b.front;
        awnings.push({
          matrix: boxMatrix({ x: b.x + fx * (b.d / 2 + 0.9), z: b.z + fz * (b.d / 2 + 0.9), w: b.w * 0.9, d: 1.8, angle: b.angle }, 0.25, ground + 3.2),
          color: new THREE.Color(AWNINGS[Math.floor(random() * AWNINGS.length)]),
        });
        break;
      }
      case "house":
        plain.push({ matrix: boxMatrix(b, b.height + sink, base), color: color(b.kind, b.tint) });
        roofs.push({
          matrix: new THREE.Matrix4().compose(
            new THREE.Vector3(b.x, ground + b.height, b.z),
            new THREE.Quaternion().setFromAxisAngle(Y, b.angle),
            new THREE.Vector3(b.w + 0.8, 2.6, b.d + 0.8),
          ),
          color: new THREE.Color(ROOFS[Math.floor(random() * ROOFS.length)]),
        });
        break;
      case "warehouse":
        plain.push({ matrix: boxMatrix(b, b.height + sink, base), color: color(b.kind, b.tint) });
        break;
      case "container": {
        // Pilha de contêineres: um bloco por andar, com uma frestinha entre eles.
        const floors = Math.round(b.height / 2.6);
        for (let f = 0; f < floors; f++) {
          plain.push({ matrix: boxMatrix(b, 2.5, ground + f * 2.6), color: color("container", b.tint + f) });
        }
        break;
      }
    }
  }

  const lambert = new THREE.MeshLambertMaterial({ color: "#ffffff" });
  addTiledBoxes(scene, buildingMaterial("#ffffff"), windowed);
  addTiledBoxes(scene, lambert, plain);
  addTiledBoxes(scene, lambert, awnings);
  addTiledBoxes(scene, lambert, roofs, roofGeometry());
}

