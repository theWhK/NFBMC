// Materiais dos prédios e casas (versão detalhada), com as texturas desenhadas
// no código: reboco, tijolo baiano, telha colonial, metal ondulado, madeira,
// concreto, vidro, janela acesa e letreiros. São criados uma vez só e
// compartilhados por todos os blocos (a cena descarta a geometria dos blocos
// que ficam longe, nunca os materiais). A cor de cada peça vai nos vértices; as
// texturas são quase neutras (claras) para a cor dos vértices mandar.
import * as THREE from "three";

import { surface } from "./look.ts";
import { normalTexture, paintedTexture, type Painter } from "./textures.ts";

/** Índice de cada material no `Mesher` (uma malha por material em cada bloco). */
export const M = {
  /** Reboco pintado (paredes). UV em metros. */
  plaster: 0,
  /** Tijolo baiano à vista. */
  brick: 1,
  /** Telha cerâmica colonial: u ao longo do beiral, v subindo o telhado. */
  tile: 2,
  /** Telha/chapa ondulada de metal: as ondas correm ao longo de v. */
  metal: 3,
  /** Tábuas de madeira (em pé: as tábuas correm ao longo de v). */
  wood: 4,
  /** Concreto, laje, muro chapiscado, piso. */
  concrete: 5,
  /** Pintura lisa: grades, calhas, caixas-d'água, portões, toldos, molduras. */
  paint: 6,
  /** Vidro escuro (reflete o céu). UV 0..1 por vidraça. */
  glass: 7,
  /** Janela acesa (fim de tarde). UV: uma das 16 cenas do atlas (`litUv`). */
  lit: 8,
  /** Letreiros (atlas de nomes, `signUv`). */
  sign: 9,
} as const;

// --- Texturas -------------------------------------------------------------------

const noise: Painter = (ctx, size, random) => {
  for (let i = 0; i < size * 6; i++) {
    const v = 200 + random() * 55;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    const s = 1 + random() * 3;
    ctx.fillRect(random() * size, random() * size, s, s);
  }
};

/** Reboco: claro, com manchas leves de umidade e um chapisco fino. */
const plasterColor: Painter = (ctx, size, random) => {
  ctx.fillStyle = "#f2f0ec";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = 10 + random() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.04 + random() * 0.06;
    g.addColorStop(0, `rgba(120,110,95,${a})`);
    g.addColorStop(1, "rgba(120,110,95,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < size * 10; i++) {
    const v = 215 + random() * 40;
    ctx.fillStyle = `rgba(${v},${v - 3},${v - 8},0.5)`;
    ctx.fillRect(random() * size, random() * size, 1, 1);
  }
};
const plasterHeight: Painter = (ctx, size, random) => {
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * 14; i++) {
    const v = 90 + random() * 90;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    const s = 1 + random() * 2;
    ctx.fillRect(random() * size, random() * size, s, s);
  }
};

/** Tijolo baiano (29 × 19 cm) em amarração, com argamassa: 4 por fiada, 4 fiadas. */
const BRICK_SPAN: [number, number] = [1.2, 0.8];
function brickPainter(height: boolean): Painter {
  return (ctx, size, random) => {
    const bw = size / 4;
    const bh = size / 4;
    const mortar = Math.max(2, size / 64);
    ctx.fillStyle = height ? "#202020" : "#a99c8c";
    ctx.fillRect(0, 0, size, size);
    for (let row = 0; row < 4; row++) {
      const offset = row % 2 ? bw / 2 : 0;
      for (let col = -1; col < 4; col++) {
        const x = col * bw + offset;
        const y = row * bh;
        if (height) {
          const v = 190 + random() * 50;
          ctx.fillStyle = `rgb(${v},${v},${v})`;
        } else {
          // Tijolo baiano: laranja queimado, uns mais claros, outros mais escuros.
          const hue = 17 + random() * 12;
          const light = 44 + random() * 14;
          ctx.fillStyle = `hsl(${hue}, ${44 + random() * 14}%, ${light}%)`;
        }
        ctx.fillRect(x + mortar / 2, y + mortar / 2, bw - mortar, bh - mortar);
        if (!height) {
          // Furinhos e queimado do forno.
          for (let k = 0; k < 6; k++) {
            ctx.fillStyle = `rgba(60,25,10,${random() * 0.15})`;
            ctx.fillRect(x + random() * bw, y + random() * bh, 2 + random() * 6, 1 + random() * 3);
          }
          // Argamassa que escorreu.
          if (random() < 0.3) {
            ctx.fillStyle = "rgba(180,170,155,0.6)";
            ctx.fillRect(x + random() * bw, y + bh - mortar, 3 + random() * 10, mortar * 1.5);
          }
        }
      }
    }
  };
}

