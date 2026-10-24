import { test, expect } from "@playwright/test";

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
