// Equipes de corrida de Porto Gordo: paródias com comida das equipes de
// Fórmula 1 e de rali (e dos patrocinadores de sempre). Nomes e logos são
// inventados e desenhados aqui em canvas: lembram, de longe e com carinho,
// sem copiar logo, fonte nem marca de ninguém.
//
// O catálogo é reaproveitado em tudo: outdoors, faixas do autódromo, boxes,
// caminhões das equipes, garagens, pórtico de largada e bandeiras.
import * as THREE from "three";

export type Series = "f1" | "rali" | "patrocinio";

export interface Team {
  id: string;
  name: string;
  /** Segunda linha (o slogan, ou o que a sigla quer dizer). */
  slogan: string;
  series: Series;
  /** Fundo, letra e destaque. */
  bg: string;
  fg: string;
  accent: string;
  /** Listras da pintura (de cima para baixo), usadas nas faixas e nos caminhões. */
  stripes: string[];
  /** Desenha o emblema centrado em (0, 0), cabendo num quadrado de lado `s`. */
  logo: (ctx: CanvasRenderingContext2D, s: number) => void;
}

const OPS = "'Black Ops One', 'Russo One', sans-serif";
const RUSSO = "'Russo One', sans-serif";

// --- Formas para os emblemas ------------------------------------------------

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Escudo (topo reto, ponta embaixo). */
function shield(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, -h / 2);
  ctx.lineTo(w / 2, h * 0.1);
  ctx.quadraticCurveTo(w / 2, h * 0.38, 0, h / 2);
  ctx.quadraticCurveTo(-w / 2, h * 0.38, -w / 2, h * 0.1);
  ctx.closePath();
}

