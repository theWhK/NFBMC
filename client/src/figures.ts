// Personagens das cinemáticas do modo história: bonecos low-poly feitos só com
// formas simples do Three.js (caixas, cilindros, esferas), no mesmo visual de
// quadrinho do resto (o GameScene transforma em cel-shading). Cada um tem o seu
// "figurino": corpo, roupa, cabelo, chapéu de comida e o que leva na mão.
// A frente do boneco aponta para +Z, como os carros.
import * as THREE from "three";

export type Hat =
  | "crown" | "headband" | "yogurt" | "bowl" | "pastel" | "egg" | "flat" | "roll"
  | "drop" | "tophat" | "bacon" | "cap" | "hood";
export type Prop = "radio" | "lunchbox" | "mic" | "keys" | "shake";

export interface Look {
  skin: string;
  shirt: string;
  pants: string;
  /** Jaqueta por cima da camisa (mangas e laterais). */
  jacket?: string;
  hair?: string;
  hairStyle?: "short" | "bald" | "ponytail" | "long" | "spiky";
  /** Largura do corpo (1 = normal) e barriga (0 = nenhuma). */
  bulk?: number;
  belly?: number;
  height?: number;
  hat?: Hat;
  hatColor?: string;
  beard?: string;
  glasses?: boolean;
  /** Regata (braço de fora, para mostrar o muque). */
  tank?: boolean;
  prop?: Prop;
}

/** Como o boneco está agora (o diretor da cena muda a cada quadro). */
export interface Acting {
  talking?: boolean;
  walking?: boolean;
  /** Braço direito esticado (apontando, entregando a chave). */
  reach?: boolean;
  /** Mãos na cabeça (rendido). */
  handsUp?: boolean;
  /** Braços cruzados (pose de apresentação). */
  crossed?: boolean;
  /** Mão com o objeto (rádio, microfone) perto da boca. */
  toMouth?: boolean;
}

export interface Figure {
  group: THREE.Group;
  update: (dt: number, acting: Acting) => void;
}

const mat = (color: THREE.ColorRepresentation) => new THREE.MeshLambertMaterial({ color });

function part(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, mat(color));
  mesh.position.set(x, y, z);
  return mesh;
}

/** Chapéu (a piada de comida de cada personagem), em cima da cabeça. */
function hat(kind: Hat, color: string | undefined, head: THREE.Group) {
  const add = (m: THREE.Mesh) => head.add(m);
  switch (kind) {
    case "crown": {
      // Coroa do Rei do X-Tudo, com um hambúrguer no meio.
      add(part(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 10, 1, true), color ?? "#f2c14e", 0, 0.22, 0));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(part(new THREE.ConeGeometry(0.04, 0.1, 4), color ?? "#f2c14e", Math.sin(a) * 0.16, 0.31, Math.cos(a) * 0.16));
      }
      add(part(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 10), "#5a3418", 0, 0.24, 0));
      break;
    }
    case "headband":
      add(part(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 12), color ?? "#9be22d", 0, 0.08, 0));
      break;
    case "yogurt":
      add(part(new THREE.CylinderGeometry(0.12, 0.15, 0.2, 12), color ?? "#f4f1e8", 0, 0.26, 0));
      add(part(new THREE.CylinderGeometry(0.13, 0.13, 0.02, 12), "#9bd3ff", 0, 0.37, 0));
      break;
    case "bowl":
      add(part(new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), color ?? "#e63946", 0, 0.32, 0));
      add(part(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 12), "#f2c14e", 0, 0.32, 0));
      break;
    case "pastel": {
      const p = part(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 16, 1, false, 0, Math.PI), color ?? "#e9c46a", 0, 0.24, 0);
      p.rotation.z = Math.PI / 2;
      add(p);
      break;
    }
    case "egg":
      add(part(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 14), "#ffffff", 0, 0.2, 0));
      add(part(new THREE.SphereGeometry(0.08, 10, 6), "#f6b000", 0, 0.23, 0.02));
      break;
    case "flat":
      add(part(new THREE.CylinderGeometry(0.22, 0.24, 0.05, 3), color ?? "#e0a24a", 0, 0.2, 0));
      break;
    case "roll": {
      const r = part(new THREE.TorusGeometry(0.12, 0.05, 6, 14), color ?? "#d98a2b", 0, 0.26, 0);
      r.rotation.x = Math.PI / 2;
      add(r);
      break;
    }
    case "drop":
      add(part(new THREE.SphereGeometry(0.15, 10, 8), color ?? "#d98a2b", 0, 0.24, 0));
      add(part(new THREE.ConeGeometry(0.11, 0.2, 10), color ?? "#d98a2b", 0, 0.42, 0));
      break;
    case "tophat":
      add(part(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 14), color ?? "#2a1a10", 0, 0.17, 0));
      add(part(new THREE.CylinderGeometry(0.13, 0.13, 0.26, 14), color ?? "#2a1a10", 0, 0.3, 0));
      for (const [x, z, c] of [[0.08, 0.1, "#ff5d8f"], [-0.06, 0.11, "#5ad1ff"], [0.11, -0.03, "#ffe14d"]] as const) {
        add(part(new THREE.BoxGeometry(0.03, 0.015, 0.015), c, x, 0.36, z));
      }
      break;
    case "bacon":
      for (let i = 0; i < 3; i++) add(part(new THREE.BoxGeometry(0.36, 0.035, 0.05), i % 2 ? "#f5d0b5" : "#c1442e", 0, 0.08 + i * 0.035, 0.15));
      break;
    case "cap": {
      add(part(new THREE.SphereGeometry(0.17, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), color ?? "#16110d", 0, 0.07, 0));
      add(part(new THREE.BoxGeometry(0.22, 0.02, 0.14), color ?? "#16110d", 0, 0.08, 0.17));
      break;
    }
    case "hood":
      // Capuz: a esfera aberta na frente (o rosto aparece).
      add(part(new THREE.SphereGeometry(0.2, 12, 8, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.62), color ?? "#ff7a00", 0, 0.0, -0.03));
      break;
  }
}

