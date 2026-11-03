// Recalibra a habilidade dos rivais do modo história quando as pistas deles mudam:
//   node scripts/calibrar-rivais.ts <pasta-da-versão-antiga>
// A pasta antiga tem shared/src e server/src/rooms/bots.ts de antes da mudança
// (por exemplo, `git show <commit>:<arquivo>` de cada um, com o import do bots.ts
// apontando para ../../../shared/src/index.ts).
//
// Para cada rival: na versão antiga, a razão entre o tempo dele (com a
// habilidade de hoje) e o de um "jogador bom" (bot com habilidade 0,97 no melhor
// carro liberado até ali). Na versão nova, procura a habilidade que dá a mesma
// razão: o duelo fica tão difícil quanto era.
import * as current from "../shared/src/index.ts";
import * as currentBots from "../server/src/rooms/bots.ts";

type Shared = typeof current;
type Bots = typeof currentBots;

const PLAYER_SKILL = 0.97;

function lapTime(shared: Shared, bots: Bots, raceId: string, carId: string, skill: number) {
  const race = (shared.RACES as Record<string, { track: current.Track; laps: number }>)[raceId];
  const track = race.track;
  const spec = shared.carSpec(carId);
  const size = shared.carHalfSize(carId);
  const s0 = track.samples[0];
  const car = { x: s0.x - s0.tx * 8, z: s0.z - s0.tz * 8, heading: Math.atan2(s0.tx, s0.tz), speed: 0 };
  const drive = shared.createDrive(spec);
  const motion = { ...shared.createMotion(), level: track.levels?.[0] ?? -1 };
  const brain = bots.createBrain("dificil", () => 0.5);
  brain.skill = skill;
  brain.lane = 0;
  brain.wobble = 0;
  const dt = 1 / 30;
  const n = track.samples.length;
  let time = 0;
  let last = 0;
  let halfway = false;
  let lap = 0;
  const hasLevels = "carGrade" in shared;
  while (time < 900) {
    const input = bots.botInput(brain, track, car, spec, dt, []);
    const grade = hasLevels ? shared.carGrade(car, motion) : shared.gradeAt(car.x, car.z, car.heading);
    const grass = hasLevels ? !shared.isOnRoad(car.x, car.z, motion.level) : !shared.isOnRoad(car.x, car.z);
    shared.stepCar(car, drive, spec, input, dt, grass, 0, motion, grade);
    shared.collideWorld(car, size.halfLength, size.halfWidth, motion);
    shared.keepInCorridor(car, track, size.halfWidth, motion);
    time += dt;
    const index = shared.nearestSample(track, car.x, car.z).index;
    if (index > n * 0.45 && index < n * 0.55) halfway = true;
    if (halfway && last > n * 0.8 && index < n * 0.2) {
      lap++;
      halfway = false;
      if (lap >= race.laps) break;
    }
    if (index > last || last - index > n * 0.5) last = index;
  }
  return time;
}

/** Carros liberados antes do duelo com o rival de `rank` (o melhor é o mais rápido na pista). */
function unlockedBefore(shared: Shared, rank: number) {
  const cars = new Set<string>(shared.STARTER_CARS);
  for (const r of shared.RIVALS_LADDER) {
    if (r.rank <= rank) continue;
    cars.add(r.car);
    if (r.bonusCar) cars.add(r.bonusCar);
  }
  return [...cars];
}

function bestPlayer(shared: Shared, bots: Bots, raceId: string, rank: number) {
  let best = Infinity;
  for (const car of unlockedBefore(shared, rank)) best = Math.min(best, lapTime(shared, bots, raceId, car, PLAYER_SKILL));
  return best;
}

const oldDir = process.argv[2];
if (!oldDir) throw new Error("Uso: node scripts/calibrar-rivais.ts <pasta-da-versão-antiga>");
const old = (await import(`${oldDir}/shared/src/index.ts`)) as Shared;
const oldBots = (await import(`${oldDir}/server/src/rooms/bots.ts`)) as Bots;

for (const rival of current.RIVALS_LADDER) {
  const before = old.RIVALS_LADDER.find((r) => r.rank === rival.rank)!;
  const ratio = lapTime(old, oldBots, before.race, before.car, before.skill) / bestPlayer(old, oldBots, before.race, before.rank);
  const reference = bestPlayer(current, currentBots, rival.race, rival.rank);
  // Busca binária: mais habilidade = tempo menor.
  let lo = 0.45;
  let hi = 1.05;
  for (let k = 0; k < 14; k++) {
    const mid = (lo + hi) / 2;
    const r = lapTime(current, currentBots, rival.race, rival.car, mid) / reference;
    if (r > ratio) lo = mid;
    else hi = mid;
  }
  const skill = Math.round(((lo + hi) / 2) * 100) / 100;
  console.log(`#${rival.rank} ${rival.name.padEnd(18)} ${rival.race.padEnd(10)} razão ${ratio.toFixed(3)}  habilidade ${before.skill} → ${skill}`);
}
