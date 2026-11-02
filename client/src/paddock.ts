// O autódromo com cara de dia de corrida e as equipes pela cidade:
// arquibancadas cobertas cheias de torcida, muro dos boxes com tela e
// patrocínio, o prédio dos boxes com a placa de cada equipe, a pista dos boxes,
// os caminhões das equipes no paddock (e perto das garagens), placas de
// patrocínio nas curvas, bandeiras das equipes e o painel da equipe parceira
// na lateral de cada garagem. Onde fica cada coisa (e a colisão) vem de
// shared/src/props.ts; aqui só se desenha. As marcas são as de teams.ts.
import * as THREE from "three";
import { GARAGES, PIT_LANE, SOLID_PROPS, heightAt, type SolidProp } from "@nfbmc/shared";

import { addChunk } from "./chunks.ts";
import { surface } from "./look.ts";
import { box, cylinder, glass, merge, put, scaleUv } from "./prop-kit.ts";
import {
  RACING_TEAMS,
  pitBoardMaterial,
  sponsorStripMaterial,
  teamFlagMaterial,
  teamPanelMaterial,
  truckLiveryMaterial,
} from "./teams.ts";

const racingTeam = (n: number) => RACING_TEAMS[((n % RACING_TEAMS.length) + RACING_TEAMS.length) % RACING_TEAMS.length];

// --- Texturas próprias -----------------------------------------------------------

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** Uma fileira de torcida (cabeças e camisas de todas as cores), fundo transparente. */
const crowdMaterial = (() => {
  const texture = canvasTexture(512, 64, (ctx) => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const shirts = ["#c8102e", "#ffe14d", "#1b2559", "#ff8000", "#14c7b4", "#ffffff", "#0d5a2c", "#3fb8f0", "#e1251b", "#222222", "#f2b705"];
    const skins = ["#f1c9a5", "#d9a477", "#a8714a", "#7a4b2c", "#5a3720"];
    for (let x = 4; x < 512; x += 9 + random() * 5) {
      if (random() < 0.12) continue; // lugar vazio
      const y = 22 + random() * 6;
      ctx.fillStyle = shirts[Math.floor(random() * shirts.length)];
      ctx.beginPath();
      ctx.ellipse(x, y + 22, 6.5, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = skins[Math.floor(random() * skins.length)];
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      // Alguns levantam os braços (ou uma bandeirinha).
      if (random() < 0.15) {
        ctx.fillRect(x + 4, y - 14, 2.5, 16);
        if (random() < 0.5) {
          ctx.fillStyle = shirts[Math.floor(random() * shirts.length)];
          ctx.fillRect(x + 6, y - 14, 10, 7);
        }
      }
    }
  });
  return new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.5, side: THREE.DoubleSide });
})();

/** Tela do alambrado (losangos), fundo transparente. */
const fenceMaterial = (() => {
  const texture = canvasTexture(64, 64, (ctx) => {
    ctx.strokeStyle = "#c9ccd0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 32);
    ctx.lineTo(32, 0);
    ctx.lineTo(64, 32);
    ctx.lineTo(32, 64);
    ctx.closePath();
    ctx.stroke();
  });
  return surface(new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide, transparent: true, opacity: 0.55, depthWrite: false }), { roughness: 0.5, metalness: 0.6 });
})();

