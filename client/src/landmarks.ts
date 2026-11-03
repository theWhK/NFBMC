// Lanchonetes e garagens de Porto Gordo: paródias carinhosas das redes de
// fast-food (McGordo's, Burger Kilo, Subgordo, Outbacon) com drive-thru e as
// garagens (esconderijos com a oficina). A planta vem de LANDMARKS
// (shared/world.ts); aqui só se desenha, com formas simples e letreiros
// pintados em canvas (nada de logo de verdade).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LANDMARKS, STANDS, heightAt, slopeAt, type Landmark } from "@nfbmc/shared";

type AddChunk = (scene: THREE.Scene, object: THREE.Object3D, center: [number, number], radius?: number) => void;

// Materiais compartilhados: o grosso é "tinta" por vértice (uma cor por peça),
// assim cada lanchonete vira poucas malhas.
const paint = new THREE.MeshLambertMaterial({ vertexColors: true });
const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
const glass = new THREE.MeshLambertMaterial({ color: "#2b4a63", emissive: "#ffc27a", emissiveIntensity: 0.22 });
// Pátio e pintura do chão: acima da rua (que tem polygonOffset -1), cada camada um pouco mais.
const asphalt = new THREE.MeshLambertMaterial({ color: "#4a474d", polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const floorPaint = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
// Marca de parar na frente da garagem: brilha e deixa ver o chão.
const stopRing = new THREE.MeshBasicMaterial({
  color: "#3ff0ff", transparent: true, opacity: 0.7, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
});
const stopDisc = new THREE.MeshBasicMaterial({
  color: "#3ff0ff", transparent: true, opacity: 0.2, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5,
});
const VERTEX_COLORED = new Set<THREE.Material>([paint, glow, floorPaint]);

/** Cor (tinta), { glow } (tinta que brilha) ou um material próprio. */
type Look = string | { glow: string } | THREE.Material;

function put(parent: THREE.Object3D, geometry: THREE.BufferGeometry, look: Look, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
  let material: THREE.Material;
  let color: string | undefined;
  if (typeof look === "string") {
    material = paint;
    color = look;
  } else if (look instanceof THREE.Material) {
    material = look;
  } else {
    material = glow;
    color = look.glow;
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  if (color) mesh.userData.color = color;
  parent.add(mesh);
  return mesh;
}

/** Caixa com a base em `y` (não o centro). */
const box = (parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, look: Look, ry = 0) =>
  put(parent, new THREE.BoxGeometry(w, h, d), look, x, y + h / 2, z, ry);

/** Pintura no chão: deitada, e depois cada vértice vai para a altura do relevo + `lift`. */
function decal(parent: THREE.Object3D, geometry: THREE.BufferGeometry, look: Look, x: number, z: number, lift: number, ry = 0) {
  const mesh = put(parent, geometry.rotateX(-Math.PI / 2), typeof look === "string" ? floorPaint : look, x, 0, z, ry);
  if (typeof look === "string") mesh.userData.color = look;
  mesh.userData.drape = lift;
  return mesh;
}

/** Junta as peças do grupo (já no lugar) por material, em coordenadas do mundo. */
function collect(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const apart: THREE.Mesh[] = [];
  const color = new THREE.Color();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as THREE.Material;
    // Peça que precisa ficar separada (a porta da garagem, que some na animação de entrar).
    if (mesh.userData.keep) {
      const kept = new THREE.Mesh(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld), material);
      kept.name = mesh.userData.keep as string;
      kept.geometry.computeBoundingSphere();
      apart.push(kept);
      return;
    }
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    for (const name of Object.keys(geometry.attributes)) if (!["position", "normal", "uv"].includes(name)) geometry.deleteAttribute(name);
    const positions = geometry.attributes.position as THREE.BufferAttribute;
    if (!geometry.attributes.uv) geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(positions.count * 2), 2));
    if (VERTEX_COLORED.has(material)) {
      color.set(mesh.userData.color ?? "#ffffff");
      const colors = new Float32Array(positions.count * 3);
      for (let i = 0; i < positions.count; i++) colors.set([color.r, color.g, color.b], i * 3);
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    }
    if (mesh.userData.drape !== undefined) {
      for (let i = 0; i < positions.count; i++) positions.setY(i, heightAt(positions.getX(i), positions.getZ(i)) + mesh.userData.drape);
    }
    let list = byMaterial.get(material);
    if (!list) byMaterial.set(material, (list = []));
    list.push(geometry);
  });
  const group = new THREE.Group();
  for (const [material, parts] of byMaterial) {
    const mesh = new THREE.Mesh(mergeGeometries(parts), material);
    mesh.geometry.computeBoundingSphere();
    group.add(mesh);
  }
  if (apart.length) group.add(...apart);
  return group;
}

