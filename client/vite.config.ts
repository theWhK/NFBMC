import { readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const offline = (file: string) => join(here, "src", "offline", file);

/**
 * Jogo sem internet: as salas do servidor (server/src/rooms) também entram no
 * build do cliente, para rodar no navegador. Os imports que só existem no Node
 * são trocados por versões locais: "colyseus" → offline/colyseus.ts e a ficha
 * com banco ("../profiles.ts") → offline/profiles.ts.
 */
function offlineRooms(): Plugin {
  return {
    name: "nfbmc-salas-locais",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || !importer.split(sep).join("/").includes("/server/src/")) return null;
      if (source === "colyseus") return offline("colyseus.ts");
      if (source === "../profiles.ts") return offline("profiles.ts");
      return null;
    },
  };
}

/** Todos os arquivos de uma pasta (relativos a ela), para a lista do service worker. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full).map((f) => `${name}/${f}`));
    else out.push(name);
  }
  return out;
}

/**
 * Service worker (PWA): gerado no build com a lista de tudo que o jogo precisa
 * (código, fontes, vozes), para guardar no aparelho e abrir sem internet. O nome
 * do cache muda a cada build, então uma versão nova substitui a anterior.
 */
function serviceWorker(): Plugin {
  return {
    name: "nfbmc-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const publicDir = join(here, "public");
      const files = new Set<string>(["./", "index.html", ...Object.keys(bundle), ...listFiles(publicDir)]);
      files.delete("sw.js");
      const list = [...files].sort();
      const version = `${Date.now().toString(36)}-${list.length}`;
      const source = SW_SOURCE.replace("__VERSION__", version).replace("__FILES__", JSON.stringify(list.map((f) => (f === "./" ? f : `./${f}`))));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

/** Código do service worker (o build troca __VERSION__ e __FILES__). */
const SW_SOURCE = `// Service worker do NFBMC (gerado no build do cliente: client/vite.config.ts).
const CACHE = "nfbmc-__VERSION__";
const FILES = __FILES__;

self.addEventListener("install", (event) => {
  // Guarda tudo; se um arquivo falhar, a instalação tenta de novo na próxima visita.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("nfbmc-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Só o que é do jogo, por GET. API, healthz e o WebSocket vão direto para a rede.
  if (request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/healthz" || url.pathname.startsWith("/matchmake")) return;
  // Página: rede primeiro (pega versão nova), cache se estiver sem internet.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("./index.html", { ignoreSearch: true })),
    );
    return;
  }
  // Arquivos (com hash no nome, vozes, fontes): cache primeiro.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => hit || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
`;

export default defineConfig({
  plugins: [offlineRooms(), serviceWorker()],
  // As salas do servidor leem esta variável; no navegador, os ganchos de teste
  // só ficam ligados no build dos testes (o Playwright builda com ela).
  define: {
    "process.env.NFBMC_TEST_HOOKS": JSON.stringify(process.env.NFBMC_TEST_HOOKS ?? ""),
  },
  server: {
    port: 5173,
    // Escuta em todas as interfaces para o preview abrir pelo Tailscale (http://nfbmc-dev:5173).
    host: true,
    allowedHosts: [".ts.net", "nfbmc-dev"],
    // As salas do servidor ficam fora da pasta do cliente.
    fs: { allow: [join(here, "..")] },
  },
});

