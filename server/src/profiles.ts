// Fichas dos jogadores nesta execução do servidor (em memória). Guardam as
// calorias acumuladas no mundo aberto e nas corridas, para o jogador não perder
// tudo ao ir do mundo para uma corrida e voltar. Reiniciou o servidor, zera.
import { randomUUID } from "node:crypto";

export interface Profile {
  token: string;
  name: string;
  calories: number;
  lastSeen: number;
}

const profiles = new Map<string, Profile>();
/** Fichas sem uso há mais que isto são esquecidas. */
const FORGET_AFTER_MS = 6 * 60 * 60 * 1000;

function cleanup() {
  const now = Date.now();
  for (const [token, profile] of profiles) {
    if (now - profile.lastSeen > FORGET_AFTER_MS) profiles.delete(token);
  }
}

/** Pega a ficha do token (se existir) ou cria uma nova. */
export function getProfile(token: unknown, name: string): Profile {
  cleanup();
  const existing = typeof token === "string" ? profiles.get(token) : undefined;
  if (existing) {
    existing.name = name;
    existing.lastSeen = Date.now();
    return existing;
  }
  const profile: Profile = { token: randomUUID(), name, calories: 0, lastSeen: Date.now() };
  profiles.set(profile.token, profile);
  return profile;
}

/** Soma calorias na ficha do token, se ela existir. */
export function addCalories(token: unknown, calories: number) {
  const profile = typeof token === "string" ? profiles.get(token) : undefined;
  if (!profile) return;
  profile.calories += calories;
  profile.lastSeen = Date.now();
}
