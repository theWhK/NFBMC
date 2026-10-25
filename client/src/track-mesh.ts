// Desenho de um traçado: asfalto (opcional), zebras, linha de chegada e pórtico.
// O autódromo usa tudo; as corridas de rua só marcam as zebras por cima da rua.
import * as THREE from "three";
import type { Track } from "@nfbmc/shared";

/** Faixa ao longo da pista, entre `inner` e `outer` metros do centro (negativo = lado direito). */
function ribbon(track: Track, inner: number, outer: number, y: number, colorAt?: (i: number) => THREE.Color) {
  const samples = track.samples;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= samples.length; i++) {
    const s = samples[i % samples.length];
    // Esquerda de quem corre: (tz, -tx).
    positions.push(s.x + s.tz * inner, y, s.z - s.tx * inner);
    positions.push(s.x + s.tz * outer, y, s.z - s.tx * outer);
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
  line.position.set(start.x, 0.13, start.z);
  group.add(line);

  // Pórtico de largada: duas colunas e uma faixa em cima.
  const post = new THREE.MeshLambertMaterial({ color: "#333333" });
  const banner = new THREE.MeshLambertMaterial({ color: options.bannerColor ?? "#e63946" });
  const gate = new THREE.Group();
  gate.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), post).translateX(half + 2).translateY(3.5));
  gate.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), post).translateX(-half - 2).translateY(3.5));
  gate.add(new THREE.Mesh(new THREE.BoxGeometry(track.width + 4.6, 1.6, 0.4), banner).translateY(7));
  gate.rotation.y = heading;
  gate.position.set(start.x, 0, start.z);
  group.add(gate);

  return group;
}
