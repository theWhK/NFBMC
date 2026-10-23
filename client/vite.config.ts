import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    // Escuta em todas as interfaces para o preview abrir pelo Tailscale (http://nfbmc-dev:5173).
    host: true,
    allowedHosts: [".ts.net", "nfbmc-dev"],
  },
});
