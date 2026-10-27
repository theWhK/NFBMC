import { readdirSync } from "node:fs";

import { test, expect } from "@playwright/test";

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