/** O que vai na mão direita. */
function prop(kind: Prop) {
  switch (kind) {
    case "radio": {
      const g = new THREE.Group();
      g.add(part(new THREE.BoxGeometry(0.07, 0.16, 0.04), "#1b1b1b"));
      g.add(part(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 4), "#1b1b1b", 0.02, 0.14, 0));
      return g;
    }
    case "lunchbox":
      return part(new THREE.BoxGeometry(0.26, 0.14, 0.12), "#2a9d4a", 0, -0.05, 0);
    case "mic": {
      const g = new THREE.Group();
      g.add(part(new THREE.CylinderGeometry(0.02, 0.015, 0.16, 6), "#1b1b1b"));
      g.add(part(new THREE.SphereGeometry(0.04, 8, 6), "#5b6470", 0, 0.1, 0));
      return g;
    }
    case "keys": {
      const g = new THREE.Group();
      g.add(part(new THREE.TorusGeometry(0.025, 0.006, 4, 10), "#c9cdd2"));
      g.add(part(new THREE.BoxGeometry(0.015, 0.06, 0.006), "#e0c050", 0, -0.05, 0));
      return g;
    }
    case "shake":
      return part(new THREE.CylinderGeometry(0.05, 0.04, 0.18, 10), "#7fc241", 0, 0.02, 0);
  }
}