// --- Letreiros ---------------------------------------------------------------

/** Textura pintada em canvas; redesenha quando as fontes do jogo carregarem. */
function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const paintIt = () => {
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, width, height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    draw(ctx, width, height);
    texture.needsUpdate = true;
  };
  paintIt();
  document.fonts
    ?.load("64px 'Black Ops One'")
    .then(() => document.fonts.load("64px 'Russo One'"))
    .then(paintIt)
    .catch(() => {});
  return texture;
}

const signCache = new Map<string, THREE.Material>();
/** Letreiro iluminado por dentro (brilha com as próprias cores). */
function lit(key: string, width: number, height: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  let material = signCache.get(key);
  if (!material) {
    const map = canvasTexture(width, height, draw);
    material = new THREE.MeshLambertMaterial({ map, emissive: "#ffffff", emissiveMap: map, emissiveIntensity: 0.55 });
    signCache.set(key, material);
  }
  return material;
}

const OPS = "'Black Ops One', 'Russo One', sans-serif";
const RUSSO = "'Russo One', sans-serif";

/** Faixa com o nome na fachada ou no poste. */
function nameBoard(key: string, text: string, bg: string, fg: string, edge: string) {
  return lit(`name:${key}`, 1024, 192, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.font = `128px ${OPS}`;
    ctx.lineWidth = 12;
    ctx.strokeStyle = edge;
    ctx.strokeText(text, w / 2, h / 2 + 6, w - 60);
    ctx.fillStyle = fg;
    ctx.fillText(text, w / 2, h / 2 + 6, w - 60);
  });
}

/** Placa do slogan, em duas linhas. */
function sloganBoard(key: string, lines: string[], bg: string, fg: string, border: string) {
  return lit(`slogan:${key}`, 1024, 256, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = border;
    ctx.lineWidth = 14;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.fillStyle = fg;
    if (lines.length === 1) {
      ctx.font = `92px ${RUSSO}`;
      ctx.fillText(lines[0], w / 2, h / 2 + 4, w - 80);
    } else {
      ctx.font = `76px ${RUSSO}`;
      ctx.fillText(lines[0], w / 2, h * 0.38, w - 80);
      ctx.font = `54px ${RUSSO}`;
      ctx.fillText(lines[1], w / 2, h * 0.72, w - 80);
    }
  });
}

