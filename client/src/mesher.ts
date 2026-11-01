// Construtor de geometria "na mão": empurra quadriláteros, caixas, triângulos e
// cilindros direto em arrays (posição, normal, uv em metros e cor), um balde por
// material, e no fim vira uma malha por material. É o que deixa montar um bloco
// inteiro da cidade (centenas de casas, dezenas de milhares de peças) em poucos
// milissegundos: nada de criar uma BoxGeometry por peça nem juntar geometrias.
//
// Tudo é desenhado num "referencial" (origem no mundo + giro em torno de Y):
// x local para a direita, y para cima, z local para fora (para quem olha a
// peça de frente). `setFrame` posiciona o referencial; `sub` empilha um
// referencial dentro do atual (uma parede, um anexo).
import * as THREE from "three";

/** Cor linear (r, g, b), já convertida do sRGB. */
export type Rgb = [number, number, number];

const tmpColor = new THREE.Color();
/** Cor de "#rrggbb" para a cor linear dos vértices. */
export const rgb = (hex: string): Rgb => {
  tmpColor.set(hex);
  return [tmpColor.r, tmpColor.g, tmpColor.b];
};
/** Mistura duas cores (t = 0 → a, 1 → b). */
export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Escurece (k < 1) ou clareia (k > 1). */
export const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

class Bucket {
  pos = new Float32Array(3 * 1024);
  nor = new Float32Array(3 * 1024);
  uv = new Float32Array(2 * 1024);
  col = new Float32Array(3 * 1024);
  idx = new Uint32Array(1536);
  nv = 0;
  ni = 0;

  reserve(vertices: number, indices: number) {
    if (this.nv + vertices > this.pos.length / 3) {
      const size = Math.max((this.pos.length / 3) * 2, this.nv + vertices);
      const grow = (old: Float32Array, n: number) => {
        const next = new Float32Array(size * n);
        next.set(old);
        return next;
      };
      this.pos = grow(this.pos, 3);
      this.nor = grow(this.nor, 3);
      this.col = grow(this.col, 3);
      this.uv = grow(this.uv, 2);
    }
    if (this.ni + indices > this.idx.length) {
      const next = new Uint32Array(Math.max(this.idx.length * 2, this.ni + indices));
      next.set(this.idx);
      this.idx = next;
    }
  }
}

/**
 * Baldes reaproveitados de uma montagem para a outra (crescem até o tamanho do
 * maior bloco e ficam): alocar e copiar arrays a cada bloco era a maior parte
 * do tempo. Por isso só um `Mesher` pode estar montando por vez (o `finish`
 * copia o resultado para fora).
 */
const pool: Bucket[] = [];

export class Mesher {
  private buckets: (Bucket | null)[] = [];
  // Referencial atual: origem no mundo e giro (c = cos, s = sin).
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private c = 1;
  private s = 0;
  private angle = 0;
  private stack: number[] = [];
  /**
   * Sujeira na base das paredes: escurece os vértices perto do chão
   * (`grime` = quanto, até `grimeHeight` metros acima de `grimeFloor`).
   */
  grime = 0;
  grimeFloor = 0;
  grimeHeight = 2.5;

  private materials: THREE.Material[];

  constructor(materials: THREE.Material[]) {
    this.materials = materials;
  }

  setFrame(x: number, y: number, z: number, angle: number) {
    this.ox = x;
    this.oy = y;
    this.oz = z;
    this.angle = angle;
    this.c = Math.cos(angle);
    this.s = Math.sin(angle);
    this.stack.length = 0;
  }

  /** Empilha um referencial dentro do atual: origem (x, y, z) local e giro `angle` a mais. */
  push(x: number, y: number, z: number, angle: number) {
    this.stack.push(this.ox, this.oy, this.oz, this.angle);
    const wx = this.ox + x * this.c + z * this.s;
    const wz = this.oz - x * this.s + z * this.c;
    this.ox = wx;
    this.oy += y;
    this.oz = wz;
    this.angle += angle;
    this.c = Math.cos(this.angle);
    this.s = Math.sin(this.angle);
  }

  pop() {
    const angle = this.stack.pop()!;
    this.oz = this.stack.pop()!;
    this.oy = this.stack.pop()!;
    this.ox = this.stack.pop()!;
    this.angle = angle;
    this.c = Math.cos(angle);
    this.s = Math.sin(angle);
  }

  /** Ponto local → mundo (para checar rua, chão etc.). */
  world(x: number, z: number): [number, number] {
    return [this.ox + x * this.c + z * this.s, this.oz - x * this.s + z * this.c];
  }

  private bucket(m: number) {
    let b = this.buckets[m];
    if (!b) {
      b = this.buckets[m] = pool[m] ??= new Bucket();
      b.nv = 0;
      b.ni = 0;
    }
    return b;
  }

