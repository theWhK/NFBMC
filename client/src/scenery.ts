// Porto Gordo em 3D, no clima "fim de tarde alaranjado" dos jogos de corrida de
// rua dos anos 2000: céu em degradê, sol baixo, prédios com janelas acesas,
// ruas com calçada e faixa, casas com telhado, galpões e contêineres no porto,
// o mar, o lago do parque e árvores de brócolis. A planta (ruas, prédios,
// árvores) vem do shared/world.ts; aqui só se desenha.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  BUILDINGS,
  DISTRICTS,
  LAKE,
  NAV,
  QUAY_Z,
  RACES,
  ROADS,
  TREES,
  WORLD_BOUNDS,
  pointOnTrack,
  seeded,
  type BuildingKind,
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

const PALETTES: Record<BuildingKind, string[]> = {
  tower: ["#3e4450", "#4a3f48", "#2f3a48", "#544a3e"],
  office: ["#6b5a4a", "#5a4a44", "#4e5560", "#6a6058"],
  shop: ["#f1e3c6", "#e8d2b0", "#d9e4dc", "#f3d6c8"],
  house: ["#f4e1b8", "#e9c46a", "#f2a3a3", "#a8d5c2", "#c9b8e8", "#f7f3ea"],
  warehouse: ["#7d8794", "#8a7f6e", "#6e7f8a", "#9a8f80"],
  container: ["#c1121f", "#2a6bff", "#e9c46a", "#2a9d8f", "#f4a261", "#6c757d"],
};
const AWNINGS = ["#c1121f", "#2a9d8f", "#f4a261", "#1d3557"];
const ROOFS = ["#8d3b2a", "#6b3a2a", "#4a4f57", "#7a4b2a"];

const instancedBoxes = (material: THREE.Material, list: { matrix: THREE.Matrix4; color: THREE.Color }[]) => {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, Math.max(1, list.length));
  list.forEach(({ matrix, color }, i) => {
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, color);
  });
  mesh.count = list.length;
  return mesh;
};

/** Matriz de uma caixa girada do mapa (base no chão). */
function boxMatrix(b: { x: number; z: number; w: number; d: number; angle: number }, height: number, y = 0, inset = 0) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(b.x, y + height / 2, b.z),
    new THREE.Quaternion().setFromAxisAngle(Y, b.angle),
    new THREE.Vector3(b.w - inset, height, b.d - inset),
  );
}

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

function buildBuildings(scene: THREE.Scene) {
  const random = seeded(31);
  const windowed: { matrix: THREE.Matrix4; color: THREE.Color }[] = [];
  const plain: { matrix: THREE.Matrix4; color: THREE.Color }[] = [];
  const awnings: { matrix: THREE.Matrix4; color: THREE.Color }[] = [];
  const roofs: { matrix: THREE.Matrix4; color: THREE.Color }[] = [];
  const color = (kind: BuildingKind, tint: number) => new THREE.Color(PALETTES[kind][tint % PALETTES[kind].length]);

  for (const b of BUILDINGS) {
    switch (b.kind) {
      case "tower":
      case "office":
        windowed.push({ matrix: boxMatrix(b, b.height), color: color(b.kind, b.tint) });
        break;
      case "shop": {
        windowed.push({ matrix: boxMatrix(b, b.height), color: color(b.kind, b.tint) });
        // Toldo listrado na frente da loja, virado para a rua.
        const fx = Math.sin(b.angle) * b.front;
        const fz = Math.cos(b.angle) * b.front;
        awnings.push({
          matrix: boxMatrix({ x: b.x + fx * (b.d / 2 + 0.9), z: b.z + fz * (b.d / 2 + 0.9), w: b.w * 0.9, d: 1.8, angle: b.angle }, 0.25, 3.2),
          color: new THREE.Color(AWNINGS[Math.floor(random() * AWNINGS.length)]),
        });
        break;
      }
      case "house":
        plain.push({ matrix: boxMatrix(b, b.height), color: color(b.kind, b.tint) });
        roofs.push({
          matrix: new THREE.Matrix4().compose(
            new THREE.Vector3(b.x, b.height, b.z),
            new THREE.Quaternion().setFromAxisAngle(Y, b.angle),
            new THREE.Vector3(b.w + 0.8, 2.6, b.d + 0.8),
          ),
          color: new THREE.Color(ROOFS[Math.floor(random() * ROOFS.length)]),
        });
        break;
      case "warehouse":
        plain.push({ matrix: boxMatrix(b, b.height), color: color(b.kind, b.tint) });
        break;
      case "container": {
        // Pilha de contêineres: um bloco por andar, com uma frestinha entre eles.
        const floors = Math.round(b.height / 2.6);
        for (let f = 0; f < floors; f++) {
          plain.push({ matrix: boxMatrix(b, 2.5, f * 2.6), color: color("container", b.tint + f) });
        }
        break;
      }
    }
  }

  const lambert = new THREE.MeshLambertMaterial({ color: "#ffffff" });
  scene.add(instancedBoxes(buildingMaterial("#ffffff"), windowed));
  scene.add(instancedBoxes(lambert, plain));
  scene.add(instancedBoxes(lambert, awnings));
  const roofMesh = new THREE.InstancedMesh(roofGeometry(), lambert, roofs.length);
  roofs.forEach(({ matrix, color: c }, i) => {
    roofMesh.setMatrixAt(i, matrix);
    roofMesh.setColorAt(i, c);
  });
  scene.add(roofMesh);
}

