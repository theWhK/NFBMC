// Porto Gordo em 3D, no clima "fim de tarde alaranjado" dos jogos de corrida de
// rua dos anos 2000: céu em degradê, sol baixo, prédios com janelas acesas,
// ruas com calçada e faixa, casas com telhado, galpões e contêineres no porto,
// o mar, o lago do parque e árvores de brócolis. A planta (ruas, prédios,
// árvores) vem do shared/world.ts; aqui só se desenha.
import * as THREE from "three";
import { makeFlag, FLAG_STRIPES } from "./flag.ts";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  BUILDINGS,
  DISTRICTS,
  LAKE,
  NAV,
  QUAY_Z,
  RACES,
  RACE_IDS,
  ROADS,
  TREES,
  districtAt,
  heightAt,
  insideBuilding,
  slopeAt,
  isOnRoad,
  raceMarker,
  WORLD_BOUNDS,
  pointOnTrack,
  seeded,
  type BuildingKind,
} from "@nfbmc/shared";

import { bake, makeBurger } from "./models.ts";
import { buildTrackMesh } from "./track-mesh.ts";
import { TILE, addChunk, byTile } from "./chunks.ts";
import { buildBuildings, buildingMaterial } from "./buildings.ts";
import { buildStreets } from "./streets.ts";
import { paintedTexture } from "./textures.ts";

export { CHUNKS, addChunk } from "./chunks.ts";

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

