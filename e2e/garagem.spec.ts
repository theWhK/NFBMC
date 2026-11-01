import { test, expect, type Page } from "@playwright/test";

const me = (page: Page) => page.evaluate(() => window.__nfbmc!.players()[window.__nfbmc!.sessionId]);
const cash = (page: Page) => page.evaluate(() => window.__nfbmcEconomy!().cash);

test("garagem: tela cheia, troca de carro, oficina e o nitro no Shift", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByTestId("garage-menu").click();
  await expect(page.getByTestId("garage")).toBeVisible();
  // Carteira de quem começa: R$ 2.000.
  await expect(page.getByTestId("garage-cash")).toHaveText("R$ 2.000");

  // ←→ trocam de carro (a vitrine passa um por um); clicar na faixa escolhe direto.
  await page.getByTestId("car-list").locator('[data-car="civic"]').click();
  await expect(page.getByTestId("car-info")).toContainText("Civic Sushi");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("car-info")).toContainText("Golf GTI Goiabada");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("car-info")).toContainText("Civic Sushi");

  // Oficina: o nitro nível Rua custa R$ 550 no Civic; sem dinheiro, não compra.
  await page.getByTestId("garage-tab-tuning").click();
  const nos = page.getByTestId("garage-parts").locator('[data-part="nos"]');
  await expect(nos).toContainText("R$ 550");
  await nos.click();
  await expect(page.getByTestId("garage-cash")).toHaveText("R$ 1.450");
  await expect(nos.locator(".pips i.on")).toHaveCount(1);
  expect((await page.evaluate(() => window.__nfbmcEconomy!().parts.civic)).nos).toBe(1);
  await expect(page.getByTestId("car-info")).toContainText("4 s");
  // Câmbio Rua (R$ 300), e o próximo nível já aparece com o preço dele.
  await page.getByTestId("garage-parts").locator('[data-part="transmission"]').click();
  expect(await cash(page)).toBe(1150);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("garage")).toBeHidden();

  await page.getByTestId("name-input").fill("Will");
  await page.getByTestId("world-button").click();
  await expect.poll(() => page.evaluate(() => window.__nfbmc?.mode())).toBe("world");
  expect((await me(page)).car).toBe("civic");
  // Com o cilindro instalado, a barra do nitro aparece cheia.
  await expect(page.getByTestId("nitro")).toBeVisible();
  await expect.poll(async () => (await me(page)).nitro).toBeGreaterThan(0.95);

  // Só Shift parado não faz nada: o nitro é catalisador do acelerador.
  await page.keyboard.down("Shift");
  await page.waitForTimeout(400);
  expect((await me(page)).boost).toBe(false);
  // Acelerando com Shift: liga e o cilindro esvazia.
  await page.keyboard.down("ArrowUp");
  await expect.poll(async () => (await me(page)).boost, { timeout: 5_000 }).toBe(true);
  await expect.poll(async () => (await me(page)).nitro, { timeout: 5_000 }).toBeLessThan(0.8);
  await page.keyboard.up("Shift");
  await expect.poll(async () => (await me(page)).boost).toBe(false);
  await page.keyboard.up("ArrowUp");
  await context.close();
});

test("esconderijo: parado no pátio a garagem abre a oficina; fugindo, ela despista a Vigilância", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByTestId("name-input").fill("Will");
  await page.getByTestId("world-solo-button").click();
  await expect.poll(() => page.evaluate(() => window.__nfbmc?.mode())).toBe("world");
  // Jogando sozinho, o seu nome não aparece em cima do carro (e a carteira fica no HUD).
  await expect(page.getByTestId("world-cash")).toHaveText("R$ 2.000");

  const garages = await page.evaluate(() => window.__nfbmc!.garages());
  expect(garages.length).toBeGreaterThan(3);

  // Procurado: as viaturas saem atrás. Sumindo da vista delas e parando numa garagem
  // longe dali, a perseguição acaba na hora (e paga a fuga).
  await page.evaluate(() => window.__nfbmc!.send("debugHeat", { heat: 1.5 }));
  await expect.poll(async () => (await page.evaluate(() => window.__nfbmc!.police()))!.cops.length).toBeGreaterThan(0);
  const me0 = await me(page);
  const far = garages.reduce((best, g) => (Math.hypot(g.x - me0.x, g.z - me0.z) > Math.hypot(best.x - me0.x, best.z - me0.z) ? g : best));
  await page.evaluate((g) => window.__nfbmc!.send("debugMove", { x: g.x, z: g.z }), far);
  await expect(page.getByTestId("banner")).toContainText("Na garagem!", { timeout: 10_000 });
  await expect.poll(async () => (await page.evaluate(() => window.__nfbmc!.police()))!.cops.length).toBe(0);
  await expect.poll(() => cash(page)).toBe(2300);

  // Parado no pátio, sem ninguém atrás: Enter abre a garagem direto na oficina do
  // carro atual (e o jogo pausa).
  await expect(page.getByTestId("garage-prompt")).toBeVisible();
  await expect(page.getByTestId("garage-prompt")).toContainText(far.name);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("garage")).toBeVisible();
  await expect(page.getByTestId("garage")).toHaveClass(/safehouse/);
  await expect(page.getByTestId("garage-parts")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__nfbmc!.paused())).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("garage")).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__nfbmc!.paused())).toBe(false);
  await context.close();
});
