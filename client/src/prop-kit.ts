// Ferramentas para montar enfeites grandes (boxes do autódromo, caminhões,
// navios, guindastes) com formas simples e poucas chamadas de desenho: cada
// peça leva a cor gravada nos vértices e, no fim, tudo é juntado numa malha
// por material (`merge`).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { surface } from "./look.ts";

/** Tinta comum (cor por vértice). */
export const paint = surface(new THREE.MeshLambertMaterial({ vertexColors: true }), { roughness: 0.75 });
/** Tinta de metal (lataria, cascos, guindastes). */
export const metal = surface(new THREE.MeshLambertMaterial({ vertexColors: true }), { roughness: 0.42, metalness: 0.45 });
/** Luzes (brilham no visual realista). */
export const glowPaint = surface(new THREE.MeshBasicMaterial({ vertexColors: true }), { glow: 2.2 });
/** Vidro escuro com reflexo do céu. */
export const glass = surface(new THREE.MeshLambertMaterial({ color: "#26394a", emissive: "#ffb070", emissiveIntensity: 0.12 }), {
  roughness: 0.08, metalness: 0.2, envMapIntensity: 1.4,
});
const COLORED = new Set<THREE.Material>([paint, metal, glowPaint]);

/** Cor (tinta), { metal } (tinta de metal), { glow } (luz) ou um material próprio. */
export type Look = string | { metal: string } | { glow: string } | THREE.Material;

export function put(parent: THREE.Object3D, geometry: THREE.BufferGeometry, look: Look, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
  let material: THREE.Material;
  let color: string | undefined;
  if (typeof look === "string") {
    material = paint;
    color = look;
  } else if (look instanceof THREE.Material) {
    material = look;
  } else if ("metal" in look) {
    material = metal;
    color = look.metal;
  } else {
    material = glowPaint;
    color = look.glow;
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  if (color) mesh.userData.color = color;
  parent.add(mesh);
  return mesh;
}

/** Caixa com a base em `y` (não o centro). */
export const box = (parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, look: Look, ry = 0) =>
  put(parent, new THREE.BoxGeometry(w, h, d), look, x, y + h / 2, z, ry);

/** Cilindro em pé com a base em `y`. */
export const cylinder = (parent: THREE.Object3D, r: number, h: number, x: number, y: number, z: number, look: Look, segments = 10, top = r) =>
  put(parent, new THREE.CylinderGeometry(top, r, h, segments), look, x, y + h / 2, z);

/** Barra (cilindro fino) de `a` a `b`. */
export function bar(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, look: Look, segments = 6) {
  const length = a.distanceTo(b);
  const geometry = new THREE.CylinderGeometry(r, r, length, segments).translate(0, length / 2, 0);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  return put(parent, geometry.translate(a.x, a.y, a.z), look);
}

/** Viga de seção quadrada de `a` a `b`. */
export function beam(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, size: number, look: Look) {
  const length = a.distanceTo(b);
  const geometry = new THREE.BoxGeometry(size, length, size).translate(0, length / 2, 0);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  return put(parent, geometry.translate(a.x, a.y, a.z), look);
}

/** Multiplica o UV (para a textura repetir na escala certa). */
export function scaleUv(geometry: THREE.BufferGeometry, u: number, v = 1) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
  return geometry;
}

/**
 * Junta as peças (já no lugar) numa malha por material, nas coordenadas de
 * `root` (o que estiver acima dele não entra). Malhas instanciadas e
 * outros objetos especiais passam inteiros (marcados com `userData.keep`).
 */
export function merge(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const kept: THREE.Object3D[] = [];
  const color = new THREE.Color();
  const matrix = new THREE.Matrix4();
  root.traverse((object) => {
    if (object.userData.keep) {
      kept.push(object);
      return;
    }
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh || hasKeptAncestor(mesh, root)) return;
    const material = mesh.material as THREE.Material;
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(matrix.multiplyMatrices(inverse, mesh.matrixWorld));
    const keep = COLORED.has(material) ? ["position", "normal", "uv", "color"] : ["position", "normal", "uv"];
    for (const name of Object.keys(geometry.attributes)) if (!keep.includes(name)) geometry.deleteAttribute(name);
    const positions = geometry.attributes.position as THREE.BufferAttribute;
    if (!geometry.attributes.uv) geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(positions.count * 2), 2));
    if (COLORED.has(material)) {
      if (!geometry.attributes.color) {
        color.set(mesh.userData.color ?? "#ffffff");
        const colors = new Float32Array(positions.count * 3);
        for (let i = 0; i < positions.count; i++) colors.set([color.r, color.g, color.b], i * 3);
        geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      }
    }
    let list = byMaterial.get(material);
    if (!list) byMaterial.set(material, (list = []));
    list.push(geometry);
  });
  const group = new THREE.Group();
  for (const [material, parts] of byMaterial) {
    const mesh = new THREE.Mesh(mergeGeometries(parts), material);
    mesh.geometry.computeBoundingSphere();
    group.add(mesh);
  }
  for (const object of kept) {
    // Leva o objeto (com a posição no mundo) para dentro do grupo novo.
    object.updateMatrixWorld(true);
    const local = new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld);
    object.removeFromParent();
    local.decompose(object.position, object.quaternion, object.scale);
    group.add(object);
  }
  return group;
}

function hasKeptAncestor(object: THREE.Object3D, root: THREE.Object3D) {
  for (let o = object.parent; o && o !== root; o = o.parent) if (o.userData.keep) return true;
  return false;
}