/** Logo redondo do Burger Kilo: pão de cima, o nome no recheio e o pão de baixo, num anel azul. */
const kiloLogo = () =>
  lit("logo:burgerkilo", 512, 512, (ctx) => {
    ctx.fillStyle = "#1f4fa3";
    ctx.beginPath();
    ctx.arc(256, 256, 256, 0, Math.PI * 2);
    ctx.fill();
    // Pão de cima (cúpula) com gergelim.
    ctx.fillStyle = "#f3a33a";
    ctx.beginPath();
    ctx.ellipse(256, 200, 190, 120, 0, Math.PI, 0);
    ctx.lineTo(446, 210);
    ctx.lineTo(66, 210);
    ctx.fill();
    ctx.fillStyle = "#fff1d6";
    for (const [x, y] of [[180, 130], [250, 110], [320, 130], [210, 170], [295, 168], [380, 175], [140, 175]]) {
      ctx.beginPath();
      ctx.ellipse(x, y, 10, 5, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Pão de baixo.
    ctx.fillStyle = "#f3a33a";
    ctx.beginPath();
    ctx.roundRect(86, 330, 340, 70, 34);
    ctx.fill();
    // O nome no meio, onde seria a carne.
    ctx.font = `92px ${OPS}`;
    ctx.lineWidth = 10;
    ctx.strokeStyle = "#fff1d6";
    ctx.fillStyle = "#c8202f";
    ctx.strokeText("BURGER", 256, 238, 420);
    ctx.fillText("BURGER", 256, 238, 420);
    ctx.strokeText("KILO", 256, 312, 420);
    ctx.fillText("KILO", 256, 312, 420);
  });

/** "Subgordo" com setinha saindo do S e do o do fim. */
const subName = () =>
  lit("name:subgordo", 1024, 256, (ctx, w, h) => {
    ctx.fillStyle = "#0f7a3d";
    ctx.fillRect(0, 0, w, h);
    ctx.font = `150px ${OPS}`;
    ctx.textAlign = "left";
    const sub = ctx.measureText("Sub").width;
    const gordo = ctx.measureText("gordo").width;
    const start = (w - sub - gordo) / 2;
    ctx.fillStyle = "#ffffff";
    ctx.fillText("Sub", start, h / 2 + 6);
    ctx.fillStyle = "#ffd400";
    ctx.fillText("gordo", start + sub, h / 2 + 6);
    // Setas: uma sai do S para a esquerda, a outra do "o" para a direita.
    const arrow = (x0: number, x1: number, y: number, color: string) => {
      ctx.strokeStyle = ctx.fillStyle = color;
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      const dir = Math.sign(x1 - x0);
      ctx.beginPath();
      ctx.moveTo(x1 + dir * 30, y);
      ctx.lineTo(x1, y - 24);
      ctx.lineTo(x1, y + 24);
      ctx.fill();
    };
    arrow(start + 20, Math.max(30, start - 60), h / 2 + 52, "#ffffff");
    arrow(start + sub + gordo - 20, Math.min(w - 60, start + sub + gordo + 60), h / 2 - 30, "#ffd400");
  });

const outbaconName = () =>
  lit("name:outbacon", 1024, 320, (ctx, w, h) => {
    ctx.fillStyle = "#b3121b";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#f3dfb8";
    ctx.lineWidth = 12;
    ctx.strokeRect(18, 18, w - 36, h - 36);
    ctx.fillStyle = "#f3dfb8";
    ctx.font = `150px ${OPS}`;
    ctx.fillText("Outbacon", w / 2, h * 0.42, w - 90);
    ctx.font = `58px ${RUSSO}`;
    ctx.fillText("S T E A K H O U S E", w / 2, h * 0.78, w - 90);
  });

/** Neon da garagem: chave inglesa e "GARAGEM", com fundo transparente. */
const garageNeon = (() => {
  let material: THREE.Material | null = null;
  return () => {
    if (material) return material;
    const map = canvasTexture(1024, 256, (ctx, w, h) => {
      ctx.shadowColor = "#3ff0ff";
      ctx.shadowBlur = 24;
      ctx.font = `150px ${OPS}`;
      ctx.lineWidth = 8;
      ctx.strokeStyle = "#3ff0ff";
      ctx.fillStyle = "#e9ffff";
      for (let i = 0; i < 2; i++) ctx.strokeText("GARAGEM", w / 2 + 70, h / 2 + 8, w - 240);
      ctx.fillText("GARAGEM", w / 2 + 70, h / 2 + 8, w - 240);
      // Chave inglesa rosa, deitada na diagonal.
      ctx.save();
      ctx.translate(120, h / 2);
      ctx.rotate(-0.7);
      ctx.shadowColor = "#ff4fd8";
      ctx.strokeStyle = "#ff4fd8";
      ctx.fillStyle = "#ffd6f6";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.roundRect(-14, -10, 28, 120, 12);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -40, 42, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.globalCompositeOperation = "destination-out";
      ctx.shadowBlur = 0;
      ctx.fillRect(-16, -96, 32, 52);
      ctx.restore();
    });
    material = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false });
    return material;
  };
})();

