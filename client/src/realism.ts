// Visual realista: o reflexo do céu (environment map gerado do próprio céu do
// pôr do sol) e, na qualidade alta, o pós-processamento: oclusão de ambiente
// (os cantos e as frestas escurecem, como na luz de verdade) e o brilho das
// luzes fortes (bloom: faróis, lanternas, janelas acesas, o sol).
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

import { speedBlurPass } from "./speed-blur.ts";

/**
 * Environment map do céu: o mesmo shader do céu numa esfera, mais o chão
 * escuro embaixo (o reflexo da metade de baixo de um carro é o chão, não o céu).
 */
export function skyEnvironment(renderer: THREE.WebGLRenderer, skyMaterial: THREE.Material, groundColor: THREE.ColorRepresentation) {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), skyMaterial));
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(48, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: groundColor }),
  );
  ground.position.y = -2;
  scene.add(ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.02, 0.1, 200);
  pmrem.dispose();
  ground.geometry.dispose();
  (ground.material as THREE.Material).dispose();
  return target.texture;
}

/**
 * Pós-processamento do realista: oclusão, brilho e o borrão de velocidade, cada
 * um ligado pela regulagem dos gráficos. A oclusão pode sair sozinha se o FPS cair.
 */
export class RealPass {
  private composer: EffectComposer;
  private ao: GTAOPass;
  private bloom: UnrealBloomPass;
  private blur = speedBlurPass();

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    // Alvo com multiamostragem: sem ela, o pós-processamento perde o antisserrilhado.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.ao = new GTAOPass(scene, camera, 1, 1);
    // Raio em metros: o bastante para o canto da parede com a calçada e o vão embaixo dos carros.
    this.ao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 2, scale: 1, samples: 12, distanceFallOff: 1 });
    this.ao.blendIntensity = 0.85;
    this.composer.addPass(this.ao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.55, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.blur);
    this.composer.addPass(new OutputPass());
  }

  get occlusion() {
    return this.ao.enabled;
  }

  set occlusion(on: boolean) {
    this.ao.enabled = on;
  }

  set glow(on: boolean) {
    this.bloom.enabled = on;
  }

  /** Força do borrão de velocidade (0 = desligado, sem custo). */
  set speedBlur(strength: number) {
    this.blur.enabled = strength >= 0.01;
    this.blur.uniforms.strength.value = strength;
  }

  setSize(width: number, height: number, pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.blur.uniforms.aspect.value = width / Math.max(1, height);
  }

  render() {
    this.composer.render();
  }

  dispose() {
    this.composer.dispose();
    this.ao.dispose();
    this.bloom.dispose();
  }
}