/** Silhueta de cidade além do muro do mapa (menos para o lado do mar). */
function buildSkyline(scene: THREE.Scene) {
  const random = seeded(99);
  const matrices: THREE.Matrix4[] = [];
  const quat = new THREE.Quaternion();
  // Em volta dos limites do mapa (um retângulo um pouco maior), menos do lado do mar.
  const cx = (WORLD_BOUNDS.minX + WORLD_BOUNDS.maxX) / 2;
  const cz = (WORLD_BOUNDS.minZ + WORLD_BOUNDS.maxZ) / 2;
  const hx = (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX) / 2 + 250;
  const hz = (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ) / 2 + 250;
  for (let i = 0; i < 360; i++) {
    const angle = (i / 360) * Math.PI * 2 + random() * 0.01;
    const reach = Math.min(hx / Math.abs(Math.cos(angle) || 1e-6), hz / Math.abs(Math.sin(angle) || 1e-6)) + random() * 200;
    const x = cx + Math.cos(angle) * reach;
    const z = cz + Math.sin(angle) * reach;
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

/**
 * Chão com relevo, em blocos (para a cena poder esconder os longe), tingido
 * pela cor de cada bairro. Vai um pouco além dos limites do mapa, sob a neblina.
 */
function buildTerrain(scene: THREE.Scene) {
  const material = new THREE.MeshLambertMaterial({ color: "#ffffff", map: groundTexture, vertexColors: true });
  const step = 20;
  const size = 500;
  const margin = 700;
  const colors = new Map(DISTRICTS.map((d) => [d.id, new THREE.Color(d.ground)]));
  const outside = new THREE.Color("#6b7337");
  for (let x0 = WORLD_BOUNDS.minX - margin; x0 < WORLD_BOUNDS.maxX + margin; x0 += size) {
    for (let z0 = QUAY_Z; z0 < WORLD_BOUNDS.maxZ + margin; z0 += size) {
      const n = size / step;
      const positions: number[] = [];
      const uvs: number[] = [];
      const tints: number[] = [];
      const indices: number[] = [];
      for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= n; j++) {
          const x = x0 + i * step;
          const z = z0 + j * step;
          positions.push(x, heightAt(x, z) - 0.25, z);
          uvs.push(x, -z);
          const inside = x >= WORLD_BOUNDS.minX && x <= WORLD_BOUNDS.maxX && z <= WORLD_BOUNDS.maxZ;
          const c = inside ? colors.get(districtAt(x, z))! : outside;
          tints.push(c.r, c.g, c.b);
          if (i < n && j < n) {
            const a = i * (n + 1) + j;
            const b = a + n + 1;
            indices.push(a, a + 1, b, b, a + 1, b + 1);
          }
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(tints, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      addChunk(scene, new THREE.Mesh(geometry, material), [x0 + size / 2, z0 + size / 2], size * 0.71);
    }
  }
}

/** Chão dos bairros (em tons de cinza; a cor do bairro tinge por cima): manchas e tufos. */
const groundTexture = (() => {
  const texture = paintedTexture(256, (ctx, size, random) => {
    ctx.fillStyle = "#f2f2f2";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 40; i++) {
      const v = 200 + Math.floor(random() * 55);
      ctx.fillStyle = `rgba(${v},${v},${v},0.6)`;
      ctx.beginPath();
      ctx.arc(random() * size, random() * size, 10 + random() * 30, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(60, 60, 60, 0.35)";
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 160; i++) {
      const x = random() * size;
      const y = random() * size;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (random() - 0.5) * 4, y - 4 - random() * 4);
      ctx.stroke();
    }
  }, 13);
  // A forma do bairro tem UV em metros: uma repetição a cada 24 m.
  texture.repeat.set(1 / 24, 1 / 24);
  return texture;
})();

/** Nuvens de desenho animado: bolhas brancas com contorno escuro, bem no alto. */
function buildClouds() {
  const group = new THREE.Group();
  const random = seeded(5);
  const makeTexture = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const blobs = Array.from({ length: 6 }, () => [90 + random() * 330, 120 + random() * 40, 50 + random() * 50] as const);
    // Primeiro o contorno (bolhas um pouco maiores e escuras), depois o recheio.
    for (const [pass, grow, color] of [[0, 7, "#3a2a24"], [1, 0, "#fff4e6"]] as const) {
      void pass;
      ctx.fillStyle = color;
      for (const [x, y, r] of blobs) {
        ctx.beginPath();
        ctx.arc(x, y, r + grow, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Sombra alaranjada embaixo (pôr do sol).
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "rgba(255, 150, 80, 0.45)";
    ctx.fillRect(0, 150, 512, 106);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  for (let i = 0; i < 9; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeTexture(), fog: false, depthWrite: false }));
    const angle = (i / 9) * Math.PI * 2 + random();
    const radius = 650 + random() * 300;
    sprite.position.set(Math.cos(angle) * radius, 170 + random() * 110, Math.sin(angle) * radius);
    sprite.scale.set(220 + random() * 120, 110 + random() * 50, 1);
    group.add(sprite);
  }
  return group;
}

/** Chão dos bairros, ruas com calçada, faixa tracejada e o mar. */
function buildGround(scene: THREE.Scene) {
  // Chão de cada bairro, com a sua cor e o relevo.
  buildTerrain(scene);

  buildStreets(scene);

  // O mar, ao sul do cais, e o muro do cais.
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX + 6000, 3000).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: "#2b6a8f", emissive: "#3a5a7a", emissiveIntensity: 0.35 }),
  );
  sea.position.set(0, -0.6, QUAY_Z - 1500);
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
    new THREE.MeshLambertMaterial({ color: "#2f7aa0", emissive: "#3a6a8a", emissiveIntensity: 0.4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  );
  lake.scale.set(LAKE.rx, 1, LAKE.rz);
  lake.position.set(LAKE.x, 0.03, LAKE.z);
  scene.add(shore, lake);
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
      const lx = x + ((nz - z) / len) * offset;
      const lz = z - ((nx - x) / len) * offset;
      spots.push(new THREE.Vector3(lx, heightAt(lx, lz), lz));
    }
  }
  // Também em volta do autódromo.
  const track = RACES.autodromo.track;
  for (let dist = 15, i = 0; dist < track.length; dist += 34, i++) {
    const p = pointOnTrack(track, dist, (i % 2 ? 1 : -1) * (track.width / 2 + 2.5));
    spots.push(new THREE.Vector3(p.x, 0, p.z));
  }

  const poleGeometry = new THREE.CylinderGeometry(0.15, 0.22, 9, 6);
  const poleMaterial = new THREE.MeshLambertMaterial({ color: "#2c2a2e" });
  const glowMaterial = new THREE.PointsMaterial({
    size: 7,
    map: glowTexture("rgba(255,214,140,1)"),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  for (const tile of byTile(spots, (p) => [p.x, p.z])) {
    const poles = new THREE.InstancedMesh(poleGeometry, poleMaterial, tile.items.length);
    const glowPositions: number[] = [];
    tile.items.forEach((p, i) => {
      matrix.compose(new THREE.Vector3(p.x, p.y + 4.5, p.z), quat, one);
      poles.setMatrixAt(i, matrix);
      glowPositions.push(p.x, p.y + 9, p.z);
    });
    poles.computeBoundingSphere();
    const glowGeometry = new THREE.BufferGeometry();
    glowGeometry.setAttribute("position", new THREE.Float32BufferAttribute(glowPositions, 3));
    const lamps = new THREE.Group();
    lamps.add(poles, new THREE.Points(glowGeometry, glowMaterial));
    addChunk(scene, lamps, tile.center);
  }
}

const BILLBOARDS: { title: string; subtitle: string; bg: string; fg: string }[] = [
  { title: "PODRÃO DO ZÉ", subtitle: "X-TUDO R$ 9,90 · 24 HORAS", bg: "#c1121f", fg: "#ffd23f" },
  { title: "COXINHA TURBO", subtitle: "abastece você e o carro", bg: "#f4a261", fg: "#3d1f0b" },
  { title: "REFRI 3 LITROS", subtitle: "pra tomar sozinho", bg: "#1d3557", fg: "#ffffff" },
  { title: "ACADEMIA", subtitle: "segunda-feira eu começo", bg: "#2a9d8f", fg: "#ffffff" },
  { title: "LISTA GORDA", subtitle: "você está nela?", bg: "#16110d", fg: "#ffd23f" },
  { title: "VIGILÂNCIA SANITÁRIA", subtitle: "estamos de olho 👀", bg: "#f1f1f1", fg: "#c1121f" },
  // Fundo listrado com a Bandeira do Orgulho Gordo.
  { title: "ORGULHO GORDO", subtitle: "pão · alface · queijo · tomate · carne · pão", bg: "stripes", fg: "#ffffff" },
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
    if (ad.bg === "stripes") {
      FLAG_STRIPES.forEach((color, i) => {
        ctx.fillStyle = color;
        ctx.fillRect(0, Math.round((i * 256) / FLAG_STRIPES.length), 512, Math.ceil(256 / FLAG_STRIPES.length));
      });
    } else {
      ctx.fillStyle = ad.bg;
      ctx.fillRect(0, 0, 512, 256);
    }
    if (ad.bg === "stripes") {
      ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
      ctx.shadowBlur = 8;
    }
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
  const stemGeometry = new THREE.CylinderGeometry(0.5, 0.8, 3, 5);
  const stemMaterial = new THREE.MeshLambertMaterial({ color: "#9bc25b" });
  const crownGeometry = new THREE.IcosahedronGeometry(2.6, 0);
  const crownMaterial = new THREE.MeshLambertMaterial({ color: "#3d7d2c", flatShading: true });
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  let n = 0;
  for (const tile of byTile(TREES, (t) => [t.x, t.z])) {
    const stem = new THREE.InstancedMesh(stemGeometry, stemMaterial, tile.items.length);
    const crown = new THREE.InstancedMesh(crownGeometry, crownMaterial, tile.items.length * 3);
    tile.items.forEach((tree, i) => {
      const s = tree.size;
      scale.setScalar(s);
      const ground = heightAt(tree.x, tree.z) - 0.3;
      matrix.compose(new THREE.Vector3(tree.x, ground + 1.5 * s, tree.z), quat, scale);
      stem.setMatrixAt(i, matrix);
      for (let k = 0; k < 3; k++) {
        const angle = (k / 3) * Math.PI * 2 + n;
        const pos = new THREE.Vector3(
          tree.x + Math.cos(angle) * 1.1 * s,
          ground + (3.4 + (k === 0 ? 0.6 : 0)) * s,
          tree.z + Math.sin(angle) * 1.1 * s,
        );
        matrix.compose(pos, quat, scale);
        crown.setMatrixAt(i * 3 + k, matrix);
      }
      n++;
    });
    stem.computeBoundingSphere();
    crown.computeBoundingSphere();
    const group = new THREE.Group();
    group.add(stem, crown);
    addChunk(scene, group, tile.center);
  }

  // Hambúrgueres gigantes de estátua: na beira do lago e no meio do autódromo.
  for (const [x, z, size] of [[400, 40, 16], [400, 425, 14]] as const) {
    const statue = bake(makeBurger());
    statue.scale.setScalar(size);
    statue.position.set(x, 0, z);
    statue.rotation.y = x * 0.01;
    scene.add(statue);
  }
}

/**
 * Mastros com a Bandeira do Orgulho Gordo: um em cada ponto de encontro de
 * corrida (na calçada, ao lado da coluna de luz) e uma roda em volta das
 * estátuas de hambúrguer.
 */
function buildFlags(scene: THREE.Scene) {
  const place = (x: number, z: number, height: number, width: number, facing: number) => {
    const flag = makeFlag(height, width);
    flag.position.set(x, heightAt(x, z) - 0.3, z);
    flag.rotation.y = facing;
    addChunk(scene, flag, [x, z], width + 5);
  };
  for (const id of RACE_IDS) {
    const m = raceMarker(id);
    // Anda para o lado da rua até sair do asfalto.
    const nx = Math.cos(m.heading);
    const nz = -Math.sin(m.heading);
    for (let d = 8; d < 30; d += 1) {
      const x = m.x + nx * d;
      const z = m.z + nz * d;
      if (isOnRoad(x, z)) continue;
      place(x + nx * 2, z + nz * 2, 11, 5.4, m.heading + Math.PI / 2);
      break;
    }
  }
  for (const [x, z, size] of [[400, 40, 16], [400, 425, 14]] as const) {
    for (let k = 0; k < 4; k++) {
      const angle = (k / 4) * Math.PI * 2 + 0.4;
      const r = size * 1.1;
      if (isOnRoad(x + Math.cos(angle) * r, z + Math.sin(angle) * r)) continue;
      place(x + Math.cos(angle) * r, z + Math.sin(angle) * r, 16, 7.5, -angle);
    }
  }
}

/** Placa de posto em canvas (nome e o "preço" do combustível). */
function stationTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 320;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const draw = () => {
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#f2b705";
    ctx.fillRect(0, 0, 256, 320);
    ctx.fillStyle = "#c1121f";
    ctx.fillRect(0, 0, 256, 120);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = "44px 'Russo One', sans-serif";
    ctx.fillText("POSTO", 128, 58);
    ctx.fillText("GORDURA", 128, 104);
    ctx.fillStyle = "#16110d";
    ctx.font = "26px 'Russo One', sans-serif";
    ctx.fillText("ÓLEO DE FRITURA", 128, 170);
    ctx.font = "56px 'Russo One', sans-serif";
    ctx.fillText("4,99", 128, 240);
    ctx.font = "22px 'Russo One', sans-serif";
    ctx.fillText("o litro (reusado)", 128, 286);
    texture.needsUpdate = true;
  };
  draw();
  document.fonts?.load("44px 'Russo One'").then(draw).catch(() => {});
  return texture;
}

