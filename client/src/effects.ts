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

/** Um conjunto de partículas com cor, vida e velocidade próprias, desenhado num só Points. */
class Particles {
  readonly points: THREE.Points;
  private positions: Float32Array;
  private colors: Float32Array;
  private velocity: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private baseColor: Float32Array;
  private next = 0;
  private count: number;
  private gravity: number;
  private alpha: number;

  constructor(count: number, size: number, gravity: number, alpha: number) {
    this.count = count;
    this.gravity = gravity;
    this.alpha = alpha;
    this.positions = new Float32Array(count * 3).fill(-9999);
    this.colors = new Float32Array(count * 4);
    this.velocity = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count).fill(1);
    this.baseColor = new Float32Array(count * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 4));
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size,
        map: softDot(),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: THREE.Color) {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.positions.set([x, y, z], i * 3);
    this.velocity.set([vx, vy, vz], i * 3);
    this.baseColor.set([color.r, color.g, color.b], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  update(dt: number) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) {
        this.colors[i * 4 + 3] = 0;
        continue;
      }
      this.life[i] -= dt;
      this.velocity[i * 3 + 1] += this.gravity * dt;
      for (let k = 0; k < 3; k++) this.positions[i * 3 + k] += this.velocity[i * 3 + k] * dt;
      const fade = Math.max(0, this.life[i] / this.maxLife[i]);
      this.colors.set([this.baseColor[i * 3], this.baseColor[i * 3 + 1], this.baseColor[i * 3 + 2], fade * this.alpha], i * 4);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

const SMOKE = new THREE.Color("#d8d2c8");
const DUST = new THREE.Color("#a07a4a");
const SPARK_COLORS = ["#ffd23f", "#ff7a00", "#ffffff", "#5cb83a"].map((c) => new THREE.Color(c));
const MAX_SKIDS = 700;

export class Effects {
  private smoke = new Particles(400, 3.2, 1.2, 0.55);
  private sparks = new Particles(300, 0.9, -14, 1);
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
      // Roda traseira: 1.3 m para trás e 1.1 m para o lado.
      const wx = x - fx * 1.3 + fz * side * 1.1;
      const wz = z - fz * 1.3 - fx * side * 1.1;
      if (!offroad) {
        // Deitada no chão, inclinada junto com a ladeira.
        this.quat.setFromEuler(new THREE.Euler(-Math.atan(gradeAt(wx, wz, heading)), heading, 0, "YXZ"));
        this.matrix.compose(new THREE.Vector3(wx, heightAt(wx, wz) + 0.16, wz), this.quat, new THREE.Vector3(1, 1, 1));
        this.skids.setMatrixAt(this.nextSkid, this.matrix);
        this.nextSkid = (this.nextSkid + 1) % MAX_SKIDS;
      }
      if (Math.random() < amount) {
        this.smoke.emit(
          wx, heightAt(wx, wz) + 0.4, wz,
          (Math.random() - 0.5) * 2, 0.8 + Math.random(), (Math.random() - 0.5) * 2,
          0.8 + Math.random() * 0.6, offroad ? DUST : SMOKE,
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
