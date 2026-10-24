import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close()));
});

/** Entra em Porto Gordo (mundo compartilhado). `?spawn=` nasce num ponto de encontro. */
async function enterWorld(browser: Browser, name: string, spawn?: string) {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(spawn ? `/?spawn=${spawn}` : "/");
  await page.getByTestId("name-input").fill(name);
  await page.getByTestId("world-button").click();
  await expect(page.getByTestId("status")).toHaveText(/^Conectado/);
  return page;
}

const mode = (page: Page) => page.evaluate(() => window.__nfbmc!.mode());

test("mundo aberto: a galera se encontra, anda pela cidade e vê a Lista Gorda", async ({ browser }) => {
  const alice = await enterWorld(browser, "Alice");
  const bob = await enterWorld(browser, "Bob");

  for (const page of [alice, bob]) {
    await expect(page.getByTestId("player-count")).toHaveText("2");
    await expect(page.getByTestId("leaderboard")).toContainText("Alice");
    await expect(page.getByTestId("leaderboard")).toContainText("Bob");
    expect(await mode(page)).toBe("world");
  }

  // Alice acelera e Bob vê o carro dela andar pela cidade.
  const aliceId = await alice.evaluate(() => window.__nfbmc!.sessionId);
  const seenByBob = () => bob.evaluate((id) => window.__nfbmc!.players()[id], aliceId);
  const before = await seenByBob();
  await alice.keyboard.down("ArrowUp");
  await expect.poll(async () => {
    const now = await seenByBob();
    return Math.hypot(now.x - before.x, now.z - before.z);
  }).toBeGreaterThan(15);
  await alice.keyboard.up("ArrowUp");
});

test("mundo aberto: quem está no ponto de encontro vai junto para a corrida", async ({ browser }) => {
  const alice = await enterWorld(browser, "Alice", "centro");
  const bob = await enterWorld(browser, "Bob", "centro");

  await expect(alice.getByTestId("marker-panel")).toBeVisible();
  await expect(alice.getByTestId("marker-panel")).toContainText("Circuito do Centro");
  await expect(alice.getByTestId("marker-panel")).toContainText("Bob");

  // Sem bots, para a corrida ter só os dois.
  for (let i = 0; i < 3; i++) await alice.getByRole("button", { name: "Menos bots" }).first().click();
  await expect(alice.getByTestId("marker-bots")).toHaveText("0");
  await alice.getByTestId("start-race-button").click();

  // Os dois são levados para a mesma corrida, que larga sozinha.
  for (const page of [alice, bob]) {
    await expect.poll(() => mode(page), { timeout: 10_000 }).toBe("race");
    expect(await page.evaluate(() => window.__nfbmc!.raceId())).toBe("centro");
    await expect.poll(() => page.evaluate(() => window.__nfbmc!.phase()), { timeout: 15_000 }).toBe("racing");
    await expect(page.getByTestId("lap")).toHaveText("1/2");
  }
  const names = Object.values(await bob.evaluate(() => window.__nfbmc!.players())).map((p) => p.name).sort();
  expect(names).toEqual(["Alice", "Bob"]);
});
