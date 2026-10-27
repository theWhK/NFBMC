// Partes do HUD desenhadas em canvas 2D: conta-giros e minimapa.
import {
  DISTRICTS,
  LAKE,
  QUAY_Z,
  RACES,
  RACE_IDS,
  ROADS,
  WORLD_BOUNDS,
  carSpec,
  raceMarker,
  type RaceId,
  type Track,
} from "@nfbmc/shared";

import type { CarView } from "./scene.ts";

export interface TachoData {
  speed: number;
  rpm: number;
  gear: number;
  car: string;
  manual: boolean;
}

/**
 * Conta-giros redondo, como no painel do carro: a escala vai até um pouco além
 * da faixa vermelha de cada motor, com luz de troca de marcha, a marcha atual
 * (R na ré) e a velocidade em km/h.
 */
export function createTacho(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const size = canvas.width;
  const c = size / 2;
  const radius = size / 2 - 14;
  // O ponteiro vai de 135° a 405° (sentido horário).
  const start = Math.PI * 0.75;
  const sweep = Math.PI * 1.5;

  return ({ speed, rpm, gear, car, manual }: TachoData) => {
    const spec = carSpec(car);
    const max = Math.ceil((spec.redline + 1000) / 1000) * 1000;
    const angle = (value: number) => start + (value / max) * sweep;
    ctx.clearRect(0, 0, size, size);

    ctx.beginPath();
    ctx.arc(c, c, radius + 8, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(22, 17, 13, 0.78)";
    ctx.fill();

    // Faixa vermelha.
    ctx.beginPath();
    ctx.arc(c, c, radius - 4, angle(spec.redline), angle(max));
    ctx.strokeStyle = "#c1121f";
    ctx.lineWidth = 7;
    ctx.stroke();

    // Marcações a cada 1000 rpm (números) e a cada 500 (tracinhos).
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let value = 0; value <= max; value += 500) {
      const a = angle(value);
      const major = value % 1000 === 0;
      const inner = radius - (major ? 15 : 9);
      ctx.strokeStyle = value >= spec.redline ? "#ff5c5c" : "#f5ebe0";
      ctx.lineWidth = major ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner);
      ctx.lineTo(c + Math.cos(a) * radius, c + Math.sin(a) * radius);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = "#f5ebe0";
        ctx.font = "13px 'Russo One', sans-serif";
        ctx.fillText(String(value / 1000), c + Math.cos(a) * (radius - 27), c + Math.sin(a) * (radius - 27));
      }
    }

    // Arco aceso até o giro atual.
    ctx.beginPath();
    ctx.arc(c, c, radius - 3, start, angle(Math.min(rpm, max)));
    ctx.strokeStyle = rpm > spec.redline * 0.9 ? "#ff3b30" : "#ff7a00";
    ctx.lineWidth = 4;
    ctx.stroke();

    // Ponteiro.
    const a = angle(Math.min(rpm, max));
    ctx.strokeStyle = "#ff3b30";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(a) * (radius - 10), c + Math.sin(a) * (radius - 10));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c, c, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#16110d";
    ctx.fill();

    // Luz de troca: acende perto da faixa vermelha e pisca no limitador.
    const shiftNow = rpm > spec.redline * 0.9;
    const blink = rpm >= spec.redline - 300 && Math.floor(performance.now() / 80) % 2 === 0;
    ctx.beginPath();
    ctx.arc(c, c - radius * 0.55, 7, 0, Math.PI * 2);
    ctx.fillStyle = shiftNow && !blink ? "#7dff6a" : "rgba(125, 255, 106, 0.12)";
    ctx.fill();

    // Velocidade, marcha e tipo de câmbio.
    ctx.fillStyle = "#ffffff";
    ctx.font = "italic 44px 'Russo One', sans-serif";
    ctx.fillText(String(Math.round(Math.abs(speed) * 3.6)), c, c + 44);
    ctx.font = "12px 'Russo One', sans-serif";
    ctx.fillStyle = "#ffc42e";
    ctx.fillText("KM/H", c, c + 70);
    ctx.font = "26px 'Russo One', sans-serif";
    ctx.fillStyle = gear < 0 ? "#ff9a1f" : "#ffffff";
    ctx.fillText(gear < 0 ? "R" : String(gear), c, c - 26);
    ctx.font = "11px 'Russo One', sans-serif";
    ctx.fillStyle = "rgba(245, 235, 224, 0.7)";
    ctx.fillText(manual ? "MANUAL" : "AUTO", c, c - 8);
  };
}

