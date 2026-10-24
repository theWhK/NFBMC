import { test, expect, type Page } from "@playwright/test";

const me = (page: Page) => page.evaluate(() => Object.values(window.__nfbmc!.players())[0]);

test("garagem: escolher um carro e entrar com ele; o câmbio automático troca de marcha", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByTestId("garage-menu").click();
  await page.getByTestId("car-list").locator('[data-car="supra"]').click();
  await expect(page.getByTestId("car-info")).toContainText("Supra Salsicha");
  await expect(page.getByTestId("car-info")).toContainText("Toyota Supra");

  await page.getByTestId("name-input").fill("Will");
  await page.getByTestId("world-solo-button").click();
  await expect.poll(() => page.evaluate(() => window.__nfbmc?.mode())).toBe("world");
  expect((await me(page)).car).toBe("supra");

  // Pé no fundo: o giro sobe e o câmbio automático passa para a 2ª marcha ou mais.
  await page.keyboard.down("ArrowUp");
  await expect.poll(async () => (await me(page)).gear, { timeout: 10_000 }).toBeGreaterThan(1);
  await page.keyboard.up("ArrowUp");
  await context.close();
});

test("câmbio manual: segura a marcha até o limitador e troca com a tecla E", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByTestId("options-menu").click();
  await page.getByTestId("opt-gearbox").click();
  await expect(page.getByTestId("opt-gearbox")).toContainText("manual");
  await page.getByTestId("name-input").fill("Will");
  await page.getByTestId("world-solo-button").click();
  await expect.poll(() => page.evaluate(() => window.__nfbmc?.mode())).toBe("world");

  await page.keyboard.down("ArrowUp");
  // Sem trocar, fica na 1ª e o giro chega perto da faixa vermelha (Civic: 8.200).
  await expect.poll(async () => (await me(page)).rpm, { timeout: 10_000 }).toBeGreaterThan(7500);
  expect((await me(page)).gear).toBe(1);
  await page.keyboard.press("KeyE");
  await expect.poll(async () => (await me(page)).gear).toBe(2);
  await page.keyboard.up("ArrowUp");
  await context.close();
});