/** Telha colonial (capa e canal): 4 ondas e 2 fiadas por textura. */
const TILE_SPAN: [number, number] = [0.84, 0.84];
function tilePainter(height: boolean): Painter {
  return (ctx, size, random) => {
    const waves = 4;
    const rows = 2;
    const ww = size / waves;
    const rh = size / rows;
    for (let row = 0; row < rows; row++) {
      for (let w = 0; w < waves; w++) {
        const tint = random();
        for (let x = 0; x < ww; x++) {
          const t = x / ww;
          const profile = Math.sin(t * Math.PI);
          for (let y = 0; y < rh; y += 2) {
            // Cada fiada fica mais alta embaixo (onde encavala na de baixo).
            const along = y / rh;
            if (height) {
              const v = 40 + profile * 150 + along * 50;
              ctx.fillStyle = `rgb(${v},${v},${v})`;
            } else {
              const light = 30 + profile * 18 + tint * 10 - (along > 0.92 ? 12 : 0);
              ctx.fillStyle = `hsl(${12 + tint * 10}, ${50 + tint * 15}%, ${light}%)`;
            }
            ctx.fillRect(w * ww + x, row * rh + y, 1, 2);
          }
        }
        if (!height && random() < 0.5) {
          // Limo e sujeira.
          ctx.fillStyle = `rgba(40,45,30,${0.1 + random() * 0.2})`;
          ctx.fillRect(w * ww, row * rh + random() * rh, ww, rh * 0.3);
        }
      }
    }
  };
}

/** Chapa ondulada trapezoidal: 6 ondas por metro. */
function metalPainter(height: boolean): Painter {
  return (ctx, size, random) => {
    const waves = 6;
    const ww = size / waves;
    for (let x = 0; x < size; x++) {
      const t = (x % ww) / ww;
      // Trapézio: sobe, plano, desce, vale.
      const h = t < 0.15 ? t / 0.15 : t < 0.45 ? 1 : t < 0.6 ? 1 - (t - 0.45) / 0.15 : 0;
      if (height) {
        const v = 40 + h * 180;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
      } else {
        const v = 205 + h * 30;
        ctx.fillStyle = `rgb(${v},${v},${v + 4})`;
      }
      ctx.fillRect(x, 0, 1, size);
    }
    if (!height) {
      // Escorridos de ferrugem e sujeira.
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = `rgba(${110 + random() * 40},${70 + random() * 20},40,${random() * 0.12})`;
        ctx.fillRect(random() * size, random() * size * 0.5, 1 + random() * 3, 10 + random() * size * 0.6);
      }
    }
  };
}

