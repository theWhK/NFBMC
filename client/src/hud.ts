// Partes do HUD desenhadas em canvas 2D: conta-giros e minimapa.
import { TRACK } from "@nfbmc/shared";

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

/** Minimapa redondo com a pista e os carros. */
export function createMinimap(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const size = canvas.width;
  const xs = TRACK.samples.map((s) => s.x);
  const zs = TRACK.samples.map((s) => s.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const scale = (size - 40) / Math.max(maxX - minX, maxZ - minZ);
  // Visto de cima com +Z para cima da tela, +X fica à esquerda.
  const toMap = (x: number, z: number): [number, number] => [
    size / 2 - (x - (minX + maxX) / 2) * scale,
    size / 2 - (z - (minZ + maxZ) / 2) * scale,
  ];

  return (cars: Map<string, CarView>, myId: string) => {
    ctx.clearRect(0, 0, size, size);
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#8a7a66";
    ctx.lineWidth = TRACK.width * scale;
    ctx.beginPath();
    for (const s of TRACK.samples) ctx.lineTo(...toMap(s.x, s.z));
    ctx.closePath();
    ctx.stroke();

    const start = TRACK.samples[0];
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(...toMap(start.x, start.z), 3, 3);

    const drawCar = (car: CarView, radius: number) => {
      ctx.fillStyle = car.color;
      ctx.beginPath();
      ctx.arc(...toMap(car.x, car.z), radius, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const [id, car] of cars) if (id !== myId && car.visible) drawCar(car, 4);
    const me = cars.get(myId);
    if (me?.visible) {
      drawCar(me, 6);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  };
}