/** Plaquinha com o nome de cada garagem. */
const plate = (name: string) =>
  lit(`plate:${name}`, 768, 128, (ctx, w, h) => {
    ctx.fillStyle = "#1a1d24";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#f2c230";
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = "#ffffff";
    ctx.font = `64px ${RUSSO}`;
    ctx.fillText(name.toUpperCase(), w / 2, h / 2 + 4, w - 50);
  });

/** Porta de enrolar: lâminas cinza e a faixa zebrada embaixo (a animação de entrar usa a mesma). */
export const rollDoor = () =>
  lit("door:garagem", 512, 320, (ctx, w, h) => {
    for (let y = 0; y < h; y += 16) {
      ctx.fillStyle = (y / 16) % 2 ? "#9aa3ad" : "#b6bec7";
      ctx.fillRect(0, y, w, 16);
      ctx.fillStyle = "#6d7680";
      ctx.fillRect(0, y + 14, w, 2);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, h - 44, w, 44);
    ctx.clip();
    ctx.fillStyle = "#f2c230";
    ctx.fillRect(0, h - 44, w, 44);
    ctx.fillStyle = "#1a1a1a";
    for (let x = -60; x < w + 60; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + 24, h);
      ctx.lineTo(x + 68, h - 44);
      ctx.lineTo(x + 44, h - 44);
      ctx.fill();
    }
    ctx.restore();
  });

// --- Desenho de cada lugar ---------------------------------------------------

/**
 * Medidas no referencial do prédio: x ao longo da rua, z para fora da fachada
 * (a fachada fica em z = D/2 e o pátio vai até z = D/2 + A), y = 0 no chão do meio.
 */
interface Frame {
  W: number;
  D: number;
  A: number;
  AW: number;
  H: number;
  /** Quanto as paredes descem abaixo do chão (morro). */
  S: number;
  /** x da janelinha do drive-thru (0 na garagem). */
  sx: number;
  /** Lado da janelinha (+1 ou −1). */
  side: number;
}

/** Caixa básica da lanchonete: paredes, platibanda, vitrine, porta e a janelinha do drive-thru. */
function shell(g: THREE.Group, f: Frame, body: string, trim: string, name: THREE.Material, awning: string) {
  const { W, D, H, S, sx, side } = f;
  box(g, W, H + S, D, 0, -S, 0, body);
  box(g, W + 0.6, 0.5, D + 0.6, 0, H, 0, trim);
  // Platibanda na frente, com o nome.
  box(g, W + 0.4, 1.5, 0.5, 0, H - 1.5, D / 2 + 0.25, trim);
  put(g, new THREE.PlaneGeometry(W * 0.62, 1.25), name, 0, H - 0.75, D / 2 + 0.52);
  // Vitrine e porta, do lado oposto ao drive-thru.
  box(g, W * 0.42, 2.2, 0.12, -side * W * 0.1, 0.8, D / 2 + 0.06, glass);
  box(g, 1.8, 2.5, 0.14, -side * (W / 2 - 2.2), 0, D / 2 + 0.07, glass);
  box(g, 2.2, 0.25, 0.3, -side * (W / 2 - 2.2), 2.5, D / 2 + 0.15, trim);
  // Janelinha do drive-thru, com moldura, balcão e toldinho.
  box(g, 2.2, 1.8, 0.1, sx, 0.6, D / 2 + 0.05, trim);
  box(g, 1.7, 1.3, 0.16, sx, 0.85, D / 2 + 0.08, glass);
  box(g, 1.9, 0.12, 0.5, sx, 0.95, D / 2 + 0.25, "#d8d2c8");
  box(g, 2.8, 0.18, 1.3, sx, 2.6, D / 2 + 0.65, awning);
  // Mureta da calçada colada na fachada (só enfeite).
  box(g, W, 0.16, 1.0, 0, -0.1, D / 2 + 0.5, "#cfc8bc");
}

