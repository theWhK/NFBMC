import { test, expect } from "@playwright/test";

import { RACES, nearestSample, trackCorridor } from "../shared/src/index.ts";

test("GPS: marca um destino no mapa, mostra a rota e a próxima conversão, e tira o destino", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("name-input").fill("Navegador");
  await page.getByTestId("world-solo-button").click();
  await expect.poll(() => page.evaluate(() => Object.keys(window.__nfbmc?.players() ?? {}).length)).toBe(1);
  const me = await page.evaluate(() => window.__nfbmc!.players()[window.__nfbmc!.sessionId]);

  // Um destino a uns 500 m (como um toque no mapa grande).
  await page.evaluate(({ x, z }) => window.__nfbmc!.setDestination(x + 400, z + 300), me);
  await expect.poll(() => page.evaluate(() => window.__nfbmc!.gps()?.points ?? 0)).toBeGreaterThan(10);
  await expect(page.getByTestId("gps")).toBeVisible();
  await expect(page.getByTestId("gps-distance")).not.toBeEmpty();

  // No mapa grande aparece o botão de tirar o destino.
  await page.keyboard.press("KeyM");
  await expect(page.getByTestId("fullmap")).toBeVisible();
  await page.getByTestId("gps-clear").click();
  await expect.poll(() => page.evaluate(() => window.__nfbmc!.gps())).toBeNull();
  await expect(page.getByTestId("gps-clear")).toBeHidden();
  await page.keyboard.press("KeyM");
  await expect(page.getByTestId("gps")).toBeHidden();
});

test("barreiras: acelerando sem virar, o carro não sai do traçado da corrida", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("name-input").fill("Reto");
  await page.getByTestId("quick-menu").click();
  await page.getByTestId("quick-track").selectOption("centro");
  await page.getByTestId("solo-button").click();
  await page.getByTestId("start-button").click();
  await expect.poll(() => page.evaluate(() => window.__nfbmc!.phase()), { timeout: 15_000 }).toBe("racing");

  const track = RACES.centro.track;
  const corridor = trackCorridor(track);
  const widest = Math.max(...corridor.left, ...corridor.right);
  await page.keyboard.down("ArrowUp");
  // A primeira esquina do Circuito do Centro vem em poucos segundos: sem barreira, o carro seguiria reto.
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(500);
    const car = await page.evaluate(() => window.__nfbmc!.players()[window.__nfbmc!.sessionId]);
    expect(nearestSample(track, car.x, car.z).distance).toBeLessThanOrEqual(widest + 0.5);
  }
  await page.keyboard.up("ArrowUp");
  // E andou: a barreira guia, não segura.
  const car = await page.evaluate(() => window.__nfbmc!.players()[window.__nfbmc!.sessionId]);
  expect(Math.abs(car.speed)).toBeGreaterThan(5);
});
