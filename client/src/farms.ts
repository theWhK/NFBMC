// O campo de Porto Gordo (Roça do Milho e Serra do Açúcar): lavouras em
// fileiras (milho, cana, girassol, terra arada), pastos, terreiros, cercas de
// madeira e de arame, cercas vivas, moitas, capim alto e, nas fazendas, casa,
// celeiro, silos, caixa-d'água, porteira com o nome, galinheiro e cocho. A
// planta (onde fica cada fazenda, cerca e cercado) vem de shared/rural.ts;
// aqui só se desenha.
//
// O chão, as lavouras, as cercas, o mato e os bichos ficam em blocos comuns
// (aparecem em qualquer qualidade); as construções têm dois níveis de detalhe
// (caixas de longe, a versão com o `Mesher` de perto).
import * as THREE from "three";
import { FARMS, FENCES, districtAt, heightAt, insideBuilding, pointInFootprint, roadClearance, seeded, toWorld, type Farm, type FenceLine } from "@nfbmc/shared";

import { DETAIL_TILE, TILE, addChunk, addLodChunk, byTile } from "./chunks.ts";
import { surface } from "./look.ts";
import { BOX, Mesher, rgb, shade, mix, type Rgb } from "./mesher.ts";
import { M, buildingMaterials } from "./building-materials.ts";
import { pick, type Lot } from "./building-kit.ts";
import { barn, farmHouse } from "./houses.ts";
import { normalTexture, paintedTexture } from "./textures.ts";
import { buildAnimals } from "./animals.ts";

// --- Materiais ------------------------------------------------------------------------

/** Índices dos materiais do campo no `Mesher` (depois dos dos prédios). */
const R = { soil: 10, grass: 11, dirt: 12, crops: 13, wire: 14, sign: 15 } as const;

/** Lavouras no atlas (de cima para baixo): milho, cana, girassol. Cada quadro = 6 m de fileira. */
const CROP_ROW = { milho: 0, cana: 1, girassol: 2 } as const;
const CROP_HEIGHT = { milho: 2.3, cana: 3.1, girassol: 1.9 } as const;
const CROP_SPACING = { milho: 1.5, cana: 1.7, girassol: 1.3, arado: 1.1 } as const;
const PIECE = 6;

