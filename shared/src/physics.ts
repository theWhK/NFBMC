// Física do carro, no plano XZ. Fica no shared porque servidor (que manda) e
// cliente (conta-giros, garagem) usam as mesmas contas.
//
// É uma física "de jogo, mas com motor de verdade": curva de torque, marchas
// com relação, giro do motor tirado da velocidade das rodas, limitador, câmbio
// automático ou manual, arrasto do ar (cresce com o quadrado da velocidade),
// resistência de rolagem (muito maior na grama), freio motor e acelerador que
// sobe aos poucos. A direção perde esterço em alta (cada carro tem o seu).
import type { CarSpec } from "./cars.ts";

export interface CarState {
  x: number;
  z: number;
  /** Ângulo em radianos; 0 aponta para +Z, e a frente é (sin, cos). */
  heading: number;
  /** Metros por segundo; negativo é ré. */
  speed: number;
}

export interface DriveInput {
  /** 1 acelera, -1 freia (e, parado, engata a ré). */
  throttle: number;
  /** -1 vira para a esquerda, 1 para a direita. */
  steer: number;
  /** Freio de mão: trava a traseira (freia e deixa o carro escorregar de lado: drift). */
  handbrake?: boolean;
}

/**
 * Movimento "extra" de um carro, fora da direção em que ele aponta: o empurrão
 * de lado de uma batida ou do drift (vx, vz em m/s) e o giro (rad/s). Os pneus
 * vão segurando e isso some em menos de um segundo.
 */
export interface CarMotion {
  vx: number;
  vz: number;
  spin: number;
}

export const createMotion = (): CarMotion => ({ vx: 0, vz: 0, spin: 0 });

/** Estado do trem de força (só no servidor; o giro e a marcha vão para o estado da sala). */
export interface DriveState {
  /** -1 = ré, 1..N = marchas. */
  gear: number;
  rpm: number;
  /** Acelerador "de verdade" (0 a 1), que persegue o pedido do jogador. */
  pedal: number;
  /** Trocando de marcha: sem força nas rodas por um instante. */
  shiftTimer: number;
  /** Tempo segurando o freio parado (para engatar a ré). */
  reverseHold: number;
  manual: boolean;
  /** Bateu no limitador de giro neste tick (o som "picota"). */
  limiter: boolean;
}

export const CAR = {
  /** Meia largura padrão (m), para colisão com o cenário quando não se sabe o carro. */
  halfWidth: 0.9,
  /** Meio comprimento padrão (m). */
  halfLength: 2.1,
  /** Turbo da comida: aceleração extra (m/s²). */
  boostAccel: 9,
} as const;

const AIR_DENSITY = 1.2;
const GRAVITY = 9.81;
const DRIVETRAIN = 0.85;
/**
 * "Motor de videogame": os torques da garagem são próximos dos reais, mas numa
 * cidade pequena 15 s de 0 a 100 km/h ficaria arrastado. Todo mundo ganha o
 * mesmo empurrão, então a ordem entre os carros continua a de verdade.
 */
const GAME_TORQUE = 1.5;
const REVERSE_RATIO = 3.4;
/** Quanto o acelerador sobe e desce por segundo (0 → 100% em ~0,25 s). */
const PEDAL_UP = 4;
const PEDAL_DOWN = 8;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function createDrive(spec: CarSpec, manual = false): DriveState {
  return { gear: 1, rpm: spec.idleRpm, pedal: 0, shiftTimer: 0, reverseHold: 0, manual, limiter: false };
}

/** Torque do motor (N·m) num giro: sobe até o pico e cai um pouco até a faixa vermelha. */
export function torqueAt(spec: CarSpec, rpm: number) {
  const peak = spec.torque * GAME_TORQUE;
  if (rpm <= spec.peakRpm) {
    const t = clamp((rpm - spec.idleRpm) / (spec.peakRpm - spec.idleRpm), 0, 1);
    return peak * (0.62 + 0.38 * t);
  }
  const t = clamp((rpm - spec.peakRpm) / (spec.redline - spec.peakRpm), 0, 1);
  return peak * (1 - 0.28 * t ** 1.5);
}

const gearRatio = (spec: CarSpec, gear: number) => (gear < 0 ? REVERSE_RATIO : spec.gears[gear - 1]);

