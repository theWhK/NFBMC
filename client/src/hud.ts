// Partes do HUD desenhadas em canvas 2D: conta-giros e minimapa.
import { LAKE, QUAY_Z, RACES, RACE_IDS, ROADS, raceMarker, type RaceId, type Track } from "@nfbmc/shared";

import { gearFor } from "./audio.ts";
import type { CarView } from "./scene.ts";

/** Conta-giros redondo com velocidade digital e marcha, no canto da tela. */
export function createTacho(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const size = canvas.width;
  const c = size / 2;
  const radius = size / 2 - 14;
  // O ponteiro vai de 135° a 405° (sentido horário), como num painel de carro.
  const start = Math.PI * 0.75;
  const sweep = Math.PI * 1.5;

  return (speed: number) => {
    const { gear, rpm } = gearFor(speed);
    ctx.clearRect(0, 0, size, size);

    ctx.beginPath();
    ctx.arc(c, c, radius + 8, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(22, 17, 13, 0.72)";
    ctx.fill();

    // Marcações de 0 a 9 (x1000 rpm) e faixa vermelha no fim.
    for (let i = 0; i <= 9; i++) {
      const a = start + (i / 9) * sweep;
      const inner = radius - 14;
      ctx.strokeStyle = i >= 8 ? "#ff3b30" : "#f5ebe0";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner);
      ctx.lineTo(c + Math.cos(a) * radius, c + Math.sin(a) * radius);
      ctx.stroke();
      ctx.fillStyle = "#f5ebe0";
      ctx.font = "13px 'Russo One', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i), c + Math.cos(a) * (radius - 26), c + Math.sin(a) * (radius - 26));
    }

    // Arco aceso até o giro atual.
    const value = 0.12 + rpm * 0.82;
    ctx.beginPath();
    ctx.arc(c, c, radius - 3, start, start + value * sweep);
    ctx.strokeStyle = value > 0.85 ? "#ff3b30" : "#ff7a00";
    ctx.lineWidth = 6;
    ctx.stroke();

    // Ponteiro.
    const a = start + value * sweep;
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

    ctx.fillStyle = "#ffffff";
    ctx.font = "italic 44px 'Russo One', sans-serif";
    ctx.fillText(String(Math.round(Math.abs(speed) * 3.6)), c, c + 44);
    ctx.font = "12px 'Russo One', sans-serif";
    ctx.fillStyle = "#ffc42e";
    ctx.fillText("KM/H", c, c + 70);
    ctx.font = "20px 'Russo One', sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(speed < -0.5 ? "R" : String(gear), c, c - 38);
  };
}

export interface MinimapView {
  cars: Map<string, CarView>;
  myId: string;
  /** Corrida em andamento: o mapa mostra o traçado inteiro. Sem corrida, segue o carro. */
  race: RaceId | null;
}

/** Minimapa redondo: ruas, traçado, pontos de encontro e carros. */
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
    for (const road of ROADS) {
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
