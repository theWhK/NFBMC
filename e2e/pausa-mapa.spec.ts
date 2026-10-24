import { test, expect } from "@playwright/test";

test("pausa e mapa: Esc pausa e solta o carro, Tab abre o mapa, e dá para voltar ao menu", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByTestId("name-input").fill("Will");
  await page.getByTestId("world-solo-button").click();
  await expect.poll(() => page.evaluate(() => window.__nfbmc?.mode())).toBe("world");

  // Acelerando, Esc abre a pausa e o carro deixa de receber o acelerador.
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("pause")).toBeVisible();
  // (Sem acelerador, o carro vai perdendo velocidade aos poucos: ar, rolagem e freio motor.)
  const speed = () => page.evaluate(() => Object.values(window.__nfbmc!.players())[0].speed);
  const atPause = await speed();
  expect(atPause).toBeGreaterThan(3);
  await expect.poll(speed, { timeout: 10_000 }).toBeLessThan(atPause / 2);
  await page.keyboard.up("ArrowUp");

  // Mapa: pela pausa e pelo Tab.
  await page.getByTestId("pause-map").click();
  await expect(page.getByTestId("fullmap")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("fullmap")).toBeHidden();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("fullmap")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("fullmap")).toBeHidden();

  // Voltar ao menu principal.
  await page.getByTestId("to-menu").click();
  await page.getByTestId("pause-quit").click();
  await expect(page.getByTestId("world-button")).toBeVisible();
  await context.close();
});
