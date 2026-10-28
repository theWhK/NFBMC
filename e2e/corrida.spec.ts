import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

// Todos os testes usam a mesma sala do servidor; fechar os jogadores no fim de
// cada teste esvazia a sala, e o próximo teste começa num lobby novo.
const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close()));
});

/** Abre o jogo num contexto separado (= outro jogador) e entra com um apelido. */
async function join(browser: Browser, name: string, mode: "multiplayer" | "solo" = "multiplayer") {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.goto("/");
  await page.getByTestId("name-input").fill(name);
  // A corrida rápida fica numa tela do menu principal.
  await page.getByTestId("quick-menu").click();
  await page.getByTestId(mode === "solo" ? "solo-button" : "join-button").click();
  await expect(page.getByTestId("status")).toHaveText(/^Conectado/);
  return page;
}

const sessionId = (page: Page) => page.evaluate(() => window.__nfbmc!.sessionId);
const phase = (page: Page) => page.evaluate(() => window.__nfbmc!.phase());
const playerSeenBy = (page: Page, id: string) =>
  page.evaluate((id) => window.__nfbmc!.players()[id], id);

test("dois jogadores entram no lobby, largam juntos e um vê o outro andar", async ({ browser }) => {
  const alice = await join(browser, "Alice");
  const bob = await join(browser, "Bob");

  // Os dois se veem no lobby, com os apelidos.
  for (const page of [alice, bob]) {
    await expect(page.getByTestId("player-count")).toHaveText("2");
    await expect(page.getByTestId("lobby-list")).toContainText("Alice");
    await expect(page.getByTestId("lobby-list")).toContainText("Bob");
  }

  // Qualquer um pode começar; os dois veem a contagem e depois a corrida.
  await alice.getByTestId("start-button").click();
  await expect(bob.getByTestId("countdown")).toHaveText(/^[123]$/);
  await expect.poll(() => phase(bob), { timeout: 6_000 }).toBe("racing");
  await expect(alice.getByTestId("lap")).toHaveText("1/3");
  await expect(alice.getByTestId("calories")).toHaveText("0");

  const aliceId = await sessionId(alice);
  const before = await playerSeenBy(bob, aliceId);
  expect(before.racing).toBe(true);

  // Alice acelera pela reta de largada; Bob vê o carro dela andar.
  await alice.keyboard.down("ArrowUp");
  await expect
    .poll(async () => {
      const now = await playerSeenBy(bob, aliceId);
      return Math.hypot(now.x - before.x, now.z - before.z);
    })
    .toBeGreaterThan(20);
  await alice.keyboard.up("ArrowUp");

  // Bob ficou parado no grid, então Alice está na frente.
  await expect(alice.getByTestId("place")).toHaveText("1º/2");
  await expect(bob.getByTestId("place")).toHaveText("2º/2");
});

test("quem entra no meio da corrida espera a próxima", async ({ browser }) => {
  const alice = await join(browser, "Alice");
  await expect(alice.getByTestId("player-count")).toHaveText("1");
  await alice.getByTestId("start-button").click();
  await expect.poll(() => phase(alice), { timeout: 6_000 }).toBe("racing");

  const carol = await join(browser, "Carol");
  await expect(carol.getByTestId("message")).toContainText("você entra na próxima");
  const carolId = await sessionId(carol);
  expect((await playerSeenBy(alice, carolId)).racing).toBe(false);
});

test("sozinho contra bots: sala privada, bots configuráveis e correndo", async ({ browser }) => {
  const will = await join(browser, "Will", "solo");
  await expect(will.getByTestId("bots-count")).toHaveText("5");
  await will.getByRole("button", { name: "Mais bots" }).click();
  await expect(will.getByTestId("bots-count")).toHaveText("6");
  await will.getByTestId("difficulty").selectOption("dificil");
  await expect(will.getByTestId("lobby-list")).toContainText("6 bots da Lista Gorda (Difícil)");

  // Quem entra no multiplayer não cai na sala solo.
  const intruso = await join(browser, "Intruso");
  await expect(intruso.getByTestId("lobby-list")).not.toContainText("Will");
  await expect(will.getByTestId("player-count")).toHaveText("1");

  await will.getByTestId("start-button").click();
  await expect.poll(() => phase(will), { timeout: 6_000 }).toBe("racing");

  const bots = async () =>
    Object.values(await will.evaluate(() => window.__nfbmc!.players())).filter((p) => p.bot);
  const start = await bots();
  expect(start).toHaveLength(6);
  expect(start.every((b) => b.racing)).toBe(true);

  // Os bots largam sozinhos e andam pela pista (todos eles; os que largam atrás
  // num carro popular demoram um pouco mais a sair, com a física de motor de verdade).
  await expect
    .poll(async () => Math.min(...(await bots()).map((b, i) => Math.hypot(b.x - start[i].x, b.z - start[i].z))), { timeout: 20_000 })
    .toBeGreaterThan(12);
});

test("corrida rápida: escolhe a pista (bairros novos) e larga nela", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByTestId("name-input").fill("Will");
  await page.getByTestId("quick-menu").click();
  await page.getByTestId("quick-track").selectOption("aeroporto");
  await expect(page.locator("#quick-info")).toContainText("2 voltas");
  await page.getByTestId("solo-button").click();
  await expect.poll(() => page.evaluate(() => window.__nfbmc?.raceId())).toBe("aeroporto");
  await page.getByTestId("start-button").click();
  await expect.poll(() => page.evaluate(() => window.__nfbmc!.phase()), { timeout: 15_000 }).toBe("racing");
  await context.close();

  // A escolha fica guardada para a próxima vez.
  const again = await browser.newContext();
  const other = await again.newPage();
  await other.goto("/");
  await other.evaluate(() => localStorage.setItem("nfbmc:quick-track", "rodoanel"));
  await other.reload();
  await other.getByTestId("quick-menu").click();
  await expect(other.getByTestId("quick-track")).toHaveValue("rodoanel");
  await expect(other.locator("#quick-info")).toContainText("1 volta");
  await again.close();
});
