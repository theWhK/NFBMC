import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";

// PWA: o jogo abre sem internet (service worker), os modos sozinho rodam em salas
// locais e o progresso sobe para a nuvem quando a conexão volta.
test("offline: abre sem internet, joga modo solo e corrida contra bots e sincroniza depois", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByTestId("name-input").fill("Offline");

  // Service worker instalado e controlando a página, com o jogo guardado.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).some((k) => k.startsWith("nfbmc-"))), { timeout: 15_000 }).toBe(true);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  // Sem internet: a página abre do cache e o menu avisa.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("offline-badge")).toContainText("Sem internet");
  await expect(page.getByTestId("world-button")).toBeDisabled();

  // Modo solo numa sala local: o carro anda.
  await page.getByTestId("name-input").fill("Offline");
  await page.getByTestId("world-solo-button").click();
  await expect.poll(() => page.evaluate(() => window.__nfbmc?.mode())).toBe("world");
  const me = () => page.evaluate(() => Object.values(window.__nfbmc!.players())[0]);
  const before = await me();
  await page.keyboard.down("ArrowUp");
  await expect.poll(async () => { const now = await me(); return Math.hypot(now.x - before.x, now.z - before.z); }, { timeout: 10_000 }).toBeGreaterThan(5);
  await page.keyboard.up("ArrowUp");
  await page.getByTestId("to-menu").click();
  await page.getByTestId("pause-quit").click();

  // Corrida contra bots offline, até o resultado.
  await page.getByTestId("quick-menu").click();
  await expect(page.getByTestId("join-button")).toBeDisabled();
  await page.getByTestId("solo-button").click();
  await page.getByTestId("start-button").click();
  await expect.poll(() => page.evaluate(() => window.__nfbmc!.phase()), { timeout: 15_000 }).toBe("racing");
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__nfbmc!.send("debugFinish", {}));
  await expect.poll(() => page.evaluate(() => window.__nfbmc!.phase()), { timeout: 10_000 }).toBe("results");
  // A corrida ficou guardada para sincronizar.
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("nfbmc:pendentes") ?? "[]").some((e: { races: number }) => e.races === 1))).toBe(true);
  const token = await page.evaluate(() => localStorage.getItem("nfbmc:token"));

  // Internet de volta: o progresso sobe e a fila esvazia.
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("nfbmc:pendentes") ?? "[]").length), { timeout: 15_000 }).toBe(0);
  const ficha = await (await page.request.get(`/api/ficha/${token}`)).json();
  expect(ficha.races).toBeGreaterThanOrEqual(1);
  await context.close();
});

test("sync: o mesmo lançamento enviado duas vezes conta uma vez só", async ({ request }) => {
  // Ids novos a cada rodada (o servidor de teste pode ser reaproveitado entre rodadas).
  const token = randomUUID();
  const entries = [{ id: randomUUID(), calories: 700, races: 1, wins: 1, best: 700 }];
  const first = await (await request.post("/api/sync", { data: { token, name: "Repete", entries } })).json();
  const again = await (await request.post("/api/sync", { data: { token, name: "Repete", entries } })).json();
  expect(first.applied).toBe(1);
  expect(again.applied).toBe(0);
  expect(again.races).toBe(first.races);
});
