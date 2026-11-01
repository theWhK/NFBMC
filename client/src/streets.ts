// Ruas de Porto Gordo: asfalto, calçadas e a sinalização no chão. O traçado
// (pontos e largura de cada rua, cruzamentos) vem do shared/world.ts.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { NAV, ROADS, heightAt } from "@nfbmc/shared";

import { byTile, addChunk } from "./chunks.ts";
import { paintedTexture } from "./textures.ts";

/** Faixa ao longo de uma linha (rua): `half` metros para cada lado. */
function stripGeometry(points: [number, number][], half: number, y: number) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let travelled = 0;
  points.forEach(([x, z], i) => {
    if (i > 0) travelled += Math.hypot(x - points[i - 1][0], z - points[i - 1][1]);
    // Textura: atravessa a rua de 0 a 1 e repete a cada 8 m ao longo dela.
    uvs.push(0, travelled / 8, 1, travelled / 8);
    const [px, pz] = points[Math.max(0, i - 1)];
    const [nx, nz] = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(nx - px, nz - pz) || 1;
    const ox = ((nz - pz) / len) * half;
    const oz = (-(nx - px) / len) * half;
    // Acompanha o relevo (cada borda na altura do chão embaixo dela).
    positions.push(x + ox, heightAt(x + ox, z + oz) + y, z + oz, x - ox, heightAt(x - ox, z - oz) + y, z - oz);
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Disco no chão (para tapar a junção das ruas nos cruzamentos). */
function discGeometry(x: number, z: number, radius: number, y: number) {
  const geometry = new THREE.CircleGeometry(radius, 24).rotateX(-Math.PI / 2);
  geometry.translate(x, 0, z);
  const flat = geometry.toNonIndexed();
  const positions = flat.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < positions.count; i++) positions.setY(i, heightAt(positions.getX(i), positions.getZ(i)) + y);
  flat.computeVertexNormals();
  return flat;
}


/** Asfalto: grão, remendos mais escuros e rachaduras traçadas a "nanquim". */
function asphaltTexture() {
  return paintedTexture(256, (ctx, size, random) => {
    ctx.fillStyle = "#5c5b63";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 2200; i++) {
      const v = 70 + Math.floor(random() * 40);
      ctx.fillStyle = `rgb(${v},${v},${v + 6})`;
      ctx.fillRect(random() * size, random() * size, 2, 2);
    }
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = "rgba(25, 24, 28, 0.35)";
      ctx.beginPath();
      ctx.ellipse(random() * size, random() * size, 14 + random() * 26, 8 + random() * 14, random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(15, 12, 10, 0.75)";
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 5; i++) {
      let x = random() * size;
      let y = random() * size;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (random() - 0.5) * 30;
        y += random() * 18;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, 11);
}

/** Calçada: lajotas com rejunte escuro e umas manchas. */
function sidewalkTexture() {
  return paintedTexture(256, (ctx, size, random) => {
    ctx.fillStyle = "#a39a8c";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = `rgba(90, 80, 70, ${0.1 + random() * 0.15})`;
      ctx.beginPath();
      ctx.arc(random() * size, random() * size, 6 + random() * 18, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(40, 32, 26, 0.6)";
    ctx.lineWidth = 2;
    for (let p = 0; p <= size; p += 64) {
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
      ctx.stroke();
    }
  }, 12);
}

/** Calçadas, asfalto e faixas de todas as ruas (e dos cruzamentos). */
export function buildStreets(scene: THREE.Scene) {
  // Calçadas (um pouco mais largas que a rua) e asfalto, uma malha de cada por
  // bloco da cidade (cada rua vai para o bloco do meio dela).
  // As camadas ficam separadas na altura e com polygonOffset: com pouca precisão
  // de profundidade o chão "brigava" com o asfalto e a rua sumia.
  const nodeRadius = new Map<string, number>();
  for (const road of ROADS) {
    for (const id of [road.a, road.b]) nodeRadius.set(id, Math.max(nodeRadius.get(id) ?? 0, road.width / 2));
  }
  type Piece = { x: number; z: number; points: [number, number][]; sidewalk: THREE.BufferGeometry; asphalt: THREE.BufferGeometry };
  const pieces: Piece[] = [];
  for (const road of ROADS) {
    const [x, z] = road.points[Math.floor(road.points.length / 2)];
    pieces.push({
      x, z, points: road.points,
      sidewalk: stripGeometry(road.points, road.width / 2 + 3, 0.02).toNonIndexed(),
      asphalt: stripGeometry(road.points, road.width / 2, 0.05).toNonIndexed(),
    });
  }
  for (const node of NAV) {
    const radius = nodeRadius.get(node.id);
    if (!radius) continue;
    pieces.push({
      x: node.x, z: node.z, points: [[node.x, node.z]],
      sidewalk: discGeometry(node.x, node.z, radius + 3, 0.02),
      asphalt: discGeometry(node.x, node.z, radius, 0.05),
    });
  }
  const offset = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };
  const sidewalkMaterial = new THREE.MeshLambertMaterial({ color: "#ffffff", map: sidewalkTexture() });
  const asphaltMaterial = new THREE.MeshLambertMaterial({ color: "#ffffff", map: asphaltTexture(), ...offset });
  for (const tile of byTile(pieces, (p) => [p.x, p.z])) {
    const [cx, cz] = tile.center;
    const reach = Math.max(...tile.items.flatMap((p) => p.points.map(([x, z]) => Math.hypot(x - cx, z - cz)))) + 20;
    const group = new THREE.Group();
    group.add(
      new THREE.Mesh(mergeGeometries(tile.items.map((p) => p.sidewalk)), sidewalkMaterial),
      new THREE.Mesh(mergeGeometries(tile.items.map((p) => p.asphalt)), asphaltMaterial),
    );
    addChunk(scene, group, tile.center, reach);
  }

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
      // Gira na direção da rua e inclina junto com a ladeira.
      const run = Math.hypot(nx - x, nz - z) || 1;
      quat.setFromEuler(new THREE.Euler(-Math.atan2(heightAt(nx, nz) - heightAt(x, z), run), Math.atan2(nx - x, nz - z), 0, "YXZ"));
      dashes.push(new THREE.Matrix4().compose(new THREE.Vector3(x, heightAt(x, z) + 0.14 + color * 0.001, z), quat, one));
    });
  }
  const dashGeometry = new THREE.PlaneGeometry(0.35, 3.5).rotateX(-Math.PI / 2);
  const dashMesh = new THREE.InstancedMesh(dashGeometry, new THREE.MeshBasicMaterial({ color: "#e8c547" }), dashes.length);
  dashes.forEach((m, i) => dashMesh.setMatrixAt(i, m));
  scene.add(dashMesh);
}