const cropAtlas = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 384;
  const ctx = canvas.getContext("2d")!;
  const random = seeded(808);
  const h = 128;
  // Milho: pés de ~25 cm de distância, folhas compridas caindo, pendão em cima e espiga.
  for (let i = 0; i < 26; i++) {
    const x = (i + 0.5) * (256 / 26) + (random() - 0.5) * 4;
    const top = 8 + random() * 14;
    const g = 120 + Math.floor(random() * 50);
    ctx.strokeStyle = `rgb(${70 + random() * 30},${g},${40 + random() * 20})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.lineTo(x + (random() - 0.5) * 3, top);
    ctx.stroke();
    for (let k = 0; k < 6; k++) {
      const y = h - 18 - k * ((h - top - 18) / 6);
      const side = k % 2 ? 1 : -1;
      ctx.strokeStyle = `rgb(${60 + random() * 40},${g + random() * 30 - 15},${35 + random() * 20})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + side * 10, y - 10, x + side * (16 + random() * 8), y + 4 + random() * 8);
      ctx.stroke();
    }
    // Pendão (dourado) e espiga com cabelo.
    ctx.strokeStyle = "#d8b45a";
    ctx.lineWidth = 1.2;
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath();
      ctx.moveTo(x, top + 4);
      ctx.lineTo(x + k * 2.5, top - 6);
      ctx.stroke();
    }
    ctx.fillStyle = "#c9b45c";
    ctx.fillRect(x + 1, h * 0.52, 4, 12);
  }
  // Cana: colmos finos e densos, folhas compridas arqueadas, mais clara em cima.
  for (let i = 0; i < 60; i++) {
    const x = random() * 256;
    const top = h + 6 + random() * 18;
    ctx.strokeStyle = `rgb(${110 + random() * 40},${130 + random() * 30},${60 + random() * 20})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, 2 * h);
    ctx.lineTo(x + (random() - 0.5) * 6, top + 20);
    ctx.stroke();
  }
  for (let i = 0; i < 140; i++) {
    const x = random() * 256;
    const y = h + 8 + random() * 70;
    const side = random() < 0.5 ? -1 : 1;
    const g = 120 + Math.floor(random() * 70);
    ctx.strokeStyle = `rgb(${50 + random() * 50},${g},${30 + random() * 20})`;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(x, y + 18);
    ctx.quadraticCurveTo(x + side * 12, y - 6, x + side * (22 + random() * 14), y + 14 + random() * 20);
    ctx.stroke();
  }
  // Girassol: caule, folhas largas e a flor virada para o sol.
  for (let i = 0; i < 20; i++) {
    const x = (i + 0.5) * (256 / 20) + (random() - 0.5) * 5;
    const top = 2 * h + 18 + random() * 16;
    ctx.strokeStyle = "#5d8a2e";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 3 * h);
    ctx.lineTo(x, top);
    ctx.stroke();
    ctx.fillStyle = "#4f7f2a";
    for (let k = 0; k < 3; k++) {
      const y = 3 * h - 22 - k * 24;
      ctx.beginPath();
      ctx.ellipse(x + (k % 2 ? 7 : -7), y, 8, 5, k % 2 ? 0.5 : -0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#f6c21c";
    ctx.beginPath();
    ctx.arc(x, top, 8 + random() * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#5a3a1a";
    ctx.beginPath();
    ctx.arc(x, top, 3.6, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
};

/** Terra arada: sulcos (uma fileira por quadro, ao longo de u) e torrões. */
const soilPainter = (ctx: CanvasRenderingContext2D, size: number, random: () => number) => {
  for (let y = 0; y < size; y++) {
    const t = y / size;
    const ridge = Math.sin(t * Math.PI);
    const l = 22 + ridge * 16;
    ctx.fillStyle = `hsl(24, 38%, ${l}%)`;
    ctx.fillRect(0, y, size, 1);
  }
  for (let i = 0; i < 260; i++) {
    const v = random() < 0.5 ? "rgba(60,35,20,0.35)" : "rgba(170,120,80,0.25)";
    ctx.fillStyle = v;
    ctx.fillRect(random() * size, random() * size, 1 + random() * 3, 1 + random() * 2);
  }
};

/** Pasto: capim em tufos, manchas mais secas. */
const grassPainter = (ctx: CanvasRenderingContext2D, size: number, random: () => number) => {
  ctx.fillStyle = "#d9d9c9";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = 8 + random() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dry = random() < 0.4;
    g.addColorStop(0, dry ? "rgba(235,215,150,0.5)" : "rgba(150,170,120,0.45)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 900; i++) {
    const v = 150 + random() * 100;
    ctx.strokeStyle = `rgba(${v * 0.9},${v},${v * 0.7},0.6)`;
    ctx.lineWidth = 1;
    const x = random() * size;
    const y = random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (random() - 0.5) * 3, y - 3 - random() * 4);
    ctx.stroke();
  }
};

/** Terra batida do terreiro: marcas de pneu e pedrisco. */
const dirtPainter = (ctx: CanvasRenderingContext2D, size: number, random: () => number) => {
  ctx.fillStyle = "#e8d3b8";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 50; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = 6 + random() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, random() < 0.5 ? "rgba(150,110,80,0.25)" : "rgba(255,240,220,0.25)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 500; i++) {
    const v = 120 + random() * 120;
    ctx.fillStyle = `rgba(${v},${v * 0.85},${v * 0.7},0.5)`;
    ctx.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2);
  }
};

const heightNoise = (ctx: CanvasRenderingContext2D, size: number, random: () => number) => {
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 400; i++) {
    const v = Math.floor(random() * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
    ctx.fillRect(random() * size, random() * size, 1 + random() * 3, 1 + random() * 3);
  }
};

/** Placas das porteiras: o nome de cada fazenda queimado na tábua (uma linha por fazenda). */
const SIGN_ROWS = 24;
function signAtlas() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = SIGN_ROWS * 48;
  const ctx = canvas.getContext("2d")!;
  const random = seeded(919);
  for (let i = 0; i < SIGN_ROWS; i++) {
    const y = i * 48;
    ctx.fillStyle = `hsl(28, ${30 + random() * 15}%, ${38 + random() * 10}%)`;
    ctx.fillRect(0, y, 512, 48);
    for (let k = 0; k < 30; k++) {
      ctx.fillStyle = `rgba(60,35,15,${0.1 + random() * 0.2})`;
      ctx.fillRect(0, y + random() * 48, 512, 1);
    }
    ctx.strokeStyle = "rgba(40,20,10,0.8)";
    ctx.lineWidth = 3;
    ctx.strokeRect(2, y + 2, 508, 44);
    const farm = FARMS[i];
    if (!farm) continue;
    ctx.fillStyle = "#2a160a";
    ctx.font = "bold 30px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(farm.name.toUpperCase(), 256, y + 26, 490);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

let materials: THREE.Material[] | null = null;
/** Materiais dos prédios (0..9) + os do campo (`R`). Criados uma vez. */
function ruralMaterials() {
  if (materials) return materials;
  const offset = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };
  const repeat = (t: THREE.Texture, u: number, v: number) => {
    t.repeat.set(1 / u, 1 / v);
    return t;
  };
  const soil = surface(new THREE.MeshLambertMaterial({ vertexColors: true, map: paintedTexture(128, soilPainter, 501), ...offset }), {
    roughness: 0.97, normalMap: normalTexture(128, soilPainter, 501, 3), normalScale: 0.8,
  });
  const grass = surface(new THREE.MeshLambertMaterial({ vertexColors: true, map: repeat(paintedTexture(256, grassPainter, 502), 7, 7), ...offset }), {
    roughness: 0.95,
  });
  const dirt = surface(new THREE.MeshLambertMaterial({ vertexColors: true, map: repeat(paintedTexture(256, dirtPainter, 503), 9, 9), ...offset }), {
    roughness: 0.95, normalMap: repeat(normalTexture(128, heightNoise, 504, 2), 3, 3), normalScale: 0.5,
  });
  const crops = surface(new THREE.MeshLambertMaterial({ vertexColors: true, map: cropAtlas(), alphaTest: 0.45, side: THREE.DoubleSide }), { roughness: 0.8 });
  const wire = new THREE.MeshLambertMaterial({ color: "#4a4a48", side: THREE.DoubleSide });
  const sign = surface(new THREE.MeshLambertMaterial({ map: signAtlas() }), { roughness: 0.9 });
  materials = [...buildingMaterials(), soil, grass, dirt, crops, wire, sign];
  return materials;
}

// --- Chão, lavouras e cercas (blocos comuns) ---------------------------------------------

/** Quadrilátero no chão (pontos do mundo no sentido de u, n), virado para cima, seguindo o relevo. */
function groundPatch(m: Mesher, mat: number, col: Rgb, farm: Farm, u0: number, u1: number, n0: number, n1: number, su: number, sn: number, lift = -0.12, step = 10) {
  const nu = Math.max(1, Math.ceil((u1 - u0) / step));
  const nn = Math.max(1, Math.ceil((n1 - n0) / step));
  const f = farm.frame;
  // u × n aponta para cima ou para baixo, conforme a orientação do referencial.
  const up = f.uz * f.nx - f.ux * f.nz > 0;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nn; j++) {
      const ua = u0 + ((u1 - u0) * i) / nu;
      const ub = u0 + ((u1 - u0) * (i + 1)) / nu;
      const na = n0 + ((n1 - n0) * j) / nn;
      const nb = n0 + ((n1 - n0) * (j + 1)) / nn;
      const p = (u: number, n: number) => {
        const [x, z] = toWorld(f, u, n);
        return [x, heightAt(x, z) + lift, z] as const;
      };
      const a = p(ua, na);
      const b = p(ub, na);
      const c = p(ub, nb);
      const d = p(ua, nb);
      const uv = [ua / su, na / sn, ub / su, nb / sn];
      if (up) m.quad(mat, col, a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2], uv);
      else m.quad(mat, col, d[0], d[1], d[2], c[0], c[1], c[2], b[0], b[1], b[2], a[0], a[1], a[2], [uv[0], uv[3], uv[2], uv[1]]);
    }
  }
}

/** Fileiras de uma lavoura: planos verticais com a planta recortada (atlas). */
function cropRows(m: Mesher, farm: Farm, field: Farm["fields"][number], random: () => number) {
  if (field.crop === "arado") return;
  const crop = field.crop;
  const [u0, u1, n0, n1] = field.local;
  const spacing = CROP_SPACING[crop];
  const row = CROP_ROW[crop];
  const vTop = 1 - row / 3 - 0.004;
  const vBottom = 1 - (row + 1) / 3 + 0.004;
  const f = farm.frame;
  const base = rgb(crop === "cana" ? "#e8f0d8" : crop === "girassol" ? "#ffffff" : "#f4f4e4");
  for (let n = n0 + spacing / 2; n < n1; n += spacing) {
    const height = CROP_HEIGHT[crop] * (0.88 + random() * 0.2);
    const tone = shade(base, 0.82 + random() * 0.22);
    for (let u = u0; u < u1 - 0.5; u += PIECE) {
      const ub = Math.min(u1, u + PIECE);
      const [ax, az] = toWorld(f, u, n);
      const [bx, bz] = toWorld(f, ub, n);
      const ya = heightAt(ax, az) - 0.3;
      const yb = heightAt(bx, bz) - 0.3;
      const uEnd = (ub - u) / PIECE;
      m.quad(R.crops, tone, ax, ya, az, bx, yb, bz, bx, yb + height, bz, ax, ya + height, az, [0, vBottom, uEnd, vTop]);
    }
  }
}

/** Reamostra uma linha em pontos a cada ~`step` m (mantém os vértices). */
function resample(points: [number, number][], step: number) {
  const out: [number, number][] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1];
    const [bx, bz] = points[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const n = Math.max(1, Math.round(len / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

const WOOD_FENCE = rgb("#8f7a60");
const WIRE_POST = rgb("#6e5a44");

/** Cerca de tábuas (moirões e três réguas) ou de arame farpado (moirões e quatro fios). */
function fence(m: Mesher, line: FenceLine, random: () => number) {
  const wood = line.style === "madeira";
  const posts = resample(line.points, wood ? 2.6 : 3.2);
  const tops: [number, number, number][] = [];
  m.setFrame(0, 0, 0, 0);
  for (let i = 0; i < posts.length; i++) {
    const [x, z] = posts[i];
    const y = heightAt(x, z);
    const t = wood ? 0.09 : 0.065;
    const h = wood ? 1.45 : 1.35;
    const col = shade(wood ? WOOD_FENCE : WIRE_POST, 0.85 + random() * 0.25);
    m.box(M.wood, col, x - t, x + t, y - 0.3, y + h, z - t, z + t, BOX.bottom);
    tops.push([x, y, z]);
  }
  for (let i = 1; i < tops.length; i++) {
    const [ax, ay, az] = tops[i - 1];
    const [bx, by, bz] = tops[i];
    // Dois moirões no mesmo lugar dariam peças de tamanho zero (normal zero → NaN no sombreamento).
    // (E pulo grande não é vão de cerca: os moirões ficam a no máximo ~3 m.)
    const span = Math.hypot(bx - ax, bz - az);
    if (span < 0.05 || span > 6) continue;
    if (wood) {
      for (const h of [0.45, 0.85, 1.25]) m.bar(M.wood, shade(WOOD_FENCE, 0.9 + random() * 0.15), ax, ay + h, az, bx, by + h, bz, 0.09);
    } else {
      for (const h of [0.35, 0.65, 0.95, 1.25]) {
        m.quad(R.wire, WIRE_POST, ax, ay + h, az, bx, by + h, bz, bx, by + h + 0.025, bz, ax, ay + h + 0.025, az);
      }
    }
  }
}

// --- Mato: moitas, cerca viva e capim alto (instanciados) -----------------------------------

const leafNormal = normalTexture(128, (ctx, size, random) => {
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 260; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = 3 + random() * 6;
    const g = ctx.createRadialGradient(x, y - r * 0.3, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}, 505, 3);

let bushParts: { geometry: THREE.BufferGeometry; material: THREE.Material; tuft: THREE.BufferGeometry; tuftMaterial: THREE.Material } | null = null;

function bushes() {
  if (bushParts) return bushParts;
  // Moita: um icosaedro amassado e com calombos (sempre o mesmo: geometria compartilhada).
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const random = seeded(506);
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const bumps = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!bumps.has(k)) bumps.set(k, 0.82 + random() * 0.32);
    const s = bumps.get(k)!;
    const y = pos.getY(i);
    pos.setXYZ(i, pos.getX(i) * s, (y < -0.2 ? -0.2 + (y + 0.2) * 0.3 : y) * s, pos.getZ(i) * s);
  }
  geometry.computeVertexNormals();
  geometry.translate(0, 0.25, 0);
  geometry.userData.shared = true;
  const material = surface(new THREE.MeshLambertMaterial({ color: "#ffffff" }), { roughness: 0.85, normalMap: leafNormal, normalScale: 0.8 });

  // Capim: três planos cruzados com as folhas recortadas.
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const r = seeded(507);
  for (let i = 0; i < 70; i++) {
    const x = 10 + r() * 108;
    const lean = (r() - 0.5) * 40;
    const g = 140 + r() * 80;
    ctx.strokeStyle = `rgb(${g * 0.85},${g},${g * 0.45})`;
    ctx.lineWidth = 1.5 + r() * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 128);
    ctx.quadraticCurveTo(x + lean * 0.3, 70, x + lean, 10 + r() * 50);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const planes: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const plane = new THREE.PlaneGeometry(1.6, 1.1);
    plane.translate(0, 0.45, 0);
    plane.rotateY((k * Math.PI) / 3);
    planes.push(plane);
  }
  const tuft = mergeAll(planes);
  tuft.userData.shared = true;
  const tuftMaterial = surface(new THREE.MeshLambertMaterial({ color: "#ffffff", map: texture, alphaTest: 0.4, side: THREE.DoubleSide }), { roughness: 0.9 });
  bushParts = { geometry, material, tuft, tuftMaterial };
  return bushParts;
}

function mergeAll(list: THREE.BufferGeometry[]) {
  let count = 0;
  for (const g of list) count += g.attributes.position.count;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const index: number[] = [];
  let at = 0;
  for (const g of list) {
    position.set(g.attributes.position.array as Float32Array, at * 3);
    normal.set(g.attributes.normal.array as Float32Array, at * 3);
    uv.set(g.attributes.uv.array as Float32Array, at * 2);
    for (const i of g.index!.array) index.push(i + at);
    at += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(position, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  out.setIndex(index);
  return out;
}

interface Plant {
  x: number;
  z: number;
  /** Escala (largura, altura) e giro. */
  s: number;
  h: number;
  turn: number;
  color: THREE.Color;
}

const BUSH_GREENS = ["#4d6b2a", "#5a7a30", "#3f5f28", "#6b7d34", "#55702c"];
const DRY = ["#a9a35a", "#b8ad66", "#9c9a52", "#c2b673"];

/** Onde dá para pôr mato: fora das ruas, dos prédios e das construções das fazendas. */
const freeSpot = (x: number, z: number, road = 2.5) => roadClearance(x, z) > road && !insideBuilding(x, z);

/** Moitas e capim do campo inteiro (sempre iguais: semente fixa). */
function scatterPlants() {
  const random = seeded(4711);
  const bushesList: Plant[] = [];
  const tufts: Plant[] = [];
  const green = (list: string[]) => new THREE.Color(pick(random, list)).multiplyScalar(0.85 + random() * 0.3);
  // Cercas vivas: moitas encostadas umas nas outras ao longo da linha.
  for (const line of FENCES) {
    if (line.style !== "viva") continue;
    for (const [x, z] of resample(line.points, 1.3)) {
      bushesList.push({ x: x + (random() - 0.5) * 0.3, z: z + (random() - 0.5) * 0.3, s: 0.95 + random() * 0.3, h: 1.4 + random() * 0.5, turn: random() * 6.3, color: green(BUSH_GREENS) });
    }
  }
  // Capim alto e moitas na beira das cercas das estradas e soltos no campo.
  for (const line of FENCES) {
    if (line.style === "viva") continue;
    for (const [x, z] of resample(line.points, 3)) {
      if (random() < 0.45) tufts.push({ x: x + (random() - 0.5) * 1.6, z: z + (random() - 0.5) * 1.6, s: 0.8 + random() * 0.6, h: 0.8 + random() * 0.7, turn: random() * 6.3, color: green(DRY) });
      if (random() < 0.06) bushesList.push({ x: x + (random() - 0.5) * 2, z: z + (random() - 0.5) * 2, s: 0.7 + random() * 0.6, h: 0.7 + random() * 0.5, turn: random() * 6.3, color: green(BUSH_GREENS) });
    }
  }
  for (let k = 0; k < 9000; k++) {
    const x = -1740 + random() * 3480;
    const z = 1500 + random() * 1150;
    const district = districtAt(x, z);
    if (district !== "roca" && district !== "serra") continue;
    const clump = random() < 0.7;
    if (!freeSpot(x, z)) continue;
    const inFarm = FARMS.find((f) => pointInFootprint(f, x, z, 2));
    // Dentro das lavouras não (a não ser na beirada); nos pastos e no terreiro, pouco.
    if (inFarm && (inFarm.fields.some((fl) => insideRect(fl, x, z, 1)) || insideRect(inFarm.yard, x, z, 0) || random() < 0.7)) continue;
    if (clump) {
      const n = 3 + Math.floor(random() * 6);
      for (let i = 0; i < n; i++) {
        const px = x + (random() - 0.5) * 6;
        const pz = z + (random() - 0.5) * 6;
        if (freeSpot(px, pz)) tufts.push({ x: px, z: pz, s: 0.8 + random() * 0.7, h: 0.8 + random() * 0.9, turn: random() * 6.3, color: green(district === "serra" ? BUSH_GREENS : DRY) });
      }
    } else bushesList.push({ x, z, s: 0.8 + random() * 1.1, h: 0.7 + random() * 0.9, turn: random() * 6.3, color: green(BUSH_GREENS) });
  }
  return { bushes: bushesList, tufts };
}

function insideRect(b: { x: number; z: number; w: number; d: number; angle: number }, x: number, z: number, margin: number) {
  const dx = x - b.x;
  const dz = z - b.z;
  const lw = dx * Math.cos(b.angle) - dz * Math.sin(b.angle);
  const ld = dx * Math.sin(b.angle) + dz * Math.cos(b.angle);
  return Math.abs(lw) <= b.w / 2 + margin && Math.abs(ld) <= b.d / 2 + margin;
}

function plantMesh(geometry: THREE.BufferGeometry, material: THREE.Material, list: Plant[]) {
  const mesh = new THREE.InstancedMesh(geometry, material, list.length);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 1, 0);
  list.forEach((p, i) => {
    quat.setFromAxisAngle(axis, p.turn);
    matrix.compose(new THREE.Vector3(p.x, heightAt(p.x, p.z) - 0.2, p.z), quat, new THREE.Vector3(p.s, p.h, p.s));
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, p.color);
  });
  mesh.computeBoundingSphere();
  return mesh;
}

// --- Construções das fazendas (dois níveis de detalhe) -----------------------------------

const HOUSE_WALLS = ["#f7f3ea", "#f1e3c6", "#fdf0d5", "#f4e1b8", "#e9c46a", "#f2d8c2"];
const BARN_REDS = ["#9b2226", "#8a1c1c", "#a4302a", "#7d2a1d"];

interface Prepared {
  farm: Farm;
  houseTone: Rgb;
  barnTone: Rgb;
  random: () => number;
}

function prepareFarm(farm: Farm): Prepared {
  const random = seeded(farm.id * 7717 + 3);
  return { farm, houseTone: rgb(pick(random, HOUSE_WALLS)), barnTone: rgb(pick(random, BARN_REDS)), random };
}

/** Lote no formato do houses.ts para um prédio da fazenda (casa ou celeiro). */
function lotFor(m: Mesher, b: Farm["house"], tone: Rgb, seed: number, finish: string): Lot {
  const ground = heightAt(b.x, b.z);
  let high = -Infinity;
  let low = Infinity;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = b.x + Math.cos(b.angle) * (b.w / 2) * sx + Math.sin(b.angle) * (b.d / 2) * sz;
    const z = b.z - Math.sin(b.angle) * (b.w / 2) * sx + Math.cos(b.angle) * (b.d / 2) * sz;
    const h = heightAt(x, z) - ground;
    high = Math.max(high, h);
    low = Math.min(low, h);
  }
  const angle = b.angle + (b.front < 0 ? Math.PI : 0);
  m.setFrame(b.x, ground, b.z, angle);
  const lot: Lot = {
    m, random: seeded(seed), w: b.w, d: b.d, height: b.height, floor: Math.max(0, high) + 0.15, base: low - 0.4, groundY: ground,
    district: "roca", tint: 0, tone, finish, pitched: true, clear: () => true,
  };
  lot.random();
  return lot;
}

/** Silo de chapa (anéis, telhado cônico e escada). */
function silo(m: Mesher, x: number, z: number, r: number, h: number) {
  const y = heightAt(x, z);
  const metal = rgb("#c9ccd0");
  m.setFrame(x, y, z, 0);
  m.cylinder(M.concrete, rgb("#a8a49c"), 0, 0, -0.5, 0.4, r + 0.3, r + 0.3, 16);
  m.cylinder(M.metal, metal, 0, 0, 0.4, h, r, r, 16, false);
  for (let k = 1; k < h / 1.6; k++) m.cylinder(M.paint, shade(metal, 0.85), 0, 0, 0.4 + k * 1.6, 0.48 + k * 1.6, r + 0.03, r + 0.03, 16, false);
  m.cylinder(M.metal, shade(metal, 0.95), 0, 0, h, h + r * 0.55, r + 0.15, 0.35, 16, false);
  m.cylinder(M.paint, shade(metal, 0.8), 0, 0, h + r * 0.55, h + r * 0.55 + 0.5, 0.35, 0.25, 8);
  // Escada de marinheiro.
  const iron = rgb("#55585c");
  for (const s of [-0.25, 0.25]) m.bar(M.paint, iron, s, 0.6, r + 0.2, s, h + 0.2, r + 0.2, 0.05);
  for (let yy = 0.9; yy < h; yy += 0.4) m.bar(M.paint, iron, -0.25, yy, r + 0.2, 0.25, yy, r + 0.2, 0.04);
}

/** Caixa-d'água na torre de madeira. */
function tankTower(m: Mesher, x: number, z: number, angle: number) {
  const y = heightAt(x, z);
  m.setFrame(x, y, z, angle);
  const wood = rgb("#7a6046");
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) m.bar(M.wood, wood, sx * 1.5, -0.3, sz * 1.5, sx * 1.1, 6, sz * 1.1, 0.2);
  for (const yy of [2, 4]) {
    m.bar(M.wood, wood, -1.4, yy, -1.4, 1.4, yy, -1.4, 0.12);
    m.bar(M.wood, wood, -1.4, yy, 1.4, 1.4, yy, 1.4, 0.12);
    m.bar(M.wood, wood, -1.4, yy, -1.4, -1.4, yy, 1.4, 0.12);
    m.bar(M.wood, wood, 1.4, yy, -1.4, 1.4, yy, 1.4, 0.12);
  }
  m.box(M.wood, shade(wood, 0.9), -1.5, 1.5, 6, 6.2, -1.5, 1.5);
  const blue = rgb("#2f6db5");
  m.cylinder(M.paint, blue, 0, 0, 6.2, 8.2, 1.3, 1.5, 14, false);
  m.cylinder(M.paint, shade(blue, 1.12), 0, 0, 8.2, 8.6, 1.52, 1.0, 14);
}

/** Porteira de entrada: dois moirões grossos, a trave com o nome e a folha aberta. */
function gate(m: Mesher, farm: Farm) {
  const f = farm.frame;
  const [x, z] = toWorld(f, 0, 0);
  const y = heightAt(x, z);
  // Local: x ao longo de u; z local = n ou −n conforme o referencial (aqui, só simetria em x).
  m.setFrame(x, y, z, Math.atan2(-f.uz, f.ux));
  const sgn = f.uz * f.nx - f.ux * f.nz > 0 ? -1 : 1; // z local = sgn·n
  const wood = rgb("#6b5238");
  for (const s of [-1, 1]) m.box(M.wood, wood, s * 4.2 - 0.18, s * 4.2 + 0.18, -0.4, 4.6, -0.18, 0.18);
  m.box(M.wood, wood, -4.6, 4.6, 4.3, 4.6, -0.2, 0.2);
  // Placa com o nome (frente para a estrada, dos dois lados).
  const row = farm.id % SIGN_ROWS;
  const v1 = 1 - row / SIGN_ROWS - 0.002;
  const v0 = 1 - (row + 1) / SIGN_ROWS + 0.002;
  m.box(M.wood, shade(wood, 0.8), -3.4, 3.4, 4.6, 5.55, -0.06, 0.06);
  m.quad(R.sign, [1, 1, 1], -3.3, 4.65, -0.08 * sgn, 3.3, 4.65, -0.08 * sgn, 3.3, 5.5, -0.08 * sgn, -3.3, 5.5, -0.08 * sgn, sgn > 0 ? [1, v0, 0, v1] : [0, v0, 1, v1]);
  m.quad(R.sign, [1, 1, 1], 3.3, 4.65, 0.08 * sgn, -3.3, 4.65, 0.08 * sgn, -3.3, 5.5, 0.08 * sgn, 3.3, 5.5, 0.08 * sgn, sgn > 0 ? [0, v0, 1, v1] : [1, v0, 0, v1]);
  // Folha da porteira, aberta para dentro.
  m.push(-4.0, 0, 0, 0);
  m.push(0, 0, 0, -sgn * 1.2);
  const leaf = rgb("#b89a6a");
  for (const h of [0.3, 0.75, 1.2]) m.box(M.wood, leaf, 0, 3.9, h, h + 0.14, -0.05, 0.05);
  m.box(M.wood, leaf, 0, 0.14, 0.2, 1.4, -0.05, 0.05);
  m.box(M.wood, leaf, 3.76, 3.9, 0.2, 1.4, -0.05, 0.05);
  m.bar(M.wood, leaf, 0.1, 0.3, 0.06, 3.8, 1.3, 0.06, 0.12);
  m.pop();
  m.pop();
}

/** Galinheiro (casinha de madeira com telhado de uma água), cocho no curral e fardos de feno. */
function yardBits(m: Mesher, p: Prepared) {
  const { farm, random } = p;
  const f = farm.frame;
  const coop = farm.pens.find((pen) => pen.animal === "galinha");
  const angle = Math.atan2(-f.uz, f.ux);
  if (coop) {
    const [u0, u1, n0, n1] = coop.local;
    const [x, z] = toWorld(f, (u0 + u1) / 2, n1 - 2.2);
    const y = heightAt(x, z);
    m.setFrame(x, y, z, angle);
    const wood = rgb("#a07c55");
    m.box(M.wood, wood, -2, 2, -0.3, 1.9, -1.4, 1.4);
    m.quad(M.metal, rgb("#8b8e91"), -2.3, 2.5, -1.7, 2.3, 2.5, -1.7, 2.3, 1.8, 1.7, -2.3, 1.8, 1.7);
    m.quad(M.metal, rgb("#6f7275"), 2.3, 2.5, -1.7, -2.3, 2.5, -1.7, -2.3, 1.8, 1.7, 2.3, 1.8, 1.7);
    m.box(M.wood, wood, -2, 2, 1.9, 2.5, -1.4, -1.0);
    m.box(M.paint, rgb("#2b2b2b"), -0.4, 0.4, 0.1, 0.9, 1.4, 1.42);
  }
  for (const pen of farm.pens) {
    if (pen.animal === "galinha") continue;
    // Cocho de madeira encostado num lado.
    const [u0, u1, n0, n1] = pen.local;
    const [x, z] = toWorld(f, u0 + 3 + random() * 4, (n0 + n1) / 2);
    const y = heightAt(x, z);
    m.setFrame(x, y, z, angle + Math.PI / 2);
    m.box(M.wood, rgb("#7c6048"), -1.5, 1.5, -0.2, 0.6, -0.4, 0.4);
    m.box(M.paint, rgb("#c9b26a"), -1.4, 1.4, 0.55, 0.62, -0.3, 0.3);
  }
  // Fardos de feno (rolos) perto do celeiro.
  const hay = rgb("#d6b76a");
  for (let k = 0; k < 4; k++) {
    const [x, z] = toWorld(f, 23 + (k % 2) * 2.2, 40 + Math.floor(k / 2) * 2.2 - 1);
    const y = heightAt(x, z);
    m.setFrame(x, y, z, 0);
    m.cylinder(M.wood, shade(hay, 0.9 + random() * 0.15), 0, 0, -0.2, 1.3, 0.85, 0.85, 12);
  }
}

function farmDetail(list: Prepared[]) {
  const m = new Mesher(ruralMaterials());
  for (const p of list) {
    const { farm } = p;
    farmHouse(lotFor(m, farm.house, p.houseTone, farm.id * 31 + 1, "paint"));
    barn(lotFor(m, farm.barn, p.barnTone, farm.id * 31 + 2, "wood"));
    for (const s of farm.silos) silo(m, s.x, s.z, s.r, s.h);
    tankTower(m, farm.tank.x, farm.tank.z, farm.tank.angle);
    gate(m, farm);
    yardBits(m, p);
  }
  return m.finish("fazendas-detalhe");
}

let farParts: { box: THREE.BufferGeometry; roof: THREE.BufferGeometry; cylinder: THREE.BufferGeometry; cone: THREE.BufferGeometry; material: THREE.Material } | null = null;
function farShapes() {
  if (farParts) return farParts;
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0);
  shape.lineTo(0.5, 0);
  shape.lineTo(0, 1);
  shape.closePath();
  const roof = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12).translate(0, 0.5, 0);
  const cone = new THREE.ConeGeometry(1, 1, 12).translate(0, 0.5, 0);
  const material = surface(new THREE.MeshLambertMaterial({ color: "#ffffff" }), { roughness: 0.85 });
  farParts = { box, roof, cylinder, cone, material };
  for (const g of [box, roof, cylinder, cone]) g.userData.shared = true;
  return farParts;
}

/** Versão de longe: caixas e cilindros instanciados. */
function farmFar(list: Prepared[]) {
  const { box, roof, cylinder, cone, material } = farShapes();
  const items: Record<"box" | "roof" | "cylinder" | "cone", { m: THREE.Matrix4; c: THREE.Color }[]> = { box: [], roof: [], cylinder: [], cone: [] };
  const quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const color = (c: Rgb) => new THREE.Color(c[0], c[1], c[2]);
  for (const { farm, houseTone, barnTone } of list) {
    for (const [b, tone, roofTone, wallH] of [[farm.house, houseTone, rgb("#9a5236"), 3.2], [farm.barn, barnTone, rgb("#6a6f73"), Math.max(3.5, farm.barn.height * 0.55)]] as const) {
      const y = heightAt(b.x, b.z);
      quat.setFromAxisAngle(up, b.angle);
      items.box.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(b.x, y - 0.3, b.z), quat, new THREE.Vector3(b.w - 0.4, wallH + 0.3, b.d - 0.4)), c: color(tone) });
      // Cumeeira ao longo de "d" (o celeiro tem a empena para a estrada).
      const roofQuat = quat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(up, b === farm.barn ? 0 : Math.PI / 2));
      const span = b === farm.barn ? b.w : b.d;
      const along = b === farm.barn ? b.d : b.w;
      items.roof.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(b.x, y + wallH, b.z), roofQuat, new THREE.Vector3(span + 0.6, span * 0.42, along + 0.6)), c: color(roofTone) });
    }
    for (const s of farm.silos) {
      const y = heightAt(s.x, s.z);
      items.cylinder.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(s.x, y, s.z), quat.identity(), new THREE.Vector3(s.r, s.h, s.r)), c: new THREE.Color("#b8bcc0") });
      items.cone.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(s.x, y + s.h, s.z), quat, new THREE.Vector3(s.r + 0.1, s.r * 0.6, s.r + 0.1)), c: new THREE.Color("#a8acb0") });
    }
    const ty = heightAt(farm.tank.x, farm.tank.z);
    items.cylinder.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(farm.tank.x, ty + 6.2, farm.tank.z), quat.identity(), new THREE.Vector3(1.45, 2.3, 1.45)), c: new THREE.Color("#2f6db5") });
    items.box.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(farm.tank.x, ty, farm.tank.z), quat, new THREE.Vector3(2.4, 6.2, 2.4)), c: new THREE.Color("#5a4632") });
  }
  const group = new THREE.Group();
  for (const [key, geometry] of [["box", box], ["roof", roof], ["cylinder", cylinder], ["cone", cone]] as const) {
    const list = items[key];
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m);
      mesh.setColorAt(i, it.c);
    });
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

// --- Montagem ---------------------------------------------------------------------------------

const YARD = rgb("#a39684");

/** Todo o campo: chão, lavouras, cercas, mato, bichos (blocos comuns) e construções (com LOD). */
export function buildFarms(scene: THREE.Scene) {
  if (!FARMS.length && !FENCES.length) return;
  ruralMaterials();
  const random = seeded(2718);
  const { bushes: bushList, tufts } = scatterPlants();
  const parts = bushes();

  // Tudo que é do chão vai no bloco do ponto de referência (a fazenda pelo portão, a cerca pelo meio).
  type Item = { kind: "farm"; farm: Farm } | { kind: "fence"; line: FenceLine } | { kind: "bush"; plant: Plant } | { kind: "tuft"; plant: Plant };
  const items: Item[] = [
    ...FARMS.map((farm): Item => ({ kind: "farm", farm })),
    ...FENCES.filter((l) => l.style !== "viva").map((line): Item => ({ kind: "fence", line })),
    ...bushList.map((plant): Item => ({ kind: "bush", plant })),
    ...tufts.map((plant): Item => ({ kind: "tuft", plant })),
  ];
  const position = (it: Item): [number, number] => {
    switch (it.kind) {
      case "farm":
        return toWorld(it.farm.frame, 0, it.farm.depth / 2);
      case "fence":
        return it.line.points[Math.floor(it.line.points.length / 2)];
      default:
        return [it.plant.x, it.plant.z];
    }
  };
  for (const tile of byTile(items, position, TILE)) {
    const m = new Mesher(ruralMaterials());
    m.setFrame(0, 0, 0, 0);
    const farms: Farm[] = [];
    const bushHere: Plant[] = [];
    const tuftHere: Plant[] = [];
    for (const it of tile.items) {
      if (it.kind === "fence") fence(m, it.line, random);
      else if (it.kind === "bush") bushHere.push(it.plant);
      else if (it.kind === "tuft") tuftHere.push(it.plant);
      else farms.push(it.farm);
    }
    for (const farm of farms) {
      m.setFrame(0, 0, 0, 0);
      // Terreiro de terra batida e a estradinha da porteira até ele.
      groundPatch(m, R.dirt, shade(YARD, 0.95 + random() * 0.1), farm, -36, 36, 1, 58, 1, 1, -0.1);
      for (const field of farm.fields) {
        const [u0, u1, n0, n1] = field.local;
        const spacing = CROP_SPACING[field.crop];
        const tone = field.crop === "arado" ? rgb("#f0e0d0") : field.crop === "cana" ? rgb("#a7b884") : field.crop === "girassol" ? rgb("#9fae6c") : rgb("#b4b77c");
        // Sulcos ao longo de u: um quadro de textura por fileira (v em fileiras).
        groundPatch(m, R.soil, tone, farm, u0, u1, n0, n1, 4, spacing, -0.11);
        cropRows(m, farm, field, random);
      }
      for (const pen of farm.pens) {
        if (pen.animal === "galinha" || pen.animal === "porco") {
          const [u0, u1, n0, n1] = pen.local;
          groundPatch(m, R.dirt, shade(rgb("#a88a66"), 0.9 + random() * 0.15), farm, u0, u1, n0, n1, 1, 1, -0.09);
          continue;
        }
        if (pen.local[2] < 30 && pen.local[0] > -36 && pen.local[1] < 36) continue; // curral no terreiro
        const [u0, u1, n0, n1] = pen.local;
        const tone = mix(rgb("#8fa45a"), rgb("#b8ad6a"), random() * 0.6);
        groundPatch(m, R.grass, tone, farm, u0, u1, n0, n1, 1, 1, -0.11);
      }
    }
    const group = m.finish("campo");
    if (bushHere.length) group.add(plantMesh(parts.geometry, parts.material, bushHere));
    if (tuftHere.length) group.add(plantMesh(parts.tuft, parts.tuftMaterial, tuftHere));
    for (const farm of farms) for (const object of buildAnimals(farm)) group.add(object);
    addChunk(scene, group, tile.center, TILE * 0.71 + 200);
  }

  // Construções: dois níveis de detalhe por bloco.
  const prepared = FARMS.map(prepareFarm);
  for (const tile of byTile(prepared, (p) => toWorld(p.farm.frame, 0, 30), DETAIL_TILE)) {
    addLodChunk(scene, tile.center, DETAIL_TILE * 0.71 + 60, farmFar(tile.items), () => farmDetail(tile.items.map((p) => ({ ...p, random: seeded(p.farm.id * 97 + 5) }))));
  }
}
