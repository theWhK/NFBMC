// Árvores de Porto Gordo (antes eram brócolis; agora a cidade fez paisagismo):
// árvores de copa cheia na maior parte, ipês amarelos, roxos e brancos nos
// bairros de casa e no parque, coqueiros na praia (e umas palmeiras nas
// mansões) e araucárias na serra. Onde fica cada árvore vem do shared/world.ts
// (TREES, com colisão); aqui só se desenha.
//
// Dois níveis de detalhe por bloco: de longe, tronco e copa simples
// instanciados; de perto, copa com volume e relevo, galhos, folhas de coqueiro
// recortadas e a "taça" da araucária.
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TREES, districtAt, heightAt, seeded, type Tree } from "@nfbmc/shared";

import { DETAIL_TILE, addLodChunk, byTile } from "./chunks.ts";
import { surface } from "./look.ts";
import { normalTexture } from "./textures.ts";

type Species = "folhosa" | "ipe" | "coqueiro" | "araucaria";

interface Placed {
  tree: Tree;
  species: Species;
  /** Cor da copa (multiplica a cor de cada folha). */
  tint: THREE.Color;
  /** Giro (rad) e quanto a árvore estica para cima (variação). */
  turn: number;
  stretch: number;
}

const LEAF_GREENS = ["#4f7f2e", "#5b8a33", "#3f6f2a", "#6a8f3a", "#4a7a3c"];
const SERRA_GREENS = ["#35602a", "#2f5626", "#3d6a2f"];
const IPE_COLORS = ["#f2c230", "#f2c230", "#d46aa3", "#b65fc4", "#f1ece4"];

/** Espécie e cor de cada árvore, conforme o bairro (sempre a mesma: semente fixa). */
function placeTrees(): Placed[] {
  const random = seeded(77);
  return TREES.map((tree) => {
    const district = districtAt(tree.x, tree.z);
    const r = random();
    let species: Species = "folhosa";
    if (district === "praia") species = r < 0.75 ? "coqueiro" : "folhosa";
    else if (district === "serra") species = r < 0.45 ? "araucaria" : "folhosa";
    else if (district === "picanha") species = r < 0.15 ? "coqueiro" : r < 0.33 ? "ipe" : "folhosa";
    else if (["jardim", "parque", "vila", "liberdade"].includes(district)) species = r < 0.22 ? "ipe" : "folhosa";
    else if (district === "roca") species = r < 0.06 ? "ipe" : "folhosa";
    const palette = species === "ipe" ? IPE_COLORS : district === "serra" ? SERRA_GREENS : LEAF_GREENS;
    const tint = new THREE.Color(palette[Math.floor(random() * palette.length)]);
    // Cada árvore um pouco mais clara ou escura.
    tint.multiplyScalar(0.88 + random() * 0.24);
    return { tree, species, tint, turn: random() * Math.PI * 2, stretch: 0.85 + random() * 0.3 };
  });
}

// --- Materiais (compartilhados por todos os blocos) -------------------------

