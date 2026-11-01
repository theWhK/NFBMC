// Texturas das ruas e calçadas, desenhadas no código pixel a pixel (sem
// arquivos): cada uma sai com a cor, o relevo (normal map, tirado de um mapa de
// altura em metros) e a aspereza. Todas repetem sem emenda e vêm com o
// `repeat` em metros (a geometria das ruas usa UV em metros).
//
// As cores são claras de propósito: o tom de cada trecho (asfalto novo ou
// gasto, cimento pintado, terra mais vermelha) vem da cor dos vértices, que
// multiplica a textura. Assim a mesma textura serve para a rua inteira sem
// parecer repetida.
//
// Usa DataTexture (e não canvas) para a cor: o canvas guarda a cor
// pré-multiplicada pela opacidade e as bordas dos decalques ficariam escuras.
import * as THREE from "three";

const TAU = Math.PI * 2;

// --- Ruído que repete sem emenda -------------------------------------------------

function hash(x: number, y: number, seed: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a: number, b: number, v: number) => smooth(clamp01((v - a) / (b - a)));
const fract = (v: number) => v - Math.floor(v);

/** Ruído de valor em (u, v) ∈ [0, 1), com `period` células por lado (repete na borda). */
function noise(u: number, v: number, period: number, seed: number) {
  const fx = u * period;
  const fy = v * period;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const sx = smooth(fx - ix);
  const sy = smooth(fy - iy);
  // u e v ficam em [0, 1): só a última célula precisa dar a volta.
  const x0 = ix >= 0 && ix < period ? ix : ((ix % period) + period) % period;
  const y0 = iy >= 0 && iy < period ? iy : ((iy % period) + period) % period;
  const x1 = x0 + 1 === period ? 0 : x0 + 1;
  const y1 = y0 + 1 === period ? 0 : y0 + 1;
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Soma de oitavas de ruído (0–1), a primeira com `period` células. */
function fbm(u: number, v: number, period: number, octaves: number, seed: number) {
  let sum = 0;
  let amp = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(u, v, period << o, seed + o * 31);
    total += amp;
    amp *= 0.5;
  }
  return sum / total;
}

/** Resultado do Voronoi (reaproveitado, para não criar objeto por pixel). */
const cell = { f1: 0, f2: 0, id: 0, cx: 0, cy: 0 };

/** Pontos sorteados de cada célula do Voronoi (deslocamento x, y e a identidade) do último n/semente usado. */
let lastPoints: { n: number; seed: number; jitter: number; pts: Float32Array } | null = null;

/** Voronoi com `n` células por lado (repete): distâncias em fração do lado, centro da célula mais perto. */
function voronoi(u: number, v: number, n: number, seed: number, jitter = 0.8) {
  let pts = lastPoints && lastPoints.n === n && lastPoints.seed === seed && lastPoints.jitter === jitter ? lastPoints.pts : null;
  if (!pts) {
    pts = new Float32Array(n * n * 3);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = (y * n + x) * 3;
        pts[i] = 0.5 + (hash(x, y, seed) - 0.5) * jitter;
        pts[i + 1] = 0.5 + (hash(x, y, seed + 7) - 0.5) * jitter;
        pts[i + 2] = hash(x, y, seed + 13);
      }
    }
    lastPoints = { n, seed, jitter, pts };
  }
  const fx = u * n;
  const fy = v * n;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  let f1 = 81;
  let f2 = 81;
  for (let dy = -1; dy <= 1; dy++) {
    const gy = iy + dy;
    const wy = gy < 0 ? gy + n : gy >= n ? gy - n : gy;
    for (let dx = -1; dx <= 1; dx++) {
      const gx = ix + dx;
      const wx = gx < 0 ? gx + n : gx >= n ? gx - n : gx;
      const i = (wy * n + wx) * 3;
      const px = gx + pts[i];
      const py = gy + pts[i + 1];
      const d = (px - fx) * (px - fx) + (py - fy) * (py - fy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        cell.id = pts[i + 2];
        cell.cx = px / n;
        cell.cy = py / n;
      } else if (d < f2) f2 = d;
    }
  }
  cell.f1 = Math.sqrt(f1) / n;
  cell.f2 = Math.sqrt(f2) / n;
  return cell;
}

/** Gerador simples com semente (para espalhar pedrinhas, rachaduras...). */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// --- Imagem em construção -------------------------------------------------------

/** Cor sRGB (0–1), altura (m), aspereza (0–1) e opacidade por pixel. */
interface Img {
  w: number;
  h: number;
  /** Metros por pixel (para o relevo). */
  pixel: number;
  rgb: Float32Array;
  height: Float32Array;
  rough: Float32Array;
  alpha: Float32Array;
}

function image(w: number, h: number, pixel: number): Img {
  return {
    w, h, pixel,
    rgb: new Float32Array(w * h * 3),
    height: new Float32Array(w * h),
    rough: new Float32Array(w * h).fill(0.9),
    alpha: new Float32Array(w * h).fill(1),
  };
}

/** Percorre os pixels com (u, v) ∈ [0, 1) do centro de cada um. */
function each(img: Img, fn: (i: number, u: number, v: number) => void) {
  for (let y = 0; y < img.h; y++) {
    const v = (y + 0.5) / img.h;
    for (let x = 0; x < img.w; x++) fn(y * img.w + x, (x + 0.5) / img.w, v);
  }
}

/**
 * Carimba um disco (com volta na borda): `fn(i, t)` recebe o pixel e a
 * distância ao centro (0 no centro, 1 na beira).
 */
function stamp(img: Img, cx: number, cy: number, radius: number, fn: (i: number, t: number) => void) {
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > radius * radius) continue;
      const t = Math.sqrt(d2) / radius;
      const x = (((Math.round(cx) + dx) % img.w) + img.w) % img.w;
      const y = (((Math.round(cy) + dy) % img.h) + img.h) % img.h;
      fn(y * img.w + x, t);
    }
  }
}

