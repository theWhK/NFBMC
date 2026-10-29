// PWA: instala como app, abre sem internet e sincroniza o progresso offline.
//
// - Service worker (gerado no build, client/vite.config.ts): guarda o jogo no aparelho.
// - Sem internet, o menu desliga o que precisa de conexão (Co-op e corrida com a
//   galera) e avisa; modo solo, história e corrida contra bots rodam em salas
//   locais (offline/local.ts).
// - O que foi ganho offline sobe para a nuvem quando a conexão volta (sync.ts).
import { checkServer, isOffline, onOfflineChange } from "./net.ts";
import { pendingEntries, syncNow } from "./sync.ts";
import { $, showPopup } from "./ui.ts";

/** Botões que precisam de internet (Co-op e corrida rápida com a galera). */
const ONLINE_ONLY = ["world", "quick"];

function applyOffline(offline: boolean) {
  document.body.classList.toggle("offline", offline);
  for (const id of ONLINE_ONLY) {
    const button = document.getElementById(id) as HTMLButtonElement | null;
    if (button) button.disabled = offline;
  }
  refreshBadge();
}

/** Aviso no rodapé do menu: offline e/ou progresso esperando para subir. */
export function refreshBadge() {
  const badge = $("offline-badge");
  const pending = pendingEntries().length;
  const offline = isOffline();
  badge.hidden = !offline && pending === 0;
  badge.textContent = offline
    ? `📴 Sem internet: carreira e corrida contra bots funcionam${pending ? ` · ⏳ ${pending} para sincronizar` : ""}`
    : `⏳ Sincronizando ${pending} ${pending === 1 ? "partida" : "partidas"} com a nuvem…`;
}

/** Manda o progresso offline (se houver e se tiver internet) e atualiza o aviso. */
export async function syncProgress(name: string) {
  if (isOffline() || pendingEntries().length === 0) return refreshBadge();
  refreshBadge();
  const done = await syncNow(name);
  refreshBadge();
  if (done) showPopup("☁️ Progresso offline sincronizado");
}

export function setupPwa(name: () => string) {
  // Service worker: só no build (em dev, o Vite recarrega sozinho).
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      // Primeira instalação não avisa; troca de versão, sim.
      if (hadController) showPopup("🍔 Versão nova instalada: recarregue para atualizar");
      hadController = true;
    });
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("Service worker não registrado", err));
    });
  }

  onOfflineChange((offline) => {
    applyOffline(offline);
    if (!offline) void syncProgress(name());
  });
  applyOffline(isOffline());
  void checkServer().then(() => {
    applyOffline(isOffline());
    void syncProgress(name());
  });
  // De tempos em tempos: confere a conexão e tenta subir o que ficou pendente.
  setInterval(() => {
    void checkServer().then(() => void syncProgress(name()));
  }, 60_000);
}