/** Coxa de frango em pé (osso para cima). */
function drumstick(ctx: CanvasRenderingContext2D, s: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, s * 0.12, s * 0.2, s * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-s * 0.05, -s * 0.3, s * 0.1, s * 0.25);
  for (const x of [-0.07, 0.07]) {
    ctx.beginPath();
    ctx.arc(x * s, -s * 0.32, s * 0.065, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Pão francês (oval com os cortes), virado para `dir`. */
function bread(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, dir: number, color: string, cut: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(dir * -0.25);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.24, s * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  // "Chifres": as pontas do pão empinadas.
  ctx.beginPath();
  ctx.moveTo(dir * s * 0.16, -s * 0.06);
  ctx.quadraticCurveTo(dir * s * 0.3, -s * 0.2, dir * s * 0.24, -s * 0.28);
  ctx.quadraticCurveTo(dir * s * 0.2, -s * 0.12, dir * s * 0.08, -s * 0.08);
  ctx.fill();
  ctx.strokeStyle = cut;
  ctx.lineWidth = s * 0.025;
  for (const k of [-1, 0, 1]) {
    ctx.beginPath();
    ctx.moveTo(k * s * 0.08 - s * 0.03, s * 0.05);
    ctx.lineTo(k * s * 0.08 + s * 0.03, -s * 0.05);
    ctx.stroke();
  }
  // Pernas (o pão vem correndo).
  ctx.fillStyle = color;
  for (const k of [-0.12, 0.1]) ctx.fillRect(k * s, s * 0.08, s * 0.04, s * 0.14);
  ctx.restore();
}

function fork(ctx: CanvasRenderingContext2D, s: number) {
  ctx.fillRect(-s * 0.025, -s * 0.05, s * 0.05, s * 0.42);
  for (const x of [-0.07, -0.023, 0.023, 0.07]) ctx.fillRect(x * s - s * 0.012, -s * 0.36, s * 0.024, s * 0.22);
  ctx.fillRect(-s * 0.08, -s * 0.15, s * 0.16, s * 0.06);
}

function knife(ctx: CanvasRenderingContext2D, s: number) {
  ctx.fillRect(-s * 0.025, 0, s * 0.05, s * 0.37);
  ctx.beginPath();
  ctx.moveTo(-s * 0.03, 0);
  ctx.lineTo(-s * 0.03, -s * 0.36);
  ctx.quadraticCurveTo(s * 0.07, -s * 0.25, s * 0.03, 0);
  ctx.closePath();
  ctx.fill();
}

/** Batata frita (palito). */
function fry(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number) {
  ctx.lineCap = "square";
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function wordmark(ctx: CanvasRenderingContext2D, text: string, y: number, size: number, color: string, maxWidth: number, font = OPS) {
  ctx.fillStyle = color;
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, y, maxWidth);
}

// --- O catálogo ---------------------------------------------------------------

export const TEAMS: Team[] = [
  {
    id: "farofa", name: "SCUDERIA FAROFA", slogan: "tradição, paixão e farinha de mandioca", series: "f1",
    bg: "#c8102e", fg: "#ffe14d", accent: "#141414", stripes: ["#c8102e", "#ffe14d", "#c8102e"],
    logo(ctx, s) {
      shield(ctx, s * 0.62, s * 0.86);
      ctx.fillStyle = "#ffd21f";
      ctx.fill();
      ctx.lineWidth = s * 0.03;
      ctx.strokeStyle = "#141414";
      ctx.stroke();
      // Faixa de cima com as cores da farofa (mandioca, bacon e cebolinha).
      ["#e9c98b", "#b5562c", "#3f8f3a"].forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect(-s * 0.29 + (i * s * 0.58) / 3, -s * 0.41, (s * 0.58) / 3 + 0.5, s * 0.08);
      });
      ctx.save();
      ctx.translate(0, s * 0.06);
      ctx.rotate(-0.25);
      drumstick(ctx, s * 0.8, "#141414");
      ctx.restore();
      wordmark(ctx, "SF", s * 0.3, s * 0.13, "#141414", s * 0.4);
    },
  },
  {
    id: "merendes", name: "MERENDES-AMG", slogan: "Almoço Muito Gorduroso", series: "f1",
    bg: "#16181b", fg: "#d6dadf", accent: "#14c7b4", stripes: ["#16181b", "#14c7b4", "#c3c8ce"],
    logo(ctx, s) {
      // Prato (dois aros) com garfo e faca cruzados.
      ctx.strokeStyle = "#d6dadf";
      ctx.lineWidth = s * 0.05;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = s * 0.02;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#d6dadf";
      ctx.save();
      ctx.rotate(-0.6);
      fork(ctx, s * 0.95);
      ctx.restore();
      ctx.save();
      ctx.rotate(0.6);
      knife(ctx, s * 0.95);
      ctx.restore();
      ctx.fillStyle = "#14c7b4";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.05, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  {
    id: "redpao", name: "RED PÃO RACING", slogan: "Red Pão te dá fome", series: "f1",
    bg: "#1b2559", fg: "#ffffff", accent: "#e1251b", stripes: ["#1b2559", "#e1251b", "#ffc72c"],
    logo(ctx, s) {
      // Sol amarelo e dois pães franceses vindo um contra o outro.
      ctx.fillStyle = "#ffc72c";
      ctx.beginPath();
      ctx.arc(0, -s * 0.06, s * 0.2, 0, Math.PI * 2);
      ctx.fill();
      bread(ctx, -s * 0.2, s * 0.06, s, 1, "#e1251b", "#ffd9a0");
      bread(ctx, s * 0.2, s * 0.06, s, -1, "#e1251b", "#ffd9a0");
    },
  },
  {
    id: "mclasanha", name: "McLASANHA", slogan: "camada por camada, volta por volta", series: "f1",
    bg: "#ff8000", fg: "#101010", accent: "#3fb8f0", stripes: ["#ff8000", "#101010", "#3fb8f0"],
    logo(ctx, s) {
      // Folha de lasanha ondulada (a "vírgula"), com as camadas de molho e queijo.
      const layers = ["#f6d36a", "#c1311f", "#fff2c4", "#c1311f", "#f6d36a"];
      layers.forEach((c, i) => {
        ctx.strokeStyle = c;
        ctx.lineWidth = s * 0.05;
        ctx.beginPath();
        const y = -s * 0.14 + i * s * 0.05;
        ctx.moveTo(-s * 0.42, y + s * 0.08);
        ctx.bezierCurveTo(-s * 0.15, y - s * 0.22, s * 0.1, y + s * 0.2, s * 0.42, y - s * 0.12);
        ctx.stroke();
      });
      wordmark(ctx, "McL", s * 0.3, s * 0.2, "#101010", s * 0.8);
    },
  },
  {
    id: "williames", name: "WILLIAMES", slogan: "batata frita de fábrica desde 1977", series: "f1",
    bg: "#0b2263", fg: "#ffffff", accent: "#00a3e0", stripes: ["#0b2263", "#ffffff", "#00a3e0"],
    logo(ctx, s) {
      roundRect(ctx, -s * 0.42, -s * 0.36, s * 0.84, s * 0.72, s * 0.08);
      ctx.fillStyle = "#00a3e0";
      ctx.fill();
      // Um "W" de batatas fritas.
      ctx.strokeStyle = "#ffd23f";
      const w = s * 0.08;
      fry(ctx, -s * 0.3, -s * 0.22, -s * 0.15, s * 0.22, w);
      fry(ctx, -s * 0.15, s * 0.22, 0, -s * 0.1, w);
      fry(ctx, 0, -s * 0.1, s * 0.15, s * 0.22, w);
      fry(ctx, s * 0.15, s * 0.22, s * 0.3, -s * 0.22, w);
    },
  },
  {
    id: "lotus", name: "LÓTUS LANCHE", slogan: "leve como uma folha (de alface)", series: "f1",
    bg: "#0d5a2c", fg: "#ffd400", accent: "#ffffff", stripes: ["#0d5a2c", "#ffd400", "#0d5a2c"],
    logo(ctx, s) {
      ctx.fillStyle = "#ffd400";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2);
      ctx.fill();
      // Flor de lótus feita de pétalas de cebola.
      ctx.fillStyle = "#0d5a2c";
      for (let k = -2; k <= 2; k++) {
        ctx.save();
        ctx.translate(0, s * 0.12);
        ctx.rotate(k * 0.42);
        ctx.beginPath();
        ctx.ellipse(0, -s * 0.18, s * 0.07, s * 0.18, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      wordmark(ctx, "LL", s * 0.27, s * 0.12, "#0d5a2c", s * 0.4);
    },
  },
  {
    id: "marmita", name: "ASTON MARMITA", slogan: "comida de verdade, voltas de verdade", series: "f1",
    bg: "#00584c", fg: "#cddc29", accent: "#ffffff", stripes: ["#00584c", "#cddc29", "#00584c"],
    logo(ctx, s) {
      // Asas de folha de alface em volta de uma marmita.
      ctx.fillStyle = "#cddc29";
      for (const dir of [-1, 1]) {
        for (let k = 0; k < 4; k++) {
          ctx.beginPath();
          ctx.ellipse(dir * (s * 0.17 + k * s * 0.07), -s * 0.04 + k * s * 0.03, s * 0.12 - k * s * 0.015, s * 0.035, dir * (0.25 + k * 0.08), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      roundRect(ctx, -s * 0.13, -s * 0.1, s * 0.26, s * 0.18, s * 0.03);
      ctx.fillStyle = "#e9eef0";
      ctx.fill();
      ctx.fillStyle = "#00584c";
      ctx.fillRect(-s * 0.13, -s * 0.05, s * 0.26, s * 0.025);
      wordmark(ctx, "AM", s * 0.22, s * 0.12, "#ffffff", s * 0.4);
    },
  },
  {
    id: "subarroz", name: "SUBARROZ 555", slogan: "arroz, feijão e tração integral", series: "rali",
    bg: "#1d3f93", fg: "#f7d117", accent: "#ffffff", stripes: ["#1d3f93", "#f7d117", "#1d3f93"],
    logo(ctx, s) {
      ctx.fillStyle = "#16306f";
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.45, s * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#f7d117";
      ctx.lineWidth = s * 0.025;
      ctx.stroke();
      // Grãos de arroz e três feijões.
      ctx.fillStyle = "#ffffff";
      for (const [x, y, a] of [[-0.25, -0.08, 0.5], [-0.15, -0.14, -0.3], [-0.05, -0.06, 0.9], [0.08, -0.15, 0.2], [0.18, -0.07, -0.6], [0.28, -0.12, 0.4]]) {
        ctx.beginPath();
        ctx.ellipse(x * s, y * s, s * 0.045, s * 0.02, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#5a2a1a";
      for (const x of [-0.12, 0, 0.12]) {
        ctx.beginPath();
        ctx.ellipse(x * s, s * 0.1, s * 0.05, s * 0.033, 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  {
    id: "lanchia", name: "LANCHIA DELTA", slogan: "o sanduíche de três pontas", series: "rali",
    bg: "#f4f0e6", fg: "#1b3a6b", accent: "#d2232a", stripes: ["#4a2c1a", "#3e8e41", "#e8552b"],
    logo(ctx, s) {
      ctx.fillStyle = "#1b3a6b";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2);
      ctx.fill();
      // O "delta": sanduíche de forma em triângulo, com o recheio aparecendo.
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.26);
      ctx.lineTo(s * 0.26, s * 0.2);
      ctx.lineTo(-s * 0.26, s * 0.2);
      ctx.closePath();
      ctx.fillStyle = "#f2d39b";
      ctx.fill();
      ctx.fillStyle = "#3e8e41";
      ctx.fillRect(-s * 0.2, s * 0.06, s * 0.4, s * 0.04);
      ctx.fillStyle = "#e8552b";
      ctx.fillRect(-s * 0.22, s * 0.1, s * 0.44, s * 0.04);
    },
  },
  {
    id: "paogeot", name: "PÃOGEOT SPORT", slogan: "o leão do pão de queijo", series: "rali",
    bg: "#f2f2f2", fg: "#14213d", accent: "#f2b705", stripes: ["#14213d", "#f2b705", "#d62828"],
    logo(ctx, s) {
      // Juba de pontas em volta de um pão de queijo (a cara do leão).
      ctx.fillStyle = "#f2b705";
      ctx.beginPath();
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const r = k % 2 ? s * 0.3 : s * 0.42;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#f7e2a8";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#14213d";
      for (const x of [-0.08, 0.08]) {
        ctx.beginPath();
        ctx.arc(x * s, -s * 0.04, s * 0.03, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(-s * 0.05, s * 0.06);
      ctx.lineTo(s * 0.05, s * 0.06);
      ctx.lineTo(0, s * 0.11);
      ctx.fill();
    },
  },
  {
    id: "biscoito", name: "MITSUBISCOITO", slogan: "três biscoitos, nenhum arrependimento", series: "rali",
    bg: "#c8102e", fg: "#ffffff", accent: "#2b2b2b", stripes: ["#c8102e", "#ffffff", "#2b2b2b"],
    logo(ctx, s) {
      // Três biscoitos redondos com gotas de chocolate, em triângulo.
      for (const [x, y] of [[0, -0.18], [-0.2, 0.15], [0.2, 0.15]]) {
        ctx.fillStyle = "#d9a35b";
        ctx.beginPath();
        ctx.arc(x * s, y * s, s * 0.16, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = s * 0.02;
        ctx.stroke();
        ctx.fillStyle = "#4a2612";
        for (const [dx, dy] of [[-0.05, -0.04], [0.06, -0.02], [0, 0.06], [-0.06, 0.05]]) {
          ctx.beginPath();
          ctx.arc((x + dx) * s, (y + dy) * s, s * 0.02, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  },
  {
    id: "martinho", name: "MARTÍNI DE COCO", slogan: "Martinho Racing · batido, não mexido", series: "patrocinio",
    bg: "#f4ecd9", fg: "#3d2614", accent: "#e8552b", stripes: ["#4a2c1a", "#3e8e41", "#e8552b"],
    logo(ctx, s) {
      // Coco partido em cima de uma barra (a "bola e barra", à moda da casa).
      ctx.fillStyle = "#3d2614";
      roundRect(ctx, -s * 0.44, -s * 0.06, s * 0.88, s * 0.14, s * 0.07);
      ctx.fill();
      ctx.fillStyle = "#6b3f1f";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fbf6e8";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e8552b";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.07, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  {
    id: "gula", name: "GULA OIL", slogan: "óleo de fritura de alta performance", series: "patrocinio",
    bg: "#8fd3f2", fg: "#ffffff", accent: "#f36c21", stripes: ["#8fd3f2", "#f36c21", "#8fd3f2"],
    logo(ctx, s) {
      ctx.fillStyle = "#f36c21";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#1f4f8f";
      ctx.lineWidth = s * 0.03;
      ctx.stroke();
      // Gota de óleo pingando da palavra.
      ctx.fillStyle = "#ffe08a";
      ctx.beginPath();
      ctx.moveTo(s * 0.2, s * 0.08);
      ctx.quadraticCurveTo(s * 0.28, s * 0.22, s * 0.2, s * 0.28);
      ctx.quadraticCurveTo(s * 0.12, s * 0.22, s * 0.2, s * 0.08);
      ctx.fill();
      wordmark(ctx, "Gula", -s * 0.02, s * 0.24, "#1f4f8f", s * 0.7, RUSSO);
    },
  },
  {
    id: "gastrol", name: "GASTROL", slogan: "óleo sintético para frituras extremas", series: "patrocinio",
    bg: "#0f7a3b", fg: "#ffffff", accent: "#d81e2b", stripes: ["#0f7a3b", "#d81e2b", "#ffffff"],
    logo(ctx, s) {
      // Fita vermelha em onda por cima de um círculo branco.
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#d81e2b";
      ctx.beginPath();
      ctx.moveTo(-s * 0.46, s * 0.05);
      ctx.bezierCurveTo(-s * 0.2, -s * 0.2, s * 0.15, s * 0.15, s * 0.46, -s * 0.1);
      ctx.lineTo(s * 0.46, s * 0.02);
      ctx.bezierCurveTo(s * 0.15, s * 0.27, -s * 0.2, -s * 0.08, -s * 0.46, s * 0.17);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#0f7a3b";
      ctx.beginPath();
      ctx.arc(0, -s * 0.18, s * 0.07, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  {
    id: "petrolanche", name: "PETROLANCHE", slogan: "energia em forma de hambúrguer", series: "patrocinio",
    bg: "#00a19b", fg: "#ffffff", accent: "#c9f0ec", stripes: ["#00a19b", "#ffffff", "#00a19b"],
    logo(ctx, s) {
      // Contorno de hambúrguer em linhas (o "prédio duplo" virou dois pães).
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = s * 0.05;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(0, -s * 0.02, s * 0.32, Math.PI, 0);
      ctx.closePath();
      ctx.stroke();
      for (const y of [0.09, 0.18]) {
        ctx.beginPath();
        ctx.moveTo(-s * 0.34, y * s);
        ctx.lineTo(s * 0.34, y * s);
        ctx.stroke();
      }
      roundRect(ctx, -s * 0.32, s * 0.24, s * 0.64, s * 0.1, s * 0.05);
      ctx.stroke();
    },
  },
  {
    id: "monstarda", name: "MONSTARDA ENERGY", slogan: "libere a fera (e o molho)", series: "patrocinio",
    bg: "#0d0d0d", fg: "#ffd21f", accent: "#ffd21f", stripes: ["#0d0d0d", "#ffd21f", "#0d0d0d"],
    logo(ctx, s) {
      // Três riscos de mostarda escorrendo (garra, mas de molho).
      ctx.fillStyle = "#ffd21f";
      for (const x of [-0.18, 0, 0.18]) {
        ctx.beginPath();
        ctx.moveTo((x - 0.05) * s, -s * 0.4);
        ctx.quadraticCurveTo((x + 0.06) * s, -s * 0.05, (x - 0.02) * s, s * 0.32);
        ctx.quadraticCurveTo(x * s, s * 0.42, (x + 0.03) * s, s * 0.3);
        ctx.quadraticCurveTo((x + 0.1) * s, -s * 0.05, (x + 0.04) * s, -s * 0.4);
        ctx.closePath();
        ctx.fill();
      }
    },
  },
  {
    id: "piruli", name: "PIRULI PNEUS", slogan: "aderência de bala puxa-puxa", series: "patrocinio",
    bg: "#121212", fg: "#ffd200", accent: "#e30613", stripes: ["#121212", "#ffd200", "#e30613"],
    logo(ctx, s) {
      // Pirulito em espiral com o cabo comprido.
      ctx.fillStyle = "#ffd200";
      ctx.fillRect(-s * 0.025, 0, s * 0.05, s * 0.44);
      ctx.beginPath();
      ctx.arc(0, -s * 0.12, s * 0.27, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#e30613";
      ctx.lineWidth = s * 0.04;
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 6; a += 0.2) {
        const r = (a / (Math.PI * 6)) * s * 0.24;
        ctx.lineTo(Math.cos(a) * r, -s * 0.12 + Math.sin(a) * r);
      }
      ctx.stroke();
    },
  },
];

/** Só as equipes que correm (as da pintura dos caminhões e dos boxes). */
export const RACING_TEAMS = TEAMS.filter((t) => t.series !== "patrocinio");
export const SPONSORS = TEAMS.filter((t) => t.series === "patrocinio");

export const teamById = (id: string) => TEAMS.find((t) => t.id === id) ?? TEAMS[0];

// --- Texturas -------------------------------------------------------------------

/** Textura de canvas que se redesenha quando as fontes do jogo carregarem. */
function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, repeat = false) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (repeat) texture.wrapS = THREE.RepeatWrapping;
  const paint = () => {
    const ctx = canvas.getContext("2d")!;
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    draw(ctx, width, height);
    ctx.restore();
    texture.needsUpdate = true;
  };
  paint();
  document.fonts
    ?.load(`64px 'Black Ops One'`)
    .then(() => document.fonts.load(`64px 'Russo One'`))
    .then(paint)
    .catch(() => {});
  return texture;
}

/** Emblema da equipe em (x, y), cabendo num quadrado `s`. */
export function drawLogo(ctx: CanvasRenderingContext2D, team: Team, x: number, y: number, s: number) {
  ctx.save();
  ctx.translate(x, y);
  team.logo(ctx, s);
  ctx.restore();
}

/** Listras da equipe numa faixa horizontal (de `y` a `y + h`). */
function stripesBand(ctx: CanvasRenderingContext2D, team: Team, x: number, y: number, w: number, h: number) {
  team.stripes.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y + (i * h) / team.stripes.length, w, h / team.stripes.length + 0.5);
  });
}

/** Painel da equipe (outdoor, parede, faixa): emblema à esquerda, nome e slogan. 2:1. */
export function teamPanelTexture(team: Team) {
  return canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = team.bg;
    ctx.fillRect(0, 0, w, h);
    stripesBand(ctx, team, 0, h - 46, w, 30);
    drawLogo(ctx, team, 104, 104, 170);
    ctx.fillStyle = team.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `46px ${OPS}`;
    ctx.fillText(team.name, 345, 84, 300);
    ctx.font = `20px ${RUSSO}`;
    wrap(ctx, team.slogan, 345, 140, 300, 24);
    ctx.strokeStyle = team.fg;
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, w - 16, h - 16);
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, line: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > max && current) {
      lines.push(current);
      current = word;
    } else current = test;
  }
  if (current) lines.push(current);
  lines.slice(0, 3).forEach((l, i) => ctx.fillText(l, x, y + i * line, max));
}

/**
 * Lateral do baú do caminhão da equipe (4:1): listras correndo pelo meio,
 * emblema grande e o nome. `flip` espelha para o outro lado do baú (a frente
 * fica sempre do lado da cabine).
 */
export function truckLiveryTexture(team: Team, flip: boolean) {
  // Desenhado em 1024×256 e guardado pela metade (memória no celular).
  return canvasTexture(512, 128, (ctx) => {
    const w = 1024;
    const h = 256;
    ctx.scale(0.5, 0.5);
    if (flip) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.fillStyle = team.bg;
    ctx.fillRect(0, 0, w, h);
    // Listras em diagonal, saindo da frente.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, h * 0.62);
    ctx.lineTo(w * 0.55, h * 0.62);
    ctx.lineTo(w * 0.7, h * 0.3);
    ctx.lineTo(w, h * 0.3);
    ctx.lineTo(w, h * 0.55);
    ctx.lineTo(w * 0.74, h * 0.55);
    ctx.lineTo(w * 0.6, h * 0.86);
    ctx.lineTo(0, h * 0.86);
    ctx.closePath();
    ctx.clip();
    stripesBand(ctx, team, 0, h * 0.3, w, h * 0.56);
    ctx.restore();
    // O texto não pode sair espelhado.
    ctx.setTransform(0.5, 0, 0, 0.5, 0, 0);
    const lx = flip ? w - 170 : 170;
    const tx = flip ? w * 0.36 : w * 0.64;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.beginPath();
    ctx.arc(lx, h * 0.45, 92, 0, Math.PI * 2);
    ctx.fill();
    drawLogo(ctx, team, lx, h * 0.45, 170);
    ctx.fillStyle = team.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `64px ${OPS}`;
    ctx.lineWidth = 8;
    ctx.strokeStyle = team.bg;
    ctx.strokeText(team.name, tx, h * 0.17, 560);
    ctx.fillText(team.name, tx, h * 0.17, 560);
    ctx.font = `24px ${RUSSO}`;
    ctx.fillText(team.series === "rali" ? "EQUIPE OFICIAL DE RALI DE PORTO GORDO" : "EQUIPE DE FÓRMULA GORDURA", tx, h * 0.94, 600);
  });
}

/**
 * Faixa de patrocínio que repete (8:1): emblema e nome de várias marcas em
 * sequência, cada uma no fundo dela. `seed` muda a ordem.
 */
export function sponsorStripTexture(seed = 0, count = 4) {
  const brands = [...SPONSORS, ...RACING_TEAMS];
  const pick = Array.from({ length: count }, (_, i) => brands[(((seed * 5 + i * 3) % brands.length) + brands.length) % brands.length]);
  return canvasTexture(1024, 128, (ctx, w, h) => {
    const cell = w / count;
    pick.forEach((team, i) => {
      const x = i * cell;
      ctx.fillStyle = team.bg;
      ctx.fillRect(x, 0, cell, h);
      stripesBand(ctx, team, x, h - 14, cell, 14);
      drawLogo(ctx, team, x + 58, h * 0.45, 96);
      ctx.fillStyle = team.fg;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `30px ${OPS}`;
      ctx.fillText(team.name, x + cell / 2 + 46, h * 0.45, cell - 120);
    });
  }, true);
}

/** Porta de box com a equipe em cima (a placa do box), 2:1. */
export function pitBoardTexture(team: Team) {
  return canvasTexture(512, 128, (ctx, w, h) => {
    ctx.fillStyle = team.bg;
    ctx.fillRect(0, 0, w, h);
    stripesBand(ctx, team, 0, h - 18, w, 18);
    drawLogo(ctx, team, 64, h * 0.42, 100);
    ctx.fillStyle = team.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `44px ${OPS}`;
    ctx.fillText(team.name, w / 2 + 50, h * 0.42, w - 150);
  });
}

/** Bandeira vertical da equipe (as "biruta" de evento), 1:3. */
export function teamFlagTexture(team: Team) {
  return canvasTexture(128, 384, (ctx, w, h) => {
    ctx.fillStyle = team.bg;
    ctx.fillRect(0, 0, w, h);
    team.stripes.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(w - 26 + i * 6, 0, 6, h);
    });
    drawLogo(ctx, team, w / 2 - 8, 70, 96);
    ctx.save();
    ctx.translate(w / 2 - 8, h * 0.62);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = team.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `40px ${OPS}`;
    ctx.fillText(team.name, 0, 0, h * 0.62);
    ctx.restore();
  });
}

// --- Materiais (um por textura, compartilhados) --------------------------------

const materials = new Map<string, THREE.MeshLambertMaterial>();

/** Material com a textura, aceso de leve (placas pintadas). Fica em cache pela chave. */
export function signMaterial(key: string, make: () => THREE.Texture, options: { glow?: number; side?: THREE.Side } = {}) {
  let material = materials.get(key);
  if (!material) {
    const map = make();
    material = new THREE.MeshLambertMaterial({ map, emissive: "#ffffff", emissiveMap: map, emissiveIntensity: options.glow ?? 0.25, side: options.side ?? THREE.FrontSide });
    materials.set(key, material);
  }
  return material;
}

export const teamPanelMaterial = (team: Team, side: THREE.Side = THREE.FrontSide) =>
  signMaterial(`panel:${team.id}:${side}`, () => teamPanelTexture(team), { side });
export const sponsorStripMaterial = (seed: number) => signMaterial(`strip:${seed}`, () => sponsorStripTexture(seed), { glow: 0.3 });
export const pitBoardMaterial = (team: Team) => signMaterial(`pit:${team.id}`, () => pitBoardTexture(team), { glow: 0.35 });
export const truckLiveryMaterial = (team: Team, flip: boolean) => signMaterial(`truck:${team.id}:${flip}`, () => truckLiveryTexture(team, flip), { glow: 0.12 });
export const teamFlagMaterial = (team: Team) => signMaterial(`flag:${team.id}`, () => teamFlagTexture(team), { glow: 0.2, side: THREE.DoubleSide });
