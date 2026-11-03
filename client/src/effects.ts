// Efeitos visuais baratos: fumaça/poeira, faíscas e marcas de pneu no asfalto.
import * as THREE from "three";
import { gradeAt, heightAt } from "@nfbmc/shared";

function softDot() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Tufo de fumaça: várias bolinhas macias sobrepostas, densas no meio e
 * esgarçadas na borda (sem o "disco" perfeito de um gradiente só).
 */
function smokePuff() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * size * 0.24;
    const x = size / 2 + Math.cos(a) * d;
    const y = size / 2 + Math.sin(a) * d;
    const r = size * (0.12 + rand() * 0.16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.22)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  // Apaga a borda do quadrado: nada pode encostar no limite do ponto.
  ctx.globalCompositeOperation = "destination-in";
  const edge = ctx.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size / 2);
  edge.addColorStop(0, "rgba(255,255,255,1)");
  edge.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

interface ParticleLook {
  size: number;
  /** Aceleração vertical (m/s²): negativa cai (faísca), positiva sobe (fumaça quente). */
  gravity: number;
  /** Opacidade máxima. */
  alpha: number;
  texture?: THREE.Texture;
  /** Tamanho no começo e no fim da vida (multiplica `size`): a fumaça abre ao se espalhar. */
  grow?: [number, number];
  /** Fração da vida para aparecer (sem "estalar" do nada). */
  fadeIn?: number;
  /** Quanto o ar segura a partícula (1/s). */
  drag?: number;
  /** Mistura somando luz (faísca) em vez de cobrir (fumaça). */
  additive?: boolean;
}

/** Um conjunto de partículas com cor, vida e velocidade próprias, desenhado num só Points. */
class Particles {
  readonly points: THREE.Points;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private angles: Float32Array;
  private velocity: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private baseColor: Float32Array;
  private scale: Float32Array;
  private next = 0;
  private count: number;
  private look: Required<Omit<ParticleLook, "texture">>;

  constructor(count: number, look: ParticleLook) {
    this.count = count;
    this.look = { grow: [1, 1], fadeIn: 0, drag: 0, additive: false, ...look };
    this.positions = new Float32Array(count * 3).fill(-9999);
    this.colors = new Float32Array(count * 4);
    this.sizes = new Float32Array(count);
    this.angles = new Float32Array(count);
    this.velocity = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count).fill(1);
    this.baseColor = new Float32Array(count * 3);
    this.scale = new Float32Array(count).fill(1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 4));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1));
    geometry.setAttribute("aAngle", new THREE.BufferAttribute(this.angles, 1));
    const material = new THREE.PointsMaterial({
      size: look.size,
      map: look.texture ?? softDot(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: look.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    // Tamanho e giro por partícula (o PointsMaterial só tem um tamanho para todas).
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("void main() {", "attribute float aSize;\nattribute float aAngle;\nvarying float vAngle;\nvoid main() {\n  vAngle = aAngle;")
        .replace("gl_PointSize = size;", "gl_PointSize = size * aSize;");
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "varying float vAngle;\nvoid main() {")
        .replace(
          "#include <map_particle_fragment>",
          `#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
            vec2 pc = gl_PointCoord - 0.5;
            float cs = cos( vAngle ), sn = sin( vAngle );
            vec2 uv = vec2( cs * pc.x - sn * pc.y, sn * pc.x + cs * pc.y ) + 0.5;
            uv = ( uvTransform * vec3( uv.x, 1.0 - uv.y, 1.0 ) ).xy;
          #endif
          #ifdef USE_MAP
            diffuseColor *= texture2D( map, uv );
          #endif`,
        );
    };
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: THREE.Color, scale = 1) {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.positions.set([x, y, z], i * 3);
    this.velocity.set([vx, vy, vz], i * 3);
    this.baseColor.set([color.r, color.g, color.b], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.scale[i] = scale;
    this.angles[i] = Math.random() * Math.PI * 2;
  }

  update(dt: number) {
    const { gravity, alpha, grow, fadeIn, drag } = this.look;
    const damp = Math.exp(-drag * dt);
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) {
        this.colors[i * 4 + 3] = 0;
        this.sizes[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      for (let k = 0; k < 3; k++) this.velocity[i * 3 + k] *= damp;
      this.velocity[i * 3 + 1] += gravity * dt;
      for (let k = 0; k < 3; k++) this.positions[i * 3 + k] += this.velocity[i * 3 + k] * dt;
      const rest = Math.max(0, this.life[i] / this.maxLife[i]);
      const age = 1 - rest;
      // Aparece rápido, some devagar.
      const fade = (fadeIn > 0 ? Math.min(1, age / fadeIn) : 1) * rest * rest;
      this.sizes[i] = this.scale[i] * (grow[0] + (grow[1] - grow[0]) * Math.sqrt(age));
      this.angles[i] += dt * 0.4 * (i % 2 ? 1 : -1);
      this.colors.set([this.baseColor[i * 3], this.baseColor[i * 3 + 1], this.baseColor[i * 3 + 2], fade * alpha], i * 4);
    }
    const attributes = this.points.geometry.attributes;
    attributes.position.needsUpdate = true;
    attributes.color.needsUpdate = true;
    attributes.aSize.needsUpdate = true;
    attributes.aAngle.needsUpdate = true;
  }
}

