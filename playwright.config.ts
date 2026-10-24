import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 2567);

export default defineConfig({
  testDir: "e2e",
  // Os testes do mundo aberto trocam de sala; 60 s dá folga sem esconder travamento.
  timeout: 60_000,
  // Todos os testes usam o mesmo servidor e as mesmas salas públicas: um de cada vez.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    // Lógica, multiplayer e telas: com o WebGL desligado. O jogo segue sem o 3D
    // (lê tudo pelo window.__nfbmc e pelo HTML), e o navegador quase não gasta CPU.
    // Com o 3D ligado, no CI (2 núcleos, 3D desenhado na CPU) dois navegadores
    // ocupavam a máquina inteira e cada clique do Playwright levava ~6 s.
    {
      name: "chromium",
      testIgnore: /visual\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--disable-webgl", "--disable-3d-apis"] } },
    },
    // Fumaça do 3D: uma aba só, com WebGL, conferindo que a cena monta sem erros.
    { name: "chromium-3d", testMatch: /visual\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
  ],
  // Sobe a stack do jeito que roda em produção: cliente buildado servido pelo próprio servidor.
  webServer: {
    command: "npm run build && npm start",
    // NFBMC_TEST_HOOKS liga mensagens de teste no servidor (ex.: definir o nível de procurado).
    env: { PORT: String(PORT), NFBMC_TEST_HOOKS: "1" },
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