  private vertex(b: Bucket, x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, col: Rgb) {
    const i = b.nv++;
    b.pos[i * 3] = this.ox + x * this.c + z * this.s;
    b.pos[i * 3 + 1] = this.oy + y;
    b.pos[i * 3 + 2] = this.oz - x * this.s + z * this.c;
    b.nor[i * 3] = nx * this.c + nz * this.s;
    b.nor[i * 3 + 1] = ny;
    b.nor[i * 3 + 2] = -nx * this.s + nz * this.c;
    b.uv[i * 2] = u;
    b.uv[i * 2 + 1] = v;
    let k = 1;
    if (this.grime > 0) {
      const t = (this.oy + y - this.grimeFloor) / this.grimeHeight;
      if (t < 1) k = 1 - this.grime * (1 - Math.max(0, t));
    }
    b.col[i * 3] = col[0] * k;
    b.col[i * 3 + 1] = col[1] * k;
    b.col[i * 3 + 2] = col[2] * k;
  }

  /**
   * Quadrilátero p0 p1 p2 p3 (embaixo à esquerda, embaixo à direita, em cima à
   * direita, em cima à esquerda, para quem olha de frente). UV em metros,
   * projetado: paredes usam (ao longo da parede, altura); pisos e telhados
   * planos usam (x, z). `uv` = [u0, v0, u1, v1] força o retângulo de UV.
   */
  quad(
    m: number, col: Rgb,
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number, x3: number, y3: number, z3: number,
    uv?: readonly number[],
  ) {
    // Normal = (p1 - p0) × (p3 - p0).
    const ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
    const bx = x3 - x0, by = y3 - y0, bz = z3 - z0;
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const b = this.bucket(m);
    b.reserve(4, 6);
    const base = b.nv;
    if (uv) {
      this.vertex(b, x0, y0, z0, nx, ny, nz, uv[0], uv[1], col);
      this.vertex(b, x1, y1, z1, nx, ny, nz, uv[2], uv[1], col);
      this.vertex(b, x2, y2, z2, nx, ny, nz, uv[2], uv[3], col);
      this.vertex(b, x3, y3, z3, nx, ny, nz, uv[0], uv[3], col);
    } else if (Math.abs(ny) > 0.7) {
      const sign = ny > 0 ? 1 : -1;
      this.vertex(b, x0, y0, z0, nx, ny, nz, x0, -z0 * sign, col);
      this.vertex(b, x1, y1, z1, nx, ny, nz, x1, -z1 * sign, col);
      this.vertex(b, x2, y2, z2, nx, ny, nz, x2, -z2 * sign, col);
      this.vertex(b, x3, y3, z3, nx, ny, nz, x3, -z3 * sign, col);
    } else {
      // Tangente horizontal: up × n.
      let tx = nz;
      let tz = -nx;
      const tl = Math.sqrt(tx * tx + tz * tz) || 1;
      tx /= tl;
      tz /= tl;
      this.vertex(b, x0, y0, z0, nx, ny, nz, x0 * tx + z0 * tz, y0, col);
      this.vertex(b, x1, y1, z1, nx, ny, nz, x1 * tx + z1 * tz, y1, col);
      this.vertex(b, x2, y2, z2, nx, ny, nz, x2 * tx + z2 * tz, y2, col);
      this.vertex(b, x3, y3, z3, nx, ny, nz, x3 * tx + z3 * tz, y3, col);
    }
    const idx = b.idx;
    let n = b.ni;
    idx[n++] = base;
    idx[n++] = base + 1;
    idx[n++] = base + 2;
    idx[n++] = base;
    idx[n++] = base + 2;
    idx[n++] = base + 3;
    b.ni = n;
  }

  /** Triângulo (sentido anti-horário para quem olha de frente), UV projetado como no `quad` (ou `uv` = u0 v0 u1 v1 u2 v2). */
  tri(m: number, col: Rgb, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, uv?: readonly number[]) {
    const ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
    const bx = x2 - x0, by = y2 - y0, bz = z2 - z0;
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const b = this.bucket(m);
    b.reserve(3, 3);
    const base = b.nv;
    if (uv) {
      this.vertex(b, x0, y0, z0, nx, ny, nz, uv[0], uv[1], col);
      this.vertex(b, x1, y1, z1, nx, ny, nz, uv[2], uv[3], col);
      this.vertex(b, x2, y2, z2, nx, ny, nz, uv[4], uv[5], col);
    } else if (Math.abs(ny) > 0.7) {
      this.vertex(b, x0, y0, z0, nx, ny, nz, x0, -z0, col);
      this.vertex(b, x1, y1, z1, nx, ny, nz, x1, -z1, col);
      this.vertex(b, x2, y2, z2, nx, ny, nz, x2, -z2, col);
    } else {
      let tx = nz;
      let tz = -nx;
      const tl = Math.sqrt(tx * tx + tz * tz) || 1;
      tx /= tl;
      tz /= tl;
      this.vertex(b, x0, y0, z0, nx, ny, nz, x0 * tx + z0 * tz, y0, col);
      this.vertex(b, x1, y1, z1, nx, ny, nz, x1 * tx + z1 * tz, y1, col);
      this.vertex(b, x2, y2, z2, nx, ny, nz, x2 * tx + z2 * tz, y2, col);
    }
    b.idx[b.ni++] = base;
    b.idx[b.ni++] = base + 1;
    b.idx[b.ni++] = base + 2;
  }

