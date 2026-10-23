import { test, expect, type Page } from "@playwright/test";

const positionSeenBy = (page: Page, sessionId: string) =>
  page.evaluate((id) => window.__nfbmc?.players()[id], sessionId);

test("duas abas veem o quadrado uma da outra se mover", async ({ browser }) => {
  // Contextos separados = dois jogadores diferentes.
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();

  await alice.goto("/");
  await bob.goto("/");

  await expect(alice.getByTestId("status")).toHaveText("Conectado");
  await expect(bob.getByTestId("status")).toHaveText("Conectado");
  await expect(alice.getByTestId("player-count")).toHaveText("2");
  await expect(bob.getByTestId("player-count")).toHaveText("2");

  const aliceId = await alice.evaluate(() => window.__nfbmc!.sessionId);
  const before = await positionSeenBy(bob, aliceId);
  expect(before).toBeDefined();

  // Anda para o lado com mais espaço, para não esbarrar na borda do mundo.
  const key = before!.x < 400 ? "ArrowRight" : "ArrowLeft";
  await alice.keyboard.down(key);
  await alice.waitForTimeout(400);
  await alice.keyboard.up(key);

  await expect
    .poll(async () => Math.abs((await positionSeenBy(bob, aliceId))!.x - before!.x))
    .toBeGreaterThan(20);
});