/** Giro do motor para uma velocidade numa marcha (sem patinar). */
export function wheelRpm(spec: CarSpec, speed: number, gear: number) {
  return (Math.abs(speed) / spec.wheelRadius) * gearRatio(spec, gear) * spec.finalDrive * (60 / (2 * Math.PI));
}

/** Pedido de troca do câmbio manual (+1 sobe, -1 desce). */
export function requestShift(drive: DriveState, spec: CarSpec, direction: number) {
  if (drive.shiftTimer > 0 || drive.gear < 1) return;
  const next = clamp(drive.gear + Math.sign(direction), 1, spec.gears.length);
  if (next === drive.gear) return;
  drive.gear = next;
  drive.shiftTimer = 0.18;
}

export function stepCar(
  car: CarState,
  drive: DriveState,
  spec: CarSpec,
  input: DriveInput,
  dt: number,
  onGrass: boolean,
  boosting: boolean,
  motion?: CarMotion,
) {
  const gas = boosting ? 1 : Math.max(0, input.throttle);
  const brakeInput = Math.max(0, -input.throttle);
  const v = car.speed;

  // Ré: parado e segurando o freio por um instante, engata. Na ré, os pedais se invertem.
  if (drive.gear >= 1) {
    drive.reverseHold = Math.abs(v) < 0.6 && brakeInput > 0 && gas === 0 ? drive.reverseHold + dt : 0;
    if (drive.reverseHold > 0.35) {
      drive.gear = -1;
      drive.reverseHold = 0;
    }
  } else if (v > -0.6 && gas > 0) {
    drive.gear = 1;
  }
  const reverse = drive.gear < 0;
  const wantPedal = reverse ? brakeInput : gas;
  const braking = reverse ? gas : brakeInput;

  // Acelerador progressivo.
  drive.pedal += clamp(wantPedal - drive.pedal, -PEDAL_DOWN * dt, PEDAL_UP * dt);

  // Giro do motor: o das rodas, mas na saída a "embreagem" deixa subir com o pé no fundo.
  const fromWheels = wheelRpm(spec, v, drive.gear);
  const launch = spec.idleRpm + drive.pedal * (spec.peakRpm * 0.9 - spec.idleRpm);
  const targetRpm = Math.max(spec.idleRpm, fromWheels, drive.gear === 1 || reverse ? launch * clamp(1 - Math.abs(v) / 12, 0, 1) : 0);
  drive.limiter = targetRpm >= spec.redline && drive.pedal > 0.1;
  drive.rpm += (Math.min(targetRpm, spec.redline) - drive.rpm) * Math.min(1, 18 * dt);
  if (drive.limiter) drive.rpm = spec.redline - Math.random() * 250; // "picota" no limitador

  // Câmbio automático: sobe perto da faixa vermelha, desce quando o giro cai.
  if (drive.shiftTimer > 0) drive.shiftTimer -= dt;
  else if (!drive.manual && drive.gear >= 1) {
    if (fromWheels > spec.redline * 0.93 && drive.gear < spec.gears.length) {
      drive.gear++;
      drive.shiftTimer = 0.22;
    } else if (drive.gear > 1 && fromWheels < spec.redline * 0.45 && wheelRpm(spec, v, drive.gear - 1) < spec.redline * 0.85) {
      drive.gear--;
      drive.shiftTimer = 0.15;
    }
  }

  // Forças (newtons). Para frente = positivo.
  const direction = reverse ? -1 : 1;
  const engineForce = drive.shiftTimer > 0 || drive.limiter
    ? 0
    : (torqueAt(spec, drive.rpm) * gearRatio(spec, drive.gear) * spec.finalDrive * DRIVETRAIN / spec.wheelRadius) * drive.pedal;
  const boostForce = boosting && !reverse ? spec.mass * CAR.boostAccel : 0;
  const drag = 0.5 * AIR_DENSITY * spec.dragArea * v * Math.abs(v);
  const rolling = (onGrass ? 0.32 : 0.015) * spec.mass * GRAVITY * Math.sign(v);
  // Freio motor: tirar o pé segura o carro, mais forte em giro alto.
  const engineBrake = drive.pedal < 0.05 && drive.shiftTimer <= 0 ? spec.mass * 1.4 * (drive.rpm / spec.redline) * Math.sign(v) : 0;

  let next = v + ((engineForce * direction + boostForce - drag - rolling - engineBrake) / spec.mass) * dt;
  // Sem tração, o atrito para o carro, mas não o faz andar para trás.
  if (engineForce === 0 && boostForce === 0 && Math.sign(next) !== Math.sign(v) && v !== 0) next = 0;
  // Freio: sempre contra o movimento, até parar.
  if (braking > 0) {
    const drop = spec.brake * braking * dt;
    next = Math.abs(next) <= drop ? 0 : next - Math.sign(next) * drop;
  }
  car.speed = next;

  // Freio de mão: segura a traseira (freia um pouco) e o carro vira bem mais.
  const handbrake = !!input.handbrake && Math.abs(car.speed) > 3;
  if (handbrake) {
    const drop = 4.5 * dt;
    car.speed = Math.abs(car.speed) <= drop ? 0 : car.speed - Math.sign(car.speed) * drop;
  }

  // Direção: parado não vira; na ré o volante inverte; em alta perde esterço (saindo de frente).
  const grip = clamp(car.speed / 8, -1, 1);
  const highSpeed = 1 / (1 + (Math.abs(car.speed) / 50) ** 2 * spec.understeer * 2);
  const oldHeading = car.heading;
  car.heading -= input.steer * spec.turn * grip * highSpeed * (onGrass ? 0.8 : 1) * (handbrake ? 1.3 : 1) * dt;

  if (motion) {
    // Drift: com a traseira travada, parte da velocidade continua na direção
    // antiga (o carro escorrega de lado em vez de só virar).
    if (handbrake) {
      const keep = 0.6;
      motion.vx += (Math.sin(oldHeading) - Math.sin(car.heading)) * car.speed * keep;
      motion.vz += (Math.cos(oldHeading) - Math.cos(car.heading)) * car.speed * keep;
    }
    // Empurrão lateral e giro (batidas, drift): os pneus vão segurando.
    car.heading += motion.spin * dt;
    car.x += motion.vx * dt;
    car.z += motion.vz * dt;
    const tireGrip = Math.exp(-(handbrake ? 1.2 : onGrass ? 2.5 : 4) * dt);
    motion.vx *= tireGrip;
    motion.vz *= tireGrip;
    motion.spin *= Math.exp(-5 * dt);
  }
  car.heading = Math.atan2(Math.sin(car.heading), Math.cos(car.heading));

  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
}

