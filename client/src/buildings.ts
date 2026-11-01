// Prédios, casas, lojas, galpões e contêineres de Porto Gordo. A planta (onde
// fica cada um, de que tipo e tamanho) vem do shared/world.ts; aqui só se desenha.
//
// Dois níveis de detalhe por bloco de 200 m (chunks.ts): de longe, caixas
// instanciadas (uma malha por material no bloco); de perto, a versão
// detalhada, montada sob demanda por `build()` com o `Mesher` (houses.ts,
// commercial.ts). A cor principal e o tipo de telhado de cada lote são
// sorteados uma vez aqui, para as duas versões baterem.
import * as THREE from "three";
import { BUILDINGS, districtAt, heightAt, isOnRoad, seeded, type Building } from "@nfbmc/shared";

import { DETAIL_TILE, addLodChunk, byTile } from "./chunks.ts";
import { surface } from "./look.ts";
import { Mesher, rgb, shade, type Rgb } from "./mesher.ts";
import { buildingMaterials } from "./building-materials.ts";
import { pick, type Lot } from "./building-kit.ts";
import { MORRO_PAINT, NEUTRAL, PASTEL, RAW, STRONG, barn, farmHouse, genericHouse, jardimHouse, kiosk, mansion, morroHouse, vilaHouse } from "./houses.ts";
import { CLADDING, CONTAINERS, OFFICE_WALLS, SHOP_WALLS, TOWER_TINTS, containers, office, shop, tower, warehouse } from "./commercial.ts";

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

// --- Lotes ------------------------------------------------------------------------------

/** Tudo que se sabe de um prédio antes de desenhar (as duas versões usam). */
interface Prepared {
  b: Building;
  index: number;
  district: string;
  /** Referencial: centro no chão, girado para a rua ficar em +z. */
  x: number;
  y: number;
  z: number;
  angle: number;
  floor: number;
  base: number;
  tone: Rgb;
  finish: string;
  pitched: boolean;
}

/** Cor média da textura de tijolo/telha (para a caixa de longe parecer a de perto). */
const BRICK_LOOK = rgb("#b8693e");
const TILE_LOOK = rgb("#9a5236");

/** Sorteia a cor principal, o acabamento e o telhado do lote (semente do lote). */
function character(b: Building, district: string, random: () => number): { tone: Rgb; finish: string; pitched: boolean } {
  const c = (list: readonly string[], spread = 0.08) => shade(rgb(pick(random, list)), 1 - spread + random() * spread * 2);
  switch (b.kind) {
    case "house":
      switch (district) {
        case "vila":
          return { tone: c(random() < 0.7 ? STRONG : PASTEL), finish: "paint", pitched: random() < 0.45 };
        case "jardim":
          return { tone: c(PASTEL), finish: "paint", pitched: random() < 0.82 };
        case "morro": {
          const roll = random();
          if (roll < 0.38) return { tone: BRICK_LOOK, finish: "brick", pitched: false };
          if (roll < 0.68) return { tone: c(RAW, 0.06), finish: "raw", pitched: false };
          return { tone: c(MORRO_PAINT, 0.1), finish: "paint", pitched: false };
        }
        case "picanha": {
          const classic = random() < 0.45;
          return { tone: classic ? c(["#f1e3c6", "#efe8dc", "#e8d5b7", "#f5f3ee", "#e3d5ca", "#d7e3ef"], 0.04) : c(NEUTRAL.slice(0, 4), 0.03), finish: "paint", pitched: classic };
        }
        case "roca":
          return { tone: c(["#f7f3ea", "#f1e3c6", "#fdf0d5", "#f4e1b8", "#e9c46a"], 0.04), finish: "paint", pitched: true };
        default:
          return { tone: c(PASTEL), finish: "paint", pitched: random() < 0.8 };
      }
    case "shop":
      if (district === "praia") return { tone: c(["#ffd23f", "#ff6b35", "#2a9d8f", "#e63946", "#4ea8de", "#f1faee"], 0.05), finish: "paint", pitched: true };
      return { tone: c(SHOP_WALLS, 0.05), finish: "paint", pitched: false };
    case "office":
      return { tone: c(OFFICE_WALLS, 0.05), finish: "paint", pitched: false };
    case "tower":
      return { tone: c(TOWER_TINTS, 0.06), finish: "glass", pitched: false };
    case "warehouse":
      if (district === "roca") return { tone: c(["#9b2226", "#8a1c1c", "#a4302a", "#7d2a1d"], 0.06), finish: "wood", pitched: true };
      return { tone: c(CLADDING, 0.05), finish: "metal", pitched: false };
    case "container":
      return { tone: c(CONTAINERS, 0.08), finish: "metal", pitched: false };
  }
}