/**
 * Máscara desenhada com o canvas (texto, setas, rachaduras): branco = 1.
 * `wrap` desenha também deslocado de um lado inteiro, para a máscara repetir.
 */
function mask(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, wrap = false) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = ctx.strokeStyle = "#fff";
  const offsets = wrap ? [-1, 0, 1] : [0];
  for (const oy of offsets) {
    for (const ox of offsets) {
      ctx.save();
      ctx.translate(ox * w, oy * h);
      draw(ctx);
      ctx.restore();
    }
  }
  const { data } = ctx.getImageData(0, 0, w, h);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4] / 255;
  return out;
}

/** Rachadura: um traço em zigue-zague (usado dentro de `mask`). */
function crack(ctx: CanvasRenderingContext2D, rnd: () => number, x: number, y: number, angle: number, length: number, width: number) {
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x, y);
  const steps = Math.max(3, Math.round(length / 6));
  for (let k = 0; k < steps; k++) {
    angle += (rnd() - 0.5) * 0.9;
    x += Math.cos(angle) * (length / steps);
    y += Math.sin(angle) * (length / steps);
    ctx.lineTo(x, y);
    // Às vezes abre um galho.
    if (rnd() < 0.12) {
      ctx.moveTo(x, y);
      const a = angle + (rnd() < 0.5 ? 1 : -1) * (0.6 + rnd() * 0.8);
      ctx.lineTo(x + Math.cos(a) * length * 0.15, y + Math.sin(a) * length * 0.15);
      ctx.moveTo(x, y);
    }
  }
  ctx.stroke();
}

// --- Para textura -----------------------------------------------------------------

export interface SurfaceMaps {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
}

function texture(data: Uint8Array, w: number, h: number, color: boolean, meters: number | null) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  if (meters) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / meters, 1 / meters);
  }
  t.needsUpdate = true;
  return t;
}

/**
 * Cor, normal map e aspereza da imagem. `meters`: quanto a textura cobre (ela
 * repete); null = atlas (sem repetir). `relief` exagera o relevo.
 */
function toMaps(img: Img, meters: number | null, relief = 1): SurfaceMaps {
  const { w, h } = img;
  const color = new Uint8Array(w * h * 4);
  const normal = new Uint8Array(w * h * 4);
  const rough = new Uint8Array(w * h * 4);
  const k = relief / (2 * img.pixel);
  const { rgb, alpha, height } = img;
  // Uint8Array corta o que passa de 255 e o que fica abaixo de 0 vira lixo: limita antes.
  const byte = (v: number) => (v <= 0 ? 0 : v >= 1 ? 255 : v * 255);
  for (let y = 0; y < h; y++) {
    const up = (y + 1 === h ? 0 : y + 1) * w;
    const down = (y === 0 ? h - 1 : y - 1) * w;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      const o = i * 4;
      color[o] = byte(rgb[i * 3]);
      color[o + 1] = byte(rgb[i * 3 + 1]);
      color[o + 2] = byte(rgb[i * 3 + 2]);
      color[o + 3] = byte(alpha[i]);
      // Linha 0 da textura = v 0 (DataTexture não inverte): +y do normal map = +v.
      const dx = (height[row + (x + 1 === w ? 0 : x + 1)] - height[row + (x === 0 ? w - 1 : x - 1)]) * k;
      const dy = (height[up + x] - height[down + x]) * k;
      const inv = 127.5 / Math.sqrt(dx * dx + dy * dy + 1);
      normal[o] = 127.5 - dx * inv;
      normal[o + 1] = 127.5 - dy * inv;
      normal[o + 2] = 127.5 + inv;
      normal[o + 3] = 255;
      rough[o] = rough[o + 1] = rough[o + 2] = byte(img.rough[i]);
      rough[o + 3] = 255;
    }
  }
  lastPoints = null;
  return {
    map: texture(color, w, h, true, meters),
    normalMap: texture(normal, w, h, false, meters),
    roughnessMap: texture(rough, w, h, false, meters),
  };
}

const setRgb = (img: Img, i: number, r: number, g: number, b: number) => {
  img.rgb[i * 3] = r;
  img.rgb[i * 3 + 1] = g;
  img.rgb[i * 3 + 2] = b;
};
const mulRgb = (img: Img, i: number, k: number) => {
  img.rgb[i * 3] *= k;
  img.rgb[i * 3 + 1] *= k;
  img.rgb[i * 3 + 2] *= k;
};
const mixRgb = (img: Img, i: number, r: number, g: number, b: number, t: number) => {
  img.rgb[i * 3] += (r - img.rgb[i * 3]) * t;
  img.rgb[i * 3 + 1] += (g - img.rgb[i * 3 + 1]) * t;
  img.rgb[i * 3 + 2] += (b - img.rgb[i * 3 + 2]) * t;
};

// --- Pisos -----------------------------------------------------------------------