/** Poste alto com o letreiro, do lado oposto ao drive-thru, perto da rua. */
function pole(g: THREE.Group, f: Frame, height: number) {
  const px = -f.side * (f.W / 2 + 2.4);
  const pz = f.D / 2 + f.A * 0.7;
  const sink = f.S + 1.5;
  box(g, 0.7, height + sink, 0.7, px, -sink, pz, "#3a3636");
  box(g, 1.6, 0.6, 1.6, px, -0.2, pz, "#8a8580");
  const top = new THREE.Group();
  top.position.set(px, height, pz);
  g.add(top);
  return top;
}

/** Placa de duas faces (frente legível dos dois lados). */
function twoFaced(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, depth: number) {
  put(parent, geometry, material, x, y, z + depth / 2 + 0.01);
  put(parent, geometry, material, x, y, z - depth / 2 - 0.01, Math.PI);
}

function mcgordos(g: THREE.Group, f: Frame) {
  shell(g, f, "#c8102e", "#ffc72c", nameBoard("mcgordos", "McGordo's", "#c8102e", "#ffc72c", "#5a0a12"), "#ffc72c");
  // Telhadinho inclinado em cima da platibanda (o "chapéu" vermelho-escuro).
  put(g, new THREE.BoxGeometry(f.W + 1, 1.1, 1.6), "#8b1a1a", 0, f.H + 0.3, f.D / 2 - 0.2, 0, -0.5);
  const top = pole(g, f, 11);
  // Os arcos dourados: dois meio-toros esticados para cima, formando um "M" gordinho.
  const arch = new THREE.TorusGeometry(1.5, 0.42, 8, 20, Math.PI).scale(1, 1.75, 0.7);
  for (const x of [-1.5, 1.5]) {
    put(top, arch, { glow: "#ffc72c" }, x, 1.4, 0);
    for (const leg of [-1.5, 1.5]) put(top, new THREE.CylinderGeometry(0.42, 0.42, 1.4, 8).scale(1, 1, 0.7), { glow: "#ffc72c" }, x + leg, 0.7, 0);
  }
  // Nome e slogan embaixo dos arcos.
  box(top, 7.4, 1.6, 0.4, 0, -1.8, 0, "#c8102e");
  twoFaced(top, new THREE.PlaneGeometry(7, 1.4), nameBoard("mcgordos", "McGordo's", "#c8102e", "#ffc72c", "#5a0a12"), 0, -1.0, 0, 0.4);
  box(top, 7.8, 2, 0.3, 0, -4.2, 0, "#f4f1e8");
  twoFaced(
    top, new THREE.PlaneGeometry(7.6, 1.9),
    sloganBoard("mcgordos", ["amo muito tudo isso", "(e mais um pouco)"], "#fffaf0", "#c8102e", "#ffc72c"),
    0, -3.2, 0, 0.3,
  );
}

function burgerkilo(g: THREE.Group, f: Frame) {
  shell(g, f, "#f2c48d", "#d2491f", nameBoard("burgerkilo", "BURGER KILO", "#d2491f", "#fff1d6", "#5a1f0a"), "#1f4fa3");
  box(g, f.W + 0.1, 0.9, f.D + 0.1, 0, -0.2, 0, "#1f4fa3");
  const top = pole(g, f, 10.5);
  // O logo redondo de pão, com anel azul e a coroa em cima.
  const y = 4.4;
  twoFaced(top, new THREE.CircleGeometry(3.1, 40), kiloLogo(), 0, y, 0, 0.5);
  put(top, new THREE.CylinderGeometry(3.15, 3.15, 0.5, 40), "#1f4fa3", 0, y, 0, 0, Math.PI / 2);
  put(top, new THREE.TorusGeometry(3.25, 0.25, 8, 40), "#173c7d", 0, y, 0);
  const crown = new THREE.Group();
  crown.position.set(0, y + 3.3, 0);
  top.add(crown);
  box(crown, 2.6, 0.7, 0.6, 0, 0, 0, "#ffcc33");
  for (const x of [-1, 0, 1]) {
    put(crown, new THREE.ConeGeometry(0.38, 1.2, 4), "#ffcc33", x, 1.25, 0, Math.PI / 4);
    put(crown, new THREE.SphereGeometry(0.18, 8, 6), { glow: "#c8202f" }, x, 1.95, 0);
  }
  box(top, 6.6, 1.6, 0.3, 0, -0.6, 0, "#5a1f0a");
  twoFaced(top, new THREE.PlaneGeometry(6.4, 1.5), sloganBoard("burgerkilo", ["o rei do quilo"], "#fff1d6", "#5a1f0a", "#d2491f"), 0, 0.2, 0, 0.3);
}

