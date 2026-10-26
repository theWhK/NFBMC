// Quem está online agora, em qualquer sala (mundo, corrida, solo). O menu e o
// mapa mostram, para a galera saber quem está jogando e onde.
import type { OnlinePilot } from "@nfbmc/shared";

/** Por sala e sessão; cada entrada lê o estado atual (as calorias mudam). */
const online = new Map<string, () => OnlinePilot>();

export function setPresence(roomId: string, sessionId: string, read: () => OnlinePilot) {
  online.set(`${roomId}:${sessionId}`, read);
}

export function clearPresence(roomId: string, sessionId: string) {
  online.delete(`${roomId}:${sessionId}`);
}

export function onlinePilots(): OnlinePilot[] {
  return [...online.values()].map((read) => read()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
