// Bichos das fazendas: vacas holandesas, bois nelore (com cupim), cavalos,
// porcos, ovelhas e galinhas. Formas simples (caixas e esferas) juntadas numa
// geometria por espécie, com a cor nos vértices; a cabeça é separada para poder
// baixar e pastar. Cada cercado vira um InstancedMesh por espécie (corpo e
// cabeça), e a animação (andar devagar de um ponto a outro dentro do cercado,
// parar, pastar, ciscar) é calculada pelo relógio, sem estado: sempre igual.
// São só enfeite: não têm colisão e nunca saem do cercado.
import * as THREE from "three";
import { heightAt, seeded, toWorld, type AnimalKind, type Farm, type Pen } from "@nfbmc/shared";

import { surface } from "./look.ts";

// --- Formas ------------------------------------------------------------------------------

type Part = [THREE.BufferGeometry, string];

/** Junta as peças numa geometria com cor por vértice. */
function merge(parts: Part[]) {
  let count = 0;
  const prepared = parts.map(([g, color]) => {
    const geometry = g.index ? g.toNonIndexed() : g;
    count += geometry.attributes.position.count;
    return { geometry, color: new THREE.Color(color) };
  });
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let at = 0;
  for (const { geometry, color } of prepared) {
    const n = geometry.attributes.position.count;
    position.set(geometry.attributes.position.array as Float32Array, at * 3);
    normal.set(geometry.attributes.normal.array as Float32Array, at * 3);
    for (let i = 0; i < n; i++) {
      colors[(at + i) * 3] = color.r;
      colors[(at + i) * 3 + 1] = color.g;
      colors[(at + i) * 3 + 2] = color.b;
    }
    at += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(position, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  out.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  out.computeBoundingSphere();
  out.userData.shared = true;
  return out;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) =>
  new THREE.BoxGeometry(w, h, d).rotateX(rx).translate(x, y, z);
const ball = (r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, detail = 1) =>
  new THREE.SphereGeometry(r, 8 + detail * 4, 6 + detail * 2).scale(sx, sy, sz).translate(x, y, z);
const legs = (w: number, d: number, h: number, t: number, color: string, hoof: string): Part[] =>
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].flatMap(([sx, sz]) => [
    [box(t, h - 0.12, t, (sx * w) / 2, (h - 0.12) / 2 + 0.12, (sz * d) / 2), color] as Part,
    [box(t * 1.05, 0.12, t * 1.05, (sx * w) / 2, 0.06, (sz * d) / 2), hoof] as Part,
  ]);

interface Species {
  body: THREE.BufferGeometry;
  /** Cabeça (com o pescoço), desenhada a partir do ponto de giro. */
  head: THREE.BufferGeometry;
  /** Ponto de giro da cabeça (no corpo). */
  neck: THREE.Vector3;
  /** Inclinação da cabeça andando e pastando (rad, positivo = para baixo). */
  up: number;
  down: number;
  speed: number;
  /** Cores possíveis (multiplicam as cores dos vértices). */
  coats: string[];
  scale: [number, number];
}

let species: Record<AnimalKind, Species> | null = null;

function build(): Record<AnimalKind, Species> {
  if (species) return species;
  const WHITE = "#f2efe8";
  const BLACK = "#1e1e1e";
  const PINK = "#e8a9a0";

  // Vaca holandesa: branca com manchas pretas, úbere rosado.
  const cow: Species = {
    body: merge([
      [ball(1, 0, 1.2, 0, 0.44, 0.42, 0.95), WHITE],
      [ball(0.42, 0.16, 1.32, 0.28, 0.75, 0.75, 0.95), BLACK],
      [ball(0.34, -0.2, 1.25, -0.42, 0.75, 0.8, 1), BLACK],
      [box(0.4, 0.2, 0.45, 0, 0.75, -0.45), PINK],
      [box(0.08, 0.8, 0.08, 0, 1.05, -0.92, 0.25), WHITE],
      [box(0.14, 0.22, 0.12, 0, 0.62, -1.02), BLACK],
      ...legs(0.58, 1.35, 0.85, 0.17, WHITE, BLACK),
    ]),
    head: merge([
      [box(0.36, 0.38, 0.6, 0, 0.0, 0.25, -0.5), WHITE],
      [box(0.34, 0.36, 0.48, 0, -0.18, 0.62), BLACK],
      [box(0.3, 0.2, 0.16, 0, -0.32, 0.86), PINK],
      [box(0.62, 0.08, 0.1, 0, -0.02, 0.5), "#e8e2d0"],
      [box(0.22, 0.12, 0.06, 0.26, -0.08, 0.5), BLACK],
      [box(0.22, 0.12, 0.06, -0.26, -0.08, 0.5), BLACK],
    ]),
    neck: new THREE.Vector3(0, 1.38, 0.82),
    up: 0.15,
    down: 1.05,
    speed: 0.45,
    coats: ["#ffffff", "#ffffff", "#f3e2c8", "#d9a066"],
    scale: [0.92, 1.05],
  };
  // Boi nelore: branco-acinzentado, cupim, barbela e orelha caída.
  const GREY = "#dcd8cf";
  const ox: Species = {
    body: merge([
      [ball(1, 0, 1.25, 0, 0.42, 0.44, 1.0), GREY],
      [ball(0.32, 0, 1.68, 0.55, 1, 0.9, 1.3), GREY],
      [box(0.3, 0.45, 0.6, 0, 0.82, 0.75), GREY],
      [box(0.08, 0.85, 0.08, 0, 1.1, -0.98, 0.2), GREY],
      [box(0.14, 0.24, 0.12, 0, 0.62, -1.07), BLACK],
      ...legs(0.56, 1.42, 0.86, 0.16, GREY, "#2b2b2b"),
    ]),
    head: merge([
      [box(0.34, 0.4, 0.62, 0, -0.02, 0.27, -0.55), GREY],
      [box(0.3, 0.34, 0.45, 0, -0.2, 0.62), GREY],
      [box(0.28, 0.18, 0.12, 0, -0.33, 0.85), "#3a3a3a"],
      [box(0.08, 0.3, 0.12, 0.22, -0.2, 0.46), GREY],
      [box(0.08, 0.3, 0.12, -0.22, -0.2, 0.46), GREY],
      [box(0.1, 0.18, 0.08, 0.13, 0.12, 0.45), "#4a443a"],
      [box(0.1, 0.18, 0.08, -0.13, 0.12, 0.45), "#4a443a"],
    ]),
    neck: new THREE.Vector3(0, 1.45, 0.88),
    up: 0.2,
    down: 1.05,
    speed: 0.4,
    coats: ["#ffffff", "#f2f2f2", "#e6e1d6", "#cfc8bc"],
    scale: [0.95, 1.1],
  };
  // Cavalo: pernas compridas, pescoço alto, crina e rabo escuros.
  const MANE = "#2a1d14";
  const horse: Species = {
    body: merge([
      [ball(1, 0, 1.45, 0, 0.32, 0.37, 0.92), "#ffffff"],
      [box(0.08, 0.9, 0.12, 0, 1.2, -0.95, 0.35), MANE],
      ...legs(0.42, 1.3, 1.15, 0.13, "#ffffff", BLACK),
    ]),
    head: merge([
      [box(0.3, 0.95, 0.42, 0, 0.3, 0.1, 0.55), "#ffffff"],
      [box(0.08, 0.85, 0.18, 0, 0.42, -0.06, 0.55), MANE],
      [box(0.26, 0.26, 0.62, 0, 0.75, 0.55, 0.35), "#ffffff"],
      [box(0.07, 0.16, 0.06, 0.09, 0.98, 0.33), "#ffffff"],
      [box(0.07, 0.16, 0.06, -0.09, 0.98, 0.33), "#ffffff"],
    ]),
    neck: new THREE.Vector3(0, 1.6, 0.75),
    up: -0.05,
    down: 1.25,
    speed: 0.6,
    coats: ["#7a4a2a", "#5a3520", "#2b211c", "#d8cfc0", "#a0683a", "#8c8a86"],
    scale: [0.95, 1.08],
  };
  // Porco: rosado, perna curta, focinho.
  const pig: Species = {
    body: merge([
      [ball(0.5, 0, 0.62, 0, 0.75, 0.72, 1.35), "#ffffff"],
      [box(0.05, 0.05, 0.2, 0, 0.7, -0.68), "#ffffff"],
      ...legs(0.4, 0.8, 0.35, 0.12, "#ffffff", "#7a5a50"),
    ]),
    head: merge([
      [ball(0.27, 0, -0.02, 0.2, 1, 0.95, 1.05), "#ffffff"],
      [box(0.18, 0.15, 0.12, 0, -0.06, 0.46), "#d88a85"],
      [box(0.12, 0.14, 0.04, 0.15, 0.2, 0.18), "#ffffff"],
      [box(0.12, 0.14, 0.04, -0.15, 0.2, 0.18), "#ffffff"],
    ]),
    neck: new THREE.Vector3(0, 0.66, 0.55),
    up: 0.1,
    down: 0.55,
    speed: 0.35,
    coats: ["#f4b8b0", "#f0c2b8", "#e9a99f", "#d8b0a0"],
    scale: [0.9, 1.15],
  };
  // Ovelha: lã fofa, cara e pernas pretas.
  const sheep: Species = {
    body: merge([
      [ball(0.5, 0, 0.82, 0, 0.85, 0.82, 1.2, 1), "#ffffff"],
      [ball(0.3, 0.2, 1.08, 0.25, 1, 0.8, 1, 1), "#ffffff"],
      [ball(0.3, -0.2, 1.06, -0.25, 1, 0.8, 1, 1), "#ffffff"],
      ...legs(0.36, 0.7, 0.5, 0.09, BLACK, BLACK),
    ]),
    head: merge([
      [box(0.2, 0.24, 0.36, 0, -0.04, 0.2, -0.3), "#222222"],
      [ball(0.17, 0, 0.1, 0.05, 1, 0.8, 1, 1), "#ffffff"],
      [box(0.2, 0.06, 0.08, 0.15, 0.0, 0.12), "#222222"],
      [box(0.2, 0.06, 0.08, -0.15, 0.0, 0.12), "#222222"],
    ]),
    neck: new THREE.Vector3(0, 0.98, 0.5),
    up: 0.1,
    down: 0.9,
    speed: 0.35,
    coats: ["#f4f1ea", "#ece6da", "#e2dccf", "#ffffff"],
    scale: [0.9, 1.1],
  };
  // Galinha: pequena, rabo para cima, crista vermelha.
  const chicken: Species = {
    body: merge([
      [ball(0.17, 0, 0.3, 0, 0.85, 0.9, 1.15, 1), "#ffffff"],
      [box(0.08, 0.2, 0.14, 0, 0.42, -0.18, 0.5), "#ffffff"],
      [box(0.03, 0.18, 0.03, 0.06, 0.1, 0), "#e0a030"],
      [box(0.03, 0.18, 0.03, -0.06, 0.1, 0), "#e0a030"],
    ]),
    head: merge([
      [ball(0.09, 0, 0.06, 0.04, 1, 1.1, 1, 1), "#ffffff"],
      [box(0.03, 0.08, 0.09, 0, 0.17, 0.04), "#d62828"],
      [box(0.05, 0.04, 0.08, 0, 0.05, 0.14), "#e8b030"],
      [box(0.04, 0.06, 0.03, 0, -0.03, 0.1), "#d62828"],
    ]),
    neck: new THREE.Vector3(0, 0.4, 0.13),
    up: 0,
    down: 1.0,
    speed: 0.5,
    coats: ["#ffffff", "#8a4a22", "#c06a30", "#2b2b2b", "#e8d8b8", "#a35a2a"],
    scale: [0.9, 1.1],
  };
  species = { vaca: cow, boi: ox, cavalo: horse, porco: pig, ovelha: sheep, galinha: chicken };
  return species;
}

const material = surface(new THREE.MeshLambertMaterial({ vertexColors: true }), { roughness: 0.75 });

// --- Andar e pastar -------------------------------------------------------------------------

interface Leg {
  /** Ponto de saída e de chegada (u, n do cercado), quando começa e quanto dura. */
  from: [number, number];
  to: [number, number];
  t0: number;
  walk: number;
  graze: number;
}

interface Animal {
  legs: Leg[];
  cycle: number;
  scale: number;
  /** Rumo inicial (se o primeiro trecho for parado). */
  phase: number;
}

/** Roteiro de um bicho: pontos sorteados no cercado, com paradas para pastar. */
function plan(pen: Pen, sp: Species, random: () => number, chicken: boolean): Animal {
  const [u0, u1, n0, n1] = pen.local;
  const inset = chicken ? 0.6 : 2;
  const point = (): [number, number] => [u0 + inset + random() * (u1 - u0 - inset * 2), n0 + inset + random() * (n1 - n0 - inset * 2)];
  const legsList: Leg[] = [];
  let at = point();
  let t = 0;
  const steps = 5 + Math.floor(random() * 3);
  const start = at;
  for (let i = 0; i < steps; i++) {
    // O último trecho volta ao começo (o roteiro dá a volta).
    let to: [number, number] = i === steps - 1 ? start : point();
    // Passos curtos: no máximo uns 12 m (galinha: 3 m) por vez.
    const max = chicken ? 3 : 12;
    const d = Math.hypot(to[0] - at[0], to[1] - at[1]);
    if (d > max && i !== steps - 1) to = [at[0] + ((to[0] - at[0]) * max) / d, at[1] + ((to[1] - at[1]) * max) / d];
    const walk = Math.hypot(to[0] - at[0], to[1] - at[1]) / (sp.speed * (0.8 + random() * 0.4));
    const graze = chicken ? 2 + random() * 5 : 8 + random() * 22;
    legsList.push({ from: at, to, t0: t, walk, graze });
    t += walk + graze;
    at = to;
  }
  return { legs: legsList, cycle: t, scale: sp.scale[0] + random() * (sp.scale[1] - sp.scale[0]), phase: random() * t };
}

const tmp = {
  m: new THREE.Matrix4(),
  head: new THREE.Matrix4(),
  q: new THREE.Quaternion(),
  e: new THREE.Euler(),
  p: new THREE.Vector3(),
  s: new THREE.Vector3(),
};

/** Bichos de uma fazenda: um par de InstancedMesh (corpo, cabeça) por cercado. */
export function buildAnimals(farm: Farm): THREE.Object3D[] {
  const all = build();
  const out: THREE.Object3D[] = [];
  const f = farm.frame;
  // Rumo no mundo de quem anda +u e +n no referencial da fazenda.
  const headingOf = (du: number, dn: number) => Math.atan2(f.ux * du + f.nx * dn, f.uz * du + f.nz * dn);
  farm.pens.forEach((pen, k) => {
    const sp = all[pen.animal];
    const random = seeded(farm.id * 1013 + k * 71 + 9);
    const chicken = pen.animal === "galinha";
    const animals = Array.from({ length: pen.count }, () => plan(pen, sp, random, chicken));
    const coats = animals.map(() => new THREE.Color(sp.coats[Math.floor(random() * sp.coats.length)]));
    const body = new THREE.InstancedMesh(sp.body, material, animals.length);
    const head = new THREE.InstancedMesh(sp.head, material, animals.length);
    coats.forEach((c, i) => {
      body.setColorAt(i, c);
      head.setColorAt(i, c);
    });
    // A animação mexe nas matrizes: o InstancedMesh não pode sumir por estar "fora" do lugar antigo.
    body.frustumCulled = head.frustumCulled = false;
    const headings = animals.map(() => 0);
    let lastFrame = -1;
    const update = (time: number) => {
      animals.forEach((a, i) => {
        const t = (time + a.phase) % a.cycle;
        let leg = a.legs[a.legs.length - 1];
        for (const l of a.legs) if (t >= l.t0 && t < l.t0 + l.walk + l.graze) leg = l;
        const local = t - leg.t0;
        const walking = local < leg.walk;
        const k2 = walking ? local / leg.walk : 1;
        const u = leg.from[0] + (leg.to[0] - leg.from[0]) * k2;
        const n = leg.from[1] + (leg.to[1] - leg.from[1]) * k2;
        const du = leg.to[0] - leg.from[0];
        const dn = leg.to[1] - leg.from[1];
        // Vira para onde vai no começo do trecho (devagar) e fica assim parado.
        const target = Math.hypot(du, dn) > 0.01 ? headingOf(du, dn) : headings[i];
        const prev = a.legs[(a.legs.indexOf(leg) + a.legs.length - 1) % a.legs.length];
        const prevHeading = Math.hypot(prev.to[0] - prev.from[0], prev.to[1] - prev.from[1]) > 0.01 ? headingOf(prev.to[0] - prev.from[0], prev.to[1] - prev.from[1]) : target;
        const turn = Math.min(1, local / 1.5);
        let diff = target - prevHeading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        const heading = prevHeading + diff * turn;
        headings[i] = heading;
        const [x, z] = toWorld(f, u, n);
        // Andando: o corpo balança um pouco; pastando: a cabeça desce (a galinha cisca rápido).
        const bob = walking ? Math.abs(Math.sin(local * (chicken ? 14 : 5))) * (chicken ? 0.03 : 0.04) : 0;
        let pitch: number;
        if (walking) pitch = sp.up + Math.sin(local * 5) * 0.05;
        else if (chicken) pitch = Math.sin(local * 6) > 0.3 ? sp.down : 0.1;
        else {
          // Desce a cabeça no começo e levanta de vez em quando para olhar em volta.
          const g = local - leg.walk;
          const lookUp = Math.sin(g * 0.35 + i) > 0.85;
          pitch = lookUp ? sp.up : sp.up + (sp.down - sp.up) * Math.min(1, g / 1.2);
        }
        tmp.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, heading);
        tmp.p.set(x, heightAt(x, z) - 0.05 + bob, z);
        tmp.s.setScalar(a.scale);
        tmp.m.compose(tmp.p, tmp.q, tmp.s);
        body.setMatrixAt(i, tmp.m);
        // Cabeça: no pescoço, inclinada para baixo (giro em torno do x local).
        tmp.head.makeRotationX(pitch).setPosition(sp.neck);
        tmp.head.premultiply(tmp.m);
        head.setMatrixAt(i, tmp.head);
      });
      body.instanceMatrix.needsUpdate = true;
      head.instanceMatrix.needsUpdate = true;
    };
    update(0);
    body.onBeforeRender = (renderer) => {
      // Uma vez por quadro (a sombra também desenha).
      const frame = renderer.info.render.frame;
      if (frame === lastFrame) return;
      lastFrame = frame;
      update(performance.now() / 1000);
    };
    body.computeBoundingSphere();
    head.computeBoundingSphere();
    out.push(body, head);
  });
  return out;
}