function subgordo(g: THREE.Group, f: Frame) {
  shell(g, f, "#0f7a3d", "#ffd400", subName(), "#ffd400");
  // Faixas amarelas nas quinas.
  for (const x of [-f.W / 2, f.W / 2]) box(g, 0.5, f.H, 0.5, x, 0, f.D / 2, "#ffd400");
  const top = pole(g, f, 10);
  box(top, 7.4, 2.2, 0.6, 0, 0, 0, "#0f7a3d");
  twoFaced(top, new THREE.PlaneGeometry(7.2, 1.8), subName(), 0, 1.1, 0, 0.6);
  box(top, 6, 1.4, 0.3, 0, -1.7, 0, "#ffd400");
  twoFaced(top, new THREE.PlaneGeometry(5.8, 1.3), sloganBoard("subgordo", ["coma gordo"], "#ffd400", "#0f7a3d", "#0f7a3d"), 0, -1.0, 0, 0.3);
}

/** Bumerangue: um "V" aberto de pontas arredondadas, extrudado. */
function boomerang() {
  const s = new THREE.Shape();
  s.moveTo(-2.6, 0.2);
  s.quadraticCurveTo(-1.2, 1.6, 0, 1.4);
  s.quadraticCurveTo(1.2, 1.6, 2.6, 0.2);
  s.quadraticCurveTo(2.8, -0.2, 2.4, -0.2);
  s.quadraticCurveTo(1.2, 0.8, 0, 0.6);
  s.quadraticCurveTo(-1.2, 0.8, -2.4, -0.2);
  s.quadraticCurveTo(-2.8, -0.2, -2.6, 0.2);
  return new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false, curveSegments: 6 }).translate(0, 0, -0.15);
}

function outbacon(g: THREE.Group, f: Frame) {
  const { W, D, H } = f;
  const wall = H - 0.8;
  shell(g, { ...f, H: wall }, "#6b4226", "#3d2414", nameBoard("outbacon", "Outbacon", "#b3121b", "#f3dfb8", "#3d0a0a"), "#b3121b");
  // Base de pedra e telhado de duas águas com a cumeeira ao longo da rua.
  box(g, W + 0.3, 1.4, D + 0.3, 0, -0.3, 0, "#8a8580");
  const gable = new THREE.Shape();
  gable.moveTo(-D / 2 - 1, 0);
  gable.lineTo(D / 2 + 1, 0);
  gable.lineTo(0, 3.2);
  gable.closePath();
  put(g, new THREE.ExtrudeGeometry(gable, { depth: W + 1, bevelEnabled: false }).translate(0, 0, -(W + 1) / 2), "#4a2c1a", 0, wall + 0.4, 0, Math.PI / 2);
  // Toras na fachada.
  for (let x = -W / 2 + 1; x <= W / 2 - 1; x += 4) box(g, 0.45, wall, 0.45, x, 0, D / 2 + 0.2, "#3d2414");
  const top = pole(g, f, 11);
  box(top, 7.6, 2.5, 0.5, 0, 0, 0, "#3d2414");
  twoFaced(top, new THREE.PlaneGeometry(7.3, 2.3), outbaconName(), 0, 1.25, 0, 0.5);
  put(top, boomerang(), "#e3b77a", 0, 2.6, 0, 0, 0, 0.15);
  box(top, 6.8, 1.5, 0.3, 0, -1.8, 0, "#3d2414");
  twoFaced(top, new THREE.PlaneGeometry(6.6, 1.4), sloganBoard("outbacon", ["cebola explosiva"], "#3d2414", "#f3dfb8", "#e3b77a"), 0, -1.05, 0, 0.3);
}