/** Monta um boneco (altura ~1,8 m) com o figurino dado. */
export function makeFigure(look: Look): Figure {
  const group = new THREE.Group();
  const body = new THREE.Group();
  const scale = look.height ?? 1;
  body.scale.setScalar(scale);
  group.add(body);
  const bulk = look.bulk ?? 1;
  const top = look.jacket ?? look.shirt;

  // Pernas (giram no quadril).
  const leg = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.1 * bulk, 0.9, 0);
    pivot.add(part(new THREE.BoxGeometry(0.15 * Math.min(bulk, 1.2), 0.82, 0.17), look.pants, 0, -0.41, 0));
    pivot.add(part(new THREE.BoxGeometry(0.16, 0.08, 0.26), "#222222", 0, -0.86, 0.04));
    body.add(pivot);
    return pivot;
  };
  const legL = leg(1);
  const legR = leg(-1);

  // Tronco, barriga e o "V" dos ombros (o Cross-fit é mais largo em cima).
  const torso = new THREE.Group();
  torso.position.y = 0.9;
  body.add(torso);
  torso.add(part(new THREE.BoxGeometry(0.4 * bulk, 0.62, 0.24 * Math.max(1, bulk * 0.8)), look.shirt, 0, 0.31, 0));
  if (look.jacket) {
    for (const side of [-1, 1]) torso.add(part(new THREE.BoxGeometry(0.12 * bulk, 0.6, 0.26 * Math.max(1, bulk * 0.8)), look.jacket, side * 0.15 * bulk, 0.31, 0));
  }
  if (look.belly) torso.add(part(new THREE.SphereGeometry(0.2 * look.belly, 12, 8), look.shirt, 0, 0.18, 0.1 + 0.06 * look.belly));
  torso.add(part(new THREE.CylinderGeometry(0.06, 0.07, 0.08, 8), look.skin, 0, 0.66, 0));

  // Braços (giram no ombro), com a mão e o objeto da direita.
  const arm = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * (0.23 * bulk + 0.04), 0.58, 0);
    const sleeve = look.tank ? look.skin : top;
    const thick = look.tank ? 0.13 * bulk : 0.11 * Math.min(bulk, 1.25);
    pivot.add(part(new THREE.BoxGeometry(thick, 0.58, thick), sleeve, 0, -0.29, 0));
    pivot.add(part(new THREE.SphereGeometry(0.06, 8, 6), look.skin, 0, -0.6, 0));
    torso.add(pivot);
    return pivot;
  };
  const armL = arm(1);
  const armR = arm(-1);
  if (look.prop) {
    const item = prop(look.prop);
    item.position.set(0, -0.66, 0.04);
    armR.add(item);
  }

  // Cabeça: rosto, cabelo, barba, óculos e o chapéu.
  const head = new THREE.Group();
  head.position.y = 0.82;
  torso.add(head);
  head.add(part(new THREE.SphereGeometry(0.15, 14, 10), look.skin, 0, 0.04, 0));
  for (const side of [-1, 1]) head.add(part(new THREE.SphereGeometry(0.022, 6, 4), "#16110d", side * 0.055, 0.07, 0.135));
  const hairColor = look.hair ?? "#2a1a10";
  switch (look.hairStyle ?? "short") {
    case "short":
      head.add(part(new THREE.SphereGeometry(0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), hairColor, 0, 0.06, -0.01));
      break;
    case "spiky":
      for (let i = 0; i < 6; i++) {
        const spike = part(new THREE.ConeGeometry(0.05, 0.14, 5), hairColor, (i % 3 - 1) * 0.07, 0.2, (Math.floor(i / 3) - 0.5) * 0.08);
        spike.rotation.z = (i % 3 - 1) * 0.4;
        head.add(spike);
      }
      break;
    case "ponytail":
      head.add(part(new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hairColor, 0, 0.05, -0.01));
      head.add(part(new THREE.CylinderGeometry(0.05, 0.03, 0.3, 8), hairColor, 0, -0.04, -0.2));
      break;
    case "long":
      head.add(part(new THREE.SphereGeometry(0.165, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), hairColor, 0, 0.04, -0.02));
      head.add(part(new THREE.BoxGeometry(0.3, 0.32, 0.08), hairColor, 0, -0.1, -0.1));
      break;
    case "bald":
      break;
  }
  if (look.beard) head.add(part(new THREE.SphereGeometry(0.13, 10, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), look.beard, 0, 0.0, 0.03));
  if (look.glasses) head.add(part(new THREE.BoxGeometry(0.24, 0.05, 0.03), "#0a0806", 0, 0.08, 0.14));
  if (look.hat) hat(look.hat, look.hatColor, head);

  // Sombra falsa no chão.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.35 * bulk, 16),
    new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.3, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  group.add(shadow);

  let time = Math.random() * 10;
  const ease = (current: number, target: number, dt: number, rate = 10) => current + (target - current) * (1 - Math.exp(-rate * dt));

  return {
    group,
    update(dt, acting) {
      time += dt;
      // Respiração.
      torso.scale.y = 1 + Math.sin(time * 2.2) * 0.012;
      // Pernas: caminhando, balançam.
      const stride = acting.walking ? Math.sin(time * 8) * 0.5 : 0;
      legL.rotation.x = ease(legL.rotation.x, stride, dt);
      legR.rotation.x = ease(legR.rotation.x, -stride, dt);
      // Braços: falando, a direita gesticula e a cabeça acompanha.
      let lx = acting.walking ? -stride * 0.6 : 0;
      let rx = acting.walking ? stride * 0.6 : 0;
      let lz = 0.08;
      let rz = -0.08;
      if (acting.talking) {
        rx = -0.6 - Math.max(0, Math.sin(time * 5.5)) * 0.7;
        lx = -0.2 - Math.max(0, Math.sin(time * 3.7 + 1)) * 0.3;
      }
      if (acting.reach) {
        rx = -1.45;
        rz = 0;
      }
      if (acting.toMouth) {
        rx = -2.3;
        rz = 0.55;
      }
      if (acting.crossed) {
        lx = rx = -1.3;
        lz = -1.0;
        rz = 1.0;
      }
      if (acting.handsUp) {
        lx = rx = -2.9;
        lz = 0.3;
        rz = -0.3;
      }
      armL.rotation.x = ease(armL.rotation.x, lx, dt);
      armR.rotation.x = ease(armR.rotation.x, rx, dt);
      armL.rotation.z = ease(armL.rotation.z, lz, dt);
      armR.rotation.z = ease(armR.rotation.z, rz, dt);
      const nod = acting.talking ? Math.sin(time * 6) * 0.08 : Math.sin(time * 0.7) * 0.03;
      head.rotation.x = ease(head.rotation.x, nod, dt, 14);
      head.rotation.y = ease(head.rotation.y, acting.talking ? Math.sin(time * 1.9) * 0.15 : 0, dt, 4);
      body.position.y = acting.walking ? Math.abs(Math.sin(time * 8)) * 0.04 : 0;
    },
  };
}

