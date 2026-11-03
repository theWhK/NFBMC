// Interior da garagem (esconderijo e oficina no mundo aberto): montado só
// enquanto alguém está lá dentro, no próprio prédio da cidade (as paredes de
// fora são ocas, client/src/landmarks.ts), e descartado ao sair.
//
// Tudo é feito com formas simples do Three.js e texturas pintadas em canvas:
// parede de bloco e de tijolo, piso de concreto com mancha de óleo, elevador
// automotivo, bancada com painel de ferramentas, pneus, tambores, caixas,
// compressor, luminárias fluorescentes, pôsteres de paródia e a bandeira do
// Orgulho Gordo. Os materiais e texturas ficam em cache (uma garagem aberta por
// vez); ao sair, só a geometria é descartada.
import * as THREE from "three";
import { heightAt, type Landmark } from "@nfbmc/shared";

import { flagTexture } from "./flag.ts";
import { GARAGE_DOOR, rollDoor } from "./landmarks.ts";
import { surface, type Surface } from "./look.ts";
import { normalTexture, paintedTexture, type Painter } from "./textures.ts";

/** Altura do forro (m, a partir do chão no meio do prédio). */
export const CEILING = 5.4;

// --- Texturas -----------------------------------------------------------------

const OPS = "'Black Ops One', 'Russo One', sans-serif";
const RUSSO = "'Russo One', sans-serif";

/** Textura avulsa (pôster, painel): redesenha quando as fontes do jogo carregarem. */
function artTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const paint = () => {
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, width, height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    draw(ctx, width, height);
    texture.needsUpdate = true;
  };
  paint();
  document.fonts?.load("64px 'Black Ops One'").then(() => document.fonts.load("64px 'Russo One'")).then(paint).catch(() => {});
  return texture;
}