/** Tábuas em pé, 8 por textura (15 cm cada), com veio. */
function woodPainter(height: boolean): Painter {
  return (ctx, size, random) => {
    const planks = 8;
    const pw = size / planks;
    for (let p = 0; p < planks; p++) {
      const tone = random();
      if (height) ctx.fillStyle = "#c0c0c0";
      else ctx.fillStyle = `hsl(${28 + tone * 8}, ${18 + tone * 14}%, ${68 + tone * 12}%)`;
      ctx.fillRect(p * pw, 0, pw, size);
      for (let i = 0; i < 14; i++) {
        const x = p * pw + random() * pw;
        ctx.fillStyle = height ? `rgba(90,90,90,0.5)` : `rgba(90,60,30,${0.08 + random() * 0.12})`;
        ctx.fillRect(x, 0, 1, size);
      }
      // Nó da madeira.
      if (!height && random() < 0.4) {
        ctx.fillStyle = "rgba(80,50,25,0.35)";
        ctx.beginPath();
        ctx.ellipse(p * pw + pw / 2, random() * size, pw * 0.15, pw * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // Fresta entre tábuas.
      ctx.fillStyle = height ? "#202020" : "rgba(40,25,15,0.7)";
      ctx.fillRect(p * pw, 0, Math.max(1, size / 128), size);
    }
  };
}

/** Concreto: cinza claro, manchado, com marcas de forma. */
const concreteColor: Painter = (ctx, size, random) => {
  ctx.fillStyle = "#e6e4e0";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 60; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = 6 + random() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = random() < 0.6;
    g.addColorStop(0, dark ? `rgba(90,90,85,${0.05 + random() * 0.08})` : `rgba(255,255,250,0.1)`);
    g.addColorStop(1, "rgba(90,90,85,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  noise(ctx, size, random);
  ctx.fillStyle = "rgba(255,255,255,0)";
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#9a978f";
  ctx.fillRect(0, size / 2, size, 1);
  ctx.globalAlpha = 1;
};

/** Vidraça: escura, com reflexo em faixa e o caixilho na borda (UV 0..1 por vidraça). */
const glassColor: Painter = (ctx, size, random) => {
  const g = ctx.createLinearGradient(0, 0, size * 0.3, size);
  g.addColorStop(0, "#c8d2dc");
  g.addColorStop(0.45, "#8f9aa6");
  g.addColorStop(0.55, "#a8b2bc");
  g.addColorStop(1, "#7a8592");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // Cortina ou persiana lá dentro, às vezes (fica bem escuro).
  ctx.fillStyle = "rgba(40,40,45,0.1)";
  for (let y = 0; y < size; y += 6) ctx.fillRect(0, y, size, 2 + random());
  ctx.strokeStyle = "#3a3d42";
  ctx.lineWidth = size / 32;
  ctx.strokeRect(0, 0, size, size);
};

/** Janelas acesas: 16 cenas (4 × 4) de lâmpada quente, fluorescente, cortina, persiana, TV. */
const litColor: Painter = (ctx, size, random) => {
  const cell = size / 4;
  for (let i = 0; i < 16; i++) {
    const x = (i % 4) * cell;
    const y = Math.floor(i / 4) * cell;
    const kind = i % 5;
    const warm = random();
    // Luz de teto: clara em cima, mais escura embaixo.
    const g = ctx.createLinearGradient(0, y, 0, y + cell);
    const top = kind === 1 ? `hsl(${190 + warm * 30}, 30%, 88%)` : `hsl(${30 + warm * 18}, ${80 + warm * 20}%, ${70 + warm * 15}%)`;
    const bottom = kind === 1 ? `hsl(200, 20%, 55%)` : `hsl(${22 + warm * 14}, 85%, ${32 + warm * 14}%)`;
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, cell, cell);
    if (kind === 2) {
      // Cortina dos lados.
      ctx.fillStyle = `hsla(${random() * 360}, 50%, 45%, 0.75)`;
      ctx.fillRect(x, y, cell * 0.22, cell);
      ctx.fillRect(x + cell * 0.78, y, cell * 0.22, cell);
    } else if (kind === 3) {
      // Persiana.
      ctx.fillStyle = "rgba(60,40,20,0.35)";
      for (let k = 0; k < cell; k += 4) ctx.fillRect(x, y + k, cell, 1.5);
    } else if (kind === 4) {
      // TV ligada no canto (azulada) e um vulto no sofá.
      ctx.fillStyle = "rgba(120,170,255,0.5)";
      ctx.fillRect(x + cell * 0.55, y + cell * 0.45, cell * 0.3, cell * 0.22);
      ctx.fillStyle = "rgba(30,20,15,0.6)";
      ctx.fillRect(x + cell * 0.1, y + cell * 0.7, cell * 0.4, cell * 0.3);
    } else if (kind === 0) {
      // Luminária pendurada.
      ctx.fillStyle = "rgba(255,250,220,0.9)";
      ctx.beginPath();
      ctx.arc(x + cell * (0.3 + warm * 0.4), y + cell * 0.18, cell * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
    // Caixilho.
    ctx.strokeStyle = "rgba(40,30,20,0.8)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
  }
};

/** UV de uma das 16 cenas de janela acesa. */
export function litUv(index: number): [number, number, number, number] {
  const i = ((index % 16) + 16) % 16;
  const u0 = (i % 4) / 4;
  // Canvas de cima para baixo; a textura tem v para cima (flipY).
  const v1 = 1 - Math.floor(i / 4) / 4;
  return [u0 + 0.004, v1 - 0.246, u0 + 0.246, v1 - 0.004];
}

// Letreiros: nomes de lojas (todo mundo é de comida em Porto Gordo).
export const SIGN_NAMES = [
  "LANCHONETE", "PASTELARIA", "PADARIA PÃO GORDO", "AÇOUGUE PICANHA", "BAR DO TORRESMO", "FARMÁCIA",
  "SORVETERIA", "MERCADINHO", "PIZZARIA", "CHURRASCARIA", "BOTECO DO ZÉ", "DOCERIA",
  "SALGADOS 24H", "AÇAÍ", "HAMBURGUERIA", "BORRACHARIA", "AUTOPEÇAS", "LOJA DE 1,99",
  "COXINHA & CIA", "TAPIOCARIA", "RAMEN", "SUSHI BAR", "YAKISOBA", "TEMPURÁ",
  "MERCADO ORIENTAL", "GYOZA", "FRIGORÍFICO TRANS", "ÓLEO PORTO GORDO", "MARGARINA S/A", "BANHA & CIA",
  "ARMAZÉM 7", "BATATA FRITA",
];
const SIGN_COLS = 2;
const SIGN_ROWS = 16;
const signColor: Painter = (ctx, size, random) => {
  const cw = size / SIGN_COLS;
  const ch = size / SIGN_ROWS;
  const backs = ["#c1121f", "#1d3557", "#f4a261", "#2a9d8f", "#ffd23f", "#7b2cbf", "#111111", "#e9f5db", "#ff6b35", "#006d77"];
  SIGN_NAMES.forEach((name, i) => {
    const x = (i % SIGN_COLS) * cw;
    const y = Math.floor(i / SIGN_COLS) * ch;
    const back = backs[Math.floor(random() * backs.length)];
    ctx.fillStyle = back;
    ctx.fillRect(x, y, cw, ch);
    const light = ["#ffd23f", "#e9f5db", "#f4a261"].includes(back);
    ctx.fillStyle = light ? "#1a1a1a" : random() < 0.5 ? "#ffffff" : "#ffd23f";
    ctx.font = `900 ${Math.round(ch * 0.62)}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const text = name;
    const width = ctx.measureText(text).width;
    const scale = Math.min(1, (cw * 0.9) / width);
    ctx.save();
    ctx.translate(x + cw / 2, y + ch / 2 + ch * 0.04);
    ctx.scale(scale, 1);
    ctx.fillText(text, 0, 0);
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 4, y + 4, cw - 8, ch - 8);
  });
};

/** UV do letreiro `index` no atlas (proporção 8 : 1). */
export function signUv(index: number): [number, number, number, number] {
  const i = ((index % SIGN_NAMES.length) + SIGN_NAMES.length) % SIGN_NAMES.length;
  const u0 = (i % SIGN_COLS) / SIGN_COLS;
  const v1 = 1 - Math.floor(i / SIGN_COLS) / SIGN_ROWS;
  return [u0 + 0.002, v1 - 1 / SIGN_ROWS + 0.002, u0 + 1 / SIGN_COLS - 0.002, v1 - 0.002];
}

// --- Materiais ------------------------------------------------------------------

/** Textura que cobre `span` metros (o UV das peças é em metros). */
function spanning<T extends THREE.Texture>(texture: T, [u, v]: [number, number]) {
  texture.repeat.set(1 / u, 1 / v);
  return texture;
}

let cache: THREE.Material[] | null = null;

/** Os materiais da versão detalhada, na ordem de `M` (criados na primeira chamada). */
export function buildingMaterials(): THREE.Material[] {
  if (cache) return cache;
  const plaster = new THREE.MeshLambertMaterial({ vertexColors: true, map: spanning(paintedTexture(256, plasterColor, 11), [2.5, 2.5]) });
  surface(plaster, { roughness: 0.92, normalMap: spanning(normalTexture(256, plasterHeight, 12, 1.2), [2.5, 2.5]), normalScale: 0.5, envMapIntensity: 0.6 });

  const brick = new THREE.MeshLambertMaterial({ vertexColors: true, map: spanning(paintedTexture(256, brickPainter(false), 21), BRICK_SPAN) });
  surface(brick, { roughness: 0.95, normalMap: spanning(normalTexture(256, brickPainter(true), 21, 3), BRICK_SPAN), normalScale: 1, envMapIntensity: 0.5 });

  const tile = new THREE.MeshLambertMaterial({ vertexColors: true, map: spanning(paintedTexture(256, tilePainter(false), 31), TILE_SPAN) });
  surface(tile, { roughness: 0.8, normalMap: spanning(normalTexture(256, tilePainter(true), 31, 4), TILE_SPAN), normalScale: 1.2, envMapIntensity: 0.6 });

  const metal = new THREE.MeshLambertMaterial({ vertexColors: true, map: spanning(paintedTexture(128, metalPainter(false), 42), [1, 1]) });
  // Zinco/galvalume já fosco do tempo (metal demais brilhava pontilhado de longe).
  surface(metal, { roughness: 0.55, metalness: 0.35, normalMap: spanning(normalTexture(128, metalPainter(true), 42, 3), [1, 1]), normalScale: 0.9 });

  const wood = new THREE.MeshLambertMaterial({ vertexColors: true, map: spanning(paintedTexture(256, woodPainter(false), 51), [1.2, 1.2]) });
  surface(wood, { roughness: 0.85, normalMap: spanning(normalTexture(256, woodPainter(true), 51, 2), [1.2, 1.2]), normalScale: 0.8, envMapIntensity: 0.5 });

  const concrete = new THREE.MeshLambertMaterial({ vertexColors: true, map: spanning(paintedTexture(256, concreteColor, 61), [3, 3]) });
  surface(concrete, { roughness: 0.95, normalMap: spanning(normalTexture(128, plasterHeight, 62, 1), [1.5, 1.5]), normalScale: 0.4, envMapIntensity: 0.5 });

  const paint = new THREE.MeshLambertMaterial({ vertexColors: true });
  surface(paint, { roughness: 0.45, metalness: 0.15 });

  const glass = new THREE.MeshLambertMaterial({ vertexColors: true, map: paintedTexture(64, glassColor, 71) });
  // Vidro liso: reflete o céu e a rua, mas a cor (azulada, esverdeada, bronze) ainda aparece.
  surface(glass, { roughness: 0.1, metalness: 0.25, envMapIntensity: 1.6 });

  const litMap = paintedTexture(256, litColor, 81);
  const lit = new THREE.MeshLambertMaterial({ color: "#ffffff", map: litMap, emissive: "#ffffff", emissiveMap: litMap, emissiveIntensity: 1.1 });
  surface(lit, { roughness: 0.2, envMapIntensity: 0.3 });

  const signMap = paintedTexture(1024, signColor, 91);
  const sign = new THREE.MeshLambertMaterial({ color: "#ffffff", map: signMap, emissive: "#ffffff", emissiveMap: signMap, emissiveIntensity: 0.35 });
  surface(sign, { roughness: 0.4 });

  cache = [plaster, brick, tile, metal, wood, concrete, paint, glass, lit, sign];
  cache.forEach((m, i) => (m.name = `predio-${Object.keys(M)[i]}`));
  return cache;
}
