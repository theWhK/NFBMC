import { test, expect } from "@playwright/test";

// Usa o gancho de teste do servidor (NFBMC_TEST_HOOKS, ligado só no Playwright)
// para definir o nível de procurado sem precisar comer pela cidade.
test("Vigilância Sanitária: com nível de procurado, viaturas chegam e autuam quem fica parado", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/?spawn=centro");
  await page.getByTestId("name-input").fill("Will");
  await page.getByTestId("world-solo-button").click();
  await expect(page.getByTestId("status")).toHaveText(/^Conectado/);
  await expect.poll(() => page.evaluate(() => window.__nfbmc!.mode())).toBe("world");

  await page.evaluate(() => window.__nfbmc!.send("debugHeat", { heat: 2.2 }));

  // Duas estrelas: o HUD mostra o nível e duas viaturas saem atrás do jogador.
  await expect(page.getByTestId("wanted")).toHaveAttribute("data-stars", "2");
  await expect.poll(async () => (await page.evaluate(() => window.__nfbmc!.police()))!.cops.length).toBe(2);
  await expect(page.getByTestId("pursuit")).toBeVisible();

  // Com a perseguição rolando, não dá para disparar corrida.
  await expect(page.getByTestId("start-race-button")).toBeDisabled();

  // Parado no lugar, as viaturas encostam e autuam.
  await expect(page.getByTestId("banner")).toContainText("Autuado", { timeout: 30_000 });
  await expect.poll(async () => (await page.evaluate(() => window.__nfbmc!.police()))!.cops.length).toBe(0);
  await expect(page.getByTestId("wanted")).toBeHidden();
  await expect(page.getByTestId("start-race-button")).toBeEnabled();

  await context.close();
});
