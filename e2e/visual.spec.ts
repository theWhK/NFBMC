import { test, expect } from "@playwright/test";

// Roda no projeto "chromium-3d" (com WebGL): os outros testes desligam o 3D para
// economizar CPU, então este garante que a cena 3D monta e roda sem erros.
test("3D: menu, garagem e cidade desenham sem erros", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto("/?spawn=centro");
  await page.getByTestId("garage-menu").click();
  await page.getByTestId("car-list").locator('[data-car="a3bruno"]').click();
  await page.getByTestId("name-input").fill("Will");
  await page.getByTestId("world-solo-button").click();
  // Com WebGL, o status não tem o aviso "sem 3D".
  await expect(page.getByTestId("status")).toHaveText("Conectado");
  await expect.poll(() => page.evaluate(() => window.__nfbmc?.mode())).toBe("world");
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(1500);
  await page.keyboard.up("ArrowUp");
  // C troca a câmera (só existe com o 3D ligado), passando por todas até voltar.
  for (const name of ["Longe", "Baixa", "Capô", "Perseguição"]) {
    await page.keyboard.press("KeyC");
    await expect(page.locator(".popup").last()).toContainText(`Câmera: ${name}`);
  }

  expect(errors).toEqual([]);
});
