// Borrão de velocidade, no espírito do Most Wanted (2005): em alta, a imagem
// "estica" para fora a partir do ponto de fuga (borrão radial), o meio da tela
// fica nítido e as bordas escurecem um pouco; no nitro, estica mais.
import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

/** Amostras ao longo do raio: poucas, com o ponto inicial variando por pixel (sem "degraus"). */
const SAMPLES = 10;

const BLUR_CHUNK = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float strength;
  uniform vec2 center;
  uniform float aspect;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  vec3 speedBlur() {
    vec2 dir = vUv - center;
    float dist = length(dir * vec2(aspect, 1.0));
    // O meio fica nítido; o borrão cresce para as bordas.
    float mask = smoothstep(0.16, 0.85, dist) * strength;
    vec3 color = texture2D(tDiffuse, vUv).rgb;
    if (mask < 0.002) return color;
    float jitter = hash(gl_FragCoord.xy);
    vec3 sum = vec3(0.0);
    for (int i = 0; i < ${SAMPLES}; i++) {
      float t = (float(i) + jitter) / float(${SAMPLES});
      sum += texture2D(tDiffuse, vUv - dir * t * mask * 0.16).rgb;
    }
    color = sum / float(${SAMPLES});
    // Um pouco de vinheta junto, como o túnel de visão em alta.
    return color * (1.0 - 0.22 * mask * smoothstep(0.35, 1.0, dist));
  }
`;

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const uniforms = () => ({
  tDiffuse: { value: null as THREE.Texture | null },
  strength: { value: 0 },
  center: { value: new THREE.Vector2(0.5, 0.56) },
  aspect: { value: 16 / 9 },
});

/** Passo para o EffectComposer do realista (antes do OutputPass, que faz o tone mapping). */
export function speedBlurPass() {
  const pass = new ShaderPass({
    uniforms: uniforms(),
    vertexShader: VERTEX,
    fragmentShader: `${BLUR_CHUNK}
      void main() { gl_FragColor = vec4(speedBlur(), 1.0); }`,
  });
  pass.enabled = false;
  return pass;
}

/**
 * Para os caminhos sem composer (quadrinho, realista sem pós): desenha a cena
 * num alvo e passa o borrão para a tela, com o tone mapping no fim. Parado, ou
 * devagar, desenha direto (custo zero).
 */
export class SpeedBlur {
  private target: THREE.WebGLRenderTarget;
  private material: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private renderer: THREE.WebGLRenderer;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.material = new THREE.ShaderMaterial({
      uniforms: uniforms(),
      toneMapped: true,
      vertexShader: VERTEX,
      fragmentShader: `${BLUR_CHUNK}
        void main() {
          gl_FragColor = vec4(speedBlur(), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.material.uniforms.tDiffuse.value = this.target.texture;
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  setSize(width: number, height: number, pixelRatio: number) {
    this.target.setSize(Math.max(1, Math.floor(width * pixelRatio)), Math.max(1, Math.floor(height * pixelRatio)));
    this.material.uniforms.aspect.value = width / Math.max(1, height);
  }

  /** `draw` desenha a cena no alvo que recebe (null = direto na tela). */
  render(strength: number, draw: (target: THREE.WebGLRenderTarget | null) => void) {
    if (strength < 0.01) {
      draw(null);
      return;
    }
    this.material.uniforms.strength.value = strength;
    draw(this.target);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
  }
}

/**
 * Quanto borrar (0 a 1) pela velocidade (m/s): começa por volta de 110 km/h e
 * chega no máximo perto de 300 km/h; o nitro soma.
 */
export function blurForSpeed(speed: number, boosting: boolean) {
  const t = THREE.MathUtils.smoothstep(Math.abs(speed), 30, 85);
  return Math.min(1, t * 0.7 + (boosting ? 0.3 : 0));
}