const SMOKE = new THREE.Color("#e4e1dc");
const DUST = new THREE.Color("#a8875e");
const SPARK_COLORS = ["#ffd23f", "#ff7a00", "#ffffff", "#5cb83a"].map((c) => new THREE.Color(c));
const MAX_SKIDS = 700;

export class Effects {
  // Fumaça de pneu: nasce pequena rente ao pneu, abre e sobe devagar, bem rala.
  private smoke = new Particles(600, { size: 1, gravity: 0.35, alpha: 0.34, texture: smokePuff(), grow: [0.8, 3.6], fadeIn: 0.12, drag: 1.6 });
  private sparks = new Particles(300, { size: 0.9, gravity: -14, alpha: 1 });
  private skids: THREE.InstancedMesh;
  private nextSkid = 0;
  private matrix = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    const plane = new THREE.PlaneGeometry(0.4, 1.1);
    plane.rotateX(-Math.PI / 2);
    this.skids = new THREE.InstancedMesh(
      plane,
      new THREE.MeshBasicMaterial({
        color: "#111111",
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
      MAX_SKIDS,
    );
    // Começa tudo escondido embaixo do chão.
    this.matrix.makeTranslation(0, -100, 0);
    for (let i = 0; i < MAX_SKIDS; i++) this.skids.setMatrixAt(i, this.matrix);
    this.skids.frustumCulled = false;
    scene.add(this.skids, this.smoke.points, this.sparks.points);
  }

  /** Rastros das rodas traseiras. `amount` de 0 a 1 controla a fumaça. */
  wheelTrail(x: number, z: number, heading: number, amount: number, offroad: boolean) {
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    for (const side of [-1, 1]) {
      // Roda traseira: 1.3 m para trás e 0.78 m para o lado.
      const wx = x - fx * 1.3 + fz * side * 0.78;
      const wz = z - fz * 1.3 - fx * side * 0.78;
      if (!offroad) {
        // Deitada no chão, inclinada junto com a ladeira.
        this.quat.setFromEuler(new THREE.Euler(-Math.atan(gradeAt(wx, wz, heading)), heading, 0, "YXZ"));
        this.matrix.compose(new THREE.Vector3(wx, heightAt(wx, wz) + 0.16, wz), this.quat, new THREE.Vector3(1, 1, 1));
        this.skids.setMatrixAt(this.nextSkid, this.matrix);
        this.nextSkid = (this.nextSkid + 1) % MAX_SKIDS;
      }
      // Poucas partículas, perto do chão: a fumaça se acumula pelo rastro do carro.
      if (Math.random() < amount) {
        const jitter = () => (Math.random() - 0.5) * 0.3;
        this.smoke.emit(
          wx + jitter(), heightAt(wx, wz) + 0.22, wz + jitter(),
          (Math.random() - 0.5) * 1.2 - fx * 0.6, 0.15 + Math.random() * 0.35, (Math.random() - 0.5) * 1.2 - fz * 0.6,
          1.4 + Math.random() * 1.2, offroad ? DUST : SMOKE, (0.6 + amount * 0.5) * (0.8 + Math.random() * 0.4),
        );
      }
    }
    this.skids.instanceMatrix.needsUpdate = true;
  }

  /** Estouro colorido onde uma comida foi comida. */
  burst(x: number, z: number) {
    for (let i = 0; i < 40; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 6;
      this.sparks.emit(
        x, heightAt(x, z) + 1.5, z,
        Math.cos(angle) * speed, 5 + Math.random() * 6, Math.sin(angle) * speed,
        0.6 + Math.random() * 0.5, SPARK_COLORS[i % SPARK_COLORS.length],
      );
    }
  }

  update(dt: number) {
    this.smoke.update(dt);
    this.sparks.update(dt);
  }
}
