// Porto Gordo em 3D, no clima "fim de tarde alaranjado" dos jogos de corrida de
// rua dos anos 2000: céu em degradê, sol baixo, prédios com janelas acesas,
// ruas com faixa, postes, praças com árvores de brócolis e o autódromo no parque.
// A planta da cidade (ruas, quarteirões, prédios) vem do shared/world.ts.
import * as THREE from "three";
import {
  BLOCKS,
  BUILDINGS,
  PARK,
  RACES,
  STREETS,
  STREET_LINES,
  STREET_WIDTH,
  WORLD_LIMIT,
  pointOnTrack,
  seeded,
} from "@nfbmc/shared";

import { bake, makeBurger } from "./models.ts";
import { buildTrackMesh } from "./track-mesh.ts";

export const FOG_COLOR = "#e0995a";
/** Direção de onde vem o sol (baixo, quase no horizonte). */
export const SUN_DIRECTION = new THREE.Vector3(-0.75, 0.16, 0.64).normalize();

const Y = new THREE.Vector3(0, 1, 0);

export function glowTexture(inner: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.25, inner);
  gradient.addColorStop(1, "rgba(255,160,60,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildSky(scene: THREE.Scene) {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1400, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color("#2e2f55") },
        middle: { value: new THREE.Color("#e3884a") },
        horizon: { value: new THREE.Color("#ffb45e") },
        sun: { value: SUN_DIRECTION },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 middle; uniform vec3 horizon; uniform vec3 sun;
        varying vec3 vDir;
        void main() {
          float h = max(vDir.y, 0.0);
          vec3 color = mix(horizon, middle, smoothstep(0.0, 0.18, h));
          color = mix(color, top, smoothstep(0.18, 0.7, h));
          // Brilho em volta do sol.
          float glow = pow(max(dot(vDir, sun), 0.0), 12.0);
          color += vec3(1.0, 0.6, 0.25) * glow * 0.6;
          gl_FragColor = vec4(color, 1.0);
        }`,
    }),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);

  const sun = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture("rgba(255,240,200,1)"),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  sun.position.copy(SUN_DIRECTION).multiplyScalar(1200);
  sun.scale.setScalar(220);
  scene.add(sun);
  return { sky, sun };
}

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

const buildingMaterial = (color: string, fog = true) =>
  new THREE.MeshLambertMaterial({
    color,
    emissive: "#ffcf8a",
    emissiveMap: windowsTexture(),
    emissiveIntensity: 1.2,
    fog,
  });

function buildBuildings(scene: THREE.Scene) {
  const random = seeded(31);
  const palette = ["#4a3f48", "#544a3e", "#3e4450", "#5a4a44"].map((c) => new THREE.Color(c));
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), buildingMaterial("#ffffff"), BUILDINGS.length);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  BUILDINGS.forEach((b, i) => {
    matrix.compose(
      new THREE.Vector3((b.minX + b.maxX) / 2, b.height / 2, (b.minZ + b.maxZ) / 2),
      quat,
      new THREE.Vector3(b.maxX - b.minX, b.height, b.maxZ - b.minZ),
    );
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, palette[Math.floor(random() * palette.length)]);
  });
  scene.add(mesh);
}

/** Silhueta de cidade além do muro do mapa, para o horizonte não ficar vazio. */
function buildSkyline(scene: THREE.Scene) {
  const random = seeded(99);
  const count = 140;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), buildingMaterial("#3a3238", false), count);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + random() * 0.03;
    const radius = 820 + random() * 200;
    const height = 40 + random() ** 2 * 180;
    const width = 30 + random() * 40;
    quat.setFromAxisAngle(Y, -angle);
    matrix.compose(
      new THREE.Vector3(Math.cos(angle) * radius, height / 2, Math.sin(angle) * radius),
      quat,
      new THREE.Vector3(width, height, width),
    );
    mesh.setMatrixAt(i, matrix);
  }
  scene.add(mesh);
}

/** Ruas, faixas tracejadas e calçadas. */
function buildStreets(scene: THREE.Scene) {
  // As camadas do chão ficam separadas na altura e com polygonOffset: com pouca
  // precisão de profundidade (alguns celulares, renderização por software) o chão
  // "brigava" com o asfalto e a rua sumia.
  const asphalt = new THREE.MeshLambertMaterial({ color: "#3f3f45", polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const streetMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), asphalt, STREETS.length);
  const streetMatrix = new THREE.Matrix4();
  STREETS.forEach((s, i) => {
    streetMatrix.compose(
      new THREE.Vector3((s.minX + s.maxX) / 2, 0.05, (s.minZ + s.maxZ) / 2),
      new THREE.Quaternion(),
      new THREE.Vector3(s.maxX - s.minX, 1, s.maxZ - s.minZ),
    );
    streetMesh.setMatrixAt(i, streetMatrix);
  });
  scene.add(streetMesh);

  // Faixa amarela tracejada no meio das ruas, sem passar pelos cruzamentos.
  const dashes: THREE.Vector3[] = [];
  const dashAngles: number[] = [];
  const nearCrossing = (v: number) => STREET_LINES.some((l) => Math.abs(v - l) < STREET_WIDTH / 2 + 2);
  for (const s of STREETS) {
    const vertical = s.maxZ - s.minZ > s.maxX - s.minX;
    const from = vertical ? s.minZ : s.minX;
    const to = vertical ? s.maxZ : s.maxX;
    for (let v = from + 3; v < to - 3; v += 9) {
      if (nearCrossing(v)) continue;
      dashes.push(vertical ? new THREE.Vector3((s.minX + s.maxX) / 2, 0.12, v) : new THREE.Vector3(v, 0.12, (s.minZ + s.maxZ) / 2));
      dashAngles.push(vertical ? 0 : Math.PI / 2);
    }
  }
  const dashGeometry = new THREE.PlaneGeometry(0.35, 4);
  dashGeometry.rotateX(-Math.PI / 2);
  const dashMesh = new THREE.InstancedMesh(dashGeometry, new THREE.MeshBasicMaterial({ color: "#e8c547" }), dashes.length);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  dashes.forEach((p, i) => {
    quat.setFromAxisAngle(Y, dashAngles[i]);
    matrix.compose(p, quat, one);
    dashMesh.setMatrixAt(i, matrix);
  });
  scene.add(dashMesh);

  // Calçada (quarteirões com prédios) e grama (praças e parque).
  const blocks = BLOCKS.filter((b) => b.kind !== "park");
  const tops = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.3, 1), new THREE.MeshLambertMaterial({ color: "#ffffff" }), blocks.length);
  const sidewalk = new THREE.Color("#8d8478");
  const grass = new THREE.Color("#6f8a3a");
  blocks.forEach((b, i) => {
    matrix.compose(
      new THREE.Vector3((b.minX + b.maxX) / 2, 0.15, (b.minZ + b.maxZ) / 2),
      new THREE.Quaternion(),
      new THREE.Vector3(b.maxX - b.minX, 1, b.maxZ - b.minZ),
    );
    tops.setMatrixAt(i, matrix);
    tops.setColorAt(i, b.kind === "plaza" ? grass : sidewalk);
  });
  scene.add(tops);
}

/** Postes ao longo das ruas, com o brilho das lâmpadas num só Points (barato). */
function buildLamps(scene: THREE.Scene) {
  const spots: THREE.Vector3[] = [];
  for (const s of STREETS) {
    const vertical = s.maxZ - s.minZ > s.maxX - s.minX;
    const from = vertical ? s.minZ : s.minX;
    const to = vertical ? s.maxZ : s.maxX;
    let side = 1;
    for (let v = from + 20; v < to; v += 50) {
      side = -side;
      const offset = side * (STREET_WIDTH / 2 + 1.5);
      spots.push(vertical
        ? new THREE.Vector3((s.minX + s.maxX) / 2 + offset, 0, v)
        : new THREE.Vector3(v, 0, (s.minZ + s.maxZ) / 2 + offset));
    }
  }
  // Também em volta do autódromo.
  const track = RACES.autodromo.track;
  for (let dist = 15, i = 0; dist < track.length; dist += 34, i++) {
    const p = pointOnTrack(track, dist, (i % 2 ? 1 : -1) * (track.width / 2 + 2.5));
    spots.push(new THREE.Vector3(p.x, 0, p.z));
  }

  const poles = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.15, 0.22, 9, 6),
    new THREE.MeshLambertMaterial({ color: "#2c2a2e" }),
    spots.length,
  );
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const glowPositions: number[] = [];
  spots.forEach((p, i) => {
    matrix.compose(new THREE.Vector3(p.x, 4.5, p.z), quat, one);
    poles.setMatrixAt(i, matrix);
    glowPositions.push(p.x, 9, p.z);
  });
  const glowGeometry = new THREE.BufferGeometry();
  glowGeometry.setAttribute("position", new THREE.Float32BufferAttribute(glowPositions, 3));
  const glows = new THREE.Points(
    glowGeometry,
    new THREE.PointsMaterial({
      size: 7,
      map: glowTexture("rgba(255,214,140,1)"),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  scene.add(poles, glows);
}

/** Outdoors de paródia em volta do autódromo. O último é um aviso do que vem por aí. */
const BILLBOARDS: { title: string; subtitle: string; bg: string; fg: string }[] = [
  { title: "PODRÃO DO ZÉ", subtitle: "X-TUDO R$ 9,90 · 24 HORAS", bg: "#c1121f", fg: "#ffd23f" },
  { title: "COXINHA TURBO", subtitle: "abastece você e o carro", bg: "#f4a261", fg: "#3d1f0b" },
  { title: "REFRI 3 LITROS", subtitle: "pra tomar sozinho", bg: "#1d3557", fg: "#ffffff" },
  { title: "ACADEMIA", subtitle: "segunda-feira eu começo", bg: "#2a9d8f", fg: "#ffffff" },
  { title: "LISTA GORDA", subtitle: "você está nela?", bg: "#16110d", fg: "#ffd23f" },
  { title: "VIGILÂNCIA SANITÁRIA", subtitle: "estamos de olho 👀", bg: "#f1f1f1", fg: "#c1121f" },
];

function billboardTexture(ad: (typeof BILLBOARDS)[number]) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const draw = () => {
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = ad.bg;
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = ad.fg;
    ctx.lineWidth = 10;
    ctx.strokeRect(12, 12, 488, 232);
    ctx.fillStyle = ad.fg;
    ctx.textAlign = "center";
    ctx.font = "64px 'Russo One', sans-serif";
    ctx.fillText(ad.title, 256, 120, 460);
    ctx.font = "32px 'Russo One', sans-serif";
    ctx.fillText(ad.subtitle, 256, 185, 460);
    texture.needsUpdate = true;
  };
  draw();
  // A fonte pode não ter carregado ainda; redesenha quando carregar.
  document.fonts?.load("64px 'Russo One'").then(draw).catch(() => {});
  return texture;
}

function buildBillboards(scene: THREE.Scene) {
  const track = RACES.autodromo.track;
  const post = new THREE.MeshLambertMaterial({ color: "#3a3636" });
  BILLBOARDS.forEach((ad, i) => {
    const dist = 40 + (i * track.length) / BILLBOARDS.length;
    const side = i % 2 === 0 ? 1 : -1;
    const spot = pointOnTrack(track, dist, side * (track.width / 2 + 14));
    const board = new THREE.Group();
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 8),
      new THREE.MeshLambertMaterial({ map: billboardTexture(ad), emissive: "#ffffff", emissiveIntensity: 0.25, side: THREE.DoubleSide }),
    );
    face.position.y = 9;
    board.add(face);
    for (const x of [-5, 5]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 0.5), post);
      leg.position.set(x, 3, -0.3);
      board.add(leg);
    }
    board.position.set(spot.x, 0, spot.z);
    // Vira o outdoor de frente para quem vem pela pista, meio de lado.
    board.rotation.y = spot.heading + Math.PI + side * 0.6;
    scene.add(board);
  });
}

/** Árvores de brócolis nas praças e no parque, porque toda dieta precisa de um vegetal (de enfeite). */
function buildTrees(scene: THREE.Scene) {
  const random = seeded(42);
  const autodromo = RACES.autodromo.track;
  const spots: THREE.Vector3[] = [];
  for (const b of BLOCKS) {
    if (b.kind !== "plaza" && b.kind !== "park") continue;
    const count = b.kind === "plaza" ? 14 : 10;
    for (let k = 0; k < count; k++) {
      const x = b.minX + 6 + random() * (b.maxX - b.minX - 12);
      const z = b.minZ + 6 + random() * (b.maxZ - b.minZ - 12);
      // No parque, longe da pista do autódromo.
      if (b.kind === "park" && autodromo.samples.some((s) => Math.hypot(s.x - x, s.z - z) < autodromo.width / 2 + 8)) continue;
      // Na praça, deixa o miolo livre para a estátua.
      if (b.kind === "plaza" && Math.hypot(x - (b.minX + b.maxX) / 2, z - (b.minZ + b.maxZ) / 2) < 22) continue;
      spots.push(new THREE.Vector3(x, b.kind === "plaza" ? 0.3 : 0, z));
    }
  }

  const stem = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.5, 0.8, 3, 8),
    new THREE.MeshLambertMaterial({ color: "#9bc25b" }),
    spots.length,
  );
  const crown = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(2.4, 1),
    new THREE.MeshLambertMaterial({ color: "#3d7d2c", flatShading: true }),
    spots.length * 3,
  );
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  spots.forEach((spot, i) => {
    const s = 0.8 + random() * 0.9;
    scale.setScalar(s);
    matrix.compose(new THREE.Vector3(spot.x, spot.y + 1.5 * s, spot.z), quat, scale);
    stem.setMatrixAt(i, matrix);
    for (let k = 0; k < 3; k++) {
      const angle = (k / 3) * Math.PI * 2 + i;
      const pos = new THREE.Vector3(
        spot.x + Math.cos(angle) * 1.1 * s,
        spot.y + (3.4 + (k === 0 ? 0.6 : 0)) * s,
        spot.z + Math.sin(angle) * 1.1 * s,
      );
      matrix.compose(pos, quat, scale);
      crown.setMatrixAt(i * 3 + k, matrix);
    }
  });
  scene.add(stem, crown);

  // Um hambúrguer gigante no meio de cada praça, como estátua.
  for (const b of BLOCKS) {
    if (b.kind !== "plaza") continue;
    const statue = bake(makeBurger());
    statue.scale.setScalar(12 + random() * 6);
    statue.position.set((b.minX + b.maxX) / 2, 0.3, (b.minZ + b.maxZ) / 2);
    statue.rotation.y = random() * Math.PI;
    scene.add(statue);
  }
}

export function buildScenery(scene: THREE.Scene) {
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.Fog(FOG_COLOR, 160, 620);
  scene.add(new THREE.HemisphereLight("#ffd9a8", "#4a3b2a", 1.4));
  const sun = new THREE.DirectionalLight("#ffb36b", 2.4);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(200);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 3000),
    new THREE.MeshLambertMaterial({ color: "#6b7337" }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.15;
  scene.add(ground);

  // Grama mais viva no parque do autódromo.
  const park = new THREE.Mesh(
    new THREE.PlaneGeometry(PARK.maxX - PARK.minX, PARK.maxZ - PARK.minZ),
    new THREE.MeshLambertMaterial({ color: "#6f8a3a" }),
  );
  park.rotation.x = -Math.PI / 2;
  park.position.set((PARK.minX + PARK.maxX) / 2, -0.05, (PARK.minZ + PARK.maxZ) / 2);
  scene.add(park);

  // Muro do mapa: uma mureta baixa em volta de tudo.
  const wallMaterial = new THREE.MeshLambertMaterial({ color: "#5b4f45" });
  for (const [x, z, w, d] of [
    [0, WORLD_LIMIT + 2, WORLD_LIMIT * 2 + 8, 2],
    [0, -WORLD_LIMIT - 2, WORLD_LIMIT * 2 + 8, 2],
    [WORLD_LIMIT + 2, 0, 2, WORLD_LIMIT * 2 + 8],
    [-WORLD_LIMIT - 2, 0, 2, WORLD_LIMIT * 2 + 8],
  ]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 2.5, d), wallMaterial);
    wall.position.set(x, 1.25, z);
    scene.add(wall);
  }

  const { sky, sun: sunSprite } = buildSky(scene);
  buildSkyline(scene);
  buildStreets(scene);
  buildBuildings(scene);
  buildLamps(scene);
  buildBillboards(scene);
  buildTrees(scene);
  scene.add(buildTrackMesh(RACES.autodromo.track, { asphalt: true }));
  return { sky, sun: sunSprite };
}
