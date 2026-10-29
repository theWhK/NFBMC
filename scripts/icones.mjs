// Gera os ícones do app (PWA) a partir do hambúrguer do favicon, com o Chromium
// do Playwright. Rodar da raiz: `node scripts/icones.mjs` (só quando o desenho mudar).
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const svg = readFileSync(new URL("../client/public/favicon.svg", import.meta.url), "utf8");
const out = new URL("../client/public/icons/", import.meta.url);

// any: hambúrguer grande num quadrado escuro arredondado.
// maskable: fundo cheio e o hambúrguer dentro da "zona segura" (o Android recorta em círculo).
const icons = [
  { file: "icone-192.png", size: 192, scale: 0.72, radius: 0.22 },
  { file: "icone-512.png", size: 512, scale: 0.72, radius: 0.22 },
  { file: "icone-maskable-512.png", size: 512, scale: 0.56, radius: 0 },
  { file: "apple-touch-icon.png", size: 180, scale: 0.7, radius: 0 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const icon of icons) {
  const inner = Math.round(icon.size * icon.scale);
  await page.setViewportSize({ width: icon.size, height: icon.size });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">
    <div style="width:${icon.size}px;height:${icon.size}px;border-radius:${icon.radius * 100}%;
      background:radial-gradient(circle at 50% 40%, #3a2a1c, #16110d 70%);display:flex;align-items:center;justify-content:center">
      <div style="width:${inner}px;height:${inner}px">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div>
    </div></body></html>`);
  await page.screenshot({ path: new URL(icon.file, out).pathname, omitBackground: true });
  console.log("gerado", icon.file);
}
await browser.close();
