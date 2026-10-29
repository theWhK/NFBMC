import { test, expect } from "@playwright/test";

test("menu: navega pelo teclado, mostra os rivais e guarda a cor da garagem", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");

  // ↓ três vezes chega na Lista Gorda; Enter abre o cardápio (tela cheia).
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("story-menu")).toHaveClass(/selected/);
  await page.keyboard.press("Enter");
  // Primeira vez: o prólogo antes.
  await page.getByTestId("comic-skip").click();
  await expect(page.getByTestId("menu-board")).toBeVisible();
  // Os 10 combos da Lista Gorda, com o Bruno no topo; o cardápio abre no combo atual (#10).
  await expect(page.locator(".rival")).toHaveCount(10);
  await expect(page.locator(".rival").first()).toContainText("Bruno");
  await expect(page.locator(".rival.current")).toContainText("Izzy Iogurte");
  await expect(page.getByTestId("story-target")).toContainText("Izzy Iogurte");
  // Setas destacam outro combo: a ficha troca, o botão de desafiar continua sendo do atual.
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("story-target")).toContainText("Ming Miojo");
  await expect(page.getByTestId("story-target")).toContainText("Derrote o #10 primeiro");
  await expect(page.getByTestId("story-target")).toContainText("Informação nutricional");
  // Esc fecha o cardápio.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("menu-board")).toBeHidden();
  await expect(page.getByTestId("story-menu")).toBeVisible();

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
  // O Enter do título não "vazou" para o menu (entraria na carreira).
  await expect(page.getByTestId("world-solo-button")).toHaveClass(/selected/);
  expect(await page.evaluate(() => window.__nfbmc?.mode())).toBeUndefined();
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

test("menu: carrossel anda com ←→ e o seletor de gráficos vale na hora, sem recarregar (nem repetir a abertura)", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("world-button")).toHaveClass(/selected/);
  await expect(page.locator("#menu-hint strong")).toHaveText("Co-op");
  // Single-player unificado: o primeiro item é a Carreira, e não há mais "Modo solo".
  await expect(page.getByTestId("world-solo-button")).toContainText("Carreira");
  await expect(page.locator("#menu-list")).not.toContainText("Modo solo");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("world-solo-button")).toHaveClass(/selected/);

  // Marca a página: se ela recarregar, a marca some.
  await page.evaluate(() => ((window as unknown as { marca: number }).marca = 1));
  await page.getByTestId("options-menu").click();
  const quality = page.getByTestId("opt-quality");
  const before = await quality.textContent();
  await quality.click();
  await expect(quality).not.toHaveText(before!);
  await quality.click();
  expect(await page.evaluate(() => (window as unknown as { marca?: number }).marca)).toBe(1);
  await expect(page.getByTestId("intro")).toBeHidden();
});

test("opções: volume da música e dos efeitos ficam guardados", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("options-menu").click();
  await page.getByTestId("vol-music").fill("40");
  await page.getByTestId("vol-sfx").fill("75");
  await expect(page.locator("#vol-music-out")).toHaveText("40%");
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem("nfbmc:audio") ?? "{}"));
  expect(prefs.musicVolume).toBeCloseTo(0.4);
  expect(prefs.sfxVolume).toBeCloseTo(0.75);
  await page.reload();
  await page.getByTestId("options-menu").click();
  await expect(page.getByTestId("vol-music")).toHaveValue("40");
});
