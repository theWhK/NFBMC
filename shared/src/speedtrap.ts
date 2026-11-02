// Speedtrap (corrida de radar): desafio solo com metas de velocidade somada.
//
// As metas não são números chutados: para cada pista e cada carro, a conta
// abaixo acha a velocidade "ideal" em cada ponto do traçado (o limite de curva
// do carro, a aceleração do motor na melhor marcha, a rampa do morro e o
// espaço de frenagem até a próxima curva). Somando o ideal nos radares sai o
// "radar perfeito"; as metas de bronze, prata e ouro são frações dele,
// calibradas por simulação (scripts/simular-radar.ts: o piloto dos bots, que freia com folga,
// faz de 82% a 95% do ideal; no difícil, prata quase sempre e ouro às vezes).
import type { CarSpec } from "./cars.ts";
import { bestDriveForce, brakeDecel, cachedTopSpeed, cornerSpeed, hillForce, roadResistance } from "./physics.ts";
import { gradeAt } from "./terrain.ts";
import type { Track } from "./track.ts";

/** Raio da curva (m) em cada ponto da pista, calculado uma vez por pista. */
const radiusCache = new WeakMap<Track, Float32Array>();
export function trackRadii(track: Track) {
  let radii = radiusCache.get(track);
  if (radii) return radii;
  const samples = track.samples;
  const n = samples.length;
  const spacing = track.length / n;
  const span = 4; // ±4 amostras ≈ ±6,4 m
  radii = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = samples[(i - span + n) % n];
    const b = samples[(i + span) % n];
    const turn = Math.abs(Math.atan2(a.tx * b.tz - a.tz * b.tx, a.tx * b.tx + a.tz * b.tz));
    radii[i] = turn < 1e-3 ? 9999 : (span * 2 * spacing) / turn;
  }
  radiusCache.set(track, radii);
  return radii;
}

/** Quanto do freio "de jogo" o piloto ideal usa (ninguém freia no limite toda vez). */
const IDEAL_BRAKE = 0.8;

const profileCache = new WeakMap<Track, WeakMap<CarSpec, Float32Array>>();

/**
 * Velocidade ideal (m/s) em cada amostra da pista, numa volta com largada
 * parada: passada para frente (o motor na melhor marcha, menos ar, rolagem e
 * rampa, sem passar do limite de curva) e para trás (frear a tempo da curva).
 */
export function speedProfile(track: Track, spec: CarSpec) {
  let perSpec = profileCache.get(track);
  if (!perSpec) profileCache.set(track, (perSpec = new WeakMap()));
  const cached = perSpec.get(spec);
  if (cached) return cached;

  const samples = track.samples;
  const n = samples.length;
  const spacing = track.length / n;
  const radii = trackRadii(track);
  const top = cachedTopSpeed(spec);
  const limit = new Float32Array(n);
  for (let i = 0; i < n; i++) limit[i] = Math.min(top, cornerSpeed(spec, radii[i]));

  const v = new Float32Array(n);
  v[0] = 0;
  for (let i = 0; i < n - 1; i++) {
    const s = samples[i];
    const grade = gradeAt(s.x, s.z, Math.atan2(s.tx, s.tz));
    const accel = (bestDriveForce(spec, v[i]) - roadResistance(spec, v[i]) - hillForce(spec, grade)) / spec.mass;
    v[i + 1] = Math.min(limit[i + 1], Math.sqrt(Math.max(0, v[i] * v[i] + 2 * accel * spacing)));
  }
  const brake = brakeDecel(spec) * IDEAL_BRAKE;
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * brake * spacing));
  perSpec.set(spec, v);
  return v;
}

/** Medalhas do speedtrap, da mais fácil para a mais difícil. Bronze já é vitória. */
export const RADAR_MEDALS = ["bronze", "prata", "ouro"] as const;
export type RadarMedal = (typeof RADAR_MEDALS)[number];
export const RADAR_MEDAL_LABELS: Record<RadarMedal, string> = { bronze: "Bronze", prata: "Prata", ouro: "Ouro" };

/** Fração do "radar perfeito" que cada medalha pede (calibrada por simulação). */
export const RADAR_GOAL_SHARE: Record<RadarMedal, number> = { bronze: 0.75, prata: 0.85, ouro: 0.93 };

/** Prêmio de cada medalha, em múltiplos do prêmio de 1º lugar da distância. */
export const RADAR_MEDAL_CASH: Record<RadarMedal, number> = { bronze: 1, prata: 1.3, ouro: 1.7 };

/** Soma ideal (km/h) nos radares de uma volta com este carro. */
export function idealTrapTotal(track: Track, radars: number[], spec: CarSpec) {
  const profile = speedProfile(track, spec);
  const n = track.samples.length;
  let total = 0;
  for (const at of radars) total += profile[Math.min(n - 1, Math.round((at / track.length) * n))] * 3.6;
  return total;
}

/**
 * Metas (soma de km/h) de um speedtrap para um carro: a fração do ideal de
 * cada medalha, em múltiplos de 5 km/h. Valem para todas as voltas.
 */
export function radarGoals(track: Track, radars: number[], laps: number, spec: CarSpec): Record<RadarMedal, number> {
  const ideal = idealTrapTotal(track, radars, spec) * laps;
  const goal = (medal: RadarMedal) => Math.round((ideal * RADAR_GOAL_SHARE[medal]) / 5) * 5;
  return { bronze: goal("bronze"), prata: goal("prata"), ouro: goal("ouro") };
}

/** Medalha de uma soma (null = não bateu nem o bronze). */
export function radarMedal(total: number, goals: Record<RadarMedal, number>): RadarMedal | null {
  let medal: RadarMedal | null = null;
  for (const m of RADAR_MEDALS) if (total >= goals[m]) medal = m;
  return medal;
}
