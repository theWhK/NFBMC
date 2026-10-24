import { test, expect, devices, type Page } from "@playwright/test";

/** Segura um botão de toque (como um dedo parado nele) por `ms` milissegundos. */
async function hold(page: Page, testId: string, ms: number) {
  const box = (await page.getByTestId(testId).boundingBox())!;
  await page.getByTestId(testId).dispatchEvent("pointerdown", {
    pointerId: 7, pointerType: "touch", isPrimary: true,
    clientX: box.x + box.width / 2, clientY: box.y + box.height / 2,
  });
  await page.waitForTimeout(ms);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, pointerType: "touch" })));
}

test("celular deitado: controles de toque aparecem e o carro anda com eles", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["Pixel 7 landscape"] });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByTestId("name-input").fill("Will");
  await page.getByTestId("world-solo-button").tap();
  await expect.poll(() => page.evaluate(() => window.__nfbmc?.mode())).toBe("world");

  await expect(page.getByTestId("touch-controls")).toBeVisible();
  await expect(page.getByTestId("rotate")).toBeHidden();

  const me = () => page.evaluate(() => Object.values(window.__nfbmc!.players())[0]);
  const before = await me();
  await hold(page, "touch-gas", 2000);
  const after = await me();
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(10);
  // Soltou o dedo: o botão volta ao normal e o carro para de acelerar.
  await expect(page.getByTestId("touch-gas")).not.toHaveClass(/down/);

  await context.close();
});

test("celular em pé: no jogo, pede para girar o aparelho", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await context.newPage();
  await page.goto("/");
  // No menu, em pé, tudo bem (o menu se ajeita na vertical).
  await expect(page.getByTestId("rotate")).toBeHidden();
  await page.getByTestId("name-input").fill("Will");
  await page.getByTestId("world-solo-button").tap();
  await expect(page.getByTestId("rotate")).toBeVisible();
  await expect(page.getByTestId("rotate")).toContainText("Gire o celular");
  await context.close();
});
