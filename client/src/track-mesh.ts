// Desenho de um traçado: asfalto (opcional), zebras, linha de chegada, pórtico
// e as barreiras translúcidas da corrida.
// O autódromo usa tudo; as corridas de rua só marcam as zebras por cima da rua.
import * as THREE from "three";

import { makeFlag } from "./flag.ts";
import { heightAt, trackCorridor, type Track } from "@nfbmc/shared";

/** Faixa ao longo da pista, entre `inner` e `outer` metros do centro (negativo = lado direito). */
function ribbon(track: Track, inner: number, outer: number, y: number, colorAt?: (i: number) => THREE.Color) {
  const samples = track.samples;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= samples.length; i++) {
    const s = samples[i % samples.length];
    // Esquerda de quem corre: (tz, -tx).
    // Acompanha o relevo.
    const ix = s.x + s.tz * inner;
    const iz = s.z - s.tx * inner;
    const ox = s.x + s.tz * outer;
    const oz = s.z - s.tx * outer;
    positions.push(ix, heightAt(ix, iz) + y, iz, ox, heightAt(ox, oz) + y, oz);
    if (colorAt) {
      const c = colorAt(i);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    if (i < samples.length) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (colorAt) geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function checkerTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 16;
  const ctx = canvas.getContext("2d")!;
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? "#111111" : "#ffffff";
      ctx.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const RED = new THREE.Color("#d62828");
const WHITE = new THREE.Color("#f5f5f5");

export function buildTrackMesh(track: Track, options: { asphalt: boolean; bannerColor?: string }) {
  const group = new THREE.Group();
  const half = track.width / 2;
  // Material dupla face: assim não importa para que lado a faixa foi montada.
  if (options.asphalt) {
    const asphalt = new THREE.MeshLambertMaterial({ color: "#4a4a4f", side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    group.add(new THREE.Mesh(ribbon(track, -half, half, 0.05), asphalt));
  }

  const curb = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const stripe = (i: number) => (Math.floor(i / 2) % 2 ? RED : WHITE);
  group.add(new THREE.Mesh(ribbon(track, half - 0.6, half + 0.8, 0.12, stripe), curb));
  group.add(new THREE.Mesh(ribbon(track, -half - 0.8, -half + 0.6, 0.12, stripe), curb));

  const start = track.samples[0];
  const heading = Math.atan2(start.tx, start.tz);
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(track.width, 2),
    new THREE.MeshLambertMaterial({ map: checkerTexture(), polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
  );
  line.rotation.x = -Math.PI / 2;
  // Com o plano deitado, o eixo X dele vira (cos, 0, -sin) do ângulo: igual ao pórtico, atravessando a pista.
  line.rotation.z = heading;
  // Um pouco mais alta: na ladeira, o meio da linha não pode afundar no asfalto.
  line.position.set(start.x, heightAt(start.x, start.z) + 0.25, start.z);
  group.add(line);

  // Pórtico de largada: duas colunas e uma faixa em cima.
  const post = new THREE.MeshLambertMaterial({ color: "#333333" });
  const banner = new THREE.MeshLambertMaterial({ color: options.bannerColor ?? "#e63946" });
  const gate = new THREE.Group();
  gate.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), post).translateX(half + 2).translateY(3.5));
  gate.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), post).translateX(-half - 2).translateY(3.5));
  gate.add(new THREE.Mesh(new THREE.BoxGeometry(track.width + 4.6, 1.6, 0.4), banner).translateY(7));
  // Bandeiras do Orgulho Gordo em cima das colunas, apontando para fora da pista.
  for (const side of [1, -1]) {
    const flag = makeFlag(4, 3.6);
    flag.position.set(side * (half + 2), 7.8, 0);
    flag.rotation.y = side > 0 ? 0 : Math.PI;
    gate.add(flag);
  }
  gate.rotation.y = heading;
  gate.position.set(start.x, heightAt(start.x, start.z), start.z);
  group.add(gate);

  return group;
}

