// Bandeira do Orgulho Gordo: listras de hambúrguer (pão, alface, queijo,
// tomate, carne e pão). Piada do @barlattiraphael, que um amigo do Will mandou;
// aqui ela é redesenhada no código e tremula em mastros pela cidade e na
// largada das corridas.
import * as THREE from "three";

/** As listras, de cima para baixo. */
export const FLAG_STRIPES = ["#e98d33", "#84b818", "#fdd65e", "#f84040", "#6e3500", "#e98d33"];

let texture: THREE.CanvasTexture | null = null;

/** Textura das listras (uma só para todas as bandeiras). */
export function flagTexture() {
  if (texture) return texture;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  const band = canvas.height / FLAG_STRIPES.length;
  FLAG_STRIPES.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, Math.round(i * band), canvas.width, Math.ceil(band));
  });
  texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

interface Cloth {
  mesh: THREE.Mesh;
  /** Posição x de cada vértice em repouso (distância do mastro). */
  rest: Float32Array;
  width: number;
  phase: number;
}

const cloths: Cloth[] = [];

/**
 * Mastro com a bandeira. `height` é a altura do mastro (m); o pano tem
 * proporção 3:2. A bandeira fica no plano XY do grupo, saindo do mastro para +X.
 */
export function makeFlag(height = 12, width = 6) {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.18, height, 6),
    new THREE.MeshLambertMaterial({ color: "#d9d4cc" }),
  );
  pole.position.y = height / 2;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshLambertMaterial({ color: "#e8b923" }));
  knob.position.y = height + 0.2;

  const clothHeight = width / 1.5;
  const geometry = new THREE.PlaneGeometry(width, clothHeight, 12, 4);
  geometry.translate(width / 2, 0, 0);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ map: flagTexture(), side: THREE.DoubleSide }));
  mesh.position.y = height - clothHeight / 2 - 0.3;
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const rest = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i++) rest[i] = positions.getX(i);
  cloths.push({ mesh, rest, width, phase: Math.random() * Math.PI * 2 });

  group.add(pole, knob, mesh);
  return group;
}

/** Faz as bandeiras visíveis tremularem (onda que corre do mastro para a ponta). */
export function waveFlags(time: number) {
  for (const cloth of cloths) {
    if (!cloth.mesh.parent?.visible || !cloth.mesh.parent.parent) continue;
    const positions = cloth.mesh.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i++) {
      const x = cloth.rest[i];
      // Preso no mastro (x = 0), solto na ponta.
      const free = x / cloth.width;
      positions.setZ(i, Math.sin(x * 1.1 - time * 5 + cloth.phase) * 0.45 * free);
      positions.setX(i, x * (1 - 0.04 * free));
    }
    positions.needsUpdate = true;
    cloth.mesh.geometry.computeVertexNormals();
  }
}

/** Esquece as bandeiras de um grupo que saiu da cena (ex.: a largada da corrida anterior). */
export function forgetFlags(root: THREE.Object3D) {
  root.traverse((object) => {
    const index = cloths.findIndex((c) => c.mesh === object);
    if (index >= 0) cloths.splice(index, 1);
  });
}
