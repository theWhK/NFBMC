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
  for (const name of ["Perto", "Longe", "Baixa", "Capô", "Primeira pessoa", "Perseguição"]) {
    await page.keyboard.press("KeyC");
    await expect(page.locator(".popup").last()).toContainText(`Câmera: ${name}`);
  }

  expect(errors).toEqual([]);
});

// Cinemáticas do modo história: com WebGL, o prólogo e o salto da ponte viram
// cenas 3D (faixas de cinema e legenda); Enter passa de plano, Esc pula tudo.
test("3D: cinemáticas do modo história (prólogo e salto da ponte)", async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto("/");
  await page.getByTestId("name-input").fill("Will");
  await page.getByTestId("story-menu").click();
  // Prólogo: abre em cinemática (sobrevoo, chegada, a sirene do Cross-fit...).
  await expect(page.getByTestId("cine")).toBeVisible();
  await expect(page.getByTestId("cine")).toContainText("Porto Gordo");
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(700);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("cine")).toBeHidden();
  await expect(page.getByTestId("comic")).toBeHidden();

  // Fuga final até a ponte: o salto em câmera lenta e o Cross-fit na beira do cais.
  await page.evaluate(() => {
    localStorage.setItem("nfbmc:story", JSON.stringify({
      stage: 10, wins: 0, escapes: 0, bounty: 0, unlocked: ["uno", "fusca", "m3"], car: "uno", seenPrologue: true, finaleDone: false,
    }));
  });
  await page.reload();
  await page.getByTestId("name-input").fill("Will");
  await page.getByTestId("story-menu").click();
  await page.getByTestId("story-challenge").click();
  await expect.poll(() => page.evaluate(() => window.__nfbmc?.mode())).toBe("world");
  await page.evaluate(() => window.__nfbmc!.send("debugMove", { x: -450, z: -484 }));
  await expect(page.getByTestId("cine")).toContainText("ponte inacabada", { timeout: 15_000 });
  // Os planos passam sozinhos (o salto inteiro roda) até o Cross-fit na beira.
  await expect(page.getByTestId("cine")).toContainText("Pode correr", { timeout: 45_000 });
  await page.getByTestId("cine-skip").click();
  // Depois da cena, o epílogo em quadrinhos.
  await expect(page.getByTestId("comic")).toContainText("Mia Marmita", { timeout: 15_000 });
  await page.getByTestId("comic-skip").click();
  await expect(page.getByTestId("story-target")).toContainText("Número 1");

  expect(errors).toEqual([]);
});
