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
  // Pelo Co-op: o carro da garagem vale ali (na carreira, vale o carro conquistado).
  await page.getByTestId("world-button").click();
  // Com WebGL, o status não tem o aviso "sem 3D".
  await expect(page.getByTestId("status")).toHaveText("Conectado");
  await expect.poll(() => page.evaluate(() => window.__nfbmc?.mode())).toBe("world");
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(1500);
  await page.keyboard.up("ArrowUp");
  // C troca a câmera (só existe com o 3D ligado), passando por todas até voltar.
  // Os avisos duram 1,2 s; com o 3D desenhado na CPU um quadro pode levar quase isso,
  // então o teste anota cada aviso no instante em que aparece (em vez de tentar vê-lo na tela).
  await page.evaluate(() => {
    const seen: string[] = ((window as unknown as { __popups: string[] }).__popups = []);
    new MutationObserver((changes) => {
      for (const change of changes) for (const node of change.addedNodes) seen.push((node as HTMLElement).textContent ?? "");
    }).observe(document.getElementById("popups")!, { childList: true });
  });
  for (const name of ["Perto", "Longe", "Baixa", "Capô", "Primeira pessoa", "Perseguição"]) {
    await page.keyboard.press("KeyC");
    await expect.poll(() => page.evaluate(() => (window as unknown as { __popups: string[] }).__popups)).toContain(`Câmera: ${name}`);
  }

  expect(errors).toEqual([]);
});

// Cinemáticas do modo história: com WebGL, tudo que é apresentação vira cena 3D
// (faixas de cinema, legenda, personagens e voz); Enter passa de plano, Esc pula tudo.
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
  // Prólogo: inteiro em cinemática (sobrevoo, chegada, o Cross-fit, o Bruno, a Mia...),
  // sem nenhum quadrinho no meio.
  await expect(page.getByTestId("cine")).toBeVisible();
  await expect(page.getByTestId("cine")).toContainText("Porto Gordo");
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(500);
    await expect(page.getByTestId("comic")).toBeHidden();
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
  // Depois, o epílogo, também em cinemática.
  await expect(page.getByTestId("cine")).toContainText("Mia Marmita", { timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("cine")).toBeHidden();
  await expect(page.getByTestId("story-target")).toContainText("Número 1");

  expect(errors).toEqual([]);
});

// Antes do duelo, o cartão da Lista Gorda com o rival na frente do carro; depois de
// vencer, a chave, a nota fiscal e o Cross-fit na TV. Os planos passam sozinhos,
// no tempo da voz. (?cena= toca uma cena direto.)
test("3D: apresentação, provocação e derrota do rival em cinemática", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const voice = page.waitForResponse(/vozes\/historia\/r5-apresenta\.mp3/);

  await page.goto("/?cena=r5-provoca");
  await page.getByTestId("story-menu").click();
  await expect(page.getByTestId("rival-intro")).toContainText("Ronnie Rocambole");
  await expect(page.getByTestId("cine")).toContainText("Número cinco da Lista Gorda");
  expect((await voice).ok()).toBe(true);
  await expect(page.getByTestId("rival-intro")).toBeHidden({ timeout: 10_000 });
  await expect(page.getByTestId("cine")).toContainText("maionese", { timeout: 25_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("cine")).toBeHidden();

  await page.goto("/?cena=r6-perde");
  await page.getByTestId("story-menu").click();
  await expect(page.getByTestId("cine")).toContainText("Earl Esfiha");
  await expect(page.locator(".cine-stamp")).toContainText("Mustang Mostarda", { timeout: 25_000 });
  await expect(page.locator(".cine-tv")).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("cine")).toBeHidden();
  await expect(page.getByTestId("comic")).toBeHidden();

  expect(errors).toEqual([]);
});
