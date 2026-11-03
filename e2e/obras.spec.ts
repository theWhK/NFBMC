import { test, expect, type Page } from "@playwright/test";

import { RACES, STRUCTURES, locate, nearestSample, type RaceId } from "../shared/src/index.ts";

/** Corrida solo numa pista; devolve quando já está correndo. */
async function soloRace(page: Page, race: RaceId) {
  await page.goto("/");
  await page.getByTestId("name-input").fill("Engenheiro");
  await page.getByTestId("quick-menu").click();
  await page.getByTestId("quick-track").selectOption(race);
  await page.getByTestId("solo-button").click();
  await page.getByTestId("start-button").click();
  await expect.poll(() => page.evaluate(() => window.__nfbmc!.phase()), { timeout: 15_000 }).toBe("racing");
}

const me = (page: Page) => page.evaluate(() => window.__nfbmc!.players()[window.__nfbmc!.sessionId]);

test("Elevado Costelão: a corrida larga no viaduto, o carro sobe nele e fica no traçado", async ({ page }) => {
  await soloRace(page, "elevado");
  const elevado = STRUCTURES.find((s) => s.name === "Elevado Costelão")!;
  const track = RACES.elevado.track;
  await page.keyboard.down("ArrowUp");
  // A largada é no pé da rampa: acelerando reto, em poucos segundos o carro está lá em cima.
  await expect.poll(async () => (await me(page)).level, { timeout: 20_000 }).toBe(elevado.id);
  // Lá em cima, continua no tabuleiro (o guarda-corpo segura) e andando.
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(500);
    const car = await me(page);
    const loc = locate(elevado, car.x, car.z, 20);
    expect(loc).not.toBeNull();
    expect(Math.abs(loc!.u)).toBeLessThanOrEqual(elevado.half);
    expect(nearestSample(track, car.x, car.z).distance).toBeLessThan(track.width);
  }
  await page.keyboard.up("ArrowUp");
  expect(Math.abs((await me(page)).speed)).toBeGreaterThan(5);
});

test("Túnel do Torresmo: o carro entra no túnel pela boca", async ({ page }) => {
  await soloRace(page, "tunel-torresmo");
  const tunnel = STRUCTURES.find((s) => s.name === "Túnel do Torresmo")!;
  await page.keyboard.down("ArrowUp");
  await expect.poll(async () => (await me(page)).level, { timeout: 20_000 }).toBe(tunnel.id);
  await page.keyboard.up("ArrowUp");
});