/** Relevo de folhagem: tufos redondos sobrepostos. */
const leafNormal = normalTexture(256, (ctx, size, random) => {
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 520; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = 4 + random() * 9;
    const g = ctx.createRadialGradient(x, y - r * 0.3, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}, 61, 3);

/** Casca: sulcos verticais. */
const barkNormal = normalTexture(128, (ctx, size, random) => {
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 90; i++) {
    const v = Math.floor(random() * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(random() * size, 0, 1 + random() * 3, size);
  }
}, 62, 2.5);

const leafMaterial = surface(new THREE.MeshLambertMaterial({ color: "#ffffff", vertexColors: true }), {
  roughness: 0.8, normalMap: leafNormal, normalScale: 1.2,
});
const barkMaterial = surface(new THREE.MeshLambertMaterial({ color: "#ffffff", vertexColors: true }), {
  roughness: 0.95, normalMap: barkNormal, normalScale: 1,
});

/** Folha de coqueiro: a nervura e os folíolos recortados (transparência por recorte). */
const frondTexture = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const random = seeded(63);
  ctx.strokeStyle = "#7a8a3a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(32, 0);
  ctx.lineTo(32, 256);
  ctx.stroke();
  for (let y = 6; y < 250; y += 5) {
    const reach = 30 * Math.sin((y / 256) * Math.PI * 0.95 + 0.1);
    for (const side of [-1, 1]) {
      const shade = 70 + Math.floor(random() * 40);
      ctx.strokeStyle = `rgb(${shade - 20}, ${shade + 50}, ${Math.floor(shade * 0.45)})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(32, y);
      ctx.quadraticCurveTo(32 + side * reach * 0.6, y + 4, 32 + side * reach, y + 14);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
})();
const frondMaterial = surface(new THREE.MeshLambertMaterial({ map: frondTexture, alphaTest: 0.5, side: THREE.DoubleSide }), { roughness: 0.75 });

// --- Formas (montadas uma vez) ----------------------------------------------

/** Pinta todos os vértices de uma geometria com uma cor (para juntar peças de cores diferentes). */
function paint(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, darkenBelow?: [number, number]) {
  const c = new THREE.Color(color);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    // Embaixo da copa é mais escuro (luz que não chega): oclusão "pintada".
    let k = 1;
    if (darkenBelow) {
      const [low, high] = darkenBelow;
      k = 0.55 + 0.45 * Math.min(1, Math.max(0, (position.getY(i) - low) / (high - low)));
    }
    colors[i * 3] = c.r * k;
    colors[i * 3 + 1] = c.g * k;
    colors[i * 3 + 2] = c.b * k;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Ruído suave e determinístico (para deformar as copas). */
const wobble = (x: number, y: number, z: number) =>
  Math.sin(x * 2.1 + y * 1.3) * Math.sin(z * 1.7 - x * 0.9) * 0.6 + Math.sin(y * 3.3 + z * 2.6) * 0.4;

/** Tufo de folhas: esfera irregular, lisa, com UV esférico (para o relevo da folhagem). */
function blob(radius: number, squash: number, seed: number, detail = 2) {
  let geometry: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  geometry.deleteAttribute("normal");
  geometry.deleteAttribute("uv");
  geometry = mergeVertices(geometry);
  const position = geometry.attributes.position;
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const r = radius * (1 + 0.22 * wobble(x * 2 + seed, y * 2, z * 2 - seed));
    position.setXYZ(i, x * r, y * r * squash, z * r);
    uv[i * 2] = (Math.atan2(z, x) / (Math.PI * 2) + 0.5) * 3;
    uv[i * 2 + 1] = (y * 0.5 + 0.5) * 1.5;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  return geometry;
}

/** Galho/tronco de `from` a `to`, afinando de `r0` para `r1`. */
function limb(from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, sides = 7) {
  const length = from.distanceTo(to);
  const geometry = new THREE.CylinderGeometry(r1, r0, length, sides, 2);
  geometry.translate(0, length / 2, 0);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()));
  geometry.translate(from.x, from.y, from.z);
  return geometry;
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

interface Shape {
  leaves?: THREE.BufferGeometry;
  wood: THREE.BufferGeometry;
  fronds?: THREE.BufferGeometry;
}

/** Árvore de copa cheia (oiti, figueira, amendoeira...): tronco, galhos e 5–7 tufos. */
function leafyShape(seed: number): Shape {
  const random = seeded(seed);
  const wood: THREE.BufferGeometry[] = [paint(limb(v3(0, -0.3, 0), v3(0.1, 3.4, 0), 0.34, 0.2), "#6b5440")];
  const leaves: THREE.BufferGeometry[] = [];
  const tufts = 5 + Math.floor(random() * 3);
  for (let k = 0; k < tufts; k++) {
    const angle = (k / tufts) * Math.PI * 2 + random();
    const out = k === 0 ? 0 : 1.2 + random() * 0.6;
    const y = k === 0 ? 5.6 : 4.0 + random() * 1.4;
    const tip = v3(Math.cos(angle) * out, y, Math.sin(angle) * out);
    if (k > 0) wood.push(paint(limb(v3(0.1, 3.0, 0), tip.clone().multiplyScalar(0.7).setY(y - 0.6), 0.14, 0.07, 5), "#6b5440"));
    const size = k === 0 ? 2.0 : 1.4 + random() * 0.5;
    leaves.push(paint(blob(size, 0.78, seed + k * 3.1).translate(tip.x, tip.y, tip.z), "#ffffff", [3.2, 6.8]));
  }
  return { wood: mergeGeometries(wood), leaves: mergeGeometries(leaves) };
}

/** Coqueiro: tronco fino e curvado, com anéis, e a coroa de folhas caídas. */
function palmShape(seed: number): Shape {
  const random = seeded(seed);
  const lean = 0.6 + random() * 0.9;
  const height = 8.5 + random() * 2;
  const curve = new THREE.QuadraticBezierCurve3(v3(0, -0.3, 0), v3(lean * 0.2, height * 0.55, 0), v3(lean, height, 0));
  const wood: THREE.BufferGeometry[] = [];
  const segments = 10;
  for (let i = 0; i < segments; i++) {
    const a = curve.getPoint(i / segments);
    const b = curve.getPoint((i + 1) / segments);
    // Cada gomo um pouco mais largo embaixo: os anéis do coqueiro.
    wood.push(paint(limb(a, b, 0.24 - i * 0.008, 0.2 - i * 0.008, 8), i % 2 ? "#8a7458" : "#7d6a52"));
  }
  const top = curve.getPoint(1);
  const fronds: THREE.BufferGeometry[] = [];
  const count = 9;
  for (let k = 0; k < count; k++) {
    // Folha: tira comprida que sai da coroa e cai em arco.
    const leaf = new THREE.PlaneGeometry(1.6, 4.8, 1, 8);
    leaf.rotateX(-Math.PI / 2);
    leaf.translate(0, 0, 2.4);
    const position = leaf.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const along = position.getZ(i) / 4.8;
      position.setY(i, 0.9 * along - 2.3 * along * along);
    }
    leaf.rotateX(-0.15 - random() * 0.25);
    leaf.rotateY((k / count) * Math.PI * 2 + random() * 0.3);
    leaf.translate(top.x, top.y, top.z);
    fronds.push(leaf);
  }
  // Os cocos.
  const coconuts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const angle = (k / 4) * Math.PI * 2;
    coconuts.push(paint(new THREE.SphereGeometry(0.17, 8, 6).translate(top.x + Math.cos(angle) * 0.22, top.y - 0.25, top.z + Math.sin(angle) * 0.22), "#5e5a2a"));
  }
  const frondGeometry = mergeGeometries(fronds);
  frondGeometry.computeVertexNormals();
  return { wood: mergeGeometries([...wood, ...coconuts]), fronds: frondGeometry };
}

/** Araucária: tronco reto e alto, galhos em andares formando a "taça" lá em cima. */
function araucariaShape(seed: number): Shape {
  const random = seeded(seed);
  const height = 13 + random() * 3;
  const wood: THREE.BufferGeometry[] = [paint(limb(v3(0, -0.3, 0), v3(0, height, 0), 0.38, 0.14, 8), "#5b4636")];
  const leaves: THREE.BufferGeometry[] = [];
  const tiers = 3;
  for (let t = 0; t < tiers; t++) {
    const y = height - 3.2 + t * 1.3;
    const reach = 3.6 - t * 0.9;
    const arms = 7 - t;
    for (let k = 0; k < arms; k++) {
      const angle = (k / arms) * Math.PI * 2 + t * 0.4;
      const tip = v3(Math.cos(angle) * reach, y + 0.9, Math.sin(angle) * reach);
      wood.push(paint(limb(v3(0, y, 0), tip, 0.09, 0.05, 5), "#5b4636"));
      // Na ponta de cada galho, o tufo achatado (a "bandeja" da araucária).
      leaves.push(paint(blob(1.05, 0.38, seed + t * 10 + k, 1).translate(tip.x, tip.y + 0.15, tip.z), "#ffffff", [y - 0.5, y + 1.5]));
    }
  }
  leaves.push(paint(blob(1.0, 0.5, seed + 99, 1).translate(0, height + 0.2, 0), "#ffffff"));
  return { wood: mergeGeometries(wood), leaves: mergeGeometries(leaves) };
}

/** Variações de cada espécie (montadas na primeira vez que alguém chega perto de uma árvore). */
let shapes: Record<Species, Shape[]> | null = null;
function getShapes() {
  shapes ??= {
    folhosa: [leafyShape(1), leafyShape(2), leafyShape(3)],
    ipe: [leafyShape(4), leafyShape(5)],
    coqueiro: [palmShape(6), palmShape(7)],
    araucaria: [araucariaShape(8), araucariaShape(9)],
  };
  // Compartilhadas por todos os blocos: a cena não descarta.
  for (const list of Object.values(shapes)) for (const shape of list) for (const g of [shape.wood, shape.leaves, shape.fronds]) if (g) g.userData.keep = true;
  return shapes;
}

// --- Versão de longe ----------------------------------------------------------

const farTrunk = new THREE.CylinderGeometry(0.22, 0.38, 1, 5).translate(0, 0.5, 0);
const farCrown = new THREE.IcosahedronGeometry(1, 1);
const farTrunkMaterial = new THREE.MeshLambertMaterial({ color: "#6b5440" });
const farCrownMaterial = surface(new THREE.MeshLambertMaterial({ color: "#ffffff" }), { roughness: 0.85 });

/** Tronco e copa simples de cada espécie: [altura do tronco, raio da copa, achatamento, altura da copa]. */
const FAR_FORM: Record<Species, [number, number, number, number]> = {
  folhosa: [3.4, 2.6, 0.8, 4.9],
  ipe: [3.4, 2.5, 0.8, 4.9],
  coqueiro: [9.5, 2.4, 0.35, 9.6],
  araucaria: [14, 3.4, 0.35, 13.6],
};

function farTile(items: Placed[]) {
  const trunks = new THREE.InstancedMesh(farTrunk, farTrunkMaterial, items.length);
  const crowns = new THREE.InstancedMesh(farCrown, farCrownMaterial, items.length);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  items.forEach((p, i) => {
    const s = p.tree.size;
    const [trunk, radius, squash, crownY] = FAR_FORM[p.species];
    const ground = heightAt(p.tree.x, p.tree.z) - 0.3;
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.turn);
    matrix.compose(new THREE.Vector3(p.tree.x, ground, p.tree.z), quat, new THREE.Vector3(s, trunk * s * p.stretch, s));
    trunks.setMatrixAt(i, matrix);
    matrix.compose(new THREE.Vector3(p.tree.x, ground + crownY * s * p.stretch, p.tree.z), quat, new THREE.Vector3(radius * s, radius * s * squash, radius * s));
    crowns.setMatrixAt(i, matrix);
    crowns.setColorAt(i, p.tint);
  });
  trunks.computeBoundingSphere();
  crowns.computeBoundingSphere();
  const group = new THREE.Group();
  group.add(trunks, crowns);
  return group;
}

// --- Versão de perto ----------------------------------------------------------

function nearTile(items: Placed[]) {
  const all = getShapes();
  const group = new THREE.Group();
  // Agrupa por forma: cada forma vira um InstancedMesh por material (tronco, copa, folhas).
  const byShape = new Map<Shape, Placed[]>();
  for (const p of items) {
    const variants = all[p.species];
    const shape = variants[Math.floor((p.turn / (Math.PI * 2)) * variants.length) % variants.length];
    let list = byShape.get(shape);
    if (!list) byShape.set(shape, (list = []));
    list.push(p);
  }
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const white = new THREE.Color("#ffffff");
  for (const [shape, list] of byShape) {
    const parts: [THREE.BufferGeometry, THREE.Material, boolean][] = [[shape.wood, barkMaterial, false]];
    if (shape.leaves) parts.push([shape.leaves, leafMaterial, true]);
    if (shape.fronds) parts.push([shape.fronds, frondMaterial, true]);
    for (const [geometry, material, tinted] of parts) {
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach((p, i) => {
        const s = p.tree.size;
        quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.turn);
        matrix.compose(new THREE.Vector3(p.tree.x, heightAt(p.tree.x, p.tree.z) - 0.3, p.tree.z), quat, new THREE.Vector3(s, s * p.stretch, s));
        mesh.setMatrixAt(i, matrix);
        // A cor da espécie tinge só as folhas (folhas do coqueiro já têm a cor na textura).
        mesh.setColorAt(i, tinted && material === leafMaterial ? p.tint : white);
      });
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  return group;
}

/** Todas as árvores da cidade, em blocos com dois níveis de detalhe. */
export function buildTrees(scene: THREE.Scene) {
  for (const tile of byTile(placeTrees(), (p) => [p.tree.x, p.tree.z], DETAIL_TILE)) {
    addLodChunk(scene, tile.center, DETAIL_TILE * 0.71 + 12, farTile(tile.items), () => nearTile(tile.items));
  }
}