/** Setas (»») de neon num fundo translúcido, com faixas acesas em cima e embaixo. */
function chevronTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const glow = ctx.createLinearGradient(0, 0, 0, 64);
  glow.addColorStop(0, "rgba(255, 150, 40, 0.95)");
  glow.addColorStop(0.12, "rgba(255, 80, 20, 0.5)");
  glow.addColorStop(0.88, "rgba(255, 80, 20, 0.5)");
  glow.addColorStop(1, "rgba(255, 150, 40, 0.95)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = "rgba(255, 236, 140, 1)";
  for (const x of [8, 72]) {
    // Seta apontando para +u (o sentido da corrida).
    ctx.beginPath();
    ctx.moveTo(x, 9);
    ctx.lineTo(x + 22, 9);
    ctx.lineTo(x + 45, 32);
    ctx.lineTo(x + 22, 55);
    ctx.lineTo(x, 55);
    ctx.lineTo(x + 23, 32);
    ctx.closePath();
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Altura dos painéis (m). */
const BARRIER_HEIGHT = 2.2;

/**
 * Barreiras da corrida (o corredor de shared/src/barriers.ts): painéis
 * translúcidos nas saídas para as ruas laterais e no lado de fora das curvas,
 * com as setas no sentido da corrida. Devolve o grupo e a textura (as setas
 * andam, em `animateBarriers`).
 */
export function buildBarriers(track: Track) {
  const corridor = trackCorridor(track);
  const samples = track.samples;
  const n = samples.length;
  const spacing = track.length / n;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const panel of corridor.panels) {
    const first = positions.length / 3;
    for (let k = panel.from; k <= panel.to; k++) {
      const s = samples[k % n];
      // Um pouco para dentro da parede de verdade, para o carro encostar no painel.
      const offset = (panel.side > 0 ? corridor.left[k % n] : corridor.right[k % n]) - 0.3;
      const x = s.x + s.tz * offset * panel.side;
      const z = s.z - s.tx * offset * panel.side;
      const y = heightAt(x, z);
      const u = ((k - panel.from) * spacing) / 4;
      positions.push(x, y + 0.05, z, x, y + BARRIER_HEIGHT, z);
      uvs.push(u, 0, u, 1);
      if (k < panel.to) {
        const a = first + (k - panel.from) * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const texture = chevronTexture();
  // Sem toon (MeshBasic): brilha igual de dia e de tarde, e não entra no contorno.
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "race-barriers";
  mesh.renderOrder = 2;
  return { mesh, texture };
}

/** As setas das barreiras correm no sentido da corrida. */
export function animateBarriers(texture: THREE.Texture, dt: number) {
  texture.offset.x = (texture.offset.x - dt * 0.6) % 1;
}

/** Setas do GPS: neon azul, apontando para +u (o sentido da rota). */
function gpsTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(63, 212, 255, 0.22)";
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = "rgba(160, 238, 255, 0.95)";
  ctx.beginPath();
  ctx.moveTo(12, 8);
  ctx.lineTo(30, 8);
  ctx.lineTo(54, 32);
  ctx.lineTo(30, 56);
  ctx.lineTo(12, 56);
  ctx.lineTo(36, 32);
  ctx.closePath();
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Rota do GPS no chão: uma faixa de setas no meio da rua. Cada trecho entre dois
 * pontos da rota são 6 índices, então dá para esconder o que já passou com o
 * `drawRange` (`gpsDrawFrom`).
 */
export function buildGpsRibbon(route: [number, number][]) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const half = 1.1;
  let u = 0;
  for (let i = 0; i < route.length; i++) {
    const [x, z] = route[i];
    const [ax, az] = route[Math.max(0, i - 1)];
    const [bx, bz] = route[Math.min(route.length - 1, i + 1)];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const nx = (bz - az) / len;
    const nz = -(bx - ax) / len;
    if (i > 0) u += Math.hypot(x - route[i - 1][0], z - route[i - 1][1]) / 4;
    for (const side of [1, -1]) {
      const px = x + nx * half * side;
      const pz = z + nz * half * side;
      positions.push(px, heightAt(px, pz) + 0.22, pz);
      uvs.push(u, side > 0 ? 1 : 0);
    }
    if (i < route.length - 1) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({ map: gpsTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "gps-route";
  mesh.renderOrder = 2;
  return mesh;
}

/** Esconde a rota antes do ponto `from` (o que o carro já passou). */
export function gpsDrawFrom(mesh: THREE.Mesh, from: number) {
  mesh.geometry.setDrawRange(from * 6, Infinity);
}
