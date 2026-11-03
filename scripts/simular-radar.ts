// Simula os bots nos speedtraps e compara a soma dos radares com as metas.
import {
  RACES, carSpec, createDrive, createMotion, stepCar, collideWorld, keepInCorridor, carHalfSize, gradeAt, isOnRoad,
  nearestSample, pointOnTrack, radarGoals, trackCorridor,
} from "../shared/src/index.ts";
import { botInput, createBrain } from "../server/src/rooms/bots.ts";

const cars = process.argv[2]?.split(",") ?? ["civic", "supra", "a3bruno"];
for (const raceId of ["radar-porto", "radar-yakisoba", "radar-rodoanel"] as const) {
  const race = RACES[raceId];
  const track = race.track;
  trackCorridor(track);
  for (const id of cars) {
    const spec = carSpec(id);
    const goals = radarGoals(track, race.radars!, race.laps, spec);
    const out: string[] = [];
    for (const skill of [0.87, 0.95, 1.0]) {
      const brain = createBrain("dificil", () => 0.5);
      brain.skill = skill;
      brain.wobble = 0;
      const start = pointOnTrack(track, -8, 3.5);
      const car = { x: start.x, z: start.z, heading: start.heading, speed: 0 };
      const drive = createDrive(spec);
      const motion = createMotion();
      const size = carHalfSize(id);
      let traps = 0;
      let total = 0;
      let lastDist = -8;
      let progress = -8;
      for (let t = 0; t < 900 && traps < race.radars!.length; t += 1 / 30) {
        const input = botInput(brain, track, car, spec, 1 / 30, []);
        stepCar(car, drive, spec, input, 1 / 30, !isOnRoad(car.x, car.z), 0, motion, gradeAt(car.x, car.z, car.heading));
        collideWorld(car, size.halfLength, size.halfWidth, motion);
        keepInCorridor(car, track, size.halfWidth, motion);
        const d = track.samples[nearestSample(track, car.x, car.z).index].dist;
        let delta = d - ((lastDist % track.length) + track.length) % track.length;
        if (delta < -track.length / 2) delta += track.length;
        if (delta > track.length / 2) delta -= track.length;
        progress += delta;
        lastDist = d;
        const at = race.radars![traps];
        if (progress >= at) {
          total += progress - at < 60 ? Math.round(car.speed * 3.6) : 0;
          traps++;
        }
      }
      out.push(`skill ${skill}: ${total}`);
    }
    console.log(raceId, id, JSON.stringify(goals), out.join(" | "));
  }
}
