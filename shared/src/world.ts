// Porto Gordo: a cidade do mundo aberto. Tudo aqui é determinístico (mesma
// semente), para servidor e clientes enxergarem exatamente a mesma cidade.
//
// Ruas em grade a cada 150 m, prédios dentro dos quarteirões, algumas praças e,
// no canto nordeste, o parque do autódromo.
import { CAR, type CarState } from "./physics.ts";
import { buildTrack, nearestSample, splinePath, streetPath, type Track } from "./track.ts";

/** Metade do tamanho do mundo; o muro invisível fica em ±WORLD_LIMIT. */
export const WORLD_LIMIT = 590;

/** Eixos das ruas (em X e em Z). */
export const STREET_LINES = [-525, -375, -225, -75, 75, 225, 375, 525] as const;
export const STREET_WIDTH = 20;
const STREET_END = 535;
/** Recuo da calçada entre a rua e os prédios. */
const SETBACK = 8;

/** Parque do autódromo: sem ruas nem prédios. */
export const PARK = { minX: 235, minZ: 235, maxX: WORLD_LIMIT, maxZ: WORLD_LIMIT } as const;
const AUTODROMO_CENTER: [number, number] = [400, 405];

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Building extends Rect {
  height: number;
}

export type BlockKind = "downtown" | "residential" | "plaza" | "park";

export interface Block extends Rect {
  kind: BlockKind;
}

/** Gerador pseudoaleatório com semente. */
export function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const inPark = (x: number, z: number) => x >= PARK.minX && z >= PARK.minZ;

function buildStreets(): Rect[] {
  const half = STREET_WIDTH / 2;
  const streets: Rect[] = [];
  for (const v of STREET_LINES) {
    // Ruas que entrariam no parque param na rua da divisa.
    const end = v > PARK.minX ? PARK.minZ : STREET_END;
    streets.push({ minX: v - half, maxX: v + half, minZ: -STREET_END, maxZ: end });
    streets.push({ minX: -STREET_END, maxX: end, minZ: v - half, maxZ: v + half });
  }
  return streets;
}

function buildBlocks(): { blocks: Block[]; buildings: Building[] } {
  const random = seeded(2005);
  const blocks: Block[] = [];
  const buildings: Building[] = [];
  const half = STREET_WIDTH / 2;
  for (let i = 0; i < STREET_LINES.length - 1; i++) {
    for (let j = 0; j < STREET_LINES.length - 1; j++) {
      const rect: Rect = {
        minX: STREET_LINES[i] + half,
        maxX: STREET_LINES[i + 1] - half,
        minZ: STREET_LINES[j] + half,
        maxZ: STREET_LINES[j + 1] - half,
      };
      const cx = (rect.minX + rect.maxX) / 2;
      const cz = (rect.minZ + rect.maxZ) / 2;
      let kind: BlockKind;
      if (inPark(rect.minX, rect.minZ)) kind = "park";
      else if (random() < 0.14) kind = "plaza";
      else kind = Math.abs(cx) < 230 && Math.abs(cz) < 230 ? "downtown" : "residential";
      blocks.push({ ...rect, kind });
      if (kind !== "downtown" && kind !== "residential") continue;

      // Até quatro prédios por quarteirão (2 × 2 lotes), com espaço entre eles.
      const inner = { minX: rect.minX + SETBACK, maxX: rect.maxX - SETBACK, minZ: rect.minZ + SETBACK, maxZ: rect.maxZ - SETBACK };
      const lot = (inner.maxX - inner.minX - 10) / 2;
      for (let a = 0; a < 2; a++) {
        for (let b = 0; b < 2; b++) {
          if (kind === "residential" && random() < 0.25) continue; // lote vazio
          const w = lot * (0.6 + random() * 0.4);
          const d = lot * (0.6 + random() * 0.4);
          const x0 = inner.minX + a * (lot + 10) + (a === 0 ? 0 : lot - w);
          const z0 = inner.minZ + b * (lot + 10) + (b === 0 ? 0 : lot - d);
          const height = kind === "downtown" ? 40 + random() ** 1.5 * 80 : 10 + random() * 26;
          buildings.push({ minX: x0, maxX: x0 + w, minZ: z0, maxZ: z0 + d, height });
        }
      }
    }
  }
  return { blocks, buildings };
}

export const STREETS = buildStreets();
export const { blocks: BLOCKS, buildings: BUILDINGS } = buildBlocks();

// --- Corridas ----------------------------------------------------------------

export type RaceId = "autodromo" | "centro" | "marginal" | "pastel";

export interface RaceInfo {
  id: RaceId;
  name: string;
  laps: number;
  track: Track;
}

/** Circuito original, agora no parque do autódromo. */
const AUTODROMO_POINTS: [number, number][] = [
  [0, -90], [70, -100], [125, -70], [135, -10], [100, 30], [45, 20], [15, 55],
  [40, 100], [-20, 130], [-90, 110], [-125, 45], [-100, -20], [-70, -75],
].map(([x, z]) => [x + AUTODROMO_CENTER[0], z + AUTODROMO_CENTER[1]]);

const STREET_CORNER = 14;