/** Chão da pista dos boxes: acima do chão, abaixo das faixas. */
const pitAsphalt = surface(new THREE.MeshLambertMaterial({ color: "#47454a", polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), { roughness: 0.9 });
const pitLine = new THREE.MeshLambertMaterial({ color: "#f4f1e8", polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });

// --- Peças --------------------------------------------------------------------------

/** Faixa de patrocínio (plano de frente para +z), repetindo na proporção certa. */
function sponsorPlane(parent: THREE.Object3D, w: number, h: number, x: number, y: number, z: number, seed: number, ry = 0) {
  const geometry = scaleUv(new THREE.PlaneGeometry(w, h), w / (h * 8));
  return put(parent, geometry, sponsorStripMaterial(((seed % 6) + 6) % 6), x, y, z, ry);
}

/** Bandeira vertical de equipe num mastro (a base em y = 0). */
function featherFlag(parent: THREE.Object3D, x: number, z: number, team: number, ry = 0) {
  cylinder(parent, 0.06, 4.4, x, 0, z, "#d9d4cc", 6);
  const flag = new THREE.PlaneGeometry(1.1, 3.3);
  put(parent, flag, teamFlagMaterial(racingTeam(team)), x + 0.58, 2.75, z, ry);
}

/** Frame do enfeite: grupo no lugar, com a frente (pista, rua) em +z local. */
function frame(p: SolidProp) {
  const g = new THREE.Group();
  g.position.set(p.x, heightAt(p.x, p.z), p.z);
  g.rotation.y = p.angle + (p.front > 0 ? 0 : Math.PI);
  return g;
}

function grandstand(p: SolidProp) {
  const g = frame(p);
  const { w, d } = p;
  const front = d / 2;
  const rows = 10;
  const tread = (d - 2.4) / rows;
  const rise = 0.85;
  const base = 1.6;
  // Mureta da frente com o patrocínio.
  box(g, w, base, 0.4, 0, -0.5, front - 0.2, "#d8d3c8");
  sponsorPlane(g, w, base * 0.8, 0, base * 0.5, front + 0.01, p.team);
  // Degraus (blocos cheios) com as cadeiras de cada fileira.
  const seats = ["#c8102e", "#f2f2f2", "#1b2559", "#ffe14d"];
  for (let k = 0; k < rows; k++) {
    const z1 = front - 0.4 - k * tread;
    const top = base + k * rise;
    box(g, w, top + 0.5, tread, 0, -0.5, z1 - tread / 2, "#bdb7ad");
    box(g, w - 0.2, 0.35, 0.45, 0, top, z1 - tread + 0.35, seats[(((k + Math.floor(p.team / 10)) % seats.length) + seats.length) % seats.length]);
  }
  // Torcida: um plano inclinado por cima dos degraus.
  const z0 = front - 0.4;
  const z9 = front - 0.4 - rows * tread;
  const length = Math.hypot(z0 - z9, rows * rise);
  const crowd = scaleUv(new THREE.PlaneGeometry(w, length), w / 14, rows);
  const slope = Math.atan2(rows * rise, z0 - z9);
  put(g, crowd, crowdMaterial, 0, base + (rows * rise) / 2 + 0.25, (z0 + z9) / 2 + 0.1, 0, -Math.PI / 2 + slope);
  // Parede do fundo, colunas e a cobertura.
  const back = -d / 2;
  box(g, w, base + rows * rise + 2, 1.0, 0, -0.5, back + 0.5, "#a9a397");
  for (const x of [-w / 2 + 0.3, w / 2 - 0.3]) {
    box(g, 0.5, 13, 0.5, x, 0, back + 0.4, "#5b5f66");
    box(g, 0.35, 0.5, d - 1, x, 12.4, back + (d - 1) / 2, "#5b5f66");
  }
  box(g, w + 0.1, 0.35, d + 0.4, 0, 12.9, -0.2 + 0.2, "#e9e6df");
  // Faixa de patrocínio na beira da cobertura e bandeiras das equipes em cima.
  sponsorPlane(g, w, 1.3, 0, 12.6, front + 0.45, p.team + 3);
  box(g, w, 0.2, 0.2, 0, 11.9, front + 0.35, "#5b5f66");
  for (const x of [-w / 4, w / 4]) {
    const flag = new THREE.Group();
    flag.position.set(x, 13.25, back + 1);
    featherFlag(flag, 0, 0, p.team + (x > 0 ? 1 : 0));
    g.add(flag);
  }
  return g;
}

function pitWall(p: SolidProp) {
  const g = frame(p);
  const { w, d } = p;
  box(g, w, 1.25, d, 0, -0.1, 0, "#d2cec6");
  box(g, w, 0.08, d + 0.1, 0, 1.15, 0, "#8d8a85");
  sponsorPlane(g, w, 0.72, 0, 0.58, d / 2 + 0.01, p.team);
  sponsorPlane(g, w, 0.72, 0, 0.58, -d / 2 - 0.01, p.team + 2, Math.PI);
  // Alambrado em cima do muro.
  for (let x = -w / 2; x <= w / 2 + 0.01; x += w / 4) cylinder(g, 0.06, 2.8, x, 1.15, 0, { metal: "#9aa0a6" }, 5);
  put(g, scaleUv(new THREE.PlaneGeometry(w, 2.6), w / 0.6, 2.6 / 0.6), fenceMaterial, 0, 1.15 + 1.4, 0);
  return g;
}

function pitBuilding(p: SolidProp) {
  const g = frame(p);
  const { w, d } = p;
  const front = d / 2;
  box(g, w, 10, d, 0, -0.5, 0, "#dedbd4");
  // Duas portas de box, cada uma com a placa da equipe.
  for (const [k, x] of [[0, -w / 4], [1, w / 4]] as const) {
    const team = racingTeam(p.team * 2 + k);
    // O box aberto: fundo cinza com a faixa da equipe, luz no teto e pilhas de pneus.
    box(g, w / 2 - 1.4, 4.4, 0.1, x, 0, front + 0.02, "#6a6e76");
    box(g, w / 2 - 1.6, 1.2, 0.08, x, 1.6, front + 0.08, team.bg);
    box(g, w / 2 - 1.6, 0.25, 0.09, x, 2.8, front + 0.08, team.stripes[1] ?? team.fg);
    box(g, w / 2 - 1.6, 0.12, 0.2, x, 4.1, front + 0.1, { glow: "#fff3dc" });
    for (const dx of [-2.2, 2.2]) for (let k = 0; k < 4; k++) put(g, new THREE.TorusGeometry(0.32, 0.14, 6, 12).rotateX(Math.PI / 2), "#151515", x + dx, 0.14 + k * 0.28, front + 0.6);
    put(g, new THREE.PlaneGeometry(w / 2 - 1.4, (w / 2 - 1.4) / 4), pitBoardMaterial(team), x, 4.6 + (w / 2 - 1.4) / 8, front + 0.03);
  }
  for (const x of [-w / 2 + 0.3, 0, w / 2 - 0.3]) box(g, 0.6, 6.4, 0.5, x, 0, front + 0.1, "#9b978f");
  // Andar de cima: vidro (camarote) e a marquise com o patrocínio.
  put(g, new THREE.BoxGeometry(w - 0.4, 2.6, 0.2), glass, 0, 7.8, front + 0.05);
  box(g, w + 0.05, 0.35, 3, 0, 9.5, front + 1.2, "#f2f0ea");
  sponsorPlane(g, w, 0.9, 0, 9.65, front + 2.72, p.team + 1);
  // No telhado: máquinas do ar-condicionado.
  box(g, 2.2, 1.2, 1.6, -w / 4, 9.5, -d / 4, "#8f9399");
  box(g, 1.6, 1.0, 1.6, w / 5, 9.5, -d / 3, "#8f9399");
  // Fundos: portinha e janelas.
  box(g, 1.2, 2.3, 0.1, w / 3, 0, -front - 0.05, "#4a4e55");
  return g;
}

function truck(p: SolidProp) {
  const g = new THREE.Group();
  g.position.set(p.x, heightAt(p.x, p.z), p.z);
  // A cabine fica no +x local (o "w" da caixa), do lado do `front`.
  g.rotation.y = p.angle + (p.front > 0 ? 0 : Math.PI);
  const team = racingTeam(p.team);
  const L = p.w;
  const W = p.d;
  const cabLength = 2.6;
  const trailerFront = L / 2 - cabLength - 0.5;
  const trailerLength = L - cabLength - 0.5;
  const trailerX = trailerFront - trailerLength / 2;
  // Baú com a pintura da equipe nas laterais.
  box(g, trailerLength, 2.85, W, trailerX, 1.15, 0, team.bg);
  box(g, trailerLength + 0.02, 0.12, W + 0.02, trailerX, 3.95, 0, team.stripes[1] ?? team.fg);
  put(g, new THREE.PlaneGeometry(trailerLength - 0.2, 2.6), truckLiveryMaterial(team, true), trailerX, 2.6, W / 2 + 0.01);
  put(g, new THREE.PlaneGeometry(trailerLength - 0.2, 2.6), truckLiveryMaterial(team, false), trailerX, 2.6, -W / 2 - 0.01, Math.PI);
  // Chassi, saia lateral e para-choque traseiro.
  box(g, L - 0.4, 0.35, W - 0.5, 0, 0.75, 0, "#1d1e21");
  box(g, trailerLength - 4, 0.55, W + 0.02, trailerX + 1, 0.6, 0, "#2b2c30");
  box(g, 0.2, 0.3, W, trailerX - trailerLength / 2 - 0.05, 0.5, 0, "#333");
  for (const z of [-W / 2 + 0.3, W / 2 - 0.3]) box(g, 0.08, 0.25, 0.3, trailerX - trailerLength / 2 - 0.02, 1.4, z, { glow: "#ff3020" });
  // Cabine (cara-chata, como as das equipes), com vidro, grade e faróis.
  const cabX = L / 2 - cabLength / 2;
  box(g, cabLength, 2.9, W, cabX, 0.9, 0, team.bg);
  box(g, cabLength - 0.2, 0.5, W - 0.1, cabX - 0.05, 3.8, 0, team.stripes[1] ?? team.fg);
  put(g, new THREE.BoxGeometry(0.06, 1.1, W - 0.3), glass, L / 2 + 0.01, 3.0, 0);
  for (const z of [-W / 2 - 0.01, W / 2 + 0.01]) put(g, new THREE.BoxGeometry(0.9, 0.8, 0.04), glass, cabX + 0.6, 3.0, z);
  box(g, 0.06, 0.8, W - 1.0, L / 2 + 0.01, 1.3, 0, "#1a1a1a");
  for (const z of [-W / 2 + 0.35, W / 2 - 0.35]) box(g, 0.06, 0.25, 0.45, L / 2 + 0.02, 1.1, z, { glow: "#fff4d6" });
  box(g, 0.25, 0.4, W, L / 2 + 0.05, 0.5, 0, "#2b2c30");
  // Rodas (eixo da cabine e o tandem do baú).
  const wheel = new THREE.CylinderGeometry(0.52, 0.52, 0.42, 14).rotateX(Math.PI / 2);
  for (const x of [L / 2 - 1.0, L / 2 - 2.7, trailerX - trailerLength / 2 + 1.6, trailerX - trailerLength / 2 + 2.8, trailerX - trailerLength / 2 + 4.0]) {
    for (const z of [-W / 2 + 0.25, W / 2 - 0.25]) put(g, wheel, "#151515", x, 0.52, z);
  }
  return g;
}

function hoarding(p: SolidProp) {
  const g = frame(p);
  const { w } = p;
  box(g, w, 1.1, 0.12, 0, 0.15, 0, "#e9e6df");
  sponsorPlane(g, w, 0.9, 0, 0.7, 0.07, p.team);
  sponsorPlane(g, w, 0.9, 0, 0.7, -0.07, p.team + 1, Math.PI);
  for (const x of [-w / 2 + 0.4, 0, w / 2 - 0.4]) box(g, 0.2, 0.2, 0.9, x, 0, 0, "#6e6a64");
  return g;
}

/** Asfalto da pista dos boxes, com a faixa branca do lado do muro e a do prédio. */
function pitLane(root: THREE.Group) {
  for (const b of PIT_LANE) {
    const g = new THREE.Group();
    g.position.set(b.x, heightAt(b.x, b.z) + 0.07, b.z);
    g.rotation.y = b.angle;
    put(g, new THREE.PlaneGeometry(b.w + 0.3, b.d).rotateX(-Math.PI / 2), pitAsphalt);
    for (const z of [-b.d / 2 + 0.4, b.d / 2 - 0.4]) put(g, new THREE.PlaneGeometry(b.w + 0.3, 0.25).rotateX(-Math.PI / 2), pitLine, 0, 0.02, z);
    root.add(g);
  }
}

/** Painel da equipe parceira nas duas laterais e uma bandeira na esquina de cada garagem. */
function garageBranding(scene: THREE.Scene) {
  GARAGES.forEach((l, i) => {
    const team = racingTeam(i * 3 + 1);
    const g = new THREE.Group();
    g.position.set(l.x, heightAt(l.x, l.z), l.z);
    g.rotation.y = l.angle + (l.front > 0 ? 0 : Math.PI);
    const panelW = Math.min(l.d - 2, 10);
    for (const side of [-1, 1]) {
      put(g, new THREE.PlaneGeometry(panelW, panelW / 2), teamPanelMaterial(team), side * (l.w / 2 + 0.03), 3.4, -0.5, side * Math.PI / 2);
    }
    featherFlag(g, l.w / 2 + 1.0, l.d / 2 - 0.6, i * 3 + 1);
    featherFlag(g, -l.w / 2 - 1.0, l.d / 2 - 0.6, i * 3 + 2);
    addChunk(scene, merge(wrap(g)), [l.x, l.z], 30);
  });
}

/** Põe o grupo dentro de um grupo vazio (para o `merge` levar a posição junto). */
function wrap(g: THREE.Object3D) {
  const root = new THREE.Group();
  root.add(g);
  return root;
}

/** Desenha tudo: o autódromo num bloco só, os caminhões da cidade cada um no seu. */
export function buildPaddock(scene: THREE.Scene) {
  const autodromo = new THREE.Group();
  let ax = 0;
  let az = 0;
  let count = 0;
  for (const p of SOLID_PROPS) {
    let object: THREE.Group | null = null;
    switch (p.kind) {
      case "arquibancada": object = grandstand(p); break;
      case "muro": object = pitWall(p); break;
      case "boxes": object = pitBuilding(p); break;
      case "placa": object = hoarding(p); break;
      case "caminhao": object = truck(p); break;
      default: break;
    }
    if (!object) continue;
    // Caminhão longe do autódromo: bloco próprio.
    if (p.kind === "caminhao" && !PIT_LANE.some((b) => Math.hypot(b.x - p.x, b.z - p.z) < 90)) {
      addChunk(scene, merge(wrap(object)), [p.x, p.z], 14);
      continue;
    }
    autodromo.add(object);
    ax += p.x;
    az += p.z;
    count++;
  }
  pitLane(autodromo);
  if (count) {
    const center: [number, number] = [ax / count, az / count];
    let radius = 0;
    autodromo.children.forEach((c) => (radius = Math.max(radius, Math.hypot(c.position.x - center[0], c.position.z - center[1]))));
    addChunk(scene, merge(autodromo), center, radius + 30);
  }
  garageBranding(scene);
}
