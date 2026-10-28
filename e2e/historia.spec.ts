import { test, expect, type Page } from "@playwright/test";

test("modo história: prólogo, Lista Gorda, objetivo na cidade e duelo contra o #10", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByTestId("name-input").fill("Will");

  // Primeira vez: o prólogo em quadrinhos abre sozinho.
  await page.getByTestId("story-menu").click();
  await expect(page.getByTestId("comic")).toBeVisible();
  await expect(page.getByTestId("comic")).toContainText("Porto Gordo");
  await page.getByTestId("comic-skip").click();
  await expect(page.getByTestId("comic")).toBeHidden();

  // Quadro: alvo é o #10, ainda sem poder desafiar.
  await expect(page.getByTestId("story-target")).toContainText("Izzy Iogurte");
  await expect(page.getByTestId("story-challenge")).toBeDisabled();

  // Na cidade (modo história), o objetivo aparece no HUD, e dá para voltar ao menu.
  await page.getByTestId("story-go").click();
  await expect.poll(() => page.evaluate(() => window.__nfbmc?.mode())).toBe("world");
  await expect(page.getByTestId("story-objective")).toContainText("Izzy Iogurte");
  expect((await page.evaluate(() => Object.values(window.__nfbmc!.players())[0])).car).toBe("uno");
  await page.getByTestId("to-menu").click();
  await page.getByTestId("pause-quit").click();
  await expect(page.getByTestId("story-menu")).toBeVisible();

  // Requisitos cumpridos (atalho pelo progresso salvo): o desafio libera.
  await page.evaluate(() => {
    const story = JSON.parse(localStorage.getItem("nfbmc:story")!);
    localStorage.setItem("nfbmc:story", JSON.stringify({ ...story, wins: 1, bounty: 3500 }));
  });
  await page.reload();
  await page.getByTestId("story-menu").click();
  await expect(page.getByTestId("story-challenge")).toBeEnabled();
  await page.getByTestId("story-challenge").click();

  // Apresentação do rival, a provocação, e o duelo 1x1 no carro dele.
  await expect(page.getByTestId("rival-intro")).toContainText("Izzy Iogurte");
  await expect(page.getByTestId("comic")).toBeVisible({ timeout: 8_000 });
  // (O primeiro "Continuar" só completa o texto da máquina de escrever; "Pular" fecha.)
  await page.getByTestId("comic-skip").click();
  await expect.poll(() => page.evaluate(() => window.__nfbmc?.phase()), { timeout: 20_000 }).toBe("racing");
  const players = Object.values(await page.evaluate(() => window.__nfbmc!.players()));
  expect(players).toHaveLength(2);
  const rival = players.find((p) => p.bot)!;
  expect(rival.name).toBe("Izzy Iogurte");
  expect(rival.car).toBe("gol");

  await context.close();
});

/** Abre o modo história com o progresso salvo dado (atalho pelo localStorage). */
async function storyWith(page: Page, progress: Record<string, unknown>) {
  await page.goto("/");
  await page.evaluate((p) => {
    localStorage.setItem("nfbmc:story", JSON.stringify({
      stage: 0, wins: 0, escapes: 0, bounty: 0, unlocked: ["uno", "fusca"], car: "uno", seenPrologue: true, finaleDone: false, ...p,
    }));
  }, progress);
  await page.reload();
  await page.getByTestId("name-input").fill("Will");
  await page.getByTestId("story-menu").click();
}

const copCars = (page: Page) => page.evaluate(() => window.__nfbmc!.police()!.cops.map((c) => c.car));

test("modo história: o Sargento Cross-fit entra na perseguição e fala pelo rádio", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Depois do #8 (JV Pastel), o Cross-fit sai atrás de quem chega a 5 estrelas.
  await storyWith(page, { stage: 3 });
  await expect(page.getByTestId("story-target")).toContainText("Vic Virado");
  await page.getByTestId("story-go").click();
  await expect.poll(() => page.evaluate(() => window.__nfbmc?.mode())).toBe("world");

  await page.evaluate(() => window.__nfbmc!.send("debugHeat", { heat: 5 }));
  await expect.poll(() => copCars(page)).toContain("viatura-crossfit");
  await expect(page.getByTestId("radio-call")).toContainText("Cross-fit");

  await context.close();
});

test("modo história: fuga final do Cross-fit até a ponte, autuação, nova tentativa e epílogo", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  // Bruno derrotado: o M3 voltou e falta a fuga final.
  await storyWith(page, { stage: 10, unlocked: ["uno", "fusca", "m3", "a3bruno"] });
  await expect(page.getByTestId("story-target")).toContainText("Cross-fit");
  await expect(page.getByTestId("story-challenge")).toBeEnabled();
  await expect(page.getByTestId("story-challenge")).toContainText("ponte");
  await page.getByTestId("story-challenge").click();

  // Nível máximo desde o começo, no M3, com o Couve-vette do Cross-fit atrás.
  await expect.poll(() => page.evaluate(() => window.__nfbmc?.mode())).toBe("world");
  expect((await page.evaluate(() => Object.values(window.__nfbmc!.players())[0])).car).toBe("m3");
  await expect(page.getByTestId("wanted")).toHaveAttribute("data-stars", "5");
  await expect.poll(() => copCars(page)).toContain("viatura-crossfit");
  await expect(page.getByTestId("story-objective")).toContainText("ponte");

  // Parado, a Vigilância autua: o Cross-fit provoca e dá para tentar de novo.
  await expect(page.getByTestId("comic")).toContainText("Mais uma série", { timeout: 60_000 });
  await page.getByTestId("comic-skip").click();
  await expect(page.getByTestId("story-challenge")).toContainText("ponte");
  await page.getByTestId("story-challenge").click();
  await expect.poll(() => page.evaluate(() => window.__nfbmc?.mode())).toBe("world");

  // Chegando na ponte inacabada do Cais (atalho de teste): o salto e o epílogo.
  await expect.poll(async () => (await copCars(page)).length).toBeGreaterThan(0);
  await page.evaluate(() => window.__nfbmc!.send("debugMove", { x: -450, z: -484 }));
  await expect(page.getByTestId("banner")).toContainText("ponte");
  await expect(page.getByTestId("comic")).toContainText("ponte inacabada", { timeout: 10_000 });
  await page.getByTestId("comic-skip").click();
  await expect(page.getByTestId("comic")).toContainText("fiança");
  await page.getByTestId("comic-skip").click();
  await expect(page.getByTestId("comic")).toBeHidden();
  await expect(page.getByTestId("story-target")).toContainText("Número 1");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("nfbmc:story")!).finaleDone)).toBe(true);

  await context.close();
});

test("modo história: derrota do rival (chave, nota fiscal e Cross-fit) com voz em cada fala", async ({ page }) => {
  // Sem WebGL, a cena vira quadrinhos; as vozes (MP3 pequenos) baixam do mesmo jeito.
  const voice = page.waitForResponse(/vozes\/historia\/r10-perde-1\.mp3/);
  await page.goto("/?cena=r10-perde");
  await page.getByTestId("story-menu").click();
  const comic = page.getByTestId("comic");
  await expect(comic).toContainText("Izzy Iogurte");
  await expect(comic).toContainText("1/4");
  expect((await voice).ok()).toBe(true);
  // Próximo quadro: a nota fiscal do Gol.
  await expect(async () => {
    await page.getByTestId("comic-next").click();
    await expect(comic).toContainText("2/4", { timeout: 300 });
  }).toPass();
  await expect(comic).toContainText("Gol Bolinha de Queijo agora é seu");
  await page.getByTestId("comic-skip").click();
  await expect(comic).toBeHidden();
});