function prepare(b: Building, index: number): Prepared {
  const ground = heightAt(b.x, b.z);
  // Os quatro cantos: o piso fica no canto mais alto e a fundação desce até o mais baixo.
  const ux = Math.cos(b.angle) * (b.w / 2);
  const uz = -Math.sin(b.angle) * (b.w / 2);
  const vx = Math.sin(b.angle) * (b.d / 2);
  const vz = Math.cos(b.angle) * (b.d / 2);
  let high = -Infinity;
  let low = Infinity;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const h = heightAt(b.x + ux * sx + vx * sz, b.z + uz * sx + vz * sz) - ground;
    high = Math.max(high, h);
    low = Math.min(low, h);
  }
  const district = districtAt(b.x, b.z);
  const lift = b.kind === "house" ? 0.15 : b.kind === "container" ? 0 : 0.05;
  const random = seeded(index * 7919 + 101);
  random();
  return {
    b,
    index,
    district,
    x: b.x,
    y: ground,
    z: b.z,
    angle: b.angle + (b.front < 0 ? Math.PI : 0),
    floor: Math.max(0, high) + lift,
    base: low - 0.4,
    ...character(b, district, random),
  };
}

// --- Versão detalhada (de perto) ----------------------------------------------------------

type Draw = (L: Lot) => void;

function drawerFor(p: Prepared): Draw {
  switch (p.b.kind) {
    case "container":
      return containers;
    case "tower":
      return tower;
    case "office":
      return office;
    case "warehouse":
      return p.district === "roca" ? barn : warehouse;
    case "shop":
      return p.district === "praia" ? kiosk : shop;
    case "house":
      switch (p.district) {
        case "vila":
          return vilaHouse;
        case "jardim":
          return jardimHouse;
        case "morro":
          return morroHouse;
        case "picanha":
          return mansion;
        case "roca":
          return farmHouse;
        default:
          return genericHouse;
      }
  }
}

/** Estatística da última montagem (para medir). */
export const detailStats = { builds: 0, lastMs: 0, maxMs: 0, lastTriangles: 0, maxTriangles: 0 };

/** Monta a versão detalhada de uma lista de lotes (um bloco). Sempre dá o mesmo resultado. */
export function buildDetail(lots: readonly Prepared[]) {
  const started = performance.now();
  const m = new Mesher(buildingMaterials());
  for (const p of lots) {
    m.setFrame(p.x, p.y, p.z, p.angle);
    const c = Math.cos(p.angle);
    const s = Math.sin(p.angle);
    const lot: Lot = {
      m,
      random: seeded(p.index * 104729 + 7),
      w: p.b.w,
      d: p.b.d,
      height: p.b.height,
      floor: p.floor,
      base: p.base,
      groundY: p.y,
      district: p.district,
      tint: p.b.tint,
      tone: p.tone,
      finish: p.finish,
      pitched: p.pitched,
      clear: (x, z) => !isOnRoad(p.x + x * c + z * s, p.z - x * s + z * c),
    };
    lot.random();
    drawerFor(p)(lot);
  }
  const triangles = m.triangles();
  const group = m.finish("predios-detalhe");
  const ms = performance.now() - started;
  group.userData.buildMs = ms;
  group.userData.triangles = triangles;
  detailStats.builds++;
  detailStats.lastMs = ms;
  detailStats.maxMs = Math.max(detailStats.maxMs, ms);
  detailStats.lastTriangles = triangles;
  detailStats.maxTriangles = Math.max(detailStats.maxTriangles, triangles);
  return group;
}

// --- Versão simples (de longe) --------------------------------------------------------------

let farCache: { windowed: THREE.Material; plain: THREE.Material; roof: THREE.Material; roofGeometry: THREE.BufferGeometry } | null = null;

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

function farMaterials() {
  if (farCache) return farCache;
  const windowed = surface(buildingMaterial("#ffffff"), { roughness: 0.6, metalness: 0.2 });
  const plain = surface(new THREE.MeshLambertMaterial({ color: "#ffffff" }), { roughness: 0.9 });
  const roof = surface(new THREE.MeshLambertMaterial({ color: "#ffffff" }), { roughness: 0.8 });
  farCache = { windowed, plain, roof, roofGeometry: roofGeometry() };
  return farCache;
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);

