// Simulação dos bots dando volta nas pistas (rode ao mexer em carros, pistas ou ruas):
//   node scripts/simular.ts [corrida ...] [--carro=civic] [--skill=0.9]
// Para cada corrida: tempo de volta de um bot com aquela habilidade e carro,
// quantas vezes encostou nas barreiras (trackCorridor), bateu no cenário e se
// desatolou. Um bot bom não deve encostar (ou quase nada).
import {
  RACES,
  RACE_IDS,
  carHalfSize,
  carSpec,
  collideWorld,
  createDrive,
  createMotion,
  carGrade,
  isOnRoad,
  keepInCorridor,
  nearestSample,
  stepCar,
  type RaceId,
} from "../shared/src/index.ts";
import { botInput, createBrain } from "../server/src/rooms/bots.ts";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const car = opt("carro", "civic");
const skill = Number(opt("skill", "0.9"));
const ids = (args.filter((a) => !a.startsWith("--")) as RaceId[]);

export function simulate(id: RaceId, carId: string, botSkill: number, laps = RACES[id].laps) {
  const track = RACES[id].track;
  const spec = carSpec(carId);
  const size = carHalfSize(carId);
  const start = track.samples[0];
  const state = { x: start.x - start.tx * 8, z: start.z - start.tz * 8, heading: Math.atan2(start.tx, start.tz), speed: 0 };
  const drive = createDrive(spec);
  const motion = { ...createMotion(), level: track.levels?.[0] ?? -1 };
  const brain = createBrain("dificil", () => 0.5);
  brain.skill = botSkill;
  brain.lane = 0;
  brain.wobble = 0;
  const dt = 1 / 30;
  let time = 0;
  let walls = 0;
  let world = 0;
  let stuck = 0;
  let wasStuck = false;
  let lap = 0;
  let last = 0;
  let halfway = false;
  let maxSpeed = 0;
  const n = track.samples.length;
  while (time < 900) {
    const input = botInput(brain, track, state, spec, dt, []);
    stepCar(state, drive, spec, input, dt, !isOnRoad(state.x, state.z, motion.level), 0, motion, carGrade(state, motion));
    if (collideWorld(state, size.halfLength, size.halfWidth, motion)) world++;
    if (keepInCorridor(state, track, size.halfWidth, motion)) walls++;
    if (brain.reverseFor > 0 && !wasStuck) stuck++;
    wasStuck = brain.reverseFor > 0;
    maxSpeed = Math.max(maxSpeed, state.speed);
    time += dt;
    const index = nearestSample(track, state.x, state.z).index;
    if (index > n * 0.45 && index < n * 0.55) halfway = true;
    // Cruzou a linha (do fim para o começo), depois de passar da metade.
    if (halfway && last > n * 0.8 && index < n * 0.2) {
      lap++;
      halfway = false;
      if (lap >= laps) break;
    }
    if (index > last || last - index > n * 0.5) last = index;
  }
  return { time, walls, world, stuck, maxSpeed: maxSpeed * 3.6, done: lap >= laps };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const id of ids.length ? ids : RACE_IDS) {
    const t0 = performance.now();
    const r = simulate(id, car, skill, 1);
    const km = RACES[id].track.length / 1000;
    console.log(
      `${id.padEnd(15)} ${km.toFixed(2)} km  volta ${r.done ? r.time.toFixed(1).padStart(6) + " s" : "  NÃO TERMINOU"}  média ${((km / r.time) * 3600).toFixed(0).padStart(3)} km/h  máx ${r.maxSpeed.toFixed(0)}  barreira ${r.walls}  cenário ${r.world}  desatolou ${r.stuck}  (${((performance.now() - t0) / 1000).toFixed(1)} s)`,
    );
  }
}