/** Elenco do modo história: o figurino de cada personagem, pelo nome que aparece na fala. */
export const CHARACTERS: Record<string, Look> = {
  "Sargento Cross-fit": {
    skin: "#c68a5e", shirt: "#3f8f2a", pants: "#16110d", tank: true, bulk: 1.45, height: 1.06,
    hairStyle: "bald", hat: "headband", hatColor: "#9be22d", glasses: true, prop: "radio",
  },
  Bruno: {
    skin: "#e0ac85", shirt: "#c1121f", pants: "#2e4a6b", bulk: 1.25, belly: 1.3,
    hair: "#2a1a10", beard: "#2a1a10", hat: "crown",
  },
  "Mia Marmita": {
    skin: "#d9a07a", shirt: "#f4f1e8", jacket: "#2a6f97", pants: "#16110d", bulk: 0.88,
    hair: "#16110d", hairStyle: "ponytail", glasses: true, prop: "lunchbox",
  },
  "Você": { skin: "#c68a5e", shirt: "#ff7a00", jacket: "#ff7a00", pants: "#2e4a6b", hair: "#16110d", hat: "hood", hatColor: "#ff7a00" },
  "Repórter": { skin: "#e0ac85", shirt: "#f4f1e8", jacket: "#5b6470", pants: "#3a3a3a", hair: "#7a3e1d", hairStyle: "long", prop: "mic", bulk: 0.9 },
  "Izzy Iogurte": { skin: "#f0c8a8", shirt: "#9bd3ff", pants: "#f4f1e8", hair: "#f2d36b", hairStyle: "long", hat: "yogurt", bulk: 0.88 },
  "Ming Miojo": { skin: "#e8c08a", shirt: "#f2c14e", pants: "#3a3a3a", hair: "#16110d", hairStyle: "spiky", hat: "bowl" },
  "JV Pastel": { skin: "#c68a5e", shirt: "#e9c46a", jacket: "#f4f1e8", pants: "#5b6470", hair: "#2a1a10", hat: "pastel", belly: 0.7 },
  "Vic Virado": { skin: "#b97a50", shirt: "#7a1f1f", pants: "#4a5a3a", hair: "#2a1a10", beard: "#3a2a1a", hat: "egg", bulk: 1.2, belly: 1.1 },
  "Earl Esfiha": { skin: "#c68a5e", shirt: "#f2b705", jacket: "#16110d", pants: "#16110d", hair: "#16110d", hat: "flat", glasses: true },
  "Ronnie Rocambole": { skin: "#e0ac85", shirt: "#d98a2b", jacket: "#3a2a1a", pants: "#16110d", hair: "#a35b2a", hairStyle: "short", hat: "roll" },
  "Kaze Coxinha": { skin: "#e8c08a", shirt: "#2b2d42", pants: "#16110d", hair: "#16110d", hairStyle: "spiky", hat: "drop", glasses: true },
  "Baron Brigadeiro": { skin: "#f0c8a8", shirt: "#f4f1e8", jacket: "#4a2c1d", pants: "#2a1a10", hair: "#9a9590", hat: "tophat", bulk: 1.1, belly: 0.8 },
  "Razor Bacon": { skin: "#d9a07a", shirt: "#16110d", jacket: "#c1442e", pants: "#16110d", hairStyle: "bald", hat: "bacon", beard: "#3a2a1a", bulk: 1.1 },
};

/** Figurino de quem fala (ou do personagem `name`); desconhecido = um piloto qualquer. */
export const lookOf = (name: string): Look =>
  CHARACTERS[name] ?? { skin: "#c68a5e", shirt: "#5b6470", pants: "#16110d" };