/** Porta da garagem (vão no meio da fachada) e a espessura das paredes, que são ocas. */
export const GARAGE_DOOR = { width: 7.6, height: 4.7, wall: 0.3 };

function garagem(g: THREE.Group, f: Frame, name: string) {
  const { W, D, H, S, A } = f;
  // Paredes ocas, com o vão da porta: o interior da oficina (garage-interior.ts)
  // só é montado quando alguém entra, e aparece pela porta aberta.
  const { wall: T, height: DH } = GARAGE_DOOR;
  const shell = "#5d6670";
  box(g, W, H + S, T, 0, -S, -D / 2 + T / 2, shell);
  for (const s of [-1, 1]) box(g, T, H + S, D, s * (W / 2 - T / 2), -S, 0, shell);
  box(g, W, T, D, 0, H - T, 0, shell);
  const jamb = (W - GARAGE_DOOR.width) / 2;
  for (const s of [-1, 1]) box(g, jamb, H + S, T, s * (W / 2 - jamb / 2), -S, D / 2 - T / 2, shell);
  box(g, GARAGE_DOOR.width, H - DH, T, 0, DH, D / 2 - T / 2, shell);
  box(g, GARAGE_DOOR.width, S, T, 0, -S, D / 2 - T / 2, shell);
  box(g, W + 0.5, 0.45, D + 0.5, 0, H, 0, "#2b2f36");
  // Frisos de chapa ondulada na fachada.
  for (let y = 5.6; y < H; y += 0.6) box(g, W + 0.02, 0.08, D + 0.02, 0, y, 0, "#4b535c");
  // Porta de enrolar com batente amarelo.
  const door = GARAGE_DOOR.width;
  for (const s of [-1, 1]) box(g, 0.4, DH + 0.4, 0.25, s * (door / 2 + 0.2), 0, D / 2 + 0.1, "#f2c230");
  box(g, door + 0.8, 0.4, 0.25, 0, DH, D / 2 + 0.1, "#f2c230");
  put(g, new THREE.PlaneGeometry(door, DH), rollDoor(), 0, DH / 2, D / 2 + 0.24).userData.keep = "door";
  put(g, new THREE.PlaneGeometry(5.6, 0.95), plate(name), 0, 5.75, D / 2 + 0.05);
  // Portinha e janela de lado.
  box(g, 1.1, 2.3, 0.14, W / 2 - 2, 0, D / 2 + 0.07, "#2b2f36");
  box(g, 1.8, 1.0, 0.14, -W / 2 + 2, 1.4, D / 2 + 0.07, glass);
  for (const x of [-door / 2 - 0.9, door / 2 + 0.9]) box(g, 0.5, 0.35, 0.5, x, 4.9, D / 2 + 0.25, { glow: "#ffe9b0" });
  // Letreiro de neon em cima do telhado, num quadro escuro.
  for (const x of [-4, 4]) box(g, 0.3, 1.0, 0.3, x, H + 0.4, D / 2 - 0.8, "#2b2f36");
  box(g, 11, 2.8, 0.35, 0, H + 1.3, D / 2 - 0.8, "#1a1d24");
  put(g, new THREE.PlaneGeometry(11, 2.75), garageNeon(), 0, H + 2.7, D / 2 - 0.6);
  box(g, 11.2, 0.12, 0.12, 0, H + 1.25, D / 2 - 0.55, { glow: "#ff4fd8" });
  box(g, 11.2, 0.12, 0.12, 0, H + 4.05, D / 2 - 0.55, { glow: "#ff4fd8" });
  // Onde parar: anel ciano no pátio, na frente da porta, e zebrado no pé da porta.
  const cz = D / 2 + A / 2;
  decal(g, new THREE.RingGeometry(3.0, 3.6, 40), stopRing, 0, cz, 0.16);
  decal(g, new THREE.CircleGeometry(3.0, 40), stopDisc, 0, cz, 0.15);
  for (let x = -door / 2; x < door / 2; x += 1.2) decal(g, new THREE.PlaneGeometry(0.6, 1.0), "#f2c230", x + 0.3, D / 2 + 0.6, 0.11, 0.6);
}