export interface MinimapView {
  cars: Map<string, CarView>;
  myId: string;
  /** Corrida em andamento: o mapa mostra o traçado inteiro. Sem corrida, segue o carro. */
  race: RaceId | null;
  /** Comidas (para o mapa em tela cheia). */
  foods?: { x: number; z: number; active: boolean }[];
}

/** Minimapa redondo: ruas, traçado, pontos de encontro e carros. */
/** Retângulo de cada rua, para o minimapa pular as que estão fora da vista. */
const ROAD_BOXES = ROADS.map((road) => {
  const xs = road.points.map((p) => p[0]);
  const zs = road.points.map((p) => p[1]);
  const pad = road.width;
  return { minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minZ: Math.min(...zs) - pad, maxZ: Math.max(...zs) + pad };
});

export function createMinimap(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const size = canvas.width;
  const raceBounds = new Map<RaceId, { x: number; z: number; radius: number }>();
  for (const id of RACE_IDS) {
    const xs = RACES[id].track.samples.map((s) => s.x);
    const zs = RACES[id].track.samples.map((s) => s.z);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    raceBounds.set(id, { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, radius: Math.max(maxX - minX, maxZ - minZ) / 2 + 25 });
  }

  const drawTrack = (track: Track, scale: number, toMap: (x: number, z: number) => [number, number], color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, width * scale);
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (const s of track.samples) ctx.lineTo(...toMap(s.x, s.z));
    ctx.closePath();
    ctx.stroke();
  };

  return ({ cars, myId, race }: MinimapView) => {
    const me = cars.get(myId);
    const view = race ? raceBounds.get(race)! : { x: me?.x ?? 0, z: me?.z ?? 0, radius: 260 };
    const scale = (size / 2 - 6) / view.radius;
    // Visto de cima com +Z para cima da tela, +X fica à esquerda.
    const toMap = (x: number, z: number): [number, number] => [
      size / 2 - (x - view.x) * scale,
      size / 2 - (z - view.z) * scale,
    ];

    ctx.clearRect(0, 0, size, size);
    // Mar e lago.
    ctx.fillStyle = "#24506e";
    const [, seaY] = toMap(0, QUAY_Z);
    if (seaY < size) ctx.fillRect(0, seaY, size, size - seaY);
    ctx.beginPath();
    ctx.ellipse(...toMap(LAKE.x, LAKE.z), LAKE.rx * scale, LAKE.rz * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    // Ruas, com a largura de cada uma.
    ctx.strokeStyle = "#6b6156";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const [i, road] of ROADS.entries()) {
      // Só as ruas que aparecem no círculo (a cidade grande tem centenas).
      const box = ROAD_BOXES[i];
      if (box.maxX < view.x - view.radius || box.minX > view.x + view.radius || box.maxZ < view.z - view.radius || box.minZ > view.z + view.radius) continue;
      ctx.lineWidth = Math.max(1.5, road.width * scale);
      ctx.beginPath();
      for (const [x, z] of road.points) ctx.lineTo(...toMap(x, z));
      ctx.stroke();
    }
    drawTrack(RACES.autodromo.track, scale, toMap, "#5b5148", RACES.autodromo.track.width);
    if (race) {
      drawTrack(RACES[race].track, scale, toMap, "#ff9a1f", 7 / scale);
      const start = RACES[race].track.samples[0];
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(...toMap(start.x, start.z), 4, 4);
    } else {
      // Pontos de encontro das corridas.
      for (const id of RACE_IDS) {
        const m = raceMarker(id);
        const [mx, my] = toMap(m.x, m.z);
        ctx.fillStyle = "#ff9a1f";
        ctx.beginPath();
        ctx.arc(mx, my, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#16110d";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("🏁", mx, my + 1);
      }
    }

    const drawCar = (car: CarView, radius: number) => {
      ctx.fillStyle = car.color;
      ctx.beginPath();
      ctx.arc(...toMap(car.x, car.z), radius, 0, Math.PI * 2);
      ctx.fill();
    };
    const flash = Math.floor(performance.now() / 160) % 2 === 0;
    for (const [id, car] of cars) {
      if (id === myId || !car.visible) continue;
      // Viaturas piscam vermelho/azul no mapa; o trânsito é só um pontinho cinza.
      if (car.traffic) drawCar({ ...car, color: "#b8b0a4" }, 2);
      else drawCar(car.cop ? { ...car, color: flash ? "#ff2a2a" : "#2a6bff" } : car, car.cop ? 5 : 4);
    }
    if (me?.visible) {
      // Seta na direção do carro.
      const [cx, cy] = toMap(me.x, me.z);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-me.heading);
      ctx.fillStyle = me.color;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(6, 6);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  };
}

