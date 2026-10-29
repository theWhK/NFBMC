import { test, expect } from "@playwright/test";

test("pausa e mapa: no modo solo Esc e o mapa pausam o jogo de verdade, Tab abre o mapa, e dá para voltar ao menu", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByTestId("name-input").fill("Will");
  await page.getByTestId("world-solo-button").click();
  await expect.poll(() => page.evaluate(() => window.__nfbmc?.mode())).toBe("world");

  // Acelerando, Esc abre a pausa: o jogo para inteiro (o carro fica onde estava, na mesma velocidade).
  const me = () => page.evaluate(() => Object.values(window.__nfbmc!.players())[0]);
  const paused = () => page.evaluate(() => window.__nfbmc!.paused());
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
  await page.keyboard.up("ArrowUp");
  await expect(page.getByTestId("pause")).toBeVisible();
  await expect(page.getByTestId("pause-note")).toHaveText("Jogo pausado.");
  await expect.poll(paused).toBe(true);
  const atPause = await me();
  expect(atPause.speed).toBeGreaterThan(3);
  await page.waitForTimeout(1000);
  const later = await me();
  expect([later.x, later.z, later.speed]).toEqual([atPause.x, atPause.z, atPause.speed]);

  // Resumo ao lado da pausa.
  await expect(page.getByTestId("pause-card")).toContainText("Carreira");

  // Continuar: 3, 2, 1 (ainda parado) e o jogo volta; freando, o carro perde velocidade
  // (só soltar o acelerador não basta: numa descida o carro embala).
  await page.getByTestId("pause-resume").click();
  await expect(page.getByTestId("resume-count")).toBeVisible();
  expect(await paused()).toBe(true);
  await expect.poll(paused).toBe(false);
  await expect(page.getByTestId("resume-count")).toBeHidden();
  await page.keyboard.down("ArrowDown");
  await expect.poll(async () => (await me()).speed, { timeout: 10_000 }).toBeLessThan(atPause.speed / 2);
  await page.keyboard.up("ArrowDown");

  // O mapa também pausa (e avisa na legenda).
  await page.keyboard.press("KeyM");
  await expect(page.getByTestId("map-paused")).toBeVisible();
  await expect.poll(paused).toBe(true);
  await page.keyboard.press("KeyM");
  await expect.poll(paused).toBe(false);

  // Mapa: pela pausa e pelo Tab.
  await page.keyboard.press("Escape");
  await page.getByTestId("pause-map").click();
  await expect(page.getByTestId("fullmap")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("fullmap")).toBeHidden();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("fullmap")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("fullmap")).toBeHidden();

  // Teclas: M abre e fecha o mapa, F1 mostra os comandos.
  await page.keyboard.press("KeyM");
  await expect(page.getByTestId("fullmap")).toBeVisible();
  await page.keyboard.press("KeyM");
  await expect(page.getByTestId("fullmap")).toBeHidden();
  await page.keyboard.press("F1");
  await expect(page.getByTestId("help")).toContainText("Freio de mão");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("help")).toBeHidden();

  // Voltar ao menu principal.
  await page.getByTestId("to-menu").click();
  await page.getByTestId("pause-quit").click();
  await expect(page.getByTestId("world-button")).toBeVisible();
  // O velocímetro não fica para trás no menu.
  await expect(page.locator("#dash")).toBeHidden();
  await context.close();
});

test("pausa: na corrida solo os bots param junto; com a galera o jogo continua", async ({ browser }) => {
  // Corrida solo contra bots: a pausa congela os bots (e o cronômetro).
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByTestId("name-input").fill("Will");
  await page.getByTestId("quick-menu").click();
  await page.getByTestId("solo-button").click();
  await expect(page.getByTestId("status")).toHaveText(/^Conectado/);
  await page.getByTestId("start-button").click();
  await expect.poll(() => page.evaluate(() => window.__nfbmc!.phase()), { timeout: 15_000 }).toBe("racing");
  await page.waitForTimeout(1500);
  const bots = () => page.evaluate(() =>
    Object.values(window.__nfbmc!.players()).filter((p) => p.bot).map((p) => [Math.round(p.x * 100), Math.round(p.z * 100)]));
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__nfbmc!.paused())).toBe(true);
  const frozen = await bots();
  expect(frozen.length).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  expect(await bots()).toEqual(frozen);
  await page.keyboard.press("Escape");
  await expect.poll(bots).not.toEqual(frozen);
  await context.close();

  // Co-op (a cidade da galera): a pausa não para o jogo.
  const coop = await browser.newContext();
  const other = await coop.newPage();
  await other.goto("/");
  await other.getByTestId("name-input").fill("Ana");
  await other.getByTestId("world-button").click();
  await expect.poll(() => other.evaluate(() => window.__nfbmc?.mode())).toBe("world");
  await other.keyboard.down("ArrowUp");
  await other.waitForTimeout(800);
  await other.keyboard.press("Escape");
  await other.keyboard.up("ArrowUp");
  await expect(other.getByTestId("pause-note")).toContainText("continua rodando");
  const speed = () => other.evaluate(() => Object.values(window.__nfbmc!.players()).find((p) => p.name === "Ana")!.speed);
  const atPause = await speed();
  // Com a pausa aberta não dá para dirigir: o carro segue andando sem acelerador e,
  // no plano, perde velocidade. Mede pela posição (numa descida ele embala).
  const where = () => other.evaluate(() => { const p = Object.values(window.__nfbmc!.players()).find((p) => p.name === "Ana")!; return [p.x, p.z]; });
  const from = await where();
  await expect.poll(async () => { const [x, z] = await where(); return Math.hypot(x - from[0], z - from[1]); }, { timeout: 10_000 }).toBeGreaterThan(3);
  expect(atPause).toBeGreaterThan(1);
  expect(await other.evaluate(() => window.__nfbmc!.paused())).toBe(false);
  await coop.close();
});