/** Pátio asfaltado, vagas e (nas lanchonetes) a pista do drive-thru com a seta. */
function apron(g: THREE.Group, f: Frame, restaurant: boolean) {
  const { D, A, AW, W, sx, side } = f;
  decal(g, new THREE.PlaneGeometry(AW, A, Math.ceil(AW / 2), Math.ceil(A / 2)), asphalt, 0, D / 2 + A / 2, 0.08);
  if (!restaurant) return;
  // Vagas do lado da porta (traços perpendiculares à fachada).
  for (let x = 1.2; x < W / 2 + 0.5; x += 2.7) decal(g, new THREE.PlaneGeometry(0.15, 4.6), "#f4f1e8", -side * x, D / 2 + 3.4, 0.11);
  // Pista do drive-thru: duas linhas amarelas e a seta até a janelinha.
  for (const z of [D / 2 + 1.5, D / 2 + 5.5]) decal(g, new THREE.PlaneGeometry(Math.abs(sx) + 2, 0.18), "#ffd23f", side * (Math.abs(sx) / 2 + 1), z, 0.11);
  const arrow = new THREE.Shape();
  arrow.moveTo(-1.6, -0.3);
  arrow.lineTo(0.4, -0.3);
  arrow.lineTo(0.4, -0.85);
  arrow.lineTo(1.6, 0);
  arrow.lineTo(0.4, 0.85);
  arrow.lineTo(0.4, 0.3);
  arrow.lineTo(-1.6, 0.3);
  arrow.closePath();
  decal(g, new THREE.ShapeGeometry(arrow), "#f4f1e8", sx * 0.35, D / 2 + 3.5, 0.11, side > 0 ? 0 : Math.PI);
}

function buildLandmark(l: Landmark) {
  // Gira o referencial para a fachada ficar sempre em +z.
  const rotation = l.angle + (l.front > 0 ? 0 : Math.PI);
  const ground = heightAt(l.x, l.z);
  const [gx, gz] = slopeAt(l.x, l.z);
  const S = Math.hypot(gx, gz) * (Math.hypot(l.w, l.d) / 2) + 0.4;
  // A janelinha do drive-thru vem do balcão (STANDS) trazido para o referencial do prédio.
  const stand = STANDS.find((s) => s.landmark === l.id);
  let sx = 0;
  if (stand) {
    const dx = stand.x - l.x;
    const dz = stand.z - l.z;
    sx = dx * Math.cos(rotation) - dz * Math.sin(rotation);
  }
  const f: Frame = {
    W: l.w, D: l.d, A: l.apron.d, AW: l.apron.w, H: l.kind === "garagem" ? 7 : 6.2, S, sx,
    side: sx < 0 ? -1 : 1,
  };
  const root = new THREE.Group();
  root.position.set(l.x, ground, l.z);
  root.rotation.y = rotation;
  apron(root, f, l.kind !== "garagem");
  switch (l.kind) {
    case "mcgordos": mcgordos(root, f); break;
    case "burgerkilo": burgerkilo(root, f); break;
    case "subgordo": subgordo(root, f); break;
    case "outbacon": outbacon(root, f); break;
    case "garagem": garagem(root, f, l.name); break;
  }
  const built = collect(root);
  const door = built.getObjectByName("door");
  if (door) DOORS.set(l.id, door);
  return built;
}

const DOORS = new Map<string, THREE.Object3D>();
/** Porta (fechada) da garagem desenhada na cidade: a animação esconde e põe a dela, que abre. */
export const garageDoor = (id: string) => DOORS.get(id) ?? null;

/** Desenha todas as lanchonetes e garagens, cada uma no bloco da cena dela. */
export function buildLandmarks(scene: THREE.Scene, addChunk: AddChunk) {
  for (const l of LANDMARKS) addChunk(scene, buildLandmark(l), [l.x, l.z], Math.hypot(l.w, l.d + 2 * l.apron.d) / 2 + 20);
}
