import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

// Speedtrap (desafio solo com metas) e arrancada (drag) no aeroporto.
const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close()));
});

async function open(browser: Browser, name: string, url = "/") {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(url);
  await page.getByTestId("name-input").fill(name);
  return page;
}

/** Corrida rápida numa pista, pelo botão solo. */
async function quickSolo(browser: Browser, name: string, track: string) {
  const page = await open(browser, name);
  await page.getByTestId("quick-menu").click();
  await page.getByTestId("quick-track").selectOption(track);
  await page.getByTestId("solo-button").click();
  await expect(page.getByTestId("status")).toHaveText(/^Conectado/);
  return page;
}

const phase = (page: Page) => page.evaluate(() => window.__nfbmc!.phase());
const me = (page: Page) => page.evaluate(() => window.__nfbmc!.players()[window.__nfbmc!.sessionId]);
const cash = (page: Page) => page.evaluate(() => window.__nfbmcEconomy!().cash);

/** Passa nos radares todos (gancho de teste) a `speed` m/s e cruza a chegada. */
async function runRadar(page: Page, speed: number) {
  await page.getByTestId("start-button").click();
  await expect.poll(() => phase(page), { timeout: 15_000 }).toBe("racing");
  await expect(page.getByTestId("trap")).toContainText("0/4");
  await expect(page.getByTestId("radar-goals")).toContainText("🥉");
  for (let i = 0; i < 4; i++) await page.evaluate((speed) => window.__nfbmc!.send("debugRadar", { speed }), speed);
  await expect(page.getByTestId("trap")).toContainText("4/4");
  await page.evaluate(() => window.__nfbmc!.send("debugFinish", {}));
  await expect.poll(() => phase(page), { timeout: 8_000 }).toBe("results");
}

test("speedtrap: é desafio solo, sem bots, e bater a meta é vitória com prêmio", async ({ browser }) => {
  const page = await open(browser, "Will");
  await page.getByTestId("quick-menu").click();
  await page.getByTestId("quick-track").selectOption("radar-porto");
  // Speedtrap não tem "com a galera": só o desafio solo.
  await expect(page.getByTestId("join-button")).toBeHidden();
  await expect(page.getByTestId("solo-button")).toHaveText("Desafio solo");
  await page.getByTestId("solo-button").click();
  await expect(page.getByTestId("status")).toHaveText(/^Conectado/);
  // As metas aparecem no lobby, e não tem bots para escolher.
  await expect(page.locator("#lobby-hint")).toContainText("km/h nos radares para vencer");
  await expect(page.getByTestId("bots-count")).toBeHidden();

  const before = await cash(page);
  // 4 × 360 km/h passa de qualquer meta: ouro.
  await runRadar(page, 100);
  const rows = page.getByTestId("results").locator("tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Ouro");
  await expect(rows.first()).toContainText("1.440 km/h");
  await expect(page.locator("#winner")).toContainText("acima da meta");
  await expect.poll(() => cash(page)).toBeGreaterThan(before);
});

test("speedtrap: sem bater a meta não vence nem ganha prêmio, e diz quanto faltou", async ({ browser }) => {
  const page = await quickSolo(browser, "Will", "radar-yakisoba");
  const before = await cash(page);
  // 4 × 18 km/h fica muito abaixo do bronze.
  await runRadar(page, 5);
  const mine = page.getByTestId("results").locator("tr.me");
  await expect(mine).toContainText("Sem meta");
  await expect(mine).toContainText("72 km/h");
  await expect(page.locator("#winner")).toContainText("Faltaram");
  await page.waitForTimeout(500);
  expect(await cash(page)).toBe(before);
});