export type FullMapView = MinimapView;

/**
 * Mapa da cidade em tela cheia: bairros com nome, ruas na largura certa, lago,
 * mar, corridas, comida e carros. Roda do mouse ou pinça dão zoom; arrastar move.
 */
export function createFullMap(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const bounds = WORLD_BOUNDS;
  let center = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
  let zoom = 1;
  let width = 1;
  let height = 1;
  let ratio = 1;

  const fitScale = () => Math.min(width / (bounds.maxX - bounds.minX + 60), height / (bounds.maxZ - bounds.minZ + 60));
  const scale = () => fitScale() * zoom;
  // Mesma orientação do minimapa: +Z para cima, +X para a esquerda.
  const toMap = (x: number, z: number): [number, number] => [
    width / 2 - (x - center.x) * scale(),
    height / 2 - (z - center.z) * scale(),
  ];

  const resize = () => {
    ratio = Math.min(window.devicePixelRatio, 2);
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  };

  // Zoom e arrasto (mouse e toque).
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStart = 0;
  let zoomStart = 1;
  const setZoom = (value: number) => {
    zoom = Math.max(1, Math.min(14, value));
    // Afastado ao máximo, a cidade inteira volta para o meio da tela.
    if (zoom === 1) center = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
  };
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }, { passive: false });
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
      zoomStart = zoom;
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    const previous = pointers.get(e.pointerId);
    if (!previous) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      if (pinchStart > 0) setZoom(zoomStart * (Math.hypot(a.x - b.x, a.y - b.y) / pinchStart));
    } else {
      // Arrastar move o mapa (o sinal acompanha a orientação invertida do toMap).
      center = { x: center.x + (e.clientX - previous.x) / scale(), z: center.z + (e.clientY - previous.y) / scale() };
    }
  });
  const release = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = 0;
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  const draw = ({ cars, myId, race, foods }: FullMapView) => {
    if (canvas.width !== Math.round((canvas.clientWidth || window.innerWidth) * ratio)) resize();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const s = scale();
    ctx.fillStyle = "#24506e";
    ctx.fillRect(0, 0, width, height);

    // Bairros.
    for (const district of DISTRICTS) {
      ctx.fillStyle = district.ground;
      ctx.beginPath();
      for (const [x, z] of district.polygon) ctx.lineTo(...toMap(x, z));
      ctx.closePath();
      ctx.fill();
    }
    // Lago.
    ctx.fillStyle = "#2f7aa0";
    ctx.beginPath();
    ctx.ellipse(...toMap(LAKE.x, LAKE.z), LAKE.rx * s, LAKE.rz * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // Ruas: borda escura e asfalto por cima.
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const [color, extra] of [["#1b1714", 4], ["#5b5148", 0]] as const) {
      ctx.strokeStyle = color;
      for (const road of ROADS) {
        ctx.lineWidth = Math.max(2, road.width * s) + extra;
        ctx.beginPath();
        for (const [x, z] of road.points) ctx.lineTo(...toMap(x, z));
        ctx.stroke();
      }
    }
    const drawTrack = (track: Track, color: string, lineWidth: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      for (const p of track.samples) ctx.lineTo(...toMap(p.x, p.z));
      ctx.closePath();
      ctx.stroke();
    };
    drawTrack(RACES.autodromo.track, "#5b5148", Math.max(2, RACES.autodromo.track.width * s));
    if (race) drawTrack(RACES[race].track, "#ff9a1f", Math.max(3, 5 * s));

    // Nomes dos bairros.
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.round(14 + 4 * Math.min(zoom, 2))}px 'Black Ops One', sans-serif`;
    for (const district of DISTRICTS) {
      const cx = district.polygon.reduce((sum, p) => sum + p[0], 0) / district.polygon.length;
      const cz = district.polygon.reduce((sum, p) => sum + p[1], 0) / district.polygon.length;
      const [mx, my] = toMap(cx, cz);
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(10, 8, 6, 0.85)";
      ctx.strokeText(district.name.toUpperCase(), mx, my);
      ctx.fillStyle = "rgba(255, 241, 214, 0.9)";
      ctx.fillText(district.name.toUpperCase(), mx, my);
    }

    // Comida (só quando dá para ver: com zoom).
    if (zoom >= 1.6) {
      ctx.font = `${Math.round(10 + zoom * 2)}px sans-serif`;
      for (const food of foods ?? []) if (food.active) ctx.fillText("🍔", ...toMap(food.x, food.z));
    }

    // Corridas.
    if (!race) {
      for (const id of RACE_IDS) {
        const m = raceMarker(id);
        const [mx, my] = toMap(m.x, m.z);
        ctx.fillStyle = "#ff9a1f";
        ctx.beginPath();
        ctx.arc(mx, my, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#16110d";
        ctx.stroke();
        ctx.font = "13px sans-serif";
        ctx.fillText("🏁", mx, my + 1);
        // Com a cidade inteira na tela os nomes se embolam: só aparecem com zoom.
        if (zoom < 2.5) continue;
        ctx.font = "13px 'Russo One', sans-serif";
        ctx.lineWidth = 3;
        ctx.strokeText(RACES[id].name, mx, my - 20);
        ctx.fillStyle = "#ffc42e";
        ctx.fillText(RACES[id].name, mx, my - 20);
      }
    }

    // Carros: trânsito (pontinhos), viaturas (piscando), outros pilotos e você (seta).
    const flash = Math.floor(performance.now() / 160) % 2 === 0;
    for (const [id, car] of cars) {
      if (id === myId || !car.visible) continue;
      const [cx, cy] = toMap(car.x, car.z);
      ctx.beginPath();
      ctx.arc(cx, cy, car.traffic ? 2.5 : car.cop ? 6 : 6, 0, Math.PI * 2);
      ctx.fillStyle = car.traffic ? "#b8b0a4" : car.cop ? (flash ? "#ff2a2a" : "#2a6bff") : car.color;
      ctx.fill();
      if (!car.traffic && !car.cop) {
        ctx.font = "12px 'Russo One', sans-serif";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#16110d";
        ctx.strokeText(car.name, cx, cy - 13);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(car.name, cx, cy - 13);
      }
    }
    const me = cars.get(myId);
    if (me) {
      const [cx, cy] = toMap(me.x, me.z);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-me.heading);
      ctx.fillStyle = me.color;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(10, 10);
      ctx.lineTo(-10, 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  };

  return {
    draw,
    /** Abre centralizado em quem joga, com um pouco de zoom. */
    focus: (x: number, z: number) => {
      resize();
      center = { x, z };
      zoom = 3.5;
    },
  };
}