export const RACES: Record<RaceId, RaceInfo> = {
  autodromo: {
    id: "autodromo",
    name: "Autódromo do Colesterol",
    laps: 3,
    track: buildTrack(splinePath(AUTODROMO_POINTS), 16),
  },
  centro: {
    id: "centro",
    name: "Circuito do Centro",
    laps: 2,
    track: buildTrack(streetPath([[-75, -75], [75, -75], [75, 75], [-75, 75], [-75, 225], [-225, 225], [-225, -75]], STREET_CORNER), 18),
  },
  marginal: {
    id: "marginal",
    name: "Volta da Marginal",
    laps: 2,
    track: buildTrack(streetPath([[-225, -525], [75, -525], [75, -225], [-525, -225], [-525, -525]], STREET_CORNER), 18),
  },
  pastel: {
    id: "pastel",
    name: "Rota do Pastel",
    laps: 2,
    track: buildTrack(streetPath([[375, -525], [525, -525], [525, -75], [375, -75], [375, -225], [225, -225], [225, -525]], STREET_CORNER), 18),
  },
};

export const RACE_IDS = Object.keys(RACES) as RaceId[];

export const isRaceId = (value: unknown): value is RaceId =>
  typeof value === "string" && value in RACES;

/** Raio do ponto de encontro de cada corrida no mundo aberto. */
export const MARKER_RADIUS = 18;

/** Onde fica o ponto de encontro: um pouco antes da linha de largada. */
export function raceMarker(id: RaceId) {
  const track = RACES[id].track;
  const s = track.samples[track.samples.length - Math.round(30 / (track.length / track.samples.length))];
  return { x: s.x, z: s.z, heading: Math.atan2(s.tx, s.tz) };
}

// --- Colisão e piso ----------------------------------------------------------

const inside = (r: Rect, x: number, z: number, margin = 0) =>
  x >= r.minX - margin && x <= r.maxX + margin && z >= r.minZ - margin && z <= r.maxZ + margin;

/** O carro está numa rua ou na pista do autódromo? Fora disso é calçada/grama (mais lento). */
export function isOnRoad(x: number, z: number) {
  if (STREETS.some((s) => inside(s, x, z, 1))) return true;
  if (inPark(x, z)) {
    const track = RACES.autodromo.track;
    return nearestSample(track, x, z).distance <= track.width / 2 + 1;
  }
  return false;
}

/**
 * Empurra o carro para fora de prédios e do muro do mapa. Retorna true se bateu.
 * A batida tira boa parte da velocidade.
 */
export function collideWorld(car: CarState): boolean {
  let hit = false;
  const r = CAR.radius;
  for (const b of BUILDINGS) {
    if (!inside(b, car.x, car.z, r)) continue;
    const cx = Math.max(b.minX, Math.min(car.x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(car.z, b.maxZ));
    let dx = car.x - cx;
    let dz = car.z - cz;
    let dist = Math.hypot(dx, dz);
    if (dist >= r) continue;
    if (dist === 0) {
      // Centro do carro dentro do prédio: sai pelo lado mais próximo.
      const exits = [car.x - b.minX, b.maxX - car.x, car.z - b.minZ, b.maxZ - car.z];
      const k = exits.indexOf(Math.min(...exits));
      dx = k === 0 ? -1 : k === 1 ? 1 : 0;
      dz = k === 2 ? -1 : k === 3 ? 1 : 0;
      dist = 0;
      car.x = k === 0 ? b.minX - r : k === 1 ? b.maxX + r : car.x;
      car.z = k === 2 ? b.minZ - r : k === 3 ? b.maxZ + r : car.z;
    } else {
      car.x = cx + (dx / dist) * r;
      car.z = cz + (dz / dist) * r;
    }
    car.speed *= 0.35;
    hit = true;
  }
  if (Math.abs(car.x) > WORLD_LIMIT || Math.abs(car.z) > WORLD_LIMIT) {
    car.x = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, car.x));
    car.z = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, car.z));
    car.speed *= -0.3;
    hit = true;
  }
  return hit;
}

// --- Barraquinhas de comida do mundo aberto ----------------------------------

export interface StandSpot {
  x: number;
  z: number;
  kind: "burger" | "fries" | "soda";
}

/** Comida nas esquinas, na calçada. */
export const STANDS: StandSpot[] = (() => {
  const random = seeded(77);
  const spots: StandSpot[] = [];
  const kinds = ["burger", "fries", "soda"] as const;
  for (const x of STREET_LINES) {
    for (const z of STREET_LINES) {
      if (inPark(x, z) || random() < 0.45) continue;
      const sx = random() < 0.5 ? -1 : 1;
      const sz = random() < 0.5 ? -1 : 1;
      // No meio da rua, perto da esquina, para dar para pegar sem subir na calçada.
      const alongX = random() < 0.5;
      const kind = kinds[Math.floor(random() * 3)];
      // Se do lado sorteado a rua acaba (borda do mapa), usa o outro lado.
      for (const flip of [1, -1]) {
        const spot = {
          x: x + (alongX ? flip * sx * 30 : sx * 4),
          z: z + (alongX ? sz * 4 : flip * sz * 30),
          kind,
        };
        if (isOnRoad(spot.x, spot.z)) {
          spots.push(spot);
          break;
        }
      }
    }
  }
  return spots;
})();
