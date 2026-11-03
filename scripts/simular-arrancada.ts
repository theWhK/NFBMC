// Arrancada fora do jogo: tempo, velocidade final e o efeito da largada e das trocas.
import {
  RACES, carSpec, createDrive, createMotion, stepCar, collideWorld, carHalfSize, gradeAt, requestShift,
  dragDistance, dragPoint, freeRev, gradeLaunch, gradeShift, shiftPoint, launchZone, type CarSpec, type Difficulty,
} from "../shared/src/index.ts";
import { createDragBrain, createDragCar, dragBotRev, dragBotShift, dragSteer, dragTraction } from "../server/src/rooms/drag.ts";

const race = RACES.arrancada;
const drag = race.drag!;
const track = race.track;
const dt = 1 / 30;

/** Uma passada: `launchRpm` na largada e trocas `shiftOffset` rpm do ideal (ou um bot). */
function run(spec: CarSpec, opts: { launchRpm?: number; shiftOffset?: number; bot?: Difficulty; seed?: number }) {
  let seed = opts.seed ?? 1;
  const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const brain = opts.bot ? createDragBrain(opts.bot, spec, random) : null;
  const half = carHalfSize(spec.id).halfLength;
  const lane = drag.lanes[0];
  const spot = dragPoint(track, drag.start - half, lane);
  const car = { x: spot.x, z: spot.z, heading: spot.heading, speed: 0 };
  const drive = createDrive(spec, true);
  const motion = createMotion();
  const dc = createDragCar(lane);
  // Contagem de 3 s segurando o giro.
  for (let t = 0; t < 3; t += dt) {
    const gas = brain ? dragBotRev(brain, drive) : drive.rpm < (opts.launchRpm ?? 0) ? 1 : 0.4;
    freeRev(drive, spec, gas, dt);
  }
  const reaction = brain ? brain.reaction : 0.25;
  const launch = gradeLaunch(spec, opts.launchRpm && !brain ? opts.launchRpm : drive.rpm);
  dc.launched = true;
  dc.penalty = launch.penalty;
  dc.recover = launch.recover;
  drive.gear = 1;
  const grades: string[] = [];
  let t = 0;
  let maxLateral = 0;
  for (; t < 40; t += dt) {
    dc.since += dt;
    drive.traction = dragTraction(dc);
    const before = drive.gear;
    const rpm = drive.rpm;
    const want = brain ? dragBotShift(brain, drive, spec, dc) : drive.shiftTimer <= 0 && drive.gear < spec.gears.length && ((opts.shiftOffset ?? 0) > 0 ? dc.limiterFor >= 0.5 : drive.rpm >= shiftPoint(spec, drive.gear) + (opts.shiftOffset ?? 0));
    if (want) {
      requestShift(drive, spec, 1);
      if (drive.gear > before) {
        const g = gradeShift(spec, before, rpm, dc.limiterFor);
        if (g === "perfeita") drive.shiftTimer *= 0.5;
        dc.limiterFor = 0;
        grades.push(g);
      }
    }
    stepCar(car, drive, spec, { throttle: 1, steer: dragSteer(track, car, lane) }, dt, false, 0, motion, gradeAt(car.x, car.z, car.heading));
    collideWorld(car, half, carHalfSize(spec.id).halfWidth, motion);
    dc.limiterFor = drive.limiter || drive.rpm >= spec.redline * 0.995 ? dc.limiterFor + dt : Math.max(0, dc.limiterFor - dt * 0.5);
    const p = dragPoint(track, dragDistance(track, car.x, car.z), 0);
    maxLateral = Math.max(maxLateral, Math.abs(Math.hypot(car.x - p.x, car.z - p.z) - Math.abs(lane)));
    if (dragDistance(track, car.x, car.z) + half - drag.start >= drag.distance) break;
  }
  return { et: t, total: t + reaction, kmh: Math.round(car.speed * 3.6), launch: launch.grade, grades: grades.join(","), lateral: maxLateral.toFixed(2) };
}

const fmt = (r: ReturnType<typeof run>) => `ET ${r.et.toFixed(2)} (+reação ${r.total.toFixed(2)}) ${r.kmh} km/h ${r.launch} [${r.grades}] desvio ${r.lateral}`;
for (const id of process.argv[2]?.split(",") ?? ["fusca", "civic", "supra", "m3", "a3bruno"]) {
  const spec = carSpec(id);
  const [lo, hi] = launchZone(spec);
  console.log(`\n${id} faixa ${lo}-${hi} troca ${spec.gears.map((_, i) => Math.round(shiftPoint(spec, i + 1))).join("/")}`);
  console.log("  perfeito        ", fmt(run(spec, { launchRpm: (lo + hi) / 2 })));
  console.log("  largada baixa   ", fmt(run(spec, { launchRpm: spec.idleRpm + 200 })));
  console.log("  largada no talo ", fmt(run(spec, { launchRpm: spec.redline })));
  console.log("  troca cedo -1200", fmt(run(spec, { launchRpm: (lo + hi) / 2, shiftOffset: -1200 })));
  console.log("  troca no corte  ", fmt(run(spec, { launchRpm: (lo + hi) / 2, shiftOffset: 2000 })));
  for (const bot of ["facil", "medio", "dificil"] as const) {
    const runs = [1, 2, 3, 4, 5, 6].map((seed) => run(spec, { bot, seed }));
    const avg = runs.reduce((a, r) => a + r.total, 0) / runs.length;
    console.log(`  bot ${bot.padEnd(8)} média ${avg.toFixed(2)} s`, runs.map((r) => `${r.total.toFixed(2)}${r.launch[0]}`).join(" "));
  }
}
