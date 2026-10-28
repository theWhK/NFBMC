import { readdirSync } from "node:fs";

import { test, expect, type Page } from "@playwright/test";

// As falas gravadas (scripts/vozes.py) saem pelo servidor junto com o cliente.
const VOICE_FILES = readdirSync(new URL("../client/public/vozes", import.meta.url)).filter((f) => f.endsWith(".mp3"));

test("som: as locuções gravadas são servidas e o navegador consegue decodificá-las", async ({ page }) => {
  expect(VOICE_FILES.length).toBeGreaterThan(10);
  await page.goto("/");
  const results = await page.evaluate(async (files) => {
    const ctx = new OfflineAudioContext(1, 48000, 48000);
    return Promise.all(files.map(async (file) => {
      const response = await fetch(`/vozes/${file}`);
      if (!response.ok) return { file, ok: false, seconds: 0 };
      const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      return { file, ok: true, seconds: buffer.duration };
    }));
  }, VOICE_FILES);
  for (const r of results) {
    expect(r.ok, r.file).toBe(true);
    expect(r.seconds, r.file).toBeGreaterThan(0.3);
  }
});

const audio = (page: Page) => page.evaluate(() => window.__nfbmcAudio?.());

test("trilha: na cidade toca uma faixa do rádio com o aviso \"tocando agora\"", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("name-input").fill("DJ");
  await page.getByTestId("world-solo-button").click();
  await expect.poll(() => page.evaluate(() => window.__nfbmc?.mode())).toBe("world");
  await expect.poll(async () => (await audio(page))?.mood).toBe("lobby");
  // A primeira seção é gravada antes de tocar: o aviso aparece quando o som começa.
  await expect(page.getByTestId("now-playing")).toHaveClass(/show/, { timeout: 20_000 });
  await expect(page.getByTestId("now-playing")).toContainText(/MC Pastel de Feira|Sindicato do Torresmo/);
  expect((await audio(page))?.track).toMatch(/recheio-pesado|barriga-cheia/);
});

test("trilha: a cena do modo história troca a música do jogo pelo tema dela e devolve no fim", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("name-input").fill("Will");
  await page.getByTestId("story-menu").click();
  await expect(page.getByTestId("comic")).toBeVisible();
  // Prólogo: abre no sobrevoo da cidade (tema "chegada"), sem música do jogo e com os efeitos calados.
  await expect.poll(async () => (await audio(page))?.cue).toBe("chegada");
  expect(await audio(page)).toMatchObject({ cinematic: true, track: null });
  await page.getByTestId("comic-skip").click();
  await expect(page.getByTestId("comic")).toBeHidden();
  await expect.poll(async () => (await audio(page))?.cinematic).toBe(false);
  expect(await audio(page)).toMatchObject({ cue: null, mood: "lobby" });
});
