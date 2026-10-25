// Peças comuns às salas para os carros: movimento extra (empurrões e giro das
// batidas e do drift), corpos para a colisão entre carros, leitura segura da
// entrada do jogador e "voltar para a rua".
import {
  ROADS,
  TRAFFIC_SIZE,
  carHalfSize,
  carSpec,
  createMotion,
  nearestRoad,
  nearestSample,
  type CarBody,
  type CarMotion,
  type CarState,
  type DriveInput,
  type InputMessage,
  type Track,
} from "@nfbmc/shared";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Lê a entrada do jogador (o cliente pode mandar qualquer coisa). */
export function readInput(message: InputMessage): DriveInput | null {
  if (!Number.isFinite(message?.throttle) || !Number.isFinite(message?.steer)) return null;
  return { throttle: clamp(message.throttle, -1, 1), steer: clamp(message.steer, -1, 1), handbrake: message.handbrake === true };
}

/** Movimento extra de cada carro (empurrão lateral e giro), criado quando precisa. */
export class Motions {
  private map = new Map<string, CarMotion>();

  get(id: string) {
    let motion = this.map.get(id);
    if (!motion) this.map.set(id, (motion = createMotion()));
    return motion;
  }

  delete(id: string) {
    this.map.delete(id);
  }

  reset(id: string) {
    this.map.set(id, createMotion());
  }
}

/** Corpo para a colisão: carro da garagem (pelo id) ou do trânsito. */
export function carBody(car: CarState, motion: CarMotion, carId: string | null): CarBody {
  if (carId === null) {
    return { car, motion, halfLength: TRAFFIC_SIZE.length / 2, halfWidth: TRAFFIC_SIZE.width / 2, mass: 1100 };
  }
  return { car, motion, ...carHalfSize(carId), mass: carSpec(carId).mass };
}

/**
 * Coloca o carro de volta no meio da rua mais próxima (ou da pista, numa
 * corrida), parado e de frente para o sentido da rua mais parecido com o que
 * ele apontava. Para quando o carro empaca de lado numa parede.
 */
export function resetToRoad(car: CarState, track?: Track) {
  let x: number;
  let z: number;
  let dirX: number;
  let dirZ: number;
  if (track) {
    const sample = track.samples[nearestSample(track, car.x, car.z).index];
    ({ x, z } = sample);
    dirX = sample.tx;
    dirZ = sample.tz;
  } else {
    const { road, index } = nearestRoad(car.x, car.z);
    const points = ROADS[road].points;
    const [ax, az] = points[index];
    const [bx, bz] = points[Math.min(points.length - 1, index + 1)];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    // Ponto da rua mais perto do carro, dentro do trecho.
    const t = clamp(((car.x - ax) * (bx - ax) + (car.z - az) * (bz - az)) / (len * len), 0, 1);
    x = ax + (bx - ax) * t;
    z = az + (bz - az) * t;
    dirX = (bx - ax) / len;
    dirZ = (bz - az) / len;
  }
  // Mão da rua mais parecida com para onde o carro apontava.
  if (Math.sin(car.heading) * dirX + Math.cos(car.heading) * dirZ < 0) {
    dirX = -dirX;
    dirZ = -dirZ;
  }
  car.x = x;
  car.z = z;
  car.heading = Math.atan2(dirX, dirZ);
  car.speed = 0;
}