/** Asfalto (5 m): ligante cinza com brita clara aparecendo e poros escuros. */
export function asphaltMaps(): SurfaceMaps {
  const size = 1024;
  const meters = 5;
  const img = image(size, size, meters / size);
  each(img, (i, u, v) => {
    // As manchas grandes vêm da cor dos vértices; aqui só uma ondulação leve.
    const big = noise(u, v, 10, 1);
    const grain = noise(u, v, 300, 2);
    const fine = noise(u, v, 600, 3);
    const l = 0.6 + (big - 0.5) * 0.06 + (grain - 0.5) * 0.16 + (fine - 0.5) * 0.12;
    setRgb(img, i, l, l, l * 1.015);
    img.height[i] = grain * 0.0012 + fine * 0.0007;
    img.rough[i] = 0.9 + (fine - 0.5) * 0.08;
  });
  const rnd = random(11);
  // Brita: lascas claras, um pouco mais lisas (polidas pelos pneus).
  for (let k = 0; k < 11000; k++) {
    const r = 0.7 + rnd() * 1.5;
    const l = 0.6 + rnd() * 0.16;
    const warm = (rnd() - 0.5) * 0.06;
    stamp(img, rnd() * size, rnd() * size, r, (i, t) => {
      const a = 1 - t * t;
      mixRgb(img, i, l + warm, l, l - warm, a * 0.75);
      img.height[i] += a * 0.0012;
      img.rough[i] = img.rough[i] * (1 - a) + 0.62 * a;
    });
  }
  // Poros e brita escura.
  for (let k = 0; k < 9000; k++) {
    stamp(img, rnd() * size, rnd() * size, 0.6 + rnd() * 1.2, (i, t) => {
      mulRgb(img, i, 0.55 + t * 0.4);
      img.height[i] -= (1 - t) * 0.0015;
    });
  }
  return toMaps(img, meters, 1);
}

/** Paralelepípedo (2 m): blocos de granito em fileiras desencontradas, rejunte de terra. */
export function cobbleMaps(): SurfaceMaps {
  const size = 512;
  const meters = 2;
  const rows = 16;
  const cols = 10;
  const img = image(size, size, meters / size);
  each(img, (i, u, v) => {
    const row = Math.floor(v * rows);
    const shift = (row % 2) * 0.5 + (hash(row, 0, 5) - 0.5) * 0.3;
    const xs = u * cols + shift;
    const col = ((Math.floor(xs) % cols) + cols) % cols;
    const lx = fract(xs);
    const ly = fract(v * rows);
    // Distância até a beira do bloco (m), com a beira irregular.
    const wobble = (noise(u, v, 48, 6) - 0.5) * 0.012;
    const d = Math.min(Math.min(lx, 1 - lx) * (meters / cols), Math.min(ly, 1 - ly) * (meters / rows)) + wobble;
    const joint = 0.009;
    const id = hash(col, row, 9);
    const speck = noise(u, v, 400, 10);
    if (d < joint) {
      const moss = noise(u, v, 32, 12);
      const l = 0.3 + speck * 0.1;
      setRgb(img, i, l * (1 - moss * 0.12), l * (0.97 + moss * 0.05), l * (0.85 - moss * 0.1));
      img.height[i] = -0.012;
      img.rough[i] = 1;
    } else {
      // Granito: cada bloco num tom (uns mais quentes, outros mais azulados), salpicado.
      const tone = 0.56 + (id - 0.5) * 0.3;
      const hue = (hash(col, row, 15) - 0.5) * 0.06;
      const l = tone * (0.85 + speck * 0.3) * (1 + (noise(u, v, 160, 14) - 0.5) * 0.2);
      // Topo gasto: mais claro e mais liso no meio do bloco.
      const dome = smoothstep(joint, joint + 0.035, d);
      setRgb(img, i, l * (1 + hue) * (0.9 + dome * 0.1), l * (0.9 + dome * 0.1), l * (1 - hue) * (0.92 + dome * 0.1));
      img.height[i] = dome * 0.012 + speck * 0.0008 + (id - 0.5) * 0.004;
      img.rough[i] = 0.82 - dome * 0.18;
    }
  });
  return toMaps(img, meters, 1);
}

/**
 * Concreto (placas de `slab` m, a textura cobre `meters`): juntas serradas,
 * marcas de vassoura atravessadas, manchas e umas trincas.
 */
function concreteImg(size: number, meters: number, slab: number, seed: number, broom: number) {
  const img = image(size, size, meters / size);
  const per = meters / slab;
  each(img, (i, u, v) => {
    const sx = Math.floor(u * per);
    const sy = Math.floor(v * per);
    const id = hash(sx, sy, seed);
    const stain = fbm(u, v, 4, 4, seed + 1);
    const grain = noise(u, v, Math.round(meters * 60), seed + 2);
    const lines = noise(0.5, v, Math.round(meters * broom), seed + 3);
    const l = (0.82 + (id - 0.5) * 0.08 + (stain - 0.5) * 0.2 + (grain - 0.5) * 0.08 + (lines - 0.5) * 0.04) * (0.97 + 0.03 * noise(u, v, Math.round(meters * 250), seed + 4));
    setRgb(img, i, l, l * 0.99, l * 0.95);
    img.height[i] = lines * 0.0006 + grain * 0.0005;
    img.rough[i] = 0.88 + (grain - 0.5) * 0.1;
    // Junta entre as placas.
    const jx = Math.min(fract(u * per), 1 - fract(u * per)) * slab;
    const jy = Math.min(fract(v * per), 1 - fract(v * per)) * slab;
    const j = Math.min(jx, jy);
    if (j < 0.01) {
      const t = 1 - j / 0.01;
      mulRgb(img, i, 1 - 0.55 * t);
      img.height[i] -= 0.004 * t;
    }
    // Cada placa levemente fora de nível (a luz bate diferente em cada uma).
    img.height[i] += ((fract(u * per) - 0.5) * (hash(sx, sy, seed + 5) - 0.5) + (fract(v * per) - 0.5) * (hash(sx, sy, seed + 6) - 0.5)) * 0.004 * slab;
  });
  const rnd = random(seed + 7);
  const cracks = mask(size, size, (ctx) => {
    for (let k = 0; k < Math.round(per * per * 0.35); k++) crack(ctx, rnd, rnd() * size, rnd() * size, rnd() * TAU, size / per * (0.4 + rnd() * 0.6), 1.1);
  }, true);
  for (let i = 0; i < cracks.length; i++) {
    if (cracks[i] <= 0) continue;
    mulRgb(img, i, 1 - cracks[i] * 0.6);
    img.height[i] -= cracks[i] * 0.003;
  }
  return img;
}