test("arrancada: faixa verde na contagem, largada com E, trocas com nota e chegada nos 402 m", async ({ browser }) => {
  test.setTimeout(90_000);
  const page = await open(browser, "Will");
  await page.getByTestId("quick-menu").click();
  await page.getByTestId("quick-track").selectOption("arrancada");
  await expect(page.locator("#quick-info")).toContainText("402 m");
  await page.getByTestId("solo-button").click();
  await expect(page.getByTestId("status")).toHaveText(/^Conectado/);
  await expect(page.locator("#lobby-title")).toHaveText("Arrancada");
  await page.getByTestId("start-button").click();

  // Na contagem, parado na linha: acelera (o giro sobe, o carro não sai) e o aviso explica a largada.
  await expect.poll(() => phase(page), { timeout: 10_000 }).toBe("countdown");
  await expect(page.getByTestId("message")).toContainText("faixa verde");
  await page.keyboard.down("ArrowUp");
  await expect.poll(async () => (await me(page)).rpm).toBeGreaterThan(2500);
  expect((await me(page)).speed).toBe(0);
  expect((await me(page)).launched).toBe(false);

  // Verde: E solta a embreagem. A reação conta do verde e a largada ganha nota.
  await expect.poll(() => phase(page), { timeout: 10_000 }).toBe("racing");
  await page.keyboard.press("KeyE");
  await expect.poll(async () => (await me(page)).launched).toBe(true);
  const launched = await me(page);
  expect(launched.jumped).toBe(false);
  expect(launched.reaction).toBeGreaterThanOrEqual(0);
  expect(["perfeita", "boa", "fraca", "patinou", "morreu"]).toContain(launched.launchGrade);
  await expect(page.getByTestId("drag-info")).toContainText("reação");

  // Trocas manuais com E: cada uma ganha nota (perfeita/boa/cedo/tarde) no HUD.
  const players = await page.evaluate(() => window.__nfbmc!.players());
  expect(Object.values(players).filter((p) => p.bot)).toHaveLength(1);
  let shifted = false;
  for (let i = 0; i < 40 && !(await me(page)).finished; i++) {
    await page.waitForTimeout(700);
    await page.keyboard.press("KeyE");
    if (!shifted && ((await me(page)).shifts ?? 0) > 0) {
      shifted = true;
      expect(["perfeita", "boa", "cedo", "tarde"]).toContain((await me(page)).shiftGrade);
    }
  }
  expect(shifted).toBe(true);
  expect((await me(page)).gear).toBeGreaterThan(1);
  await page.keyboard.up("ArrowUp");

  // Chegada: tempo, velocidade final e reação; os dois carros no placar.
  await expect.poll(async () => (await me(page)).finished, { timeout: 30_000 }).toBe(true);
  await expect.poll(() => phase(page), { timeout: 15_000 }).toBe("results");
  const rows = page.getByTestId("results").locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(page.locator("#trap-col-title")).toHaveText("Reação · final");
  await expect(page.getByTestId("results").locator("tr.me")).toContainText("km/h");
});

test("arrancada: soltar antes do verde queima a largada e desclassifica", async ({ browser }) => {
  const page = await quickSolo(browser, "Will", "arrancada");
  await page.getByTestId("start-button").click();
  await expect.poll(() => phase(page), { timeout: 10_000 }).toBe("countdown");
  await page.keyboard.press("KeyE");
  await expect.poll(async () => (await me(page)).jumped).toBe(true);
  expect((await me(page)).reaction).toBeLessThan(0);
  await expect(page.getByTestId("drag-grade")).toContainText("Queimou");
  await expect.poll(() => phase(page), { timeout: 10_000 }).toBe("racing");
  await page.evaluate(() => window.__nfbmc!.send("debugFinish", {}));
  await expect.poll(() => phase(page), { timeout: 10_000 }).toBe("results");
  const mine = page.getByTestId("results").locator("tr.me");
  await expect(mine).toContainText("Queimou");
  // Desclassificado: sem prêmio.
  await expect(mine.locator("td").last()).toHaveText("—");
});

test("mundo: arrancada é ponto de encontro no aeroporto e o speedtrap leva só quem disparou", async ({ browser }) => {
  // Arrancada: ponto de encontro com a distância; vai você e um bot.
  const page = await open(browser, "Will", "/?spawn=arrancada");
  await page.getByTestId("world-button").click();
  await expect(page.getByTestId("status")).toHaveText(/^Conectado/);
  await expect(page.getByTestId("marker-panel")).toContainText("Arrancada do Aeroporto");
  await expect(page.getByTestId("marker-panel")).toContainText("402 m");
  await expect(page.getByTestId("marker-bots")).toHaveText("1");
  await page.getByTestId("start-race-button").click();
  await expect.poll(() => page.evaluate(() => window.__nfbmc!.mode()), { timeout: 10_000 }).toBe("race");
  expect(await page.evaluate(() => window.__nfbmc!.raceId())).toBe("arrancada");
  await expect.poll(async () => Object.keys(await page.evaluate(() => window.__nfbmc!.players())).length, { timeout: 15_000 }).toBe(2);

  // Speedtrap: dois no ponto, só quem disparou vai (o outro continua no mundo).
  const alice = await open(browser, "Alice", "/?spawn=radar-porto");
  await alice.getByTestId("world-button").click();
  const bob = await open(browser, "Bob", "/?spawn=radar-porto");
  await bob.getByTestId("world-button").click();
  await expect(alice.getByTestId("player-count")).toHaveText("2");
  await expect(alice.getByTestId("marker-panel")).toContainText("Desafio solo");
  await alice.getByTestId("start-race-button").click();
  await expect.poll(() => alice.evaluate(() => window.__nfbmc!.mode()), { timeout: 10_000 }).toBe("race");
  await expect.poll(() => alice.evaluate(() => window.__nfbmc!.phase()), { timeout: 15_000 }).not.toBe("lobby");
  expect(Object.keys(await alice.evaluate(() => window.__nfbmc!.players()))).toHaveLength(1);
  await bob.waitForTimeout(1000);
  expect(await bob.evaluate(() => window.__nfbmc!.mode())).toBe("world");
});