/** Silhueta de cidade além do muro do mapa (menos para o lado do mar). */
function buildSkyline(scene: THREE.Scene) {
  const random = seeded(99);
  const matrices: THREE.Matrix4[] = [];
  const quat = new THREE.Quaternion();
  for (let i = 0; i < 160; i++) {
    const angle = (i / 160) * Math.PI * 2 + random() * 0.03;
    const radius = 820 + random() * 200;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (z < QUAY_Z - 50) continue; // ali é mar
    const height = 40 + random() ** 2 * 180;
    const width = 30 + random() * 40;
    quat.setFromAxisAngle(Y, -angle);
    matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, height / 2, z), quat, new THREE.Vector3(width, height, width)));
  }
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), buildingMaterial("#3a3238", false), matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  scene.add(mesh);
}

/** Faixa ao longo de uma linha (rua): `half` metros para cada lado. */
function stripGeometry(points: [number, number][], half: number, y: number) {
  const positions: number[] = [];
  const indices: number[] = [];
  points.forEach(([x, z], i) => {
    const [px, pz] = points[Math.max(0, i - 1)];
    const [nx, nz] = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(nx - px, nz - pz) || 1;
    const ox = ((nz - pz) / len) * half;
    const oz = (-(nx - px) / len) * half;
    positions.push(x + ox, y, z + oz, x - ox, y, z - oz);
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setIndex(indices);
  return geometry;
}

/** Disco no chão (para tapar a junção das ruas nos cruzamentos). */
function discGeometry(x: number, z: number, radius: number, y: number) {
  const geometry = new THREE.CircleGeometry(radius, 24).rotateX(-Math.PI / 2);
  geometry.translate(x, y, z);
  return geometry.toNonIndexed();
}

/** Chão dos bairros, ruas com calçada, faixa tracejada e o mar. */
function buildGround(scene: THREE.Scene) {
  // Chão de cada bairro, com a sua cor (grama, calçadão, concreto do porto...).
  for (const district of DISTRICTS) {
    const shape = new THREE.Shape(district.polygon.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geometry = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: district.ground }));
    mesh.position.y = -0.05;
    scene.add(mesh);
  }

  // Calçadas (um pouco mais largas que a rua) e asfalto, cada um numa malha só.
  // As camadas ficam separadas na altura e com polygonOffset: com pouca precisão
  // de profundidade o chão "brigava" com o asfalto e a rua sumia.
  const sidewalkParts: THREE.BufferGeometry[] = [];
  const asphaltParts: THREE.BufferGeometry[] = [];
  const nodeRadius = new Map<string, number>();
  for (const road of ROADS) {
    sidewalkParts.push(stripGeometry(road.points, road.width / 2 + 3, 0.02).toNonIndexed());
    asphaltParts.push(stripGeometry(road.points, road.width / 2, 0.05).toNonIndexed());
    for (const id of [road.a, road.b]) nodeRadius.set(id, Math.max(nodeRadius.get(id) ?? 0, road.width / 2));
  }
  for (const node of NAV) {
    const radius = nodeRadius.get(node.id);
    if (!radius) continue;
    sidewalkParts.push(discGeometry(node.x, node.z, radius + 3, 0.02));
    asphaltParts.push(discGeometry(node.x, node.z, radius, 0.05));
  }
  const offset = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };
  scene.add(new THREE.Mesh(mergeGeometries(sidewalkParts.map(stripUv)), new THREE.MeshLambertMaterial({ color: "#9a9184" })));
  scene.add(new THREE.Mesh(mergeGeometries(asphaltParts.map(stripUv)), new THREE.MeshLambertMaterial({ color: "#3f3f45", ...offset })));

  // Faixa tracejada no meio das avenidas e ruas (vielas não têm), longe dos cruzamentos.
  const dashes: THREE.Matrix4[] = [];
  const quat = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  for (const road of ROADS) {
    if (road.kind === "viela") continue;
    const color = road.kind === "avenida" ? 0 : 1;
    road.points.forEach(([x, z], i) => {
      if (i % 2 || i < 5 || i > road.points.length - 6) return;
      const [nx, nz] = road.points[i + 1];
      quat.setFromAxisAngle(Y, Math.atan2(nx - x, nz - z));
      dashes.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0.12 + color * 0.001, z), quat, one));
    });
  }
  const dashGeometry = new THREE.PlaneGeometry(0.35, 3.5).rotateX(-Math.PI / 2);
  const dashMesh = new THREE.InstancedMesh(dashGeometry, new THREE.MeshBasicMaterial({ color: "#e8c547" }), dashes.length);
  dashes.forEach((m, i) => dashMesh.setMatrixAt(i, m));
  scene.add(dashMesh);

  // O mar, ao sul do cais, e o muro do cais.
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 1600).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: "#2b6a8f", emissive: "#3a5a7a", emissiveIntensity: 0.35 }),
  );
  sea.position.set(0, -0.6, QUAY_Z - 800);
  scene.add(sea);
  const quay = new THREE.Mesh(new THREE.BoxGeometry(WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX + 40, 1.6, 2), new THREE.MeshLambertMaterial({ color: "#6b6258" }));
  quay.position.set(0, 0.2, QUAY_Z - 1);
  scene.add(quay);

  // Lago do parque, com uma borda de areia.
  const shore = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: "#cdb380" }));
  shore.scale.set(LAKE.rx + 4, 1, LAKE.rz + 4);
  shore.position.set(LAKE.x, 0.01, LAKE.z);
  const lake = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: "#2f7aa0", emissive: "#3a6a8a", emissiveIntensity: 0.4, ...offset }),
  );
  lake.scale.set(LAKE.rx, 1, LAKE.rz);
  lake.position.set(LAKE.x, 0.03, LAKE.z);
  scene.add(shore, lake);
}