/** Calçada de concreto (2 m): placas de 1 m. */
export function sidewalkConcreteMaps(): SurfaceMaps {
  return toMaps(concreteImg(512, 2, 1, 21, 6), 2, 1);
}

/** Pavimento de concreto (4 m): placas de 4 m (vielas do morro, trechos da rodovia, a pista do aeroporto). */
export function roadConcreteMaps(): SurfaceMaps {
  return toMaps(concreteImg(512, 4, 4, 31, 90), 4, 1);
}

/** Meio-fio (1 m ao longo): concreto liso com a junta entre as peças. */
export function curbMaps(): SurfaceMaps {
  const size = 256;
  const img = image(size, size, 1 / size);
  each(img, (i, u, v) => {
    const grain = noise(u, v, 90, 41);
    const stain = fbm(u, v, 3, 3, 42);
    const l = 0.86 + (grain - 0.5) * 0.08 + (stain - 0.5) * 0.12;
    setRgb(img, i, l, l, l * 0.97);
    img.height[i] = grain * 0.0006;
    img.rough[i] = 0.85;
    const j = Math.min(u, 1 - u);
    if (j < 0.006) {
      mulRgb(img, i, 0.55);
      img.height[i] -= 0.003;
    }
  });
  return toMaps(img, 1, 1);
}

/** Terra batida (4 m): vermelha, com pedrinhas, sulcos e torrões. */
export function dirtMaps(): SurfaceMaps {
  const size = 512;
  const meters = 4;
  const img = image(size, size, meters / size);
  each(img, (i, u, v) => {
    const big = fbm(u, v, 4, 4, 51);
    const grain = noise(u, v, 220, 52);
    const clod = noise(u, v, 60, 53);
    const l = 0.72 + (big - 0.5) * 0.25 + (grain - 0.5) * 0.14;
    const dry = smoothstep(0.55, 0.75, big);
    setRgb(img, i, l * (1 + dry * 0.05), l * (0.86 + dry * 0.06), l * (0.74 + dry * 0.08));
    img.height[i] = big * 0.02 + clod * 0.006 + grain * 0.001;
    img.rough[i] = 0.97;
  });
  const rnd = random(54);
  for (let k = 0; k < 1300; k++) {
    const l = 0.5 + rnd() * 0.25;
    stamp(img, rnd() * size, rnd() * size, 0.7 + rnd() * 1.6, (i, t) => {
      mixRgb(img, i, l, l * 0.92, l * 0.85, 0.7 * (1 - t * t));
      img.height[i] += (1 - t * t) * 0.004;
      img.rough[i] = 0.8;
    });
  }
  return toMaps(img, meters, 1);
}

/** Pedrinhas (Voronoi) para petit-pavé e pedra portuguesa: `color(i, cx, cy, id)` pinta cada uma. */
function mosaicImg(size: number, meters: number, stones: number, seed: number, color: (img: Img, i: number, cx: number, cy: number, id: number) => void) {
  const img = image(size, size, meters / size);
  const joint = 0.006;
  each(img, (i, u, v) => {
    const c = voronoi(u, v, stones, seed);
    const edge = ((c.f2 - c.f1) * meters) / 2;
    const cx = c.cx * meters;
    const cy = c.cy * meters;
    color(img, i, cx, cy, c.id);
    const grain = noise(u, v, Math.round(meters * 150), seed + 1);
    mulRgb(img, i, 0.92 + grain * 0.12);
    const dirt = fbm(u, v, 3, 2, seed + 2);
    mulRgb(img, i, 1 - smoothstep(0.5, 0.8, dirt) * 0.18);
    if (edge < joint) {
      const t = 1 - edge / joint;
      mixRgb(img, i, 0.32, 0.3, 0.27, t * 0.9);
      img.height[i] = -0.004 * t;
      img.rough[i] = 1;
    } else {
      const dome = smoothstep(joint, joint + 0.012, edge);
      img.height[i] = dome * 0.004 + grain * 0.0004;
      img.rough[i] = 0.8 - dome * 0.12;
    }
  });
  return img;
}

/** Petit-pavé do centro (1,6 m): calcário claro com losangos de basalto. */
export function petitMaps(): SurfaceMaps {
  const meters = 1.6;
  const img = mosaicImg(512, meters, 30, 61, (img, i, cx, cy, id) => {
    const a = Math.abs(fract((cx + cy) / 0.8) - 0.5);
    const b = Math.abs(fract((cx - cy) / 0.8) - 0.5);
    const dark = Math.min(a, b) < 0.075;
    const l = dark ? 0.18 + id * 0.08 : 0.84 + (id - 0.5) * 0.12;
    setRgb(img, i, l, l * 0.98, l * (dark ? 1.02 : 0.92));
  });
  return toMaps(img, meters, 1);
}

/** Pedra portuguesa em ondas, como no calçadão de Copacabana (3 m): faixas pretas e brancas onduladas. */
export function wavesMaps(): SurfaceMaps {
  const meters = 3;
  const img = mosaicImg(768, meters, 58, 71, (img, i, cx, cy, id) => {
    // cx atravessa a calçada (a partir do meio-fio), cy vai ao longo da rua.
    const band = fract((cx + 0.32 * Math.sin((TAU * cy) / meters)) / 1.5);
    const dark = band < 0.5;
    const l = dark ? 0.14 + id * 0.08 : 0.86 + (id - 0.5) * 0.1;
    setRgb(img, i, l, l * 0.98, l * (dark ? 1.03 : 0.9));
  });
  return toMaps(img, meters, 1);
}

