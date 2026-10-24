// Fichas dos jogadores: calorias acumuladas (mundo aberto + corridas), corridas,
// vitórias e melhor corrida. Ficam em memória enquanto o jogador está online e
// são gravadas no Postgres em lote (a cada poucos segundos). Sem banco, valem só
// enquanto o servidor estiver de pé.
import { randomUUID } from "node:crypto";

import { pool } from "./db.ts";

export interface Profile {
  token: string;
  name: string;
  calories: number;
  races: number;
  wins: number;
  bestRace: number;
  lastSeen: number;
  /** Mudou desde a última gravação no banco. */
  dirty: boolean;
}

export interface ListaGordaEntry {
  name: string;
  calories: number;
  races: number;
  wins: number;
}

const profiles = new Map<string, Profile>();
/** Fichas sem uso há mais que isto saem da memória (já estão no banco, se houver). */
const FORGET_AFTER_MS = 6 * 60 * 60 * 1000;
const FLUSH_EVERY_MS = 5000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isToken = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

function touch(profile: Profile) {
  profile.lastSeen = Date.now();
  profile.dirty = true;
}

/** Pega a ficha do token (memória, depois banco) ou cria uma nova. */
export async function loadProfile(token: unknown, name: string): Promise<Profile> {
  const cached = isToken(token) ? profiles.get(token) : undefined;
  if (cached) {
    cached.name = name;
    touch(cached);
    return cached;
  }

  let profile: Profile = {
    // Token conhecido do navegador mas ausente do banco (ex.: banco novo): reaproveita.
    token: isToken(token) ? token : randomUUID(),
    name,
    calories: 0,
    races: 0,
    wins: 0,
    bestRace: 0,
    lastSeen: Date.now(),
    dirty: true,
  };
  if (pool && isToken(token)) {
    try {
      const { rows } = await pool.query(
        "select calories, races, wins, best_race from players where token = $1",
        [token],
      );
      if (rows[0]) {
        profile = {
          ...profile,
          calories: Number(rows[0].calories),
          races: rows[0].races,
          wins: rows[0].wins,
          bestRace: Number(rows[0].best_race),
        };
      }
    } catch (err) {
      console.error("Falha ao ler ficha do banco (seguindo só em memória)", err);
    }
  }
  profiles.set(profile.token, profile);
  return profile;
}

/** Ficha já carregada (de quem está online), se houver. */
export const findProfile = (token: unknown) => (isToken(token) ? profiles.get(token) : undefined);

export function setCalories(profile: Profile, calories: number) {
  profile.calories = calories;
  touch(profile);
}

/** Resultado de uma corrida: soma as calorias e atualiza as estatísticas. */
export function recordRace(token: unknown, total: number, won: boolean) {
  const profile = findProfile(token);
  if (!profile) return;
  profile.calories += total;
  profile.races += 1;
  if (won) profile.wins += 1;
  profile.bestRace = Math.max(profile.bestRace, total);
  touch(profile);
}

/** Grava no banco as fichas que mudaram e esquece as antigas. */
export async function flushProfiles() {
  const dirty = [...profiles.values()].filter((p) => p.dirty);
  if (pool && dirty.length) {
    for (const p of dirty) p.dirty = false;
    try {
      // Um único comando para todas as fichas que mudaram.
      await pool.query(
        `insert into players (token, name, calories, races, wins, best_race)
         select * from unnest($1::uuid[], $2::text[], $3::bigint[], $4::int[], $5::int[], $6::bigint[])
         on conflict (token) do update set
           name = excluded.name, calories = excluded.calories, races = excluded.races,
           wins = excluded.wins, best_race = excluded.best_race, updated_at = now()`,
        [
          dirty.map((p) => p.token), dirty.map((p) => p.name), dirty.map((p) => p.calories),
          dirty.map((p) => p.races), dirty.map((p) => p.wins), dirty.map((p) => p.bestRace),
        ],
      );
    } catch (err) {
      for (const p of dirty) p.dirty = true; // tenta de novo na próxima rodada
      console.error("Falha ao gravar fichas no banco", err);
    }
  } else if (!pool) {
    for (const p of dirty) p.dirty = false;
  }

  const now = Date.now();
  for (const [token, profile] of profiles) {
    if (!profile.dirty && now - profile.lastSeen > FORGET_AFTER_MS) profiles.delete(token);
  }
}

setInterval(() => void flushProfiles(), FLUSH_EVERY_MS).unref();

/** Ficha do token para mostrar no menu (memória ou banco), sem criar uma nova. */
export async function peekProfile(token: unknown) {
  if (!isToken(token)) return null;
  const cached = profiles.get(token);
  if (cached) return { name: cached.name, calories: cached.calories, races: cached.races, wins: cached.wins };
  if (!pool) return null;
  const { rows } = await pool.query("select name, calories, races, wins from players where token = $1", [token]);
  return rows[0] ? { name: rows[0].name, calories: Number(rows[0].calories), races: rows[0].races, wins: rows[0].wins } : null;
}

/** Lista Gorda de todos os tempos: quem mais acumulou calorias. */
export async function listaGorda(limit = 10): Promise<ListaGordaEntry[]> {
  if (pool) {
    const { rows } = await pool.query(
      "select name, calories, races, wins from players where calories > 0 order by calories desc limit $1",
      [limit],
    );
    return rows.map((r) => ({ name: r.name, calories: Number(r.calories), races: r.races, wins: r.wins }));
  }
  return [...profiles.values()]
    .filter((p) => p.calories > 0)
    .sort((a, b) => b.calories - a.calories)
    .slice(0, limit)
    .map(({ name, calories, races, wins }) => ({ name, calories, races, wins }));
}
