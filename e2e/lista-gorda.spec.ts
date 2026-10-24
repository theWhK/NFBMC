import { test, expect } from "@playwright/test";

test("Lista Gorda: as calorias ficam na ficha e aparecem no menu, mesmo voltando depois", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByTestId("name-input").fill("Comilão");
  await page.getByTestId("world-solo-button").click();
  await expect.poll(() => page.evaluate(() => window.__nfbmc?.mode())).toBe("world");
  await expect(page.getByTestId("world-stats")).toContainText("Nenhuma corrida ainda");

  // Gancho de teste do servidor: dá calorias sem precisar comer pela cidade.
  await page.evaluate(() => window.__nfbmc!.send("debugCalories", { calories: 98765 }));
  await expect(page.getByTestId("world-calories")).toHaveText("98.765");

  // Voltando ao site no mesmo navegador: o menu mostra a Lista Gorda e a ficha continua.
  await page.goto("/");
  await expect(page.getByTestId("hall")).toContainText("Comilão");
  await expect(page.getByTestId("hall")).toContainText("98.765");
  await page.getByTestId("world-solo-button").click();
  await expect(page.getByTestId("world-calories")).toHaveText("98.765");

  await context.close();
});