/** Ladrilho hidráulico da Liberdade (1,6 m): placas de 20 cm vermelhas com círculos grafite. */
export function ladrilhoMaps(): SurfaceMaps {
  const size = 512;
  const meters = 1.6;
  const tiles = 8;
  const img = image(size, size, meters / size);
  each(img, (i, u, v) => {
    const a = fract(u * tiles);
    const b = fract(v * tiles);
    const tx = Math.floor(u * tiles);
    const ty = Math.floor(v * tiles);
    const corner = Math.hypot(Math.min(a, 1 - a), Math.min(b, 1 - b));
    const diamond = Math.abs(a - 0.5) + Math.abs(b - 0.5);
    // Vermelho queimado com quartos de círculo grafite nos cantos (vira um círculo a cada 4 placas).
    let r = 0.6;
    let g = 0.36;
    let bl = 0.3;
    if (corner < 0.3) [r, g, bl] = [0.4, 0.38, 0.37];
    else if (corner < 0.34) [r, g, bl] = [0.8, 0.76, 0.68];
    if (diamond < 0.1) [r, g, bl] = [0.8, 0.76, 0.68];
    const wear = fbm(u, v, 4, 4, 81);
    const tone = 1 + (hash(tx, ty, 82) - 0.5) * 0.1;
    const grain = noise(u, v, 240, 83);
    const k = tone * (0.94 + grain * 0.1);
    setRgb(img, i, r * k, g * k, bl * k);
    mixRgb(img, i, 0.62, 0.55, 0.5, smoothstep(0.55, 0.85, wear) * 0.5);
    img.height[i] = grain * 0.0004;
    img.rough[i] = 0.7 + smoothstep(0.5, 0.85, wear) * 0.2;
    const j = Math.min(a, 1 - a, b, 1 - b) * (meters / tiles);
    if (j < 0.003) {
      mixRgb(img, i, 0.5, 0.47, 0.42, 0.8);
      img.height[i] -= 0.002;
      img.rough[i] = 0.95;
    }
  });
  return toMaps(img, meters, 1);
}

