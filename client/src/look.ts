// Visual do jogo: "realista" (materiais físicos, reflexo do céu, sombras
// suaves) ou "quadrinho" (cel-shading com contorno de tinta, o visual antigo).
//
// Tudo é criado com MeshLambertMaterial (o material "de autoria"); a cena troca
// pelo material do visual escolhido na hora de desenhar, guardando o original
// em `mesh.userData.base` para poder trocar de novo. O que é especial no
// visual realista (aspereza, metal, verniz, relevo) vai junto do Lambert por
// `surface(material, {...})`; o quadrinho e a qualidade baixa ignoram.
// MeshBasicMaterial (luzes, neon) não muda, mas `surface(..., { glow })` deixa a
// cor mais forte no realista, para acender o brilho (bloom).
import * as THREE from "three";

import { toonMaterial } from "./toon.ts";

export type Look = "realista" | "quadrinho";

export interface Surface {
  /** 0 = espelho, 1 = fosco (padrão 0,85). */
  roughness?: number;
  /** 0 = não metal (padrão), 1 = metal (cromado, alumínio). */
  metalness?: number;
  /** Verniz por cima (pintura de carro): 0 a 1. */
  clearcoat?: number;
  clearcoatRoughness?: number;
  /** Quanto o reflexo do céu aparece (padrão 1). */
  envMapIntensity?: number;
  normalMap?: THREE.Texture;
  /** Força do relevo do normal map (padrão 1). */
  normalScale?: number;
  roughnessMap?: THREE.Texture;
  /** Só MeshBasicMaterial: multiplica a cor no realista (acima de 1 brilha no bloom). */
  glow?: number;
}

/** Marca o que um material tem de especial no visual realista. Devolve o próprio material. */
export function surface<M extends THREE.Material>(material: M, spec: Surface): M {
  material.userData.surface = spec;
  return material;
}

const realCache = new WeakMap<THREE.Material, THREE.Material>();

/** Lambert → Standard (ou Physical, se tiver verniz), com as mesmas cores e texturas. */
function realMaterial(material: THREE.Material): THREE.Material {
  const cached = realCache.get(material);
  if (cached) return cached;
  const spec = (material.userData.surface ?? {}) as Surface;
  let result: THREE.Material = material;
  if (material instanceof THREE.MeshLambertMaterial) {
    const params: THREE.MeshPhysicalMaterialParameters = {
      color: material.color,
      map: material.map,
      emissive: material.emissive,
      emissiveMap: material.emissiveMap,
      emissiveIntensity: material.emissiveIntensity,
      vertexColors: material.vertexColors,
      transparent: material.transparent,
      opacity: material.opacity,
      side: material.side,
      fog: material.fog,
      depthWrite: material.depthWrite,
      alphaTest: material.alphaTest,
      flatShading: material.flatShading,
      polygonOffset: material.polygonOffset,
      polygonOffsetFactor: material.polygonOffsetFactor,
      polygonOffsetUnits: material.polygonOffsetUnits,
      roughness: spec.roughness ?? 0.85,
      metalness: spec.metalness ?? 0,
      envMapIntensity: spec.envMapIntensity ?? 1,
      normalMap: spec.normalMap ?? null,
      roughnessMap: spec.roughnessMap ?? null,
    };
    if (spec.normalMap) params.normalScale = new THREE.Vector2(spec.normalScale ?? 1, spec.normalScale ?? 1);
    if (spec.clearcoat) {
      params.clearcoat = spec.clearcoat;
      params.clearcoatRoughness = spec.clearcoatRoughness ?? 0.08;
      result = new THREE.MeshPhysicalMaterial(params);
    } else {
      delete params.clearcoat;
      result = new THREE.MeshStandardMaterial(params);
    }
    result.name = material.name;
  } else if (material instanceof THREE.MeshBasicMaterial && spec.glow) {
    const glow = material.clone();
    glow.color.multiplyScalar(spec.glow);
    result = glow;
  }
  realCache.set(material, result);
  return result;
}

/**
 * Aplica o visual em tudo dentro de `root`. `simple` (qualidade baixa no
 * realista) deixa o Lambert como está, que é o mais leve.
 */
export function applyLook(root: THREE.Object3D, look: Look, simple = false) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh && !(object as THREE.Points).isPoints) return;
    const base = (mesh.userData.base ??= mesh.material) as THREE.Material | THREE.Material[];
    const convert = (m: THREE.Material) => (look === "quadrinho" ? toonMaterial(m) : simple ? m : realMaterial(m));
    mesh.material = Array.isArray(base) ? base.map(convert) : convert(base);
  });
}
