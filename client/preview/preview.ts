// Prévia (não vai para o repositório): câmera parada para capturas.
import * as THREE from "three";
import { GameScene } from "../src/scene.ts";
const p = new URLSearchParams(location.search);
const num = (k: string, d: number) => (p.has(k) ? Number(p.get(k)) : d);
if (p.has("t")) {
  const fixed = Number(p.get("t")) * 1000;
  performance.now = () => fixed;
}
const scene = new GameScene(document.getElementById("c") as HTMLCanvasElement);
const s = scene as any;
s.adaptResolution = () => {};
s.pixelRatio = 1;
scene.renderer.setPixelRatio(1);
scene.setQuality(p.get("q") ?? "alto");
if (p.get("look")) scene.setLook(p.get("look")!);
if (p.has("fog")) s.scene.fog.far = num("fog", 620);
s.resize();
const pos = new THREE.Vector3(num("x", 0), num("y", 60), num("z", 0));
const tgt = new THREE.Vector3(num("tx", 0), num("ty", 0), num("tz", 10));
const fov = num("fov", 60);
scene.setDirector(((_dt: number, camera: THREE.PerspectiveCamera, target: THREE.Vector3) => {
  camera.position.copy(pos);
  target.copy(tgt);
  if (camera.fov !== fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}) as any);
let frames = 0;
const loop = () => {
  scene.render(new Map(), undefined);
  frames++;
  (window as any).__frames = frames;
  if (frames < num("frames", 30)) requestAnimationFrame(loop);
  else (window as any).__done = true;
};
loop();