  /** Retângulo vertical virado para +z local, em z = `z`. */
  front(m: number, col: Rgb, x0: number, x1: number, y0: number, y1: number, z: number, uv?: readonly number[]) {
    this.quad(m, col, x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z, uv);
  }

  /**
   * Caixa alinhada ao referencial. `skip` tira faces escondidas (soma de
   * BOX.*); por padrão a de baixo.
   */
  box(m: number, col: Rgb, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, skip: number = BOX.bottom) {
    if (!(skip & BOX.front)) this.quad(m, col, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1);
    if (!(skip & BOX.back)) this.quad(m, col, x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0);
    if (!(skip & BOX.left)) this.quad(m, col, x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0);
    if (!(skip & BOX.right)) this.quad(m, col, x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1);
    if (!(skip & BOX.top)) this.quad(m, col, x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0);
    if (!(skip & BOX.bottom)) this.quad(m, col, x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1);
  }

  /** Cilindro (ou tronco de cone) em pé, de y0 a y1, raios r0 embaixo e r1 em cima. */
  cylinder(m: number, col: Rgb, cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, segments = 10, top = true) {
    const step = (Math.PI * 2) / segments;
    for (let i = 0; i < segments; i++) {
      const a0 = i * step;
      const a1 = a0 + step;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      this.quad(
        m, col,
        cx + c1 * r0, y0, cz + s1 * r0, cx + c0 * r0, y0, cz + s0 * r0,
        cx + c0 * r1, y1, cz + s0 * r1, cx + c1 * r1, y1, cz + s1 * r1,
      );
      if (top) this.tri(m, col, cx, y1, cz, cx + c1 * r1, y1, cz + s1 * r1, cx + c0 * r1, y1, cz + s0 * r1);
    }
  }

  /** Barra fina entre dois pontos (vergalhão, fio, cano): caixa quadrada de lado `t`. */
  bar(m: number, col: Rgb, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, t: number) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz) || 1;
    // Dois eixos perpendiculares à barra.
    let px = -dz, py = 0, pz = dx;
    let pl = Math.hypot(px, pz);
    if (pl < 1e-4) {
      px = 1;
      pz = 0;
      pl = 1;
    }
    px = (px / pl) * (t / 2);
    pz = (pz / pl) * (t / 2);
    // q = barra × p
    let qx = (dy * pz - dz * py) / len, qy = (dz * px - dx * pz) / len, qz = (dx * py - dy * px) / len;
    const ql = Math.hypot(qx, qy, qz) || 1;
    qx = (qx / ql) * (t / 2);
    qy = (qy / ql) * (t / 2);
    qz = (qz / ql) * (t / 2);
    const corner = (sx: number, sy: number, end: number): [number, number, number] => [
      (end ? x1 : x0) + px * sx + qx * sy,
      (end ? y1 : y0) + py * sx + qy * sy,
      (end ? z1 : z0) + pz * sx + qz * sy,
    ];
    const sides: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = sides[i];
      const [bx, by] = sides[(i + 1) % 4];
      const a0 = corner(ax, ay, 0), b0 = corner(bx, by, 0), b1 = corner(bx, by, 1), a1 = corner(ax, ay, 1);
      this.quad(m, col, a0[0], a0[1], a0[2], b0[0], b0[1], b0[2], b1[0], b1[1], b1[2], a1[0], a1[1], a1[2]);
    }
  }

  /** Conta de triângulos até agora. */
  triangles() {
    let n = 0;
    for (const b of this.buckets) if (b) n += b.ni / 3;
    return n;
  }

  /** Vira um grupo com uma malha por material. */
  finish(name = "detalhe") {
    const group = new THREE.Group();
    group.name = name;
    this.buckets.forEach((b, m) => {
      if (!b || b.ni === 0) return;
      this.buckets[m] = null;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(b.pos.slice(0, b.nv * 3), 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(b.nor.slice(0, b.nv * 3), 3));
      geometry.setAttribute("uv", new THREE.BufferAttribute(b.uv.slice(0, b.nv * 2), 2));
      geometry.setAttribute("color", new THREE.BufferAttribute(b.col.slice(0, b.nv * 3), 3));
      const indices = b.nv < 65536 ? new Uint16Array(b.idx.subarray(0, b.ni)) : b.idx.slice(0, b.ni);
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, this.materials[m]);
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    });
    return group;
  }
}

/** Faces da caixa, para o `skip` do `Mesher.box`. */
export const BOX = { front: 1, back: 2, left: 4, right: 8, top: 16, bottom: 32 } as const;
