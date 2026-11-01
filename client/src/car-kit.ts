// Ferramentas para esculpir os carros: curvas suaves, carrocerias montadas por
// seções transversais ao longo do comprimento (loft), "adesivos" que seguem a
// superfície da lataria (faróis, vidros, faixas, grades), varreduras de uma
// seção ao longo de um caminho (aerofólios, para-choques) e a caixa de peças
// que junta tudo por material (uma malha por material, poucas chamadas de desenho).
//
// Eixos: x é a lateral (+ = direita de quem dirige), y é a altura e z o
// comprimento (+ = frente). Perfis são pares [z, y]; plantas, [z, meia largura].
import * as THREE from "three";

export type P2 = [number, number];
export type Fn = (t: number) => number;

// --- Curvas -------------------------------------------------------------------

/**
 * Curva suave pelos pontos (o primeiro valor de cada par cresce), cúbica e
 * monotônica entre os pontos (Fritsch-Carlson): não passa do ponto nem ondula.
 * Fora do intervalo, fica no valor da ponta.
 */
export function curve(points: P2[]): Fn {
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  if (n === 1) return () => ys[0];
  const d: number[] = [];
  const h: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  }
  const m = new Array<number>(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  // Nas pontas, a inclinação não pode inverter (senão a curva passa do ponto).
  if (n > 2) {
    if (m[0] * d[0] < 0) m[0] = 0;
    if (m[n - 1] * d[n - 2] < 0) m[n - 1] = 0;
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    let j = n - 1;
    while (j - i > 1) {
      const k = (i + j) >> 1;
      if (xs[k] > x) j = k;
      else i = k;
    }
    const t = (x - xs[i]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Lombada suave: 1 no centro, 0 a partir de `radius` (cosseno). */
export const bump = (x: number, center: number, radius: number) => {
  const t = Math.abs(x - center) / radius;
  return t >= 1 ? 0 : 0.5 + 0.5 * Math.cos(t * Math.PI);
};

/** Arredonda as quinas de um contorno fechado (Chaikin). */
export function rounded(points: P2[], passes = 3, closed = true): P2[] {
  let pts = points;
  for (let k = 0; k < passes; k++) {
    const next: P2[] = [];
    const count = closed ? pts.length : pts.length - 1;
    if (!closed) next.push(pts[0]);
    for (let i = 0; i < count; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    if (!closed) next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

/** Elipse (ou círculo) como contorno. */
export function ellipse(cx: number, cy: number, rx: number, ry: number, segments = 32, start = 0): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = start + (i / segments) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

/** Retângulo de quinas arredondadas (raio `r`) como contorno. */
export function roundRect(a0: number, b0: number, a1: number, b1: number, r: number, seg = 5): P2[] {
  const rr = Math.min(r, Math.abs(a1 - a0) / 2, Math.abs(b1 - b0) / 2);
  const out: P2[] = [];
  const corners: [number, number, number][] = [
    [a1 - rr, b0 + rr, -Math.PI / 2], [a1 - rr, b1 - rr, 0], [a0 + rr, b1 - rr, Math.PI / 2], [a0 + rr, b0 + rr, Math.PI],
  ];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = start + (i / seg) * (Math.PI / 2);
      out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  }
  return out;
}

/** Corta um contorno convexo pelo semiplano a·p + b·q + c ≥ 0 (Sutherland-Hodgman). */
export function clip(poly: P2[], a: number, b: number, c: number): P2[] {
  const out: P2[] = [];
  const f = (p: P2) => a * p[0] + b * p[1] + c;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const fp = f(p);
    const fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) {
      const t = fp / (fp - fq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

/** Corta pela reta que passa por p e q, ficando do lado de `keep`. */
export function clipLine(poly: P2[], p: P2, q: P2, keep: P2): P2[] {
  const a = q[1] - p[1];
  const b = p[0] - q[0];
  let c = -(a * p[0] + b * p[1]);
  let s = 1;
  if (a * keep[0] + b * keep[1] + c < 0) s = -1;
  c *= s;
  return clip(poly, a * s, b * s, c);
}

/** Reamostra um contorno para nenhum lado passar de `step` (os adesivos seguem melhor a curva). */
export function densify(poly: P2[], step: number, closed = true): P2[] {
  const out: P2[] = [];
  const count = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < count; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / step));
    for (let k = 0; k < n; k++) out.push([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]);
  }
  if (!closed) out.push(poly[poly.length - 1]);
  return out;
}

// --- Sólidos por seções (loft) -----------------------------------------------

export interface SectionShape {
  /** Expoente da superelipse em cima e embaixo: 2 = redondo, 6+ = quadrado de quinas redondas. */
  nTop: number;
  nBot: number;
  /** Quanto as laterais fecham para cima ("tumblehome") e para baixo, 0 a ~0,4. */
  tumble: number;
  tuck: number;
  /** Abaulado do teto/capô: quanto as quinas de cima descem em relação ao meio (fração). */
  crown: number;
}

export interface SolidSpec {
  z0: number;
  z1: number;
  top: Fn;
  bottom: Fn;
  /** Meia largura no ponto mais largo da seção. */
  half: Fn;
  /** Altura do ponto mais largo (a linha de ombro). Padrão: 60% da altura. */
  shoulder?: Fn;
  /** Centro lateral da seção (peças de um lado só, como o para-lama do Fusca). */
  cx?: Fn;
  shape: SectionShape;
  /** Muda o expoente de cima ao longo do comprimento (opcional). */
  nTopAt?: Fn;
  /** Muda o abaulado ao longo do comprimento (negativo = laterais mais altas que o meio). */
  crownAt?: Fn;
  /** Alargamento extra numa altura (para-lamas estufados). */
  flare?: (z: number, y: number) => number;
  /** Piso mínimo num ponto (as caixas de roda): devolve a altura mínima ou -Infinity. */
  clamp?: (z: number, x: number) => number;
}

const DENSE = 72;

/**
 * Sólido montado por seções transversais: cada seção é uma superelipse
 * (ombro, laterais fechando para cima, teto abaulado), com a altura de baixo e
 * de cima e a meia largura vindas das curvas do perfil e da planta.
 */
export class Solid {
  readonly spec: SolidSpec;
  private cache = new Map<number, Float64Array>();

  constructor(spec: SolidSpec) {
    this.spec = spec;
  }

  center(z: number) {
    return this.spec.cx ? this.spec.cx(z) : 0;
  }

  /** Meio contorno denso (do centro de baixo ao centro de cima, lado +x): pares [dx, y] relativos ao centro. */
  private dense(z: number, withClamp: boolean): Float64Array {
    const s = this.spec;
    const yT = s.top(z);
    const yB = Math.min(s.bottom(z), yT - 0.002);
    const ySraw = s.shoulder ? s.shoulder(z) : yB + (yT - yB) * 0.6;
    const yS = Math.min(yT - 0.001, Math.max(yB + 0.001, ySraw));
    const hw = Math.max(0.001, s.half(z));
    const { nBot, tumble, tuck } = s.shape;
    const crown = s.crownAt ? s.crownAt(z) : s.shape.crown;
    const nTop = s.nTopAt ? s.nTopAt(z) : s.shape.nTop;
    const cx = this.center(z);
    const out = new Float64Array((DENSE + 1) * 2);
    for (let k = 0; k <= DENSE; k++) {
      const theta = -Math.PI / 2 + (k / DENSE) * Math.PI;
      const c = Math.max(0, Math.cos(theta));
      const sn = Math.sin(theta);
      const n = sn >= 0 ? nTop : nBot;
      const X0 = Math.pow(c, 2 / n);
      const Y0 = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n);
      let y = Y0 >= 0 ? yS + Y0 * (yT - yS) : yS + Y0 * (yS - yB);
      // Abaulado: o meio fica na altura de cima e as quinas descem (ou sobem, se negativo).
      if (Y0 > 0) y -= crown * (yT - yS) * X0 * X0 * Y0;
      const wf = Y0 >= 0 ? 1 - tumble * Y0 * Y0 : 1 - tuck * Y0 * Y0;
      let x = hw * X0 * wf;
      if (s.flare && x > 0.002) x += s.flare(z, y) * X0;
      if (withClamp && s.clamp) y = Math.max(y, Math.min(yT, s.clamp(z, cx + x)));
      out[k * 2] = x;
      out[k * 2 + 1] = y;
    }
    return out;
  }

  private ring(z: number): Float64Array {
    const key = Math.round(z * 1000);
    let r = this.cache.get(key);
    if (!r) {
      r = this.dense(key / 1000, true);
      this.cache.set(key, r);
    }
    return r;
  }

  /** Meia largura (a partir do centro) na altura y; -1 se a seção não chega lá. */
  width(z: number, y: number): number {
    if (z < this.spec.z0 || z > this.spec.z1) return -1;
    const r = this.ring(z);
    let best = -1;
    for (let k = 0; k < DENSE; k++) {
      const y0 = r[k * 2 + 1];
      const y1 = r[k * 2 + 3];
      if ((y >= y0 && y <= y1) || (y >= y1 && y <= y0)) {
        const t = y1 === y0 ? 1 : (y - y0) / (y1 - y0);
        const x = r[k * 2] + (r[k * 2 + 2] - r[k * 2]) * t;
        if (x > best) best = x;
      }
    }
    return best;
  }

  /** Lateral da superfície (lado +x) em (z, y), ou null. */
  side(z: number, y: number): number | null {
    const w = this.width(z, y);
    return w < 0 ? null : this.center(z) + w;
  }

  /** Altura de cima da superfície em (z, x), ou null. */
  top(z: number, x: number): number | null {
    if (z < this.spec.z0 || z > this.spec.z1) return null;
    const r = this.ring(z);
    const dx = Math.abs(x - this.center(z));
    if (dx <= r[DENSE * 2] + 1e-6) return r[DENSE * 2 + 1];
    for (let k = DENSE; k > 0; k--) {
      const xa = r[k * 2];
      const xb = r[k * 2 - 2];
      if (dx >= xa && dx <= xb) {
        const t = xb === xa ? 0 : (dx - xa) / (xb - xa);
        return r[k * 2 + 1] + (r[k * 2 - 1] - r[k * 2 + 1]) * t;
      }
    }
    return null;
  }

  private contains(z: number, x: number, y: number) {
    const w = this.width(z, y);
    return w >= 0 && Math.abs(x - this.center(z)) <= w;
  }

  /** z da superfície da frente (o ponto mais à frente) em (x, y), ou null. */
  front(x: number, y: number): number | null {
    return this.search(x, y, this.spec.z1, -1);
  }

  rear(x: number, y: number): number | null {
    return this.search(x, y, this.spec.z0, 1);
  }

  private search(x: number, y: number, from: number, dir: number): number | null {
    // A frente/traseira nunca fica a mais de ~1 m da ponta: não precisa varrer o carro todo.
    const span = Math.min(1.1, this.spec.z1 - this.spec.z0);
    const step = 0.03;
    let prev = from;
    if (this.contains(from, x, y)) return from;
    for (let d = step; d <= span; d += step) {
      const z = from + dir * d;
      if (this.contains(z, x, y)) {
        let a = prev;
        let b = z;
        for (let i = 0; i < 7; i++) {
          const m = (a + b) / 2;
          if (this.contains(m, x, y)) b = m;
          else a = m;
        }
        return b;
      }
      prev = z;
    }
    return null;
  }

  /** Esquece as seções guardadas (depois de montar o carro). */
  release() {
    this.cache.clear();
  }

  /**
   * Malha do sólido nas posições `zs` (crescentes), com `ringN` pontos por
   * seção (par). As pontas são fechadas com uma tampa plana.
   */
  geometry(zs: number[], ringN: number, caps = true): THREE.BufferGeometry {
    const halfN = ringN / 2;
    const positions: number[] = [];
    const index: number[] = [];
    const rings: number[][] = [];
    for (const z of zs) {
      const d = this.dense(z, false);
      // Reamostra o meio contorno por comprimento de arco (pontos bem espalhados).
      const len: number[] = [0];
      for (let k = 1; k <= DENSE; k++) len.push(len[k - 1] + Math.hypot(d[k * 2] - d[k * 2 - 2], d[k * 2 + 1] - d[k * 2 - 1]));
      const total = len[DENSE] || 1;
      const half: P2[] = [];
      let j = 0;
      for (let i = 0; i <= halfN; i++) {
        const target = (i / halfN) * total;
        while (j < DENSE - 1 && len[j + 1] < target) j++;
        const seg = len[j + 1] - len[j] || 1;
        const t = Math.min(1, Math.max(0, (target - len[j]) / seg));
        half.push([d[j * 2] + (d[j * 2 + 2] - d[j * 2]) * t, d[j * 2 + 1] + (d[j * 2 + 3] - d[j * 2 + 1]) * t]);
      }
      half[0][0] = 0;
      half[halfN][0] = 0;
      const cx = this.center(z);
      const yT = this.spec.top(z);
      const ring: number[] = [];
      const push = (dx: number, y: number) => {
        let yy = y;
        if (this.spec.clamp) yy = Math.max(yy, Math.min(yT, this.spec.clamp(z, cx + dx)));
        ring.push(positions.length / 3);
        positions.push(cx + dx, yy, z);
      };
      for (let i = 0; i <= halfN; i++) push(half[i][0], half[i][1]);
      for (let i = halfN - 1; i >= 1; i--) push(-half[i][0], half[i][1]);
      rings.push(ring);
    }
    for (let s = 0; s < rings.length - 1; s++) {
      const r0 = rings[s];
      const r1 = rings[s + 1];
      for (let i = 0; i < ringN; i++) {
        const a = r0[i];
        const b = r0[(i + 1) % ringN];
        const c = r1[(i + 1) % ringN];
        const d = r1[i];
        index.push(a, b, d, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    if (!caps) return g;
    const parts = [g];
    for (const [ring, dir] of [[rings[0], -1], [rings[rings.length - 1], 1]] as const) {
      const pts = ring.map((i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
      let area = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        area += p[0] * q[1] - q[0] * p[1];
      }
      if (Math.abs(area) < 1e-4) continue;
      const cap: number[] = [];
      const cxm = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const cym = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        if (dir > 0) cap.push(cxm, cym, p[2], ...p, ...q);
        else cap.push(cxm, cym, p[2], ...q, ...p);
      }
      const cg = new THREE.BufferGeometry();
      cg.setAttribute("position", new THREE.Float32BufferAttribute(cap, 3));
      cg.computeVertexNormals();
      parts.push(cg);
    }
    return mergeParts(parts.map((p) => ({ geometry: p, color: null })), false);
  }
}

/** Posições das seções: passo `step`, mais fino (`fine`) perto das pontas e dos trechos pedidos. */
export function sections(z0: number, z1: number, step: number, fine: number, dense: [number, number][] = [], edge = 0.12): number[] {
  const zs: number[] = [];
  let z = z0;
  while (z < z1) {
    zs.push(z);
    const nearEdge = z - z0 < edge || z1 - z < edge;
    const nearDense = dense.some(([a, b]) => z >= a - fine && z <= b);
    // Bem nas pontas, mais fino ainda (é onde a lataria faz a curva da frente).
    const tip = z - z0 < edge * 0.35 || z1 - z < edge * 0.35;
    z += tip ? fine * 0.5 : nearEdge || nearDense ? fine : step;
  }
  zs.push(z1);
  return zs;
}

// --- Superfícies e adesivos -------------------------------------------------

/** Um lado do sólido visto como superfície: (a, b) → ponto na lataria. */
export interface Surface {
  at(a: number, b: number): [number, number, number] | null;
  /** Para onde a superfície olha (a normal aponta para esse lado). */
  dir: [number, number, number];
}

export const Surf = {
  /** Frente: a = x, b = y. */
  front: (s: Solid): Surface => ({ at: (a, b) => { const z = s.front(a, b); return z === null ? null : [a, b, z]; }, dir: [0, 0, 1] }),
  rear: (s: Solid): Surface => ({ at: (a, b) => { const z = s.rear(a, b); return z === null ? null : [a, b, z]; }, dir: [0, 0, -1] }),
  /** Lateral: a = z, b = y; `side` = +1 (direita) ou -1 (esquerda). */
  side: (s: Solid, side: number): Surface => ({
    at: (a, b) => { const x = s.side(a, b); return x === null ? null : [x * side, b, a]; },
    dir: [side, 0, 0],
  }),
  /** Por cima: a = x, b = z. Com vários sólidos, vale o mais alto. */
  top: (...solids: Solid[]): Surface => ({
    at: (a, b) => {
      let best: number | null = null;
      for (const s of solids) {
        const y = s.top(b, a);
        if (y !== null && (best === null || y > best)) best = y;
      }
      return best === null ? null : [a, best, b];
    },
    dir: [0, 1, 0],
  }),
};

export interface PatchOptions {
  /** Distância da lataria (m). */
  off?: number;
  /** Altura da "lente" no meio (m): faróis abaulados. */
  dome?: number;
  /** Anéis do centro até a borda. */
  rings?: number;
  /** Passo máximo do contorno (m). */
  step?: number;
  /** Divisões da grade (só nos retângulos). */
  na?: number;
  nb?: number;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/** Ponto na superfície com a normal (por diferenças), já afastado `off` dela. */
function surfacePoint(surface: Surface, a: number, b: number, off: number): number[] | null {
  const p = surface.at(a, b);
  if (!p) return null;
  const e = 0.006;
  const pa = surface.at(a + e, b) ?? p;
  const pa2 = surface.at(a - e, b) ?? p;
  const pb = surface.at(a, b + e) ?? p;
  const pb2 = surface.at(a, b - e) ?? p;
  tmpA.set(pa[0] - pa2[0], pa[1] - pa2[1], pa[2] - pa2[2]);
  tmpB.set(pb[0] - pb2[0], pb[1] - pb2[1], pb[2] - pb2[2]);
  const n = tmpA.cross(tmpB);
  if (n.lengthSq() < 1e-12) n.set(...surface.dir);
  n.normalize();
  if (n.x * surface.dir[0] + n.y * surface.dir[1] + n.z * surface.dir[2] < 0) n.negate();
  return [p[0] + n.x * off, p[1] + n.y * off, p[2] + n.z * off];
}

function finishPatch(positions: number[], index: number[], surface: Surface): THREE.BufferGeometry {
  // Garante que cada triângulo olha para fora da lataria.
  for (let t = 0; t < index.length; t += 3) {
    const [i, j, k] = [index[t] * 3, index[t + 1] * 3, index[t + 2] * 3];
    tmpA.set(positions[j] - positions[i], positions[j + 1] - positions[i + 1], positions[j + 2] - positions[i + 2]);
    tmpB.set(positions[k] - positions[i], positions[k + 1] - positions[i + 1], positions[k + 2] - positions[i + 2]);
    const n = tmpA.cross(tmpB);
    if (n.x * surface.dir[0] + n.y * surface.dir[1] + n.z * surface.dir[2] < 0) {
      const tmp = index[t + 1];
      index[t + 1] = index[t + 2];
      index[t + 2] = tmp;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Adesivo de contorno qualquer (estrelado em relação ao centro), que acompanha a lataria. */
export function patchPoly(surface: Surface, outline: P2[], opts: PatchOptions = {}): THREE.BufferGeometry | null {
  const off = opts.off ?? 0.004;
  const dome = opts.dome ?? 0;
  const rings = opts.rings ?? 5;
  const pts = densify(outline, opts.step ?? 0.035);
  if (pts.length < 3) return null;
  const ca = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cb = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const positions: number[] = [];
  const ids: (number | -1)[][] = [];
  for (let r = 0; r < rings; r++) {
    const f = 1 - r / rings;
    const t = r / rings;
    const lift = dome * Math.sin((t * Math.PI) / 2);
    const row: number[] = [];
    for (const p of pts) {
      const q = surfacePoint(surface, ca + (p[0] - ca) * f, cb + (p[1] - cb) * f, off + lift);
      if (!q) { row.push(-1); continue; }
      row.push(positions.length / 3);
      positions.push(...q);
    }
    ids.push(row);
  }
  const center = surfacePoint(surface, ca, cb, off + dome);
  const ci = center ? positions.length / 3 : -1;
  if (center) positions.push(...center);
  const index: number[] = [];
  const n = pts.length;
  for (let r = 0; r < rings; r++) {
    for (let i = 0; i < n; i++) {
      const a = ids[r][i];
      const b = ids[r][(i + 1) % n];
      if (r === rings - 1) {
        if (a >= 0 && b >= 0 && ci >= 0) index.push(a, b, ci);
        continue;
      }
      const c = ids[r + 1][(i + 1) % n];
      const d = ids[r + 1][i];
      if (a >= 0 && b >= 0 && d >= 0) index.push(a, b, d);
      if (b >= 0 && c >= 0 && d >= 0) index.push(b, c, d);
    }
  }
  if (!index.length) return null;
  return finishPatch(positions, index, surface);
}

/** Adesivo retangular em grade (faixas compridas, placas). */
export function patchRect(surface: Surface, a0: number, a1: number, b0: number, b1: number, opts: PatchOptions = {}): THREE.BufferGeometry | null {
  const off = opts.off ?? 0.004;
  const step = opts.step ?? 0.04;
  const na = opts.na ?? Math.max(1, Math.ceil(Math.abs(a1 - a0) / step));
  const nb = opts.nb ?? Math.max(1, Math.ceil(Math.abs(b1 - b0) / step));
  const positions: number[] = [];
  const ids: number[][] = [];
  for (let j = 0; j <= nb; j++) {
    const row: number[] = [];
    for (let i = 0; i <= na; i++) {
      const q = surfacePoint(surface, a0 + ((a1 - a0) * i) / na, b0 + ((b1 - b0) * j) / nb, off);
      if (!q) { row.push(-1); continue; }
      row.push(positions.length / 3);
      positions.push(...q);
    }
    ids.push(row);
  }
  const index: number[] = [];
  for (let j = 0; j < nb; j++) {
    for (let i = 0; i < na; i++) {
      const a = ids[j][i];
      const b = ids[j][i + 1];
      const c = ids[j + 1][i + 1];
      const d = ids[j + 1][i];
      if (a >= 0 && b >= 0 && d >= 0) index.push(a, b, d);
      if (b >= 0 && c >= 0 && d >= 0) index.push(b, c, d);
    }
  }
  if (!index.length) return null;
  return finishPatch(positions, index, surface);
}

/** Faixa fina ao longo de um caminho (linhas de porta, frisos). */
export function patchStrip(surface: Surface, path: P2[], width: number, opts: PatchOptions = {}): THREE.BufferGeometry | null {
  const off = opts.off ?? 0.004;
  const pts = densify(path, opts.step ?? 0.03, false);
  const positions: number[] = [];
  const ids: number[][] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[Math.min(pts.length - 1, i + 1)];
    const o = pts[Math.max(0, i - 1)];
    let ta = q[0] - o[0];
    let tb = q[1] - o[1];
    const l = Math.hypot(ta, tb) || 1;
    ta /= l;
    tb /= l;
    const row: number[] = [];
    for (const s of [-1, 1]) {
      const v = surfacePoint(surface, p[0] - tb * s * width / 2, p[1] + ta * s * width / 2, off);
      if (!v) { row.push(-1); continue; }
      row.push(positions.length / 3);
      positions.push(...v);
    }
    ids.push(row);
  }
  const index: number[] = [];
  for (let i = 0; i < ids.length - 1; i++) {
    const [a, b] = ids[i];
    const [d, c] = ids[i + 1];
    if (a >= 0 && b >= 0 && d >= 0) index.push(a, b, d);
    if (b >= 0 && c >= 0 && d >= 0) index.push(b, c, d);
  }
  if (!index.length) return null;
  return finishPatch(positions, index, surface);
}

// --- Varreduras ----------------------------------------------------------------

/**
 * Varre uma seção 2D fechada ao longo de um caminho 3D. Na seção, u vai para o
 * lado (`up` × tangente... ou seja, tangente × up) e v para cima. As pontas são tampadas.
 */
export function sweep(path: THREE.Vector3[], section: P2[] | ((t: number) => P2[]), up = new THREE.Vector3(0, 1, 0), caps = true): THREE.BufferGeometry {
  const positions: number[] = [];
  const index: number[] = [];
  const n = path.length;
  const sec0 = typeof section === "function" ? section(0) : section;
  const m = sec0.length;
  const side = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(n - 1, i + 1)];
    tangent.subVectors(b, a).normalize();
    side.crossVectors(tangent, up).normalize();
    normal.crossVectors(side, tangent).normalize();
    const sec = typeof section === "function" ? section(i / (n - 1)) : section;
    for (const [u, v] of sec) {
      const p = path[i];
      positions.push(p.x + side.x * u + normal.x * v, p.y + side.y * u + normal.y * v, p.z + side.z * u + normal.z * v);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < m; j++) {
      const a = i * m + j;
      const b = i * m + ((j + 1) % m);
      const c = (i + 1) * m + ((j + 1) % m);
      const d = (i + 1) * m + j;
      index.push(a, d, b, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  orientOutward(g);
  g.computeVertexNormals();
  if (!caps) return g;
  const parts = [g];
  for (const [start, flip] of [[0, true], [(n - 1) * m, false]] as const) {
    const cap: number[] = [];
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < m; j++) {
      cx += positions[(start + j) * 3] / m;
      cy += positions[(start + j) * 3 + 1] / m;
      cz += positions[(start + j) * 3 + 2] / m;
    }
    for (let j = 0; j < m; j++) {
      const p = (start + j) * 3;
      const q = (start + ((j + 1) % m)) * 3;
      const P = positions.slice(p, p + 3);
      const Q = positions.slice(q, q + 3);
      if (flip) cap.push(cx, cy, cz, ...Q, ...P);
      else cap.push(cx, cy, cz, ...P, ...Q);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute("position", new THREE.Float32BufferAttribute(cap, 3));
    // A tampa olha para fora do caminho.
    const dirv = start === 0 ? new THREE.Vector3().subVectors(path[0], path[1]) : new THREE.Vector3().subVectors(path[n - 1], path[n - 2]);
    orientAlong(cg, dirv);
    cg.computeVertexNormals();
    parts.push(cg);
  }
  return mergeParts(parts.map((geometry) => ({ geometry, color: null })), false);
}

/** Vira os triângulos de uma malha fechada para fora (pelo volume com sinal). */
function orientOutward(g: THREE.BufferGeometry) {
  const pos = g.attributes.position.array as Float32Array;
  const idx = g.index!.array as Uint16Array | Uint32Array;
  let c = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) c.add(tmpA.set(pos[i], pos[i + 1], pos[i + 2]));
  c = c.multiplyScalar(3 / pos.length);
  let vol = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, d = idx[t + 2] * 3;
    tmpA.set(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]);
    tmpB.set(pos[d] - pos[a], pos[d + 1] - pos[a + 1], pos[d + 2] - pos[a + 2]);
    const n = tmpA.cross(tmpB);
    vol += n.x * (pos[a] - c.x) + n.y * (pos[a + 1] - c.y) + n.z * (pos[a + 2] - c.z);
  }
  if (vol < 0) {
    const arr = Array.from(idx);
    for (let t = 0; t < arr.length; t += 3) [arr[t + 1], arr[t + 2]] = [arr[t + 2], arr[t + 1]];
    g.setIndex(arr);
  }
}

function orientAlong(g: THREE.BufferGeometry, dir: THREE.Vector3) {
  const pos = g.attributes.position.array as Float32Array;
  for (let t = 0; t < pos.length; t += 9) {
    tmpA.set(pos[t + 3] - pos[t], pos[t + 4] - pos[t + 1], pos[t + 5] - pos[t + 2]);
    tmpB.set(pos[t + 6] - pos[t], pos[t + 7] - pos[t + 1], pos[t + 8] - pos[t + 2]);
    if (tmpA.cross(tmpB).dot(dir) < 0) {
      for (let k = 0; k < 3; k++) [pos[t + 3 + k], pos[t + 6 + k]] = [pos[t + 6 + k], pos[t + 3 + k]];
    }
  }
}

// --- Caixa de peças ----------------------------------------------------------

/** Materiais de um carro: a pintura muda por cor, o resto é igual em todos. */
export type MatName = "paint" | "accent" | "glass" | "chrome" | "trim" | "lamp" | "food" | "rubber" | "metal";

/** Materiais que usam a cor de cada vértice (peças de cores diferentes na mesma malha). */
export const VERTEX_COLORED: Record<MatName, boolean> = {
  paint: false, accent: true, glass: false, chrome: false, trim: true, lamp: true, food: true, rubber: false, metal: true,
};

interface Piece {
  geometry: THREE.BufferGeometry;
  color: THREE.Color | null;
}

/** Junta geometrias (com índice ou não) numa só, com a cor de cada peça nos vértices se pedido. */
export function mergeParts(pieces: Piece[], colored: boolean): THREE.BufferGeometry {
  let vertexCount = 0;
  let indexCount = 0;
  for (const { geometry } of pieces) {
    vertexCount += geometry.attributes.position.count;
    indexCount += geometry.index ? geometry.index.count : geometry.attributes.position.count;
  }
  const pos = new Float32Array(vertexCount * 3);
  const nor = new Float32Array(vertexCount * 3);
  const col = colored ? new Float32Array(vertexCount * 3) : null;
  const idx = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  let vo = 0;
  let io = 0;
  for (const { geometry, color } of pieces) {
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const p = geometry.attributes.position;
    const n = geometry.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i);
      pos[(vo + i) * 3 + 1] = p.getY(i);
      pos[(vo + i) * 3 + 2] = p.getZ(i);
      nor[(vo + i) * 3] = n.getX(i);
      nor[(vo + i) * 3 + 1] = n.getY(i);
      nor[(vo + i) * 3 + 2] = n.getZ(i);
    }
    if (col) {
      const c = color ?? new THREE.Color(1, 1, 1);
      for (let i = 0; i < p.count; i++) col.set([c.r, c.g, c.b], (vo + i) * 3);
    }
    if (geometry.index) {
      const gi = geometry.index;
      for (let i = 0; i < gi.count; i++) idx[io + i] = gi.getX(i) + vo;
      io += gi.count;
    } else {
      for (let i = 0; i < p.count; i++) idx[io + i] = vo + i;
      io += p.count;
    }
    vo += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  if (col) g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/** Espelha uma geometria no eixo x (o outro lado do carro). */
export function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.clone();
  m.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  if (m.index) {
    const arr = Array.from(m.index.array);
    for (let t = 0; t < arr.length; t += 3) [arr[t + 1], arr[t + 2]] = [arr[t + 2], arr[t + 1]];
    m.setIndex(arr);
  } else {
    const p = m.attributes.position.array as Float32Array;
    const n = m.attributes.normal?.array as Float32Array | undefined;
    for (let t = 0; t < p.length; t += 9) {
      for (let k = 0; k < 3; k++) {
        [p[t + 3 + k], p[t + 6 + k]] = [p[t + 6 + k], p[t + 3 + k]];
        if (n) [n[t + 3 + k], n[t + 6 + k]] = [n[t + 6 + k], n[t + 3 + k]];
      }
    }
  }
  return m;
}

const dummy = new THREE.Object3D();

/** As peças de um carro, separadas por material; no fim vira uma geometria por material. */
export class Bin {
  private parts = new Map<MatName, Piece[]>();

  add(mat: MatName, geometry: THREE.BufferGeometry | null, color?: THREE.ColorRepresentation | null) {
    if (!geometry) return;
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== "position" && name !== "normal") geometry.deleteAttribute(name);
    }
    let list = this.parts.get(mat);
    if (!list) this.parts.set(mat, (list = []));
    list.push({ geometry, color: color === undefined || color === null ? null : new THREE.Color(color) });
  }

  /** Peça pronta do Three.js, posicionada (posição, rotação em radianos, escala). */
  place(mat: MatName, geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation | null, x: number, y: number, z: number, rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]) {
    dummy.position.set(x, y, z);
    dummy.rotation.set(rot[0], rot[1], rot[2]);
    dummy.scale.set(scale[0], scale[1], scale[2]);
    dummy.updateMatrix();
    const g = geometry;
    g.applyMatrix4(dummy.matrix);
    if (scale[0] * scale[1] * scale[2] < 0 && g.index) {
      const arr = Array.from(g.index.array);
      for (let t = 0; t < arr.length; t += 3) [arr[t + 1], arr[t + 2]] = [arr[t + 2], arr[t + 1]];
      g.setIndex(arr);
    }
    this.add(mat, g, color);
  }

  /** Passa tudo de outra caixa para esta, com uma transformação. */
  absorb(other: Map<MatName, THREE.BufferGeometry>, matrix: THREE.Matrix4) {
    for (const [mat, g] of other) {
      const c = g.clone().applyMatrix4(matrix);
      const colors = c.attributes.color as THREE.BufferAttribute | undefined;
      let list = this.parts.get(mat);
      if (!list) this.parts.set(mat, (list = []));
      if (colors && VERTEX_COLORED[mat]) {
        // Mantém as cores: guarda como peça já colorida (cor por vértice).
        list.push({ geometry: c, color: null });
        (c.userData as { colors?: THREE.BufferAttribute }).colors = colors;
      } else list.push({ geometry: c, color: null });
    }
  }

  build(): Map<MatName, THREE.BufferGeometry> {
    const out = new Map<MatName, THREE.BufferGeometry>();
    for (const [mat, pieces] of this.parts) {
      if (!pieces.length) continue;
      const merged = mergeParts(pieces, VERTEX_COLORED[mat]);
      // Peças que já vinham com cor por vértice (rodas fundidas no trânsito).
      if (VERTEX_COLORED[mat]) {
        let offset = 0;
        const col = merged.attributes.color as THREE.BufferAttribute;
        for (const piece of pieces) {
          const own = (piece.geometry.userData as { colors?: THREE.BufferAttribute }).colors;
          if (own) for (let i = 0; i < own.count; i++) col.setXYZ(offset + i, own.getX(i), own.getY(i), own.getZ(i));
          offset += piece.geometry.attributes.position.count;
        }
      }
      out.set(mat, merged);
    }
    return out;
  }
}
