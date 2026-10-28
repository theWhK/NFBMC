// Aviso "tocando agora" (como o do rádio do Most Wanted): banda e música
// inventadas aparecem no canto quando uma faixa começa.
import type { TrackInfo } from "./music.ts";
import { escapeHtml } from "./ui.ts";

let timer: ReturnType<typeof setTimeout> | null = null;

export function showNowPlaying(info: TrackInfo) {
  let el = document.getElementById("now-playing");
  if (!el) {
    el = document.createElement("div");
    el.id = "now-playing";
    el.className = "now-playing";
    el.dataset.testid = "now-playing";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  el.innerHTML = `<span class="np-icon" aria-hidden="true">♪</span><div><small>Tocando agora</small>` +
    `<strong>${escapeHtml(info.artist)}</strong><span>${escapeHtml(info.title)}</span></div>`;
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
  if (timer) clearTimeout(timer);
  const current = el;
  timer = setTimeout(() => current.classList.remove("show"), 5000);
}