/**
 * Lugares na beira das ruas, fora do asfalto e dos prédios: `offset` metros
 * além da calçada, de frente para a rua. Sempre os mesmos (semente fixa).
 */
function roadsideSpots(seed: number, count: number, kinds: string[], offset: number, footprint: number, accept?: (x: number, z: number) => boolean) {
  const random = seeded(seed);
  const roads = ROADS.filter((r) => kinds.includes(r.kind) && r.points.length > 12);
  const spots: { x: number; z: number; facing: number }[] = [];
  for (let tries = 0; tries < count * 40 && spots.length < count && roads.length; tries++) {
    const road = roads[Math.floor(random() * roads.length)];
    const i = 4 + Math.floor(random() * (road.points.length - 8));
    const [x, z] = road.points[i];
    const [nx, nz] = road.points[i + 1];
    const len = Math.hypot(nx - x, nz - z) || 1;
    const side = random() < 0.5 ? 1 : -1;
    const ox = ((nz - z) / len) * side;
    const oz = (-(nx - x) / len) * side;
    const d = road.width / 2 + offset;
    const sx = x + ox * d;
    const sz = z + oz * d;
    if (accept && !accept(sx, sz)) continue;
    // O "terreno" inteiro do enfeite tem que estar livre.
    let free = true;
    for (const [px, pz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
      const qx = sx + px * footprint;
      const qz = sz + pz * footprint;
      if (isOnRoad(qx, qz) && footprint > 2) free = false;
      if (insideBuilding(qx, qz)) free = false;
    }
    if (!free || spots.some((o) => Math.hypot(o.x - sx, o.z - sz) < footprint * 4)) continue;
    // De frente para a rua.
    spots.push({ x: sx, z: sz, facing: Math.atan2(-ox, -oz) });
  }
  return spots;
}

/**
 * Enfeites pela cidade inteira: postos de gasolina, outdoors nas avenidas,
 * pontos de ônibus e torres de antena nos morros (sem colisão, como os postes).
 */
function buildProps(scene: THREE.Scene) {
  const lambert = (color: string) => new THREE.MeshLambertMaterial({ color });
  const white = lambert("#f1ece2");
  const red = lambert("#c1121f");
  const dark = lambert("#2c2a2e");
  const glass = new THREE.MeshLambertMaterial({ color: "#9fd3e6", transparent: true, opacity: 0.45 });
  // Tudo vira uma malha por material em cada bloco da cidade (centenas de
  // enfeites separados seriam centenas de chamadas de desenho por quadro).
  const batches = new Map<string, { material: THREE.Material; parts: THREE.BufferGeometry[]; center: [number, number] }>();
  const place = (group: THREE.Group, x: number, z: number, facing: number) => {
    group.position.set(x, heightAt(x, z) - 0.2, z);
    group.rotation.y = facing;
    group.updateMatrixWorld(true);
    const tx = Math.floor(x / TILE);
    const tz = Math.floor(z / TILE);
    group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.Material;
      const key = `${tx},${tz}|${material.uuid}`;
      let batch = batches.get(key);
      if (!batch) batches.set(key, (batch = { material, parts: [], center: [(tx + 0.5) * TILE, (tz + 0.5) * TILE] }));
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrixWorld);
      // Só posição, normal e UV (todas as formas têm), para poderem ser juntadas.
      for (const name of Object.keys(geometry.attributes)) if (!["position", "normal", "uv"].includes(name)) geometry.deleteAttribute(name);
      batch.parts.push(geometry);
    });
  };

  // Postos "Gordura": cobertura em 4 pilares, bombas, lojinha e a placa alta.
  const sign = new THREE.MeshLambertMaterial({ map: stationTexture(), emissive: "#ffffff", emissiveIntensity: 0.3 });
  for (const spot of roadsideSpots(901, 8, ["avenida", "rodovia"], 12, 9)) {
    const g = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(16, 0.8, 10), white);
    canopy.position.y = 5.2;
    const band = new THREE.Mesh(new THREE.BoxGeometry(16.2, 0.5, 10.2), red);
    band.position.y = 4.7;
    g.add(canopy, band);
    for (const [px, pz] of [[-6, -3.5], [6, -3.5], [-6, 3.5], [6, 3.5]]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.8, 0.5), white);
      pillar.position.set(px, 2.4, pz);
      g.add(pillar);
    }
    for (const px of [-3, 3]) {
      const pump = new THREE.Mesh(new THREE.BoxGeometry(1, 1.8, 0.7), red);
      pump.position.set(px, 0.9, 0);
      g.add(pump);
    }
    const shop = new THREE.Mesh(new THREE.BoxGeometry(10, 3.6, 6), lambert("#e9c46a"));
    shop.position.set(0, 1.8, 10);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9, 0.5), dark);
    pole.position.set(9.5, 4.5, -4);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(3.2, 4, 0.4), sign);
    panel.position.set(9.5, 9.5, -4);
    g.add(shop, pole, panel);
    place(g, spot.x, spot.z, spot.facing);
  }

  // Outdoors nas avenidas e no Rodoanel (os mesmos anúncios do autódromo).
  const faces = BILLBOARDS.map((ad) => new THREE.MeshLambertMaterial({ map: billboardTexture(ad), emissive: "#ffffff", emissiveIntensity: 0.25, side: THREE.DoubleSide }));
  const boardGeometry = new THREE.PlaneGeometry(16, 8);
  const legGeometry = new THREE.BoxGeometry(0.5, 6, 0.5);
  roadsideSpots(902, 36, ["avenida", "rodovia"], 9, 6).forEach((spot, i) => {
    const g = new THREE.Group();
    const face = new THREE.Mesh(boardGeometry, faces[i % faces.length]);
    face.position.y = 9;
    g.add(face);
    for (const x of [-5, 5]) {
      const leg = new THREE.Mesh(legGeometry, dark);
      leg.position.set(x, 3, -0.3);
      g.add(leg);
    }
    // Meio virado para quem vem pela rua.
    place(g, spot.x, spot.z, spot.facing + (i % 2 ? 0.5 : -0.5));
  });

  // Pontos de ônibus na calçada: cobertura, vidro, banco e a placa.
  const roofGeometry = new THREE.BoxGeometry(3.2, 0.15, 1.5);
  const backGeometry = new THREE.BoxGeometry(3.2, 2, 0.08);
  const benchGeometry = new THREE.BoxGeometry(2.4, 0.15, 0.45);
  const postGeometry = new THREE.BoxGeometry(0.12, 2.5, 0.12);
  const plateGeometry = new THREE.BoxGeometry(0.6, 0.6, 0.06);
  for (const spot of roadsideSpots(903, 70, ["avenida", "rua"], 2.2, 1.6)) {
    const g = new THREE.Group();
    const roof = new THREE.Mesh(roofGeometry, red);
    roof.position.y = 2.5;
    const back = new THREE.Mesh(backGeometry, glass);
    back.position.set(0, 1.25, 0.65);
    const bench = new THREE.Mesh(benchGeometry, dark);
    bench.position.set(0, 0.5, 0.35);
    const post = new THREE.Mesh(postGeometry, dark);
    post.position.set(-1.9, 1.25, -0.5);
    const plate = new THREE.Mesh(plateGeometry, lambert("#2a6bff"));
    plate.position.set(-1.9, 2.6, -0.5);
    g.add(roof, back, bench, post, plate);
    place(g, spot.x, spot.z, spot.facing);
  }

  // Torres de antena nos pontos mais altos da serra e do morro, com a luz vermelha no topo.
  const random = seeded(904);
  const light = new THREE.MeshBasicMaterial({ color: "#ff2a2a" });
  const towers: [number, number][] = [];
  for (let k = 0; k < 4000 && towers.length < 7; k++) {
    const x = WORLD_BOUNDS.minX + random() * (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX);
    const z = WORLD_BOUNDS.minZ + random() * (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ);
    const district = districtAt(x, z);
    if ((district !== "serra" && district !== "morro") || heightAt(x, z) < 30 || isOnRoad(x, z) || insideBuilding(x, z)) continue;
    if (towers.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 300)) continue;
    towers.push([x, z]);
    const g = new THREE.Group();
    for (const [lx, lz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 38, 4), white);
      leg.position.set(lx * 0.6, 19, lz * 0.6);
      leg.rotation.set(lz * 0.03, 0, -lx * 0.03);
      g.add(leg);
    }
    for (let y = 6; y < 38; y += 6) {
      const ring = new THREE.Mesh(new THREE.BoxGeometry(2.2 - y * 0.03, 0.25, 2.2 - y * 0.03), y % 12 ? red : white);
      ring.position.y = y;
      g.add(ring);
    }
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), light);
    beacon.position.y = 39;
    g.add(beacon);
    place(g, x, z, 0);
  }

  for (const batch of batches.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(batch.parts), batch.material);
    mesh.geometry.computeBoundingSphere();
    addChunk(scene, mesh, batch.center, TILE * 0.71 + 45);
  }
}

