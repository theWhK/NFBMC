// Ambientação no clima "fim de tarde alaranjado" dos jogos de corrida de rua
// dos anos 2000: céu em degradê, sol baixo, prédios com janelas acesas no
// horizonte, postes de luz e outdoors de paródia.
import * as THREE from "three";
import { TRACK, nearestSample, pointOnTrack } from "@nfbmc/shared";

import { makeBurger } from "./models.ts";

export const FOG_COLOR = "#e0995a";
/** Direção de onde vem o sol (baixo, quase no horizonte). */
export const SUN_DIRECTION = new THREE.Vector3(-0.75, 0.16, 0.64).normalize();

/** Gerador pseudoaleatório com semente, para o cenário ser igual para todo mundo. */
export function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function glowTexture(inner: string) {
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
    new THREE.SphereGeometry(700, 32, 16),
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
  scene.add(sky);

  const sun = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture("rgba(255,240,200,1)"),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  sun.position.copy(SUN_DIRECTION).multiplyScalar(600);
  sun.scale.setScalar(110);
  scene.add(sun);
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

function buildSkyline(scene: THREE.Scene) {
  const random = seeded(99);
  const count = 110;
  const buildings = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({
      color: "#4a3f48",
      emissive: "#ffcf8a",
      emissiveMap: windowsTexture(),
      emissiveIntensity: 1.2,
    }),
    count,
  );
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + random() * 0.04;
    const radius = 270 + random() * 140;
    const height = 25 + random() ** 2 * 110;
    const width = 18 + random() * 22;
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle);
    matrix.compose(
      new THREE.Vector3(Math.cos(angle) * radius, height / 2, Math.sin(angle) * radius),
      quat,
      new THREE.Vector3(width, height, width * (0.7 + random() * 0.6)),
    );
    buildings.setMatrixAt(i, matrix);
  }
  scene.add(buildings);
}

function buildLamps(scene: THREE.Scene) {
  const spots: { x: number; z: number; heading: number; side: number }[] = [];
  for (let dist = 15, i = 0; dist < TRACK.length; dist += 34, i++) {
    const side = i % 2 === 0 ? 1 : -1;
    spots.push({ ...pointOnTrack(TRACK, dist, side * (TRACK.width / 2 + 2.5)), side });
  }

  const poles = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.15, 0.22, 9, 6),
    new THREE.MeshLambertMaterial({ color: "#2c2a2e" }),
    spots.length,
  );
  const heads = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.5, 0.22, 1.2),
    new THREE.MeshBasicMaterial({ color: "#ffe0a0" }),
    spots.length,
  );
  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture("rgba(255,214,140,1)"),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.8,
  });
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  spots.forEach((spot, i) => {
    matrix.compose(new THREE.Vector3(spot.x, 4.5, spot.z), quat, one);
    poles.setMatrixAt(i, matrix);
    // A luminária pende para dentro da pista.
    const inward = -spot.side * 1.2;
    const hx = spot.x + Math.cos(spot.heading) * inward;
    const hz = spot.z - Math.sin(spot.heading) * inward;
    matrix.compose(new THREE.Vector3(hx, 9, hz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spot.heading), one);
    heads.setMatrixAt(i, matrix);
    const glow = new THREE.Sprite(glowMaterial);
    glow.position.set(hx, 8.7, hz);
    glow.scale.setScalar(6);
    scene.add(glow);
  });
  scene.add(poles, heads);
}

/** Outdoors de paródia. O último é um aviso do que vem por aí. */
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
  const post = new THREE.MeshLambertMaterial({ color: "#3a3636" });
  BILLBOARDS.forEach((ad, i) => {
    const dist = 40 + (i * TRACK.length) / BILLBOARDS.length;
    const side = i % 2 === 0 ? 1 : -1;
    const spot = pointOnTrack(TRACK, dist, side * (TRACK.width / 2 + 14));
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

function buildTrees(scene: THREE.Scene) {
  // Árvores de brócolis, porque toda dieta precisa de um vegetal (de enfeite).
  const random = seeded(42);
  const spots: THREE.Vector3[] = [];
  while (spots.length < 110) {
    const x = (random() - 0.5) * 440;
    const z = (random() - 0.5) * 440;
    if (nearestSample(TRACK, x, z).distance < TRACK.width / 2 + 8) continue;
    spots.push(new THREE.Vector3(x, 0, z));
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
    const s = 0.7 + random() * 0.8;
    scale.setScalar(s);
    matrix.compose(new THREE.Vector3(spot.x, 1.5 * s, spot.z), quat, scale);
    stem.setMatrixAt(i, matrix);
    for (let k = 0; k < 3; k++) {
      const angle = (k / 3) * Math.PI * 2 + i;
      const pos = new THREE.Vector3(
        spot.x + Math.cos(angle) * 1.1 * s,
        (3.4 + (k === 0 ? 0.6 : 0)) * s,
        spot.z + Math.sin(angle) * 1.1 * s,
      );
      matrix.compose(pos, quat, scale);
      crown.setMatrixAt(i * 3 + k, matrix);
    }
  });
  scene.add(stem, crown);
}

export function buildScenery(scene: THREE.Scene) {
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.Fog(FOG_COLOR, 140, 520);
  scene.add(new THREE.HemisphereLight("#ffd9a8", "#4a3b2a", 1.4));
  const sun = new THREE.DirectionalLight("#ffb36b", 2.4);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(200);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1200, 1200),
    new THREE.MeshLambertMaterial({ color: "#7d8a3e" }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  buildSky(scene);
  buildSkyline(scene);
  buildLamps(scene);
  buildBillboards(scene);
  buildTrees(scene);

  // Hambúrgueres gigantes pelo infield, como estátuas.
  for (const [x, z, size] of [[30, -40, 14], [-50, 50, 18], [85, -30, 10], [-80, -50, 12]] as const) {
    const statue = makeBurger();
    statue.scale.setScalar(size);
    statue.position.set(x, 0, z);
    statue.rotation.y = x;
    scene.add(statue);
  }
}