/** Piso de concreto (4 m por repetição): manchado, com poros e a junta de dilatação. */
const concrete: Painter = (ctx, size, random) => {
  ctx.fillStyle = "#8f8b84";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 70; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = 20 + random() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tone = random() < 0.5 ? "60,56,52" : "180,176,168";
    g.addColorStop(0, `rgba(${tone},${0.05 + random() * 0.08})`);
    g.addColorStop(1, `rgba(${tone},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = random() < 0.5 ? "rgba(40,38,36,0.35)" : "rgba(220,216,208,0.3)";
    ctx.fillRect(random() * size, random() * size, 1 + random() * 1.5, 1 + random() * 1.5);
  }
  // Trincas finas.
  ctx.strokeStyle = "rgba(50,46,42,0.35)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    let x = random() * size;
    let y = random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 9; k++) {
      x += (random() - 0.5) * 40;
      y += (random() - 0.5) * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(45,42,40,0.7)";
  ctx.fillRect(0, 0, size, 3);
  ctx.fillRect(0, 0, 3, size);
};
const concreteHeight: Painter = (ctx, size, random) => {
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = random() < 0.6 ? "#5a5a5a" : "#a0a0a0";
    ctx.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2);
  }
  ctx.fillStyle = "#202020";
  ctx.fillRect(0, 0, size, 4);
  ctx.fillRect(0, 0, 4, size);
};

/** Bloco de concreto pintado (2 m por repetição: 5 blocos × 10 fiadas). */
const blocks: Painter = (ctx, size, random) => {
  ctx.fillStyle = "#a9a397";
  ctx.fillRect(0, 0, size, size);
  const bw = size / 5;
  const bh = size / 10;
  for (let row = 0; row < 10; row++) {
    const shift = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < 6; col++) {
      const shade = 200 + Math.floor(random() * 22);
      ctx.fillStyle = `rgb(${shade + 6},${shade + 2},${shade - 8})`;
      ctx.fillRect(col * bw + shift + 3, row * bh + 3, bw - 6, bh - 6);
    }
  }
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = "rgba(120,112,100,0.25)";
    ctx.fillRect(random() * size, random() * size, 2, 2);
  }
};
const blocksHeight: Painter = (ctx, size) => {
  ctx.fillStyle = "#303030";
  ctx.fillRect(0, 0, size, size);
  const bw = size / 5;
  const bh = size / 10;
  ctx.fillStyle = "#d0d0d0";
  for (let row = 0; row < 10; row++) {
    const shift = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < 6; col++) ctx.fillRect(col * bw + shift + 4, row * bh + 4, bw - 8, bh - 8);
  }
};

/** Tijolo à vista (2 m por repetição: 8 tijolos × 24 fiadas). */
const bricks: Painter = (ctx, size, random) => {
  ctx.fillStyle = "#bdb3a2";
  ctx.fillRect(0, 0, size, size);
  const bw = size / 8;
  const bh = size / 24;
  for (let row = 0; row < 24; row++) {
    const shift = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < 9; col++) {
      const r = 140 + Math.floor(random() * 50);
      const g = 62 + Math.floor(random() * 28);
      const b = 40 + Math.floor(random() * 20);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(col * bw + shift + 2, row * bh + 2, bw - 4, bh - 4);
      if (random() < 0.3) {
        ctx.fillStyle = "rgba(40,20,10,0.25)";
        ctx.fillRect(col * bw + shift + 2, row * bh + 2 + (bh - 4) * 0.6, bw - 4, (bh - 4) * 0.4);
      }
    }
  }
};
const bricksHeight: Painter = (ctx, size) => {
  ctx.fillStyle = "#282828";
  ctx.fillRect(0, 0, size, size);
  const bw = size / 8;
  const bh = size / 24;
  ctx.fillStyle = "#d8d8d8";
  for (let row = 0; row < 24; row++) {
    const shift = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < 9; col++) ctx.fillRect(col * bw + shift + 3, row * bh + 3, bw - 6, bh - 6);
  }
};

/** Telha de chapa ondulada (forro), 2 m por repetição. */
const corrugated: Painter = (ctx, size) => {
  for (let x = 0; x < size; x++) {
    const v = Math.round(128 + Math.sin((x / size) * Math.PI * 2 * 12) * 110);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x, 0, 1, size);
  }
};

/** Mancha de óleo no chão (transparente, borda irregular). */
function stainTexture(seed: number) {
  return artTexture(256, 256, (ctx, w) => {
    let s = seed;
    const random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 14; i++) {
      const x = w / 2 + (random() - 0.5) * w * 0.45;
      const y = w / 2 + (random() - 0.5) * w * 0.45;
      const r = w * (0.12 + random() * 0.22);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(14,12,10,0.55)");
      g.addColorStop(0.6, "rgba(20,17,14,0.3)");
      g.addColorStop(1, "rgba(20,17,14,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Painel de ferramentas (eucatex furado com as silhuetas pintadas). */
function pegboardTexture() {
  return artTexture(1024, 400, (ctx, w, h) => {
    ctx.fillStyle = "#a97c4f";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(60,38,20,0.55)";
    for (let y = 12; y < h; y += 24) for (let x = 12; x < w; x += 24) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "#3b2a1a";
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, w - 10, h - 10);
    const tool = (draw: () => void, color: string) => {
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = 16;
      ctx.lineCap = "round";
      ctx.translate(4, 4);
      draw();
      ctx.restore();
      ctx.save();
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 10;
      ctx.lineCap = "round";
      draw();
      ctx.restore();
    };
    // Chaves de boca, da maior para a menor.
    for (let i = 0; i < 7; i++) {
      const x = 60 + i * 42;
      const len = 210 - i * 18;
      tool(() => {
        ctx.beginPath();
        ctx.moveTo(x, 70);
        ctx.lineTo(x, 70 + len);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, 64, 14 - i, Math.PI * 0.15, Math.PI * 1.85, true);
        ctx.stroke();
      }, "#c9cdd2");
    }
    // Martelo.
    tool(() => {
      ctx.fillRect(400, 70, 70, 26);
      ctx.beginPath();
      ctx.moveTo(435, 96);
      ctx.lineTo(435, 300);
      ctx.stroke();
    }, "#d33a2c");
    // Chaves de fenda de cabo colorido.
    ["#f2c230", "#2f7de0", "#d33a2c", "#36a852"].forEach((color, i) => {
      const x = 520 + i * 40;
      tool(() => {
        ctx.fillRect(x - 9, 70, 18, 70);
        ctx.beginPath();
        ctx.moveTo(x, 140);
        ctx.lineTo(x, 280 - i * 12);
        ctx.stroke();
      }, color);
    });
    // Alicate.
    tool(() => {
      ctx.beginPath();
      ctx.moveTo(700, 80);
      ctx.lineTo(730, 170);
      ctx.lineTo(712, 300);
      ctx.moveTo(760, 80);
      ctx.lineTo(730, 170);
      ctx.lineTo(748, 300);
      ctx.stroke();
    }, "#c9cdd2");
    // Espátula de virar hambúrguer (ferramenta oficial da casa).
    tool(() => {
      ctx.fillRect(810, 70, 90, 70);
      ctx.beginPath();
      ctx.moveTo(855, 140);
      ctx.lineTo(855, 320);
      ctx.stroke();
    }, "#9aa3ad");
    ctx.fillStyle = "#f4ead8";
    ctx.font = `30px ${RUSSO}`;
    ctx.fillText("DEVOLVA A ESPÁTULA", 855, 360);
  });
}

/** Pôster de paródia (anúncio de peça com comida). */
function posterTexture(p: { bg: string; fg: string; accent: string; title: string[]; sub: string; art: (ctx: CanvasRenderingContext2D, w: number, h: number) => void }) {
  return artTexture(512, 720, (ctx, w, h) => {
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, w, h);
    // Raios de fundo, estilo anúncio antigo.
    ctx.save();
    ctx.translate(w / 2, h * 0.52);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    for (let i = 0; i < 16; i++) {
      ctx.rotate(Math.PI / 8);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-40, -600);
      ctx.lineTo(40, -600);
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = p.accent;
    ctx.fillRect(0, 0, w, 16);
    ctx.fillRect(0, h - 16, w, 16);
    ctx.fillStyle = p.fg;
    ctx.font = `64px ${OPS}`;
    p.title.forEach((line, i) => ctx.fillText(line, w / 2, 84 + i * 70, w - 40));
    p.art(ctx, w, h);
    ctx.fillStyle = p.accent;
    ctx.fillRect(30, h - 150, w - 60, 100);
    ctx.fillStyle = p.bg;
    ctx.font = `28px ${RUSSO}`;
    const words = p.sub.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      if (ctx.measureText(`${line} ${word}`).width > w - 90 && line) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
    lines.forEach((l, i) => ctx.fillText(l, w / 2, h - 100 + (i - (lines.length - 1) / 2) * 34, w - 70));
    // Fita crepe nos cantos.
    ctx.fillStyle = "rgba(240,228,190,0.85)";
    for (const [x, y, r] of [[30, 20, -0.5], [w - 30, 20, 0.5]] as const) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(r);
      ctx.fillRect(-36, -12, 72, 24);
      ctx.restore();
    }
  });
}

const POSTERS = [
  posterTexture({
    bg: "#14324f", fg: "#ffd23f", accent: "#ff7a1a", title: ["ÓLEO DE", "FRITURA", "10W-40"],
    sub: "Lubrifica o motor e a batata. Troque a cada 3 porções.",
    art: (ctx, w) => {
      // Galão pingando numa caixinha de batata.
      ctx.fillStyle = "#ffd23f";
      ctx.fillRect(w / 2 - 80, 300, 130, 150);
      ctx.fillRect(w / 2 + 20, 280, 40, 30);
      ctx.fillStyle = "#14324f";
      ctx.font = `34px ${OPS}`;
      ctx.fillText("ÓLEO", w / 2 - 15, 375);
      ctx.fillStyle = "#ffcf5a";
      ctx.beginPath();
      ctx.ellipse(w / 2 + 50, 470, 10, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#d92b2b";
      ctx.beginPath();
      ctx.moveTo(w / 2 - 20, 500);
      ctx.lineTo(w / 2 + 120, 500);
      ctx.lineTo(w / 2 + 100, 560);
      ctx.lineTo(w / 2, 560);
      ctx.fill();
      ctx.fillStyle = "#ffd23f";
      for (let i = 0; i < 6; i++) ctx.fillRect(w / 2 + i * 18 - 6, 470 + (i % 2) * 12, 10, 40);
    },
  }),
  posterTexture({
    bg: "#3a1410", fg: "#f6e7c8", accent: "#e8b923", title: ["PNEUS", "CALABRESA"],
    sub: "Radial, crocante e aro 16 (tamanho família).",
    art: (ctx, w) => {
      const cx = w / 2;
      const cy = 380;
      ctx.fillStyle = "#1a1a1a";
      ctx.beginPath();
      ctx.arc(cx, cy, 150, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e9a23b";
      ctx.beginPath();
      ctx.arc(cx, cy, 104, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f4d27a";
      ctx.beginPath();
      ctx.arc(cx, cy, 90, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#b8321f";
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * 55, cy + Math.sin(a) * 55, 18, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = "#444";
      ctx.lineWidth = 6;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 125, cy + Math.sin(a) * 125);
        ctx.lineTo(cx + Math.cos(a) * 148, cy + Math.sin(a) * 148);
        ctx.stroke();
      }
    },
  }),
  posterTexture({
    bg: "#f2c230", fg: "#1a1d24", accent: "#d92b2b", title: ["TURBO", "COXINHA"],
    sub: "+40 cv de catupiry. Não use no trânsito.",
    art: (ctx, w) => {
      const cx = w / 2;
      ctx.fillStyle = "#c97a2a";
      ctx.beginPath();
      ctx.moveTo(cx, 250);
      ctx.bezierCurveTo(cx + 40, 300, cx + 150, 400, cx + 120, 500);
      ctx.bezierCurveTo(cx + 90, 560, cx - 90, 560, cx - 120, 500);
      ctx.bezierCurveTo(cx - 150, 400, cx - 40, 300, cx, 250);
      ctx.fill();
      ctx.strokeStyle = "#1a1d24";
      ctx.lineWidth = 8;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - 200, 330 + i * 60);
        ctx.lineTo(cx - 140, 330 + i * 60);
        ctx.stroke();
      }
      ctx.fillStyle = "#fff6e0";
      ctx.beginPath();
      ctx.arc(cx, 440, 40, 0, Math.PI * 2);
      ctx.fill();
    },
  }),
  posterTexture({
    bg: "#1f4d2b", fg: "#f6e7c8", accent: "#f2c230", title: ["AUTO PEÇAS", "TORRESMO"],
    sub: "Calendário 2026. Mês de novembro: Picanha.",
    art: (ctx, w) => {
      ctx.fillStyle = "#f6e7c8";
      ctx.fillRect(70, 230, w - 140, 330);
      ctx.fillStyle = "#1f4d2b";
      ctx.font = `30px ${RUSSO}`;
      ctx.fillText("NOVEMBRO", w / 2, 260);
      ctx.fillStyle = "#b5402a";
      ctx.beginPath();
      ctx.ellipse(w / 2, 330, 120, 40, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f3e2b3";
      ctx.fillRect(w / 2 - 120, 300, 240, 16);
      ctx.fillStyle = "#444";
      for (let r = 0; r < 4; r++) for (let c = 0; c < 7; c++) ctx.fillRect(90 + c * 48, 390 + r * 40, 36, 28);
      ctx.fillStyle = "#d92b2b";
      ctx.fillRect(90 + 1 * 48, 390, 36, 28);
    },
  }),
];

/** Quadro do "cardápio" da oficina (giz). */
const menuBoard = () =>
  artTexture(512, 400, (ctx, w, h) => {
    ctx.fillStyle = "#4a3320";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#23292b";
    ctx.fillRect(18, 18, w - 36, h - 36);
    ctx.fillStyle = "#f4f1e8";
    ctx.font = `40px ${OPS}`;
    ctx.fillText("CARDÁPIO", w / 2, 62);
    ctx.font = `24px ${RUSSO}`;
    ctx.textAlign = "left";
    const rows = [["Troca de óleo", "1 fritadeira"], ["Alinhamento", "1 X-Tudo"], ["Balanceamento", "2 pastéis"], ["Turbina", "consulte"], ["Fiado", "só amanhã"]];
    rows.forEach(([a, b], i) => {
      ctx.fillStyle = "#f4f1e8";
      ctx.fillText(a, 42, 120 + i * 52);
      ctx.fillStyle = "#ffd23f";
      ctx.textAlign = "right";
      ctx.fillText(b, w - 42, 120 + i * 52);
      ctx.textAlign = "left";
    });
  });

/** Neon da oficina (só o desenho brilha). */
const neonSign = () =>
  artTexture(1024, 256, (ctx, w, h) => {
    ctx.shadowColor = "#ff4fd8";
    ctx.shadowBlur = 24;
    ctx.strokeStyle = "#ff8be6";
    ctx.lineWidth = 6;
    ctx.strokeRect(20, 20, w - 40, h - 40);
    ctx.font = `92px ${OPS}`;
    ctx.fillStyle = "#ffd6f5";
    ctx.fillText("OFICINA DO GORDO", w / 2, h / 2 + 6, w - 90);
  });

// --- Materiais (um de cada, compartilhados por todas as visitas) -------------

let kit: ReturnType<typeof makeKit> | null = null;

function makeKit() {
  const floorMap = paintedTexture(512, concrete, 31);
  const floor = surface(new THREE.MeshLambertMaterial({ map: floorMap }), {
    roughness: 0.62, normalMap: normalTexture(512, concreteHeight, 31, 3), normalScale: 0.5, envMapIntensity: 0.6,
  });
  const blockWall = surface(new THREE.MeshLambertMaterial({ map: paintedTexture(512, blocks, 32) }), {
    roughness: 0.92, normalMap: normalTexture(512, blocksHeight, 32, 2.5), normalScale: 0.8,
  });
  const brickWall = surface(new THREE.MeshLambertMaterial({ map: paintedTexture(512, bricks, 33) }), {
    roughness: 0.9, normalMap: normalTexture(512, bricksHeight, 33, 3), normalScale: 1,
  });
  const ceiling = surface(new THREE.MeshLambertMaterial({ color: "#5b6068", map: paintedTexture(256, corrugated, 34) }), {
    roughness: 0.55, metalness: 0.5, normalMap: normalTexture(256, corrugated, 34, 4),
  });
  const door = (rollDoor() as THREE.MeshLambertMaterial).clone();
  door.map = door.map!.clone();
  door.emissiveMap = door.map;
  door.emissiveIntensity = 0.35;
  door.side = THREE.DoubleSide;
  surface(door, { roughness: 0.45, metalness: 0.6 });
  const tube = surface(new THREE.MeshBasicMaterial({ color: "#eef6ff" }), { glow: 3 });
  const neon = surface(new THREE.MeshBasicMaterial({ map: neonSign(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), { glow: 2.2 });
  const stains = [11, 23, 37].map((seed) =>
    new THREE.MeshLambertMaterial({ map: stainTexture(seed), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  for (const s of stains) surface(s, { roughness: 0.15 });
  const posters = POSTERS.map((map) => surface(new THREE.MeshLambertMaterial({ map }), { roughness: 0.7 }));
  const flag = surface(new THREE.MeshLambertMaterial({ map: flagTexture(), side: THREE.DoubleSide }), { roughness: 0.95 });
  const pegboard = new THREE.MeshLambertMaterial({ map: pegboardTexture() });
  const board = new THREE.MeshLambertMaterial({ map: menuBoard() });
  return { floor, blockWall, brickWall, ceiling, door, tube, neon, stains, posters, flag, pegboard, board };
}

const colors = new Map<string, THREE.Material>();
/** Material de uma cor só (com aspereza/metal no realista), em cache. */
function tint(color: string, spec: Surface = {}) {
  const key = `${color}|${JSON.stringify(spec)}`;
  let material = colors.get(key);
  if (!material) colors.set(key, (material = surface(new THREE.MeshLambertMaterial({ color }), spec)));
  return material;
}
const STEEL: Surface = { roughness: 0.4, metalness: 0.8 };
const CHROME: Surface = { roughness: 0.15, metalness: 1 };
const PAINTED: Surface = { roughness: 0.5, metalness: 0.3 };

// --- Peças -------------------------------------------------------------------

/** Pneu deitado (perfil girado no torno): raio de fora, de dentro e largura. */
const tireGeometry = (() => {
  const points: THREE.Vector2[] = [];
  const outer = 0.33;
  const inner = 0.21;
  const half = 0.11;
  for (let i = 0; i <= 12; i++) {
    const a = -Math.PI / 2 + (i / 12) * Math.PI;
    points.push(new THREE.Vector2(outer - 0.04 + Math.cos(a) * 0.05, Math.sin(a) * half));
  }
  points.unshift(new THREE.Vector2(inner, -half * 0.8));
  points.push(new THREE.Vector2(inner, half * 0.8));
  const g = new THREE.LatheGeometry(points, 28);
  g.userData.shared = true;
  return g;
})();

/** Tambor de óleo (com os frisos). */
const drumGeometry = (() => {
  const r = 0.29;
  const h = 0.88;
  const points = [new THREE.Vector2(0, 0), new THREE.Vector2(r - 0.01, 0), new THREE.Vector2(r, 0.02)];
  for (const y of [0.29, 0.59]) points.push(new THREE.Vector2(r, y - 0.02), new THREE.Vector2(r + 0.015, y), new THREE.Vector2(r, y + 0.02));
  points.push(new THREE.Vector2(r, h - 0.02), new THREE.Vector2(r - 0.01, h), new THREE.Vector2(0, h));
  const g = new THREE.LatheGeometry(points, 24);
  g.userData.shared = true;
  return g;
})();

export interface GarageInterior {
  /** Raiz, já no lugar e girada como o prédio (o referencial do prédio: fachada em +z). */
  group: THREE.Group;
  /** Porta de enrolar: 0 = fechada, 1 = aberta. */
  setDoor(open: number): void;
  /** Tira da cena (quem chama) e descarta a geometria. */
  dispose(): void;
}

/** Rumo (no mundo) do referencial do prédio: a fachada da garagem fica em +z. */
export const garageRotation = (l: Landmark) => l.angle + (l.front > 0 ? 0 : Math.PI);

/** Monta o interior da garagem `l`, no referencial do prédio. */
export function buildGarageInterior(l: Landmark): GarageInterior {
  kit ??= makeKit();
  const k = kit;
  const rotation = garageRotation(l);
  const ground = heightAt(l.x, l.z);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  /** Altura do chão (relevo) num ponto do referencial, a partir do chão do meio. */
  const fy = (x: number, z: number) => heightAt(l.x + x * cos + z * sin, l.z - x * sin + z * cos) - ground;

  const root = new THREE.Group();
  root.position.set(l.x, ground, l.z);
  root.rotation.y = rotation;

  const { wall: T, width: DW, height: DH } = GARAGE_DOOR;
  const IX = l.w / 2 - T - 0.01;
  const IZ = l.d / 2 - T - 0.01;
  const C = CEILING;

  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, ry = 0, parent: THREE.Object3D = root) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    parent.add(m);
    return m;
  };
  /** Caixa com a base em `y`. */
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material, ry = 0, parent: THREE.Object3D = root) =>
    mesh(new THREE.BoxGeometry(w, h, d), material, x, y + h / 2, z, ry, parent);
  const cylinder = (r: number, h: number, x: number, y: number, z: number, material: THREE.Material, segments = 16, parent: THREE.Object3D = root) =>
    mesh(new THREE.CylinderGeometry(r, r, h, segments), material, x, y + h / 2, z, 0, parent);
  /** Grupo apoiado no chão (na altura do relevo naquele ponto). */
  const onFloor = (x: number, z: number, ry = 0) => {
    const g = new THREE.Group();
    g.position.set(x, fy(x, z), z);
    g.rotation.y = ry;
    root.add(g);
    return g;
  };
  /** Plano com a textura repetindo a cada `tile` metros. */
  const tiled = (w: number, h: number, tile: number, segX = 1, segY = 1) => {
    const g = new THREE.PlaneGeometry(w, h, segX, segY);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
    return g;
  };

  // Piso: segue o relevo embaixo do prédio (o carro anda pela mesma altura).
  {
    const g = tiled(IX * 2, IZ * 2 + T + 0.3, 4, 24, 22).rotateX(-Math.PI / 2);
    g.translate(0, 0, (T + 0.3) / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, fy(p.getX(i), p.getZ(i)) + 0.02);
    g.computeVertexNormals();
    mesh(g, k.floor, 0, 0, 0);
  }
  /** Decalque deitado no chão, acompanhando o relevo. */
  const decal = (w: number, d: number, x: number, z: number, material: THREE.Material, ry = 0, lift = 0.03) => {
    const g = new THREE.PlaneGeometry(w, d, 4, 4).rotateX(-Math.PI / 2).rotateY(ry);
    g.translate(x, 0, z);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, fy(p.getX(i), p.getZ(i)) + lift);
    return mesh(g, material, 0, 0, 0);
  };
  const yellow = surface(new THREE.MeshLambertMaterial({ color: "#e8b923", polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), { roughness: 0.5 });
  // Faixas amarelas: a vaga do elevador e a do carro.
  const line = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    decal(len, 0.1, (x0 + x1) / 2, (z0 + z1) / 2, yellow, Math.atan2(-(z1 - z0), x1 - x0), 0.025);
  };
  line(3.0, -IZ + 0.2, 3.0, -0.6);
  line(7.5, -0.6, 3.0, -0.6);
  for (const x of [-2.2, 2.2]) line(x, -4.4, x, 2.6);
  line(-2.2, 2.6, -1.4, 2.6);
  line(2.2, 2.6, 1.4, 2.6);
  // Manchas de óleo: embaixo do carro, do elevador e perto da bancada.
  decal(2.4, 2.4, 0.3, -1.2, k.stains[0], 0.4);
  decal(1.8, 1.8, 5.1, -3.4, k.stains[1], 1.2);
  decal(1.4, 1.4, -3.9, -4.9, k.stains[2], 2.1);
  decal(1.0, 1.0, -3.2, 2.9, k.stains[1], 0.3);

  // Paredes: tijolo à vista no fundo, bloco pintado dos lados e na frente.
  const low = -1.5;
  const wallH = C - low;
  mesh(tiled(IX * 2, wallH, 2), k.brickWall, 0, low + wallH / 2, -IZ);
  for (const s of [-1, 1]) mesh(tiled(IZ * 2, wallH, 2), k.blockWall, s * IX, low + wallH / 2, 0, -s * Math.PI / 2);
  const jamb = IX - DW / 2;
  for (const s of [-1, 1]) mesh(tiled(jamb, wallH, 2), k.blockWall, s * (DW / 2 + jamb / 2), low + wallH / 2, IZ, Math.PI);
  mesh(tiled(DW, C - DH, 2), k.blockWall, 0, DH + (C - DH) / 2, IZ, Math.PI);
  // Barra pintada embaixo (cinza-escuro com o friso amarelo) nas laterais.
  const band = tint("#3c4147", { roughness: 0.6 });
  for (const s of [-1, 1]) {
    box(0.02, 1.1 - low, IZ * 2, s * (IX - 0.01), low, 0, band);
    box(0.02, 0.06, IZ * 2, s * (IX - 0.02), 1.1, 0, tint("#e8b923"));
  }
  // Forro de chapa ondulada e as vigas.
  mesh(tiled(IX * 2, IZ * 2, 2).rotateX(Math.PI / 2), k.ceiling, 0, C, 0);
  const beam = tint("#2e3238", STEEL);
  for (const z of [-4.2, -0.8, 2.8]) {
    box(IX * 2, 0.32, 0.12, 0, C - 0.32, z, beam);
    box(IX * 2, 0.03, 0.3, 0, C - 0.32, z, beam);
  }

  // Porta de enrolar: por fora (no lugar da porta da cidade, que fica escondida) e por dentro.
  const doorGeometry = new THREE.PlaneGeometry(DW, DH);
  const outer = mesh(doorGeometry, k.door, 0, DH / 2, l.d / 2 + 0.24);
  const inner = mesh(doorGeometry, k.door, 0, DH / 2, IZ - 0.06, Math.PI);
  // Trilhos e o rolo em cima, do lado de dentro.
  for (const s of [-1, 1]) box(0.12, DH, 0.16, s * (DW / 2 + 0.06), 0, IZ - 0.1, beam);
  mesh(new THREE.CylinderGeometry(0.32, 0.32, DW + 0.4, 18).rotateZ(Math.PI / 2), tint("#7b848d", STEEL), 0, DH + 0.3, IZ - 0.45);
  box(0.4, 0.4, 0.3, DW / 2 + 0.5, DH + 0.1, IZ - 0.25, tint("#3f6fb0", PAINTED));

  // Luminárias fluorescentes (duas lâmpadas cada) e as luzes de verdade.
  const housing = tint("#d9dde2", { roughness: 0.5, metalness: 0.2 });
  const chain = tint("#8a9097", STEEL);
  const tubeGeometry = new THREE.CylinderGeometry(0.028, 0.028, 1.45, 8).rotateZ(Math.PI / 2);
  const fixtures: [number, number][] = [[-3.4, -3.6], [3.4, -3.6], [-3.4, 1.6], [3.4, 1.6]];
  for (const [x, z] of fixtures) {
    box(1.6, 0.07, 0.32, x, C - 0.75, z, housing);
    for (const dz of [-0.07, 0.07]) mesh(tubeGeometry, k.tube, x, C - 0.79, z + dz);
    for (const dx of [-0.65, 0.65]) cylinder(0.008, 0.68, x + dx, C - 0.68, z, chain, 4);
  }
  const lights: THREE.PointLight[] = [];
  for (const [x, z, color, power] of [[-3.4, -3.6, "#fff2df", 26], [3.4, -3.6, "#f2f6ff", 26], [-3.4, 1.6, "#fff2df", 22], [3.4, 1.6, "#f2f6ff", 22]] as const) {
    const light = new THREE.PointLight(color, power, 0, 1.6);
    light.position.set(x, C - 1.0, z);
    root.add(light);
    lights.push(light);
  }

  // --- Fundo: bancada, painel de ferramentas, armário, quadro e bandeira ---
  const wood = tint("#8a5a32", { roughness: 0.75 });
  const steelDark = tint("#2b2f36", STEEL);
  const red = tint("#c2262e", { roughness: 0.35, metalness: 0.4, clearcoat: 0.6 });
  const chrome = tint("#d8dde3", CHROME);
  {
    const z = -IZ + 0.42;
    const g = onFloor(-4.4, z);
    box(4.2, 0.07, 0.8, 0, 0.88, 0, wood, 0, g);
    for (const x of [-2.0, 2.0]) for (const dz of [-0.33, 0.33]) box(0.06, 0.88, 0.06, x, 0, dz, steelDark, 0, g);
    box(4.1, 0.04, 0.7, 0, 0.18, 0, steelDark, 0, g);
    // Gaveteiro embaixo, com puxadores.
    box(1.0, 0.7, 0.7, 1.4, 0.18, 0, red, 0, g);
    for (let i = 0; i < 3; i++) {
      box(0.96, 0.01, 0.02, 1.4, 0.4 + i * 0.22, 0.36, steelDark, 0, g);
      box(0.3, 0.025, 0.03, 1.4, 0.32 + i * 0.22, 0.37, chrome, 0, g);
    }
    // Morsa, caixa de ferramentas e o lanche esquecido.
    box(0.2, 0.16, 0.26, -1.6, 0.95, 0.1, tint("#3d5b7a", PAINTED), 0, g);
    box(0.08, 0.1, 0.3, -1.6, 1.11, 0.1, tint("#3d5b7a", PAINTED), 0, g);
    box(0.62, 0.24, 0.28, -0.6, 0.95, 0.05, red, 0.15, g);
    box(0.64, 0.03, 0.06, -0.6, 1.22, 0.05, steelDark, 0.15, g);
    const burger = new THREE.Group();
    burger.position.set(0.6, 0.95, 0.1);
    g.add(burger);
    cylinder(0.12, 0.05, 0, 0, 0, tint("#d99a4e"), 16, burger);
    cylinder(0.125, 0.035, 0, 0.05, 0, tint("#5a2e14"), 16, burger);
    cylinder(0.13, 0.012, 0, 0.085, 0, tint("#f2c230"), 16, burger);
    cylinder(0.13, 0.01, 0, 0.097, 0, tint("#6ab02e"), 16, burger);
    const top = mesh(new THREE.SphereGeometry(0.12, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), tint("#d99a4e"), 0, 0.105, 0, 0, burger);
    top.scale.y = 0.6;
    for (const [x, c] of [[0.95, "#d92b2b"], [1.05, "#2f7de0"], [-1.1, "#36a852"]] as const) cylinder(0.05, 0.16, x, 0.95, -0.15, tint(c, PAINTED), 12, g);
    // Painel de ferramentas na parede.
    mesh(new THREE.PlaneGeometry(4.2, 1.64), k.pegboard, -4.4, 2.1, -IZ + 0.03);
    // Luminária de bancada.
    box(4.0, 0.05, 0.12, -4.4, 3.05, -IZ + 0.12, housing);
    mesh(new THREE.CylinderGeometry(0.02, 0.02, 3.6, 6).rotateZ(Math.PI / 2), k.tube, -4.4, 3.03, -IZ + 0.15);
  }
  {
    // Armário de ferramentas de rodinha (vermelho, gavetas cromadas).
    const g = onFloor(-1.35, -IZ + 0.36);
    box(1.1, 1.0, 0.62, 0, 0.1, 0, red, 0, g);
    box(1.06, 0.48, 0.5, 0, 1.12, -0.05, red, 0, g);
    for (let i = 0; i < 6; i++) {
      box(1.04, 0.01, 0.02, 0, 0.22 + i * 0.15, 0.32, steelDark, 0, g);
      box(0.5, 0.02, 0.03, 0, 0.3 + i * 0.15, 0.33, chrome, 0, g);
    }
    box(1.12, 0.03, 0.64, 0, 1.1, 0, steelDark, 0, g);
    for (const x of [-0.45, 0.45]) for (const z of [-0.24, 0.24]) cylinder(0.05, 0.08, x, 0, z, steelDark, 10, g);
  }
  // Quadro de giz com o "cardápio" da oficina.
  mesh(new THREE.PlaneGeometry(1.3, 1.02), k.board, -1.2, 2.55, -IZ + 0.03);
  // Bandeira do Orgulho Gordo pendurada num cano, com as dobras do pano.
  {
    const w = 2.8;
    const h = w / 1.5;
    const g = new THREE.PlaneGeometry(w, h, 16, 6);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      p.setZ(i, Math.sin(x * 3.1) * 0.05 * (1 - (y + h / 2) / h * 0.6));
    }
    g.computeVertexNormals();
    mesh(g, k.flag, 1.25, 4.75 - h / 2, -IZ + 0.12);
    box(w + 0.3, 0.05, 0.05, 1.25, 4.76, -IZ + 0.12, chrome);
    for (const x of [1.25 - w / 2, 1.25 + w / 2]) cylinder(0.01, C - 4.8, x, 4.8, -IZ + 0.12, chain, 4);
  }

  // --- Elevador automotivo (dois postes), na vaga do fundo à direita ---
  {
    const blue = tint("#1f5fa8", { roughness: 0.4, metalness: 0.3, clearcoat: 0.4 });
    const g = onFloor(5.25, -3.3);
    for (const s of [-1, 1]) {
      const x = s * 1.85;
      box(0.75, 0.03, 0.75, x, 0, 0, steelDark, 0, g);
      box(0.4, 3.9, 0.4, x, 0, 0, blue, 0, g);
      // Faixa zebrada no pé do poste.
      for (let i = 0; i < 4; i++) box(0.41, 0.09, 0.41, x, 0.12 + i * 0.18, 0, tint(i % 2 ? "#1a1a1a" : "#f2c230"), 0, g);
      // Carro do elevador (embaixo, sem carro em cima) e os braços dobrados.
      box(0.32, 0.55, 0.32, x - s * 0.33, 0.12, 0, steelDark, 0, g);
      for (const a of [-0.55, 0.55]) {
        const arm = new THREE.Group();
        arm.position.set(x - s * 0.33, 0.2, 0);
        arm.rotation.y = s > 0 ? Math.PI + a : a;
        g.add(arm);
        box(1.15, 0.08, 0.13, 0.6, 0, 0, tint("#b8bec6", STEEL), 0, arm);
        cylinder(0.1, 0.06, 1.12, 0.08, 0, tint("#1d1d1f", { roughness: 0.9 }), 12, arm);
      }
    }
    box(4.1, 0.28, 0.32, 0, 3.9, 0, blue, 0, g);
    // Central hidráulica e a mangueira.
    box(0.36, 0.5, 0.3, 2.2, 1.0, 0.3, tint("#d33a2c", PAINTED), 0, g);
    cylinder(0.11, 0.3, 2.2, 1.5, 0.3, tint("#2b2f36", STEEL), 12, g);
    box(3.7, 0.04, 0.04, 0, 3.75, 0.2, tint("#111111"), 0, g);
    // Bandeja de óleo no chão.
    cylinder(0.38, 0.06, 0.3, 0, 0.6, tint("#3a3f46", STEEL), 20, g);
  }
  // Neon da oficina na parede do fundo, em cima do elevador.
  mesh(new THREE.PlaneGeometry(3.6, 0.9), k.neon, 5.25, 4.62, -IZ + 0.05);
  box(3.7, 0.95, 0.04, 5.25, 4.15, -IZ + 0.02, tint("#15161a"));

  // --- Lateral esquerda: compressor, prateleira, caixas, tambores, geladeira e pneus ---
  {
    const g = onFloor(-IX + 0.55, -4.5, Math.PI / 2);
    mesh(new THREE.CapsuleGeometry(0.3, 0.8, 6, 16).rotateZ(Math.PI / 2), tint("#c8302a", { roughness: 0.35, metalness: 0.3, clearcoat: 0.5 }), 0, 0.42, 0, 0, g);
    for (const x of [-0.45, 0.45]) cylinder(0.08, 0.04, x, 0.04, 0.22, steelDark, 12, g).geometry.rotateX(Math.PI / 2);
    box(0.5, 0.32, 0.36, -0.15, 0.72, 0, tint("#2b2f36", STEEL), 0, g);
    box(0.08, 0.36, 0.42, 0.25, 0.72, 0, tint("#e8b923"), 0, g);
    const gauge = cylinder(0.07, 0.03, 0.55, 0.7, 0, tint("#f4f1e8"), 16, g);
    gauge.geometry.rotateZ(Math.PI / 2);
    // Mangueira de ar enrolada na parede.
    mesh(new THREE.TorusGeometry(0.3, 0.025, 8, 28), tint("#e8b923", { roughness: 0.6 }), 0, 1.7, -0.5, 0, g);
  }
  {
    // Prateleira de aço com caixas e latas.
    const g = onFloor(-IX + 0.34, -1.7, Math.PI / 2);
    const rack = tint("#5f7d8f", PAINTED);
    for (const x of [-1.4, 1.4]) for (const z of [-0.27, 0.27]) box(0.05, 2.3, 0.05, x, 0, z, rack, 0, g);
    const boxes = ["#b98a55", "#a77b48", "#c89a62", "#8f6a3e"];
    const cans = ["#d92b2b", "#2f7de0", "#f2c230", "#36a852", "#1a1a1a"];
    let n = 0;
    for (const y of [0.12, 0.8, 1.45, 2.1]) {
      box(2.85, 0.03, 0.58, 0, y, 0, rack, 0, g);
      if (y > 2) continue;
      let x = -1.25;
      while (x < 1.2) {
        n++;
        if (n % 3 === 0) {
          for (let c = 0; c < 3 && x < 1.25; c++, x += 0.2) cylinder(0.08, 0.22, x + 0.08, y + 0.03, 0.05, tint(cans[(n + c) % cans.length], PAINTED), 12, g);
        } else {
          const w = 0.35 + ((n * 37) % 20) / 100;
          const h = 0.25 + ((n * 53) % 30) / 100;
          box(w, Math.min(h, 0.58), 0.45, x + w / 2, y + 0.03, 0, tint(boxes[n % boxes.length]), ((n * 13) % 10 - 5) / 60, g);
          x += w + 0.06;
        }
      }
    }
  }
  {
    // Caixotes de madeira e caixas de papelão empilhadas.
    const g = onFloor(-IX + 0.7, 1.05, 0.08);
    const crate = tint("#9b7243", { roughness: 0.85 });
    box(1.0, 0.7, 0.9, 0, 0, 0, crate, 0, g);
    box(0.9, 0.62, 0.8, 0.05, 0.7, 0.02, crate, 0.2, g);
    box(0.6, 0.45, 0.5, 0.0, 1.32, 0.05, tint("#c89a62"), -0.25, g);
    for (const y of [0.15, 0.5]) box(1.02, 0.06, 0.92, 0, y, 0, tint("#7e5a32"), 0, g);
    box(0.7, 0.5, 0.55, 0.2, 0, 0.85, tint("#b98a55"), 0.4, g);
  }
  {
    // Tambores de óleo (um caído de lado).
    const g = onFloor(-IX + 0.5, 2.7);
    mesh(drumGeometry, tint("#2453a0", PAINTED), 0, 0, -0.32, 0, g);
    mesh(drumGeometry, tint("#c8302a", PAINTED), 0.05, 0, 0.32, 0, g);
    const lying = mesh(drumGeometry, tint("#2c7a3d", PAINTED), 1.0, 0.29, 0.0, 0, g);
    lying.rotation.set(0, 0.3, Math.PI / 2);
    lying.position.x = 1.45;
  }
  {
    // Geladeira de refrigerante, com a porta de vidro acesa.
    const g = onFloor(-IX + 0.42, 4.1, Math.PI / 2);
    box(0.8, 1.9, 0.7, 0, 0, 0, tint("#c8302a", { roughness: 0.4, metalness: 0.2, clearcoat: 0.5 }), 0, g);
    box(0.66, 1.4, 0.02, 0, 0.32, 0.355, surface(new THREE.MeshBasicMaterial({ color: "#cfe9ff" }), { glow: 1.4 }), 0, g);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      cylinder(0.035, 0.14, -0.22 + c * 0.15, 0.4 + r * 0.33, 0.33, tint(["#d92b2b", "#f2c230", "#36a852", "#5a2e14"][(r + c) % 4]), 8, g);
    }
    box(0.8, 0.3, 0.02, 0, 1.6, 0.356, tint("#f4f1e8"), 0, g);
  }

  // Pilhas de pneus (cantos da frente e a parede da direita).
  const rubber = tint("#1c1c1e", { roughness: 0.92 });
  const rim = tint("#9aa3ad", STEEL);
  const stack = (x: number, z: number, count: number, rims = false) => {
    const g = onFloor(x, z, (x * 7 + z) % 1);
    for (let i = 0; i < count; i++) {
      const t = mesh(tireGeometry, rubber, ((i * 37) % 5 - 2) * 0.012, 0.11 + i * 0.22, ((i * 53) % 5 - 2) * 0.012, i * 0.7, g);
      if (rims) cylinder(0.2, 0.18, 0, -0.09, 0, rim, 18, t);
    }
  };
  stack(-IX + 0.42, IZ - 0.55, 5);
  stack(-IX + 1.15, IZ - 0.45, 3, true);
  stack(IX - 0.42, 3.2, 6);
  stack(IX - 0.42, 4.0, 4, true);
  stack(IX - 1.2, 4.9, 3);
  {
    // Pneus em pé, encostados na parede.
    for (const [z, a] of [[1.8, 0.12], [2.35, -0.1]] as const) {
      const g = onFloor(IX - 0.2, z, Math.PI / 2);
      const t = mesh(tireGeometry, rubber, 0, 0.33, 0, 0, g);
      t.rotation.set(Math.PI / 2 + a, 0, 0);
    }
  }
  {
    // Macaco jacaré e um carrinho de ferramentas.
    const g = onFloor(4.9, 0.9, -0.5);
    box(0.36, 0.14, 0.9, 0, 0.06, 0, red, 0, g);
    box(0.06, 0.06, 1.1, 0, 0.18, 0.9, steelDark, -0.0, g);
    for (const [x, z] of [[-0.15, -0.4], [0.15, -0.4], [-0.15, 0.4], [0.15, 0.4]]) cylinder(0.05, 0.05, x, 0, z, steelDark, 10, g);
    const cart = onFloor(6.4, 0.4, 0.3);
    for (const y of [0.25, 0.6, 0.9]) box(0.8, 0.03, 0.5, 0, y, 0, tint("#2f7de0", PAINTED), 0, cart);
    for (const x of [-0.38, 0.38]) for (const z of [-0.23, 0.23]) box(0.03, 0.9, 0.03, x, 0.05, z, steelDark, 0, cart);
    for (let i = 0; i < 4; i++) cylinder(0.04, 0.12, -0.25 + i * 0.16, 0.93, 0, tint(["#d92b2b", "#f2c230", "#c9cdd2", "#36a852"][i], PAINTED), 10, cart);
  }

  // Pôsteres: dois na parede da esquerda, dois na da direita.
  const poster = (i: number, x: number, z: number, ry: number, tilt = 0) => {
    const m = mesh(new THREE.PlaneGeometry(0.9, 1.27), k.posters[i], x, 3.25, z, ry);
    m.rotation.z = tilt;
  };
  poster(0, -IX + 0.02, -1.6, Math.PI / 2, 0.02);
  poster(3, -IX + 0.02, 0.6, Math.PI / 2, -0.03);
  poster(1, IX - 0.02, 2.4, -Math.PI / 2, 0.025);
  poster(2, IX - 0.02, 4.4, -Math.PI / 2, -0.02);
  // Extintor ao lado da porta e o relógio em cima dela.
  {
    const g = onFloor(DW / 2 + 0.9, IZ - 0.18);
    cylinder(0.09, 0.5, 0, 0.9, 0, tint("#d92b2b", { roughness: 0.3, clearcoat: 0.6 }), 14, g);
    box(0.4, 0.4, 0.02, 0, 1.55, 0.15, tint("#d92b2b"), 0, g);
    const clock = cylinder(0.24, 0.04, -DW / 2 - 1.6, 3.6, IZ - 0.03, tint("#f4f1e8"), 24);
    clock.geometry.rotateX(Math.PI / 2);
    box(0.02, 0.17, 0.01, -DW / 2 - 1.6, 3.6, IZ - 0.06, tint("#111111"));
    box(0.13, 0.02, 0.01, -DW / 2 - 1.55, 3.6, IZ - 0.06, tint("#111111"));
  }

  const setDoor = (open: number) => {
    const shut = Math.min(1, Math.max(0, 1 - open));
    for (const door of [outer, inner]) {
      door.visible = shut > 0.01;
      door.scale.y = Math.max(0.01, shut);
      door.position.y = DH - (DH * shut) / 2;
    }
    // As lâminas não esticam: a textura mostra só o pedaço de baixo da porta (o resto enrolou).
    const map = k.door.map!;
    map.repeat.set(1, Math.max(0.01, shut));
    map.offset.set(0, 0);
  };
  setDoor(0);

  return {
    group: root,
    setDoor,
    dispose() {
      root.traverse((o) => {
        const geometry = (o as THREE.Mesh).geometry;
        if (geometry && !geometry.userData.shared) geometry.dispose();
        if ((o as THREE.PointLight).isPointLight) (o as THREE.PointLight).dispose();
      });
    },
  };
}
