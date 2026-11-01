// Blocos da cidade: tudo que é espalhado pelo mapa (prédios, árvores, postes,
// ruas) é dividido em blocos, e a cena só desenha os perto da câmera (o resto
// está escondido na neblina de qualquer jeito). Alguns blocos têm dois níveis
// de detalhe: a versão simples (caixas) de longe e a detalhada de perto, que
// só é montada quando a câmera chega perto pela primeira vez.
import * as THREE from "three";

/** Tamanho (m) dos blocos comuns. */
export const TILE = 400;
/** Tamanho (m) dos blocos com nível de detalhe (menores: a troca acontece mais perto). */
export const DETAIL_TILE = 200;

/** Blocos comuns: a cena esconde os que estão além da neblina. `userData.center` e `userData.radius`. */
export const CHUNKS: THREE.Object3D[] = [];

export interface LodChunk {
  center: [number, number];
  /** Até onde o conteúdo vai, a partir do centro. */
  radius: number;
  /** Versão simples (de longe). Pode ser null (nada de longe). */
  far: THREE.Object3D | null;
  /** Versão detalhada, montada na primeira vez que a câmera chega perto. */
  near: THREE.Object3D | null;
  build: () => THREE.Object3D;
  /** Grupo na cena que segura as duas versões. */
  group: THREE.Group;
}

/** Blocos com nível de detalhe (a cena troca a versão conforme a distância e a qualidade). */
export const LOD_CHUNKS: LodChunk[] = [];

/** Agrupa itens por bloco de `size` metros. */
export function byTile<T>(items: T[], position: (item: T) => [number, number], size = TILE) {
  const tiles = new Map<string, { center: [number, number]; items: T[] }>();
  for (const item of items) {
    const [x, z] = position(item);
    const tx = Math.floor(x / size);
    const tz = Math.floor(z / size);
    const key = `${tx},${tz}`;
    let tile = tiles.get(key);
    if (!tile) tiles.set(key, (tile = { center: [(tx + 0.5) * size, (tz + 0.5) * size], items: [] }));
    tile.items.push(item);
  }
  return [...tiles.values()];
}

/**
 * Põe na cena um objeto que pertence a um bloco (a cena esconde quando está
 * longe). `radius`: até onde o conteúdo vai, a partir do centro (padrão: o
 * canto do bloco, com folga para um galpão grande).
 */
export function addChunk(scene: THREE.Scene, object: THREE.Object3D, center: [number, number], radius = TILE * 0.71 + 40) {
  object.userData.center = center;
  object.userData.radius = radius;
  CHUNKS.push(object);
  scene.add(object);
}

/**
 * Bloco com dois níveis de detalhe: `far` já entra na cena; `build` monta a
 * versão detalhada sob demanda (a cena chama no máximo uma por quadro, para
 * não travar). Os dois ficam escondidos além da neblina, como os comuns.
 */
export function addLodChunk(scene: THREE.Scene, center: [number, number], radius: number, far: THREE.Object3D | null, build: () => THREE.Object3D) {
  const group = new THREE.Group();
  if (far) group.add(far);
  scene.add(group);
  LOD_CHUNKS.push({ center, radius, far, near: null, build, group });
}