/** mergeGeometries exige os mesmos atributos: as faixas não têm "uv", os discos têm. */
function stripUv(geometry: THREE.BufferGeometry) {
  geometry.deleteAttribute("uv");
  return geometry;
}

/** Guindastes do porto (só enfeite, na beira do cais). */
function buildCranes(scene: THREE.Scene) {
  const yellow = new THREE.MeshLambertMaterial({ color: "#e8a00c" });
  for (const x of [-380, -120, 140, 380]) {
    const crane = new THREE.Group();
    for (const [lx, lz] of [[-4, -3], [4, -3], [-4, 3], [4, 3]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 26, 0.8), yellow);
      leg.position.set(lx, 13, lz);
      crane.add(leg);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 8), yellow);
    beam.position.y = 26;
    crane.add(beam);
    const jib = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 46), yellow);
    jib.position.set(0, 28, -14);
    crane.add(jib);
    crane.position.set(x, 0, QUAY_Z + 4);
    scene.add(bake(crane));
  }
}

/** Postes ao longo das avenidas e ruas, com o brilho das lâmpadas num só Points (barato). */
function buildLamps(scene: THREE.Scene) {
  const spots: THREE.Vector3[] = [];
  for (const road of ROADS) {
    if (road.kind === "viela") continue;
    let side = 1;
    for (let i = 6; i < road.points.length - 6; i += 12) {
      side = -side;
      const [x, z] = road.points[i];
      const [nx, nz] = road.points[i + 1];
      const len = Math.hypot(nx - x, nz - z) || 1;
      const offset = side * (road.width / 2 + 1.8);
      spots.push(new THREE.Vector3(x + ((nz - z) / len) * offset, 0, z - ((nx - x) / len) * offset));
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

/** Árvores de brócolis, porque toda dieta precisa de um vegetal (de enfeite). */
function buildTrees(scene: THREE.Scene) {
  const stem = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.5, 0.8, 3, 8),
    new THREE.MeshLambertMaterial({ color: "#9bc25b" }),
    TREES.length,
  );
  const crown = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(2.4, 1),
    new THREE.MeshLambertMaterial({ color: "#3d7d2c", flatShading: true }),
    TREES.length * 3,
  );
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  TREES.forEach((tree, i) => {
    const s = tree.size;
    scale.setScalar(s);
    matrix.compose(new THREE.Vector3(tree.x, 1.5 * s, tree.z), quat, scale);
    stem.setMatrixAt(i, matrix);
    for (let k = 0; k < 3; k++) {
      const angle = (k / 3) * Math.PI * 2 + i;
      const pos = new THREE.Vector3(
        tree.x + Math.cos(angle) * 1.1 * s,
        (3.4 + (k === 0 ? 0.6 : 0)) * s,
        tree.z + Math.sin(angle) * 1.1 * s,
      );
      matrix.compose(pos, quat, scale);
      crown.setMatrixAt(i * 3 + k, matrix);
    }
  });
  scene.add(stem, crown);

  // Hambúrgueres gigantes de estátua: na beira do lago e no meio do autódromo.
  for (const [x, z, size] of [[400, 40, 16], [400, 425, 14]] as const) {
    const statue = bake(makeBurger());
    statue.scale.setScalar(size);
    statue.position.set(x, 0, z);
    statue.rotation.y = x * 0.01;
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

  const { sky, sun: sunSprite } = buildSky(scene);
  buildSkyline(scene);
  buildGround(scene);
  buildBuildings(scene);
  buildCranes(scene);
  buildLamps(scene);
  buildBillboards(scene);
  buildTrees(scene);
  scene.add(buildTrackMesh(RACES.autodromo.track, { asphalt: true }));
  return { sky, sun: sunSprite };
}