export function buildScenery(scene: THREE.Scene) {
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.Fog(FOG_COLOR, 160, 620);
  scene.add(new THREE.HemisphereLight("#ffd9a8", "#4a3b2a", 1.4));
  const sun = new THREE.DirectionalLight("#ffb36b", 2.4);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(200);
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000),
    new THREE.MeshLambertMaterial({ color: "#6b7337" }),
  );
  ground.rotation.x = -Math.PI / 2;
  // Bem embaixo do relevo (a baixada mais funda tem ~5 m): só aparece além dele, na neblina.
  ground.position.set((WORLD_BOUNDS.minX + WORLD_BOUNDS.maxX) / 2, -8, (WORLD_BOUNDS.minZ + WORLD_BOUNDS.maxZ) / 2);
  scene.add(ground);

  const { sky, sun: sunSprite } = buildSky(scene);
  const clouds = buildClouds();
  scene.add(clouds);
  buildSkyline(scene);
  buildGround(scene);
  buildBuildings(scene);
  buildCranes(scene);
  buildLamps(scene);
  buildBillboards(scene);
  buildTrees(scene);
  buildFlags(scene);
  buildProps(scene);
  scene.add(buildTrackMesh(RACES.autodromo.track, { asphalt: true }));
  return { sky, sun: sunSprite, light: sun, clouds };
}
