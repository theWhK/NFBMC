import { test, expect, type Page } from "@playwright/test";

const jukebox = (page: Page) => page.evaluate(() => window.__nfbmcJukebox?.());

test("jukebox: abre pelo menu principal, lista as 25 faixas (com o Lado E, do baile), toca, passa de faixa e fecha com Esc", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("jukebox-menu").click();
  await expect(page.getByTestId("jukebox")).toBeVisible();
  await expect(page.getByTestId("jukebox-track")).toHaveCount(25);
  // Abre tocando a primeira faixa da lista.
  await expect.poll(async () => (await jukebox(page))?.playing).toBe(true);
  const first = (await jukebox(page))!.title!;
  await expect(page.getByTestId("jukebox-now")).toContainText(first);

  // Próxima (botão) e a seta → mudam o "tocando agora".
  await page.getByTestId("jukebox-next").click();
  await expect(page.getByTestId("jukebox-now")).not.toContainText(first);
  const second = (await jukebox(page))!.title!;
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("jukebox-now")).not.toContainText(second);

  // O som começa de verdade (a seção é gravada e o tempo anda).
  await expect.poll(async () => (await jukebox(page))?.elapsed, { timeout: 20_000 }).toBeGreaterThan(0.5);

  // Espaço pausa; escolher pela lista toca a escolhida.
  await page.keyboard.press("Space");
  await expect.poll(async () => (await jukebox(page))?.paused).toBe(true);
  await page.getByTestId("jukebox-track").nth(19).click();
  await expect.poll(async () => (await jukebox(page))?.paused).toBe(false);
  await expect(page.getByTestId("jukebox-now")).toContainText((await page.getByTestId("jukebox-track").nth(19).locator("strong").textContent())!);

  // Esc fecha e a música do menu volta.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("jukebox")).toBeHidden();
  expect((await jukebox(page))?.open).toBe(false);
  await expect.poll(async () => (await page.evaluate(() => window.__nfbmcAudio?.()))?.jukebox).toBe(false);
});