// --- Números para a garagem e para a IA --------------------------------------

/** Velocidade final (m/s) no plano, sem turbo: onde a força do motor empata com o ar e o atrito. */
export function topSpeed(spec: CarSpec) {
  let best = 0;
  for (let v = 1; v < 160; v += 0.25) {
    const reachable = spec.gears.some((_, i) => {
      const rpm = wheelRpm(spec, v, i + 1);
      if (rpm > spec.redline) return false;
      const force = torqueAt(spec, Math.max(rpm, spec.idleRpm)) * spec.gears[i] * spec.finalDrive * DRIVETRAIN / spec.wheelRadius;
      return force > 0.5 * AIR_DENSITY * spec.dragArea * v * v + 0.015 * spec.mass * GRAVITY;
    });
    if (reachable) best = v;
  }
  return best;
}

/** Tempo de 0 a 100 km/h (s), simulando com o câmbio automático. */
export function zeroToHundred(spec: CarSpec) {
  const car = { x: 0, z: 0, heading: 0, speed: 0 };
  const drive = createDrive(spec);
  let t = 0;
  while (car.speed < 100 / 3.6 && t < 40) {
    stepCar(car, drive, spec, { throttle: 1, steer: 0 }, 1 / 60, false, false);
    t += 1 / 60;
  }
  return t;
}

/**
 * Velocidade máxima para fazer uma curva de raio `radius` (m) sem sair dela,
 * pelo esterço do carro (que diminui em alta). Usada pela IA para frear antes.
 */
export function cornerSpeed(spec: CarSpec, radius: number) {
  let v = spec.turn * radius;
  for (let i = 0; i < 4; i++) {
    const highSpeed = 1 / (1 + (v / 50) ** 2 * spec.understeer * 2);
    v = spec.turn * highSpeed * radius;
  }
  return v;
}

const topSpeedCache = new Map<string, number>();
/** topSpeed com cache (a conta percorre todas as marchas e velocidades). */
export function cachedTopSpeed(spec: CarSpec) {
  let v = topSpeedCache.get(spec.id);
  if (v === undefined) {
    v = topSpeed(spec);
    topSpeedCache.set(spec.id, v);
  }
  return v;
}
