import { test, expect } from "@playwright/test";

test("menu: navega pelo teclado, mostra os rivais e guarda a cor da garagem", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");

  // ↓ três vezes chega na Lista Gorda; Enter abre a tela com os rivais.
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("lista-menu")).toHaveClass(/selected/);
  await page.keyboard.press("Enter");
  await expect(page.locator(".rival")).toHaveCount(12);
  await expect(page.locator(".rival").first()).toContainText("Razor Bacon");

  // Garagem: escolher a terceira cor e conferir que ela fica guardada ao voltar.
  await page.getByTestId("garage-menu").click();
  const swatch = page.getByTestId("swatches").locator("button").nth(2);
  await swatch.click();
  await expect(swatch).toHaveClass(/selected/);
  const color = await swatch.getAttribute("data-color");
  await page.reload();
  await page.getByTestId("garage-menu").click();
  await expect(page.getByTestId("swatches").locator(`button[data-color="${color}"]`)).toHaveClass(/selected/);

  await context.close();
});
