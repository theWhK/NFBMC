import { test, expect } from "@playwright/test";

test("menu: navega pelo teclado, mostra os rivais e guarda a cor da garagem", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");

  // ↓ quatro vezes chega na Lista Gorda; Enter abre a tela com os rivais.
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("lista-menu")).toHaveClass(/selected/);
  await page.keyboard.press("Enter");
  // Os 10 da Lista Gorda do modo história, com o Bruno no topo.
  await expect(page.locator(".rival")).toHaveCount(10);
  await expect(page.locator(".rival").first()).toContainText("Bruno");

  // Garagem: escolher a terceira cor e conferir que ela fica guardada ao voltar.
  await page.getByTestId("garage-menu").click();
  const swatch = page.getByTestId("swatches").locator("button").nth(2);
  await swatch.click();
  await expect(swatch).toHaveClass(/chosen/);
  const color = await swatch.getAttribute("data-color");
  await page.reload();
  await page.getByTestId("garage-menu").click();
  await expect(page.getByTestId("swatches").locator(`button[data-color="${color}"]`)).toHaveClass(/chosen/);

  await context.close();
});

// Nos testes a abertura fica desligada (navigator.webdriver); ?intro=1 força.
test("abertura: aviso, vinhetas de mentira, trailer e título; Esc pula tudo", async ({ page }) => {
  await page.goto("/?intro=1");
  const intro = page.getByTestId("intro");
  await expect(intro).toHaveAttribute("data-step", "aviso");
  await expect(intro).toContainText("Aviso à saúde");
  // O menu fica escondido por baixo.
  await expect(page.getByTestId("story-menu")).toBeHidden();

  // Cada tecla pula uma vinheta; o trailer inteiro conta como uma.
  for (const step of ["eat", "lunchbox", "nhamvidia", "cidade", "titulo"]) {
    await page.keyboard.press("Enter");
    await expect(intro).toHaveAttribute("data-step", step);
  }
  await expect(intro).toContainText("Aperte Enter");
  await page.keyboard.press("Enter");
  await expect(intro).toBeHidden();
  // O Enter do título não "vazou" para o menu (abriria o modo história e o prólogo).
  await expect(page.getByTestId("story-menu")).toHaveClass(/selected/);
  await expect(page.getByTestId("comic")).toBeHidden();

  // Créditos → "Ver a abertura"; Esc pula direto para o menu.
  await page.locator('[data-screen="credits"]').click();
  await page.getByTestId("credits-intro").click();
  await expect(intro).toHaveAttribute("data-step", "aviso");
  await page.keyboard.press("Escape");
  await expect(intro).toBeHidden();
  await expect(page.getByTestId("story-menu")).toBeVisible();

  // Dá para desligar nas Opções (e fica guardado).
  await page.getByTestId("options-menu").click();
  await page.getByTestId("opt-intro").click();
  await expect(page.getByTestId("opt-intro")).toHaveText("Abertura: desligada");
  await page.reload();
  await expect(page.getByTestId("opt-intro")).toHaveText("Abertura: desligada");
});

test("créditos: a Bandeira do Orgulho Gordo e quem fez a piada", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Créditos" }).click();
  await expect(page.locator(".credit-flag")).toContainText("Bandeira do Orgulho Gordo");
  await expect(page.locator(".credit-flag")).toContainText("@barlattiraphael");
});
