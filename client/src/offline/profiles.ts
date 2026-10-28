// Fichas sem servidor: no build do cliente, o "../profiles.ts" das salas do
// servidor aponta para cá (veja o vite.config.ts). A ficha fica no aparelho e o
// que o jogador ganha vira lançamento para sincronizar depois (sync.ts).
import { addOfflineCalories, addOfflineRace, ensureToken, localProfile, type LocalProfile } from "../sync.ts";

export type Profile = LocalProfile;

let current: Profile | null = null;

export async function loadProfile(_token: unknown, name: string): Promise<Profile> {
  current = localProfile(ensureToken(), name);
  return current;
}

export const findProfile = (_token: unknown) => current ?? undefined;

/** O mundo informa o total de calorias do jogador: a diferença vira lançamento. */
export function setCalories(profile: Profile, calories: number) {
  if (calories > profile.calories) addOfflineCalories(calories - profile.calories);
  profile.calories = calories;
}

export function recordRace(_token: unknown, total: number, won: boolean) {
  addOfflineRace(total, won);
  if (current) {
    current.calories += total;
    current.races += 1;
    if (won) current.wins += 1;
    current.bestRace = Math.max(current.bestRace, total);
  }
}
