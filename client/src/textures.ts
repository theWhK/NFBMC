// Texturas desenhadas no código (canvas), sem arquivos: cor e, para o visual
// realista, o relevo (normal map) e a aspereza tirados de um mapa de altura.
import * as THREE from "three";
import { seeded } from "@nfbmc/shared";

export type Painter = (ctx: CanvasRenderingContext2D, size: number, random: () => number) => void;

function canvasOf(size: number, draw: Painter, seed: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  draw(canvas.getContext("2d")!, size, seeded(seed));
  return canvas;
}

function repeating(texture: THREE.Texture, color: boolean) {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Textura de cor que repete, desenhada por `draw` (mesma semente = mesma textura). */
export function paintedTexture(size: number, draw: Painter, seed: number) {
  return repeating(new THREE.CanvasTexture(canvasOf(size, draw, seed)), true);
}

/**
 * Normal map a partir de um mapa de altura em tons de cinza (claro = alto),
 * desenhado por `draw`. `strength` exagera o relevo.
 */
export function normalTexture(size: number, draw: Painter, seed: number, strength = 2) {
  const canvas = canvasOf(size, draw, seed);
  const ctx = canvas.getContext("2d")!;
  const { data } = ctx.getImageData(0, 0, size, size);
  const height = (x: number, y: number) => data[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  const out = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (height(x + 1, y) - height(x - 1, y)) * strength;
      const dy = (height(x, y + 1) - height(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return repeating(new THREE.CanvasTexture(canvas), false);
}

/** Textura de dados (aspereza, metal...) em tons de cinza, sem espaço de cor. */
export function dataTexture(size: number, draw: Painter, seed: number) {
  return repeating(new THREE.CanvasTexture(canvasOf(size, draw, seed)), false);
}
