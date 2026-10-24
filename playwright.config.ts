import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 2567);

export default defineConfig({
  testDir: "e2e",
  // A cidade em 3D é pesada no Chromium headless (desenha na CPU), e os testes do
  // mundo aberto trocam de sala; 60 s dá folga sem esconder travamento.
  timeout: 60_000,
  // Todos os testes usam o mesmo servidor e as mesmas salas públicas: um de cada vez.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Sobe a stack do jeito que roda em produção: cliente buildado servido pelo próprio servidor.
  webServer: {
    command: "npm run build && npm start",
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
