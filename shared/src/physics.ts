// Física arcade do carrinho, no plano XZ. Fica no shared para o cliente poder
// usar a mesma conta no futuro (predição local); hoje só o servidor chama.

export interface CarState {
  x: number;
  z: number;
  /** Ângulo em radianos; 0 aponta para +Z, e a frente é (sin, cos). */
  heading: number;
  /** Metros por segundo; negativo é ré. */
  speed: number;
}

export interface DriveInput {
  /** 1 acelera, -1 freia/dá ré. */
  throttle: number;
  /** -1 vira para a esquerda, 1 para a direita. */
  steer: number;
}

export const CAR = {
  maxSpeed: 42,
  maxReverse: 12,
  grassMaxSpeed: 16,
  accel: 26,
  brake: 55,
  /** Desaceleração sem acelerar nem frear. */
  drag: 10,
  /** Velocidade de giro em rad/s quando o carro já está rápido. */
  turnRate: 2.4,
  /** Com o turbo, a velocidade máxima e a aceleração são multiplicadas por isto. */
  boostFactor: 1.45,
  radius: 1.8,
} as const;

export function stepCar(car: CarState, input: DriveInput, dt: number, onGrass: boolean, boosting: boolean) {
  const boost = boosting ? CAR.boostFactor : 1;
  const maxSpeed = (onGrass ? CAR.grassMaxSpeed : CAR.maxSpeed) * boost;
  const throttle = boosting ? Math.max(input.throttle, 1) : input.throttle;

  if (throttle > 0) {
    // Acelerar não passa do limite; quem já está acima (saiu do turbo, caiu na grama) só desacelera.
    if (car.speed < maxSpeed) {
      car.speed = Math.min(maxSpeed, car.speed + (car.speed < 0 ? CAR.brake : CAR.accel * boost) * throttle * dt);
    }
  } else if (throttle < 0) {
    car.speed += (car.speed > 0 ? CAR.brake : CAR.accel) * throttle * dt;
  } else {
    const drop = CAR.drag * dt;
    car.speed = Math.abs(car.speed) <= drop ? 0 : car.speed - Math.sign(car.speed) * drop;
  }

  // Passou do limite (grama ou turbo acabando): perde velocidade aos poucos, sem tranco.
  if (car.speed > maxSpeed) car.speed = Math.max(maxSpeed, car.speed - CAR.brake * 0.6 * dt);
  if (car.speed < -CAR.maxReverse) car.speed = -CAR.maxReverse;

  // Parado não vira; na ré o volante inverte, como num carro de verdade.
  const grip = Math.max(-1, Math.min(1, car.speed / 8));
  car.heading -= input.steer * CAR.turnRate * grip * dt;
  car.heading = Math.atan2(Math.sin(car.heading), Math.cos(car.heading));

  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
}
