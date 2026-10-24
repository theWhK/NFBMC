// Visual de quadrinho, no estilo Borderlands: cel-shading (sombreamento em
// degraus, sem degradê suave) e um contorno de "tinta" desenhado por cima da
// imagem pronta, a partir da profundidade (bordas e silhuetas).
import * as THREE from "three";

export type Quality = "alto" | "medio" | "baixo";

/** Rampa de luz em 3 degraus: sombra, meia-luz e luz. */
const gradient = (() => {
  const data = new Uint8Array([150, 205, 255]);
  const texture = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
})();

const converted = new WeakMap<THREE.Material, THREE.Material>();

/** Troca materiais "Lambert" por "Toon" (mesmas cores e texturas), uma vez por material. */
function toonMaterial(material: THREE.Material): THREE.Material {
  if (!(material instanceof THREE.MeshLambertMaterial)) return material;
  const cached = converted.get(material);
  if (cached) return cached;
  const toon = new THREE.MeshToonMaterial({
    color: material.color,
    map: material.map,
    emissive: material.emissive,
    emissiveMap: material.emissiveMap,
    emissiveIntensity: material.emissiveIntensity,
    vertexColors: material.vertexColors,
    transparent: material.transparent,
    opacity: material.opacity,
    side: material.side,
    fog: material.fog,
    depthWrite: material.depthWrite,
    polygonOffset: material.polygonOffset,
    polygonOffsetFactor: material.polygonOffsetFactor,
    polygonOffsetUnits: material.polygonOffsetUnits,
    gradientMap: gradient,
  });
  converted.set(material, toon);
  return toon;
}

/** Aplica o cel-shading em tudo dentro de `root`. */
export function toonify(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(toonMaterial) : toonMaterial(mesh.material);
  });
}

/**
 * Passada final de "tinta": a cena é desenhada numa textura (com a
 * profundidade), e um quadro de tela inteira desenha por cima o contorno onde a
 * profundidade salta (silhuetas e quinas), mais fraco ao longe. Aplica também o
 * tone mapping.
 */
export class InkPass {
  private target: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;
  private renderer: THREE.WebGLRenderer;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(1, 1),
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        texel: { value: new THREE.Vector2() },
        near: { value: 0.8 },
        far: { value: 2600 },
        thickness: { value: 1 },
      },
      toneMapped: true,
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        uniform sampler2D tColor; uniform sampler2D tDepth;
        uniform vec2 texel; uniform float near; uniform float far; uniform float thickness;
        varying vec2 vUv;
        float linearDepth(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          return (near * far) / (far - d * (far - near));
        }
        void main() {
          vec4 color = texture2D(tColor, vUv);
          float z = linearDepth(vUv);
          vec2 o = texel * thickness;
          float zl = linearDepth(vUv - vec2(o.x, 0.0));
          float zr = linearDepth(vUv + vec2(o.x, 0.0));
          float zu = linearDepth(vUv + vec2(0.0, o.y));
          float zd = linearDepth(vUv - vec2(0.0, o.y));
          // Salto relativo de profundidade: silhueta ou quina.
          float jump = max(max(abs(zl - z), abs(zr - z)), max(abs(zu - z), abs(zd - z))) / z;
          // Curvatura (2ª derivada) de 1/z: pega quinas onde a superfície "dobra".
          // Em 1/z, qualquer plano varia linearmente na tela, então chão visto de
          // raspão dá zero aqui (com z linear, o asfalto ao longe virava listras).
          float iz = 1.0 / z;
          float bend = (abs(1.0 / zl + 1.0 / zr - 2.0 * iz) + abs(1.0 / zu + 1.0 / zd - 2.0 * iz)) / iz;
          float edge = max(smoothstep(0.03, 0.08, jump), smoothstep(0.01, 0.03, bend) * 0.85);
          // Longe, a linha some aos poucos (senão a cidade vira um rabisco só).
          edge *= 1.0 - smoothstep(180.0, 520.0, z);
          vec3 ink = vec3(0.06, 0.04, 0.03);
          vec3 rgb = mix(color.rgb, ink, edge * 0.95);
          gl_FragColor = vec4(rgb, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);
  }

  setSize(width: number, height: number, pixelRatio: number) {
    const w = Math.max(1, Math.floor(width * pixelRatio));
    const h = Math.max(1, Math.floor(height * pixelRatio));
    this.target.setSize(w, h);
    this.material.uniforms.texel.value.set(1 / w, 1 / h);
    // Linha grossa, de quadrinho: ~2 px em telas comuns, mais em telas densas.
    this.material.uniforms.thickness.value = Math.max(1.5, 2 * pixelRatio);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.material.uniforms.near.value = camera.near;
    this.material.uniforms.far.value = camera.far;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }
}
