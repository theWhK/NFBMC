import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close()));
});

async function open(browser: Browser) {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.goto("/");
  return page;
}

/** Entra no Co-op (Porto Gordo compartilhado). */
async function enterCoop(browser: Browser, name: string) {
  const page = await open(browser);
  await page.getByTestId("name-input").fill(name);
  await page.getByTestId("world-button").click();
  await expect(page.getByTestId("status")).toHaveText(/^Conectado/);
  return page;
}

const mode = (page: Page) => page.evaluate(() => window.__nfbmc!.mode());

test("co-op: vê quem está online no mapa e no menu, desafia para um pega e os dois vão correr", async ({ browser }) => {
  const alice = await enterCoop(browser, "Alice");
  const bob = await enterCoop(browser, "Bob");

  // Quem ainda está no menu já vê quem está online, e onde.
  const watcher = await open(browser);
  await expect(watcher.getByTestId("online-badge")).toHaveText("2 online");
  await watcher.getByTestId("world-button").hover();
  await expect(watcher.locator("#menu-hint")).toContainText("Alice (em Porto Gordo)");

  // Alice abre o mapa: Bob aparece em "Online agora", com a distância.
  await alice.keyboard.press("Tab");
  await expect(alice.getByTestId("fullmap")).toBeVisible();
  const bobRow = alice.getByTestId("online-list").locator("li", { hasText: "Bob" });
  await expect(bobRow).toContainText(/a [\d,]+ k?m/);
  await alice.getByTestId("challenge-race").selectOption("parque");

  // Primeiro desafio: Bob amarela.
  await bobRow.getByRole("button", { name: "Desafiar" }).click();
  await expect(bob.getByTestId("challenge-card")).toBeVisible();
  await expect(bob.getByTestId("challenge-card")).toContainText("Alice");
  await expect(bob.getByTestId("challenge-card")).toContainText("Volta do Lago");
  await bob.getByTestId("challenge-decline").click();
  await expect(bob.getByTestId("challenge-card")).toBeHidden();
  await expect(alice.locator(".popup", { hasText: "amarelou" })).toBeVisible();

  // Segundo desafio: Bob aceita com Y e os dois vão para o pega, sem bots.
  await bobRow.getByRole("button", { name: "Desafiar" }).click();
  await expect(bob.getByTestId("challenge-card")).toBeVisible();
  await bob.keyboard.press("KeyY");
  for (const page of [alice, bob]) {
    await expect.poll(() => mode(page), { timeout: 10_000 }).toBe("race");
    expect(await page.evaluate(() => window.__nfbmc!.raceId())).toBe("parque");
  }
  const names = Object.values(await bob.evaluate(() => window.__nfbmc!.players())).map((p) => p.name).sort();
  expect(names).toEqual(["Alice", "Bob"]);

  // E o menu mostra que estão correndo.
  await watcher.reload();
  await watcher.getByTestId("world-button").hover();
  await expect(watcher.locator("#menu-hint")).toContainText("Bob (correndo: Volta do Lago)");
});

test("co-op: no modo solo a cidade é só sua e não dá para desafiar", async ({ browser }) => {
  const page = await open(browser);
  await page.getByTestId("name-input").fill("Sozinho");
  await page.getByTestId("world-solo-button").click();
  await expect(page.getByTestId("status")).toHaveText(/^Conectado/);
  // O mapa só abre depois que o carro aparece no estado da sala.
  await expect.poll(() => page.evaluate(() => Object.keys(window.__nfbmc!.players()).length)).toBe(1);
  await page.keyboard.press("KeyM");
  await expect(page.getByTestId("fullmap")).toBeVisible();
  await expect(page.getByTestId("online-list")).toContainText("Sozinho (você)");
  await expect(page.getByTestId("online-panel")).toContainText("Esta cidade é só sua");
  await expect(page.getByTestId("challenge-race")).toBeDisabled();
});