/** Grama (2 m): verde com folhas claras e escuras e umas falhas de terra. */
export function grassMaps(): SurfaceMaps {
  const size = 512;
  const meters = 2;
  const img = image(size, size, meters / size);
  each(img, (i, u, v) => {
    const big = fbm(u, v, 3, 4, 91);
    const dry = smoothstep(0.45, 0.75, big);
    const fine = noise(u, v, 200, 92);
    const l = 0.75 + (fine - 0.5) * 0.3;
    setRgb(img, i, l * (0.46 + dry * 0.28), l * (0.72 + dry * 0.06), l * (0.24 + dry * 0.06));
    const bare = smoothstep(0.78, 0.86, fbm(u, v, 6, 3, 93));
    mixRgb(img, i, 0.5, 0.4, 0.3, bare * 0.8);
    img.height[i] = fine * 0.004;
    img.rough[i] = 0.95;
  });
  const rnd = random(94);
  const blades = mask(size, size, (ctx) => {
    ctx.lineCap = "round";
    for (let k = 0; k < 9000; k++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const a = rnd() * TAU;
      const len = 2 + rnd() * 5;
      ctx.globalAlpha = 0.3 + rnd() * 0.7;
      ctx.lineWidth = 0.8 + rnd() * 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
  }, true);
  for (let i = 0; i < blades.length; i++) {
    const t = blades[i];
    if (t <= 0) continue;
    const light = hash(i, 0, 95) < 0.5;
    mulRgb(img, i, light ? 1 + t * 0.35 : 1 - t * 0.35);
    img.height[i] += t * 0.006;
  }
  return toMaps(img, meters, 1);
}

/** Tinta das faixas (2 m): branca, com falhas de desgaste e grão. */
export function paintMaps(): SurfaceMaps {
  const size = 256;
  const meters = 2;
  const img = image(size, size, meters / size);
  each(img, (i, u, v) => {
    const wear = fbm(u, v, 4, 4, 101);
    const grain = noise(u, v, 160, 102);
    const worn = smoothstep(0.6, 0.72, wear * 0.8 + grain * 0.25);
    const l = 0.97 - worn * 0.42 - (grain - 0.5) * 0.06;
    setRgb(img, i, l, l, l);
    img.height[i] = (1 - worn) * 0.0008 + grain * 0.0003;
    img.rough[i] = 0.55 + worn * 0.35;
  });
  return toMaps(img, meters, 1);
}

// --- Decalques (atlas) -----------------------------------------------------------

/** Decalques do atlas (a ordem é a posição no atlas). */
export const DECALS = [
  "bueiro", "grelha", "caixa", "oleo", "pingos",
  "pneu", "remendo", "remendoVelho", "jacare", "piche",
  "trinca", "pare", "seta", "areia", "borracha",
  "umidade", "n09", "n27", "registro", "lixo",
] as const;
export type DecalName = (typeof DECALS)[number];

const ATLAS_COLS = 5;
const ATLAS_ROWS = 4;
const CELL = 256;

/** Retângulo (u0, v0, u1, v1) do decalque no atlas, com uma margem contra o vazamento do mipmap. */
export function decalRect(name: DecalName): [number, number, number, number] {
  const k = DECALS.indexOf(name);
  const cx = k % ATLAS_COLS;
  const cy = Math.floor(k / ATLAS_COLS);
  const pad = 6 / CELL;
  return [(cx + pad) / ATLAS_COLS, (cy + pad) / ATLAS_ROWS, (cx + 1 - pad) / ATLAS_COLS, (cy + 1 - pad) / ATLAS_ROWS];
}

/**
 * Atlas dos decalques (com transparência): bueiros, grelhas, manchas de óleo,
 * marcas de pneu, remendos, rachaduras, "PARE", setas, números da pista...
 * Cada célula tem 256 px; o v 0 de cada célula é o lado "da frente" (o que
 * fica para o cruzamento): o topo das letras e a ponta da seta.
 */
export function decalMaps(): SurfaceMaps {
  const W = CELL * ATLAS_COLS;
  const H = CELL * ATLAS_ROWS;
  // Relevo calculado como se cada célula tivesse ~1 m.
  const img = image(W, H, 1 / CELL);
  img.alpha.fill(0);
  img.rough.fill(0.9);
  for (let p = 0; p < W * H; p++) setRgb(img, p, 0.2, 0.2, 0.2);
  const rnd = random(201);

  /** Pinta a célula: `fn(i, a, b)` com (a, b) ∈ [0, 1) dentro da célula. */
  const paint = (name: DecalName, fn: (i: number, a: number, b: number) => void) => {
    const k = DECALS.indexOf(name);
    const x0 = (k % ATLAS_COLS) * CELL;
    const y0 = Math.floor(k / ATLAS_COLS) * CELL;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) fn((y0 + y) * W + x0 + x, (x + 0.5) / CELL, (y + 0.5) / CELL);
    }
  };
  /** Máscara (canvas) do tamanho de uma célula. */
  const cellMask = (draw: (ctx: CanvasRenderingContext2D) => void) => mask(CELL, CELL, draw);
  const at = (m: Float32Array, a: number, b: number) => m[Math.min(CELL - 1, Math.floor(b * CELL)) * CELL + Math.min(CELL - 1, Math.floor(a * CELL))];

  // Tampa de bueiro redonda: aro de ferro, desenho em xadrez em relevo, ferrugem.
  paint("bueiro", (i, a, b) => {
    const r = Math.hypot(a - 0.5, b - 0.5) * 2;
    if (r > 0.94) return;
    const rust = fbm(a, b, 4, 3, 211);
    const grain = noise(a, b, 120, 212);
    let l = 0.3 + grain * 0.08;
    let h = 0.004;
    if (r > 0.8) {
      l = 0.42 + grain * 0.1;
      h = 0.008;
    } else if (r > 0.74) {
      l = 0.12;
      h = 0;
    } else if (r > 0.2 && r < 0.26) {
      l = 0.2;
      h = 0.002;
    } else {
      const ga = Math.floor((a - 0.5) * 22 + 100);
      const gb = Math.floor((b - 0.5) * 22 + 100);
      const raised = (ga + gb) % 2 === 0;
      l = raised ? 0.4 + grain * 0.1 : 0.24;
      h = raised ? 0.007 : 0.003;
    }
    setRgb(img, i, l, l * 0.97, l * 0.95);
    mixRgb(img, i, 0.45, 0.25, 0.12, smoothstep(0.55, 0.8, rust) * 0.6);
    img.height[i] = h;
    img.rough[i] = h > 0.006 ? 0.45 : 0.75;
    img.alpha[i] = smoothstep(0.94, 0.9, r);
  });

  // Grelha da boca de lobo: quadro de ferro com as barras e o vão escuro.
  paint("grelha", (i, a, b) => {
    if (a < 0.05 || a > 0.95 || b < 0.25 || b > 0.75) return;
    const inner = a > 0.1 && a < 0.9 && b > 0.3 && b < 0.7;
    const bar = fract((a - 0.1) * 14) < 0.45;
    const grain = noise(a, b, 90, 221);
    const metal = !inner || bar;
    const l = metal ? 0.34 + grain * 0.1 : 0.03;
    setRgb(img, i, l, l * 0.96, l * 0.93);
    mixRgb(img, i, 0.4, 0.24, 0.12, smoothstep(0.5, 0.8, fbm(a, b, 4, 3, 222)) * 0.5);
    img.height[i] = metal ? 0.006 : -0.02;
    img.rough[i] = metal ? 0.5 : 1;
    img.alpha[i] = 1;
  });

  // Caixa de concreto (telefone, água): tampa quadrada com aro e dois furos.
  paint("caixa", (i, a, b) => {
    const d = Math.max(Math.abs(a - 0.5), Math.abs(b - 0.5)) * 2;
    if (d > 0.9) return;
    const grain = noise(a, b, 100, 231);
    let l = 0.58 + grain * 0.1 + (fbm(a, b, 3, 3, 232) - 0.5) * 0.2;
    let h = 0.003;
    if (d > 0.78) {
      l = 0.45 + grain * 0.08;
      h = 0.005;
    } else if (d > 0.72) {
      l = 0.15;
      h = 0;
    }
    if (Math.hypot(a - 0.3, b - 0.5) < 0.035 || Math.hypot(a - 0.7, b - 0.5) < 0.035) {
      l = 0.08;
      h = -0.004;
    }
    setRgb(img, i, l, l * 0.98, l * 0.94);
    img.height[i] = h;
    img.rough[i] = 0.85;
    img.alpha[i] = smoothstep(0.9, 0.87, d);
  });

  // Mancha de óleo: escura, de beira irregular e um pouco mais lisa (brilha).
  paint("oleo", (i, a, b) => {
    const r = Math.hypot(a - 0.5, b - 0.5) * 2;
    const n = fbm(a, b, 4, 4, 241);
    const m = smoothstep(0.85, 0.5, r + (n - 0.5) * 0.7);
    if (m <= 0) return;
    setRgb(img, i, 0.06, 0.055, 0.05);
    img.alpha[i] = m * (0.4 + n * 0.25);
    img.rough[i] = 0.62;
  });

  // Pingos de óleo ao longo da faixa (carros parados no semáforo).
  const drips = cellMask((ctx) => {
    for (let k = 0; k < 26; k++) {
      ctx.globalAlpha = 0.3 + rnd() * 0.7;
      ctx.beginPath();
      ctx.arc(CELL * (0.5 + (rnd() - 0.5) * 0.35), CELL * (0.08 + rnd() * 0.84), 3 + rnd() * 9, 0, TAU);
      ctx.fill();
    }
  });
  paint("pingos", (i, a, b) => {
    const m = at(drips, a, b);
    if (m <= 0) return;
    setRgb(img, i, 0.06, 0.055, 0.05);
    img.alpha[i] = m * 0.5;
    img.rough[i] = 0.65;
  });

  // Marcas de pneu: duas faixas escuras ao longo, com falhas.
  paint("pneu", (i, a, b) => {
    const curve = 0.06 * Math.sin(b * Math.PI);
    const n = noise(a, b, 40, 251);
    let m = 0;
    for (const c of [0.27, 0.73]) m = Math.max(m, smoothstep(0.1, 0.03, Math.abs(a - c - curve)));
    m *= smoothstep(0, 0.15, b) * smoothstep(1, 0.8, b) * (0.5 + n * 0.5);
    if (m <= 0) return;
    setRgb(img, i, 0.05, 0.05, 0.05);
    img.alpha[i] = m * 0.6;
    img.rough[i] = 0.6;
  });

  // Remendo novo: asfalto mais escuro e fechado, com a emenda selada com piche.
  paint("remendo", (i, a, b) => {
    const edge = Math.min(a, 1 - a, b, 1 - b) + (noise(a, b, 24, 261) - 0.5) * 0.03;
    if (edge < 0.02) return;
    const grain = noise(a, b, 160, 262);
    const l = 0.13 + grain * 0.05 + (fbm(a, b, 3, 3, 263) - 0.5) * 0.04;
    setRgb(img, i, l, l, l * 1.03);
    img.height[i] = 0.001 + grain * 0.0008;
    img.rough[i] = 0.78;
    img.alpha[i] = 0.92;
    if (edge < 0.045) {
      setRgb(img, i, 0.04, 0.04, 0.045);
      img.rough[i] = 0.4;
      img.alpha[i] = 0.95;
    }
  });

  // Remendo velho: forma irregular, asfalto mais claro e ressecado.
  paint("remendoVelho", (i, a, b) => {
    const r = Math.max(Math.abs(a - 0.5), Math.abs(b - 0.5)) * 2 + (fbm(a, b, 5, 3, 271) - 0.5) * 0.5;
    if (r > 0.92) return;
    const grain = noise(a, b, 140, 272);
    const l = 0.42 + grain * 0.1;
    setRgb(img, i, l, l * 0.99, l * 0.97);
    img.height[i] = -0.001 + grain * 0.001;
    img.rough[i] = 0.95;
    img.alpha[i] = smoothstep(0.92, 0.8, r) * 0.75;
  });

  // Couro de jacaré: rede de trincas num pedaço afundado.
  paint("jacare", (i, a, b) => {
    const r = Math.hypot(a - 0.5, b - 0.5) * 2 + (fbm(a, b, 4, 3, 281) - 0.5) * 0.5;
    if (r > 0.95) return;
    const c = voronoi(a, b, 9, 282);
    const line = smoothstep(0.012, 0.004, (c.f2 - c.f1) / 2);
    const area = smoothstep(0.95, 0.7, r);
    setRgb(img, i, 0.03, 0.03, 0.03);
    img.alpha[i] = area * (line * 0.6 + 0.08);
    img.height[i] = -0.002 * line;
    img.rough[i] = 0.95;
  });

  // Piche nas trincas seladas: "minhocas" pretas brilhantes.
  const tar = cellMask((ctx) => {
    for (let k = 0; k < 4; k++) crack(ctx, rnd, CELL * (0.2 + rnd() * 0.6), CELL * 0.05, Math.PI / 2 + (rnd() - 0.5) * 0.6, CELL * (0.6 + rnd() * 0.3), 5 + rnd() * 3);
  });
  paint("piche", (i, a, b) => {
    const m = at(tar, a, b);
    if (m <= 0) return;
    setRgb(img, i, 0.025, 0.025, 0.03);
    img.alpha[i] = m * 0.95;
    img.height[i] = m * 0.0015;
    img.rough[i] = 0.3;
  });

  // Trinca comprida (ao longo da rua).
  const long = cellMask((ctx) => {
    crack(ctx, rnd, CELL * 0.5, CELL * 0.03, Math.PI / 2, CELL * 0.95, 2.2);
    crack(ctx, rnd, CELL * 0.45, CELL * 0.4, Math.PI / 2 + 0.5, CELL * 0.3, 1.4);
  });
  paint("trinca", (i, a, b) => {
    const m = at(long, a, b);
    if (m <= 0) return;
    setRgb(img, i, 0.03, 0.03, 0.03);
    img.alpha[i] = m * 0.85;
    img.height[i] = -m * 0.002;
  });

  /** Pintura (PARE, setas, números): branca, com desgaste. */
  const paintMark = (name: DecalName, m: Float32Array) => {
    paint(name, (i, a, b) => {
      const t = at(m, a, b);
      setRgb(img, i, 0.95, 0.95, 0.93);
      if (t <= 0) return;
      const wear = smoothstep(0.62, 0.75, fbm(a, b, 6, 4, 291) * 0.8 + noise(a, b, 90, 292) * 0.25);
      setRgb(img, i, 0.95, 0.95, 0.93);
      img.alpha[i] = t * (1 - wear * 0.75);
      img.height[i] = t * 0.0008;
      img.rough[i] = 0.6;
    });
  };
  // "PARE" esticado ao longo da rua (para ler de longe, deitado no chão).
  paintMark("pare", cellMask((ctx) => {
    ctx.font = "bold 70px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.save();
    ctx.translate(CELL / 2, CELL / 2);
    ctx.scale(1.05, 3.2);
    ctx.fillText("PARE", 0, 2);
    ctx.restore();
  }));
  // Seta para a frente (ponta em v 0).
  paintMark("seta", cellMask((ctx) => {
    ctx.beginPath();
    ctx.moveTo(CELL * 0.5, CELL * 0.03);
    ctx.lineTo(CELL * 0.8, CELL * 0.36);
    ctx.lineTo(CELL * 0.6, CELL * 0.36);
    ctx.lineTo(CELL * 0.6, CELL * 0.97);
    ctx.lineTo(CELL * 0.4, CELL * 0.97);
    ctx.lineTo(CELL * 0.4, CELL * 0.36);
    ctx.lineTo(CELL * 0.2, CELL * 0.36);
    ctx.closePath();
    ctx.fill();
  }));
  for (const [name, text] of [["n09", "09"], ["n27", "27"]] as const) {
    paintMark(name, cellMask((ctx) => {
      ctx.font = "bold 150px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.save();
      ctx.translate(CELL / 2, CELL / 2);
      ctx.scale(0.8, 1.6);
      ctx.fillText(text, 0, 4);
      ctx.restore();
    }));
  }

  // Areia e folhas secas (junto da sarjeta).
  paint("areia", (i, a, b) => {
    const n = fbm(a, b, 5, 4, 301);
    const m = smoothstep(0.45, 0.65, n) * smoothstep(0, 0.2, Math.min(b, 1 - b)) * smoothstep(0.95, 0.3, a);
    if (m <= 0) return;
    const speck = noise(a, b, 150, 302);
    setRgb(img, i, 0.5 + speck * 0.2, 0.42 + speck * 0.15, 0.3 + speck * 0.1);
    img.alpha[i] = m * 0.85;
    img.height[i] = m * 0.002;
    img.rough[i] = 1;
  });
  for (let k = 0; k < 28; k++) {
    const k0 = DECALS.indexOf("areia");
    const x = (k0 % ATLAS_COLS) * CELL + CELL * (0.1 + rnd() * 0.5);
    const y = Math.floor(k0 / ATLAS_COLS) * CELL + CELL * (0.1 + rnd() * 0.8);
    const [r, g, b2] = rnd() < 0.5 ? [0.55, 0.36, 0.14] : [0.48, 0.42, 0.18];
    stamp(img, x, y, 3 + rnd() * 4, (i, t) => {
      setRgb(img, i, r, g, b2);
      img.alpha[i] = Math.max(img.alpha[i], 1 - t * t);
      img.height[i] = 0.002;
    });
  }

  // Borracha dos pneus dos aviões no pouso (pista): faixas escuras compridas.
  paint("borracha", (i, a, b) => {
    const n = noise(a * 0.3, b, 60, 311);
    const streak = noise(a, 0.5, 70, 312);
    const m = smoothstep(0.35, 0.75, streak) * (0.4 + n * 0.6) * smoothstep(0.5, 0.2, Math.abs(a - 0.5)) * smoothstep(0, 0.2, b) * smoothstep(1, 0.8, b);
    if (m <= 0) return;
    setRgb(img, i, 0.04, 0.04, 0.04);
    img.alpha[i] = m * 0.8;
    img.rough[i] = 0.55;
  });

  // Umidade: mancha escura e lisa (água empoçada que secou pela metade).
  paint("umidade", (i, a, b) => {
    const r = Math.hypot((a - 0.5) * 1.4, b - 0.5) * 2 + (fbm(a, b, 4, 4, 321) - 0.5) * 0.6;
    const m = smoothstep(0.95, 0.4, r);
    if (m <= 0) return;
    setRgb(img, i, 0.1, 0.1, 0.11);
    img.alpha[i] = m * 0.35;
    img.rough[i] = 0.25 + (1 - m) * 0.5;
  });

  // Registro de água: tampinha de ferro redonda e pequena.
  paint("registro", (i, a, b) => {
    const r = Math.hypot(a - 0.5, b - 0.5) * 2;
    if (r > 0.6) return;
    const grain = noise(a, b, 80, 331);
    const ring = r > 0.48;
    const l = ring ? 0.4 : 0.28 + grain * 0.1;
    setRgb(img, i, l, l * 0.95, l * 0.9);
    mixRgb(img, i, 0.42, 0.25, 0.12, smoothstep(0.5, 0.8, fbm(a, b, 4, 3, 332)) * 0.6);
    img.height[i] = ring ? 0.004 : 0.002;
    img.rough[i] = 0.55;
    img.alpha[i] = smoothstep(0.6, 0.56, r);
  });

  // Sujeira de calçada: papel, bituca, folha, chiclete.
  paint("lixo", () => {});
  {
    const k0 = DECALS.indexOf("lixo");
    const ox = (k0 % ATLAS_COLS) * CELL;
    const oy = Math.floor(k0 / ATLAS_COLS) * CELL;
    for (let k = 0; k < 40; k++) {
      const kind = rnd();
      const [r, g, b] = kind < 0.4 ? [0.12, 0.11, 0.1] : kind < 0.7 ? [0.55, 0.38, 0.16] : [0.9, 0.88, 0.82];
      const radius = kind < 0.4 ? 2 + rnd() * 3 : 3 + rnd() * 6;
      stamp(img, ox + CELL * (0.08 + rnd() * 0.84), oy + CELL * (0.08 + rnd() * 0.84), radius, (i, t) => {
        setRgb(img, i, r, g, b);
        img.alpha[i] = Math.max(img.alpha[i], (1 - t * t) * 0.85);
        img.height[i] = 0.001;
      });
    }
  }

  return toMaps(img, null, 1);
}