interface Instance {
  matrix: THREE.Matrix4;
  color: THREE.Color;
}

const instanced = (material: THREE.Material, list: Instance[], geometry: THREE.BufferGeometry = unitBox) => {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, list.length));
  list.forEach(({ matrix, color }, i) => {
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, color);
  });
  mesh.count = list.length;
  mesh.computeBoundingSphere();
  return mesh;
};

const quat = new THREE.Quaternion();

/** Matriz de uma caixa girada do lote, de y0 a y1 (mundo). */
function boxMatrix(p: Prepared, y0: number, y1: number, w = p.b.w, d = p.b.d) {
  quat.setFromAxisAngle(Y, p.b.angle);
  return new THREE.Matrix4().compose(new THREE.Vector3(p.x, (y0 + y1) / 2, p.z), quat, new THREE.Vector3(w, y1 - y0, d));
}

const toColor = (c: Rgb) => new THREE.Color(c[0], c[1], c[2]);

/** Caixas de longe de um bloco: corpo (com janelas nos prédios), telhado das casas, toldos. */
function buildFar(lots: readonly Prepared[]) {
  const { windowed, plain, roof, roofGeometry } = farMaterials();
  const win: Instance[] = [];
  const flat: Instance[] = [];
  const roofs: Instance[] = [];
  for (const p of lots) {
    const { b } = p;
    const floor = p.y + p.floor;
    const base = p.y + p.base;
    const color = toColor(p.tone);
    switch (b.kind) {
      case "tower":
      case "office":
        win.push({ matrix: boxMatrix(p, base, floor + b.height), color });
        break;
      case "shop":
        if (p.district === "praia") {
          flat.push({ matrix: boxMatrix(p, base, floor + 2.7, b.w - 0.6, b.d - 0.6), color });
          roofs.push({ matrix: new THREE.Matrix4().compose(new THREE.Vector3(p.x, floor + 2.7, p.z), quat.setFromAxisAngle(Y, b.angle), new THREE.Vector3(b.w + 1, 2, b.d + 1)), color: toColor(TILE_LOOK) });
        } else win.push({ matrix: boxMatrix(p, base, floor + b.height), color });
        break;
      case "house":
      case "warehouse": {
        const top = b.kind === "house" && p.district === "roca" ? floor + Math.max(3, b.height * 0.7) : floor + b.height * (b.kind === "warehouse" && p.district === "roca" ? 0.55 : 1);
        flat.push({ matrix: boxMatrix(p, base, top, b.w - 0.3, b.d - 0.3), color });
        if (p.pitched) {
          const rise = b.kind === "warehouse" ? b.w * 0.44 : Math.min(b.w, b.d) * 0.28;
          roofs.push({
            matrix: new THREE.Matrix4().compose(new THREE.Vector3(p.x, top, p.z), quat.setFromAxisAngle(Y, b.angle), new THREE.Vector3(b.w + 0.8, rise, b.d + 0.8)),
            color: b.kind === "warehouse" ? toColor(rgb("#6a6f73")) : toColor(TILE_LOOK),
          });
        }
        break;
      }
      case "container": {
        const levels = Math.max(1, Math.round(b.height / 2.6));
        for (let f = 0; f < levels; f++) flat.push({ matrix: boxMatrix(p, floor + f * 2.6, floor + f * 2.6 + 2.5), color: f === 0 ? color : toColor(shade(p.tone, 0.8 + 0.1 * f)) });
        break;
      }
    }
  }
  const group = new THREE.Group();
  group.name = "predios-longe";
  if (win.length) group.add(instanced(windowed, win));
  if (flat.length) group.add(instanced(plain, flat));
  if (roofs.length) group.add(instanced(roof, roofs, roofGeometry));
  return group;
}

export function buildBuildings(scene: THREE.Scene) {
  const prepared = BUILDINGS.map(prepare);
  // Os materiais (e texturas) da versão detalhada são criados agora, uma vez só.
  buildingMaterials();
  for (const tile of byTile(prepared, (p) => [p.x, p.z], DETAIL_TILE)) {
    const lots = tile.items;
    addLodChunk(scene, tile.center, DETAIL_TILE * 0.71 + 40, buildFar(lots), () => buildDetail(lots));
  }
}

