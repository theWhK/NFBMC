import { ColyseusSDK } from "@colyseus/sdk";
import type server from "@nfbmc/server/app.config";
import { PLAYER_SIZE, ROOM_NAME, WORLD, type InputMessage } from "@nfbmc/shared";

const statusEl = document.getElementById("status")!;
const countEl = document.getElementById("player-count")!;
const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

// Em produção o cliente é servido pelo próprio servidor do jogo (mesma origem).
// Em dev o Vite roda na 5173 e o servidor na 2567, na mesma máquina.
const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
const endpoint = import.meta.env.DEV
  ? `${wsProtocol}://${location.hostname}:2567`
  : `${wsProtocol}://${location.host}`;

const client = new ColyseusSDK<typeof server>(endpoint);

const keys = new Set<string>();
const KEYMAP: Record<string, [number, number]> = {
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
};

function currentInput(): InputMessage {
  let x = 0;
  let y = 0;
  for (const code of keys) {
    const dir = KEYMAP[code];
    if (dir) {
      x += dir[0];
      y += dir[1];
    }
  }
  return { x: Math.sign(x), y: Math.sign(y) };
}

async function main() {
  const room = await client.joinOrCreate(ROOM_NAME);
  statusEl.textContent = "Conectado";

  // Gancho para os testes e2e (Playwright) lerem o estado sem depender do canvas.
  window.__nfbmc = {
    sessionId: room.sessionId,
    players: () => {
      const snapshot: Record<string, { x: number; y: number }> = {};
      room.state.players?.forEach((p, id) => (snapshot[id] = { x: p.x, y: p.y }));
      return snapshot;
    },
  };

  let lastSent = "";
  const sendInput = () => {
    const input = currentInput();
    const serialized = JSON.stringify(input);
    if (serialized === lastSent) return;
    lastSent = serialized;
    room.send("input", input);
  };

  window.addEventListener("keydown", (e) => {
    if (!(e.code in KEYMAP)) return;
    e.preventDefault();
    keys.add(e.code);
    sendInput();
  });
  window.addEventListener("keyup", (e) => {
    keys.delete(e.code);
    sendInput();
  });
  window.addEventListener("blur", () => {
    keys.clear();
    sendInput();
  });

  room.onLeave(() => {
    statusEl.textContent = "Desconectado. Recarregue a página.";
  });

  const render = () => {
    ctx.clearRect(0, 0, WORLD.width, WORLD.height);
    let count = 0;
    room.state.players?.forEach((player, id) => {
      count++;
      ctx.fillStyle = player.color;
      ctx.fillRect(player.x, player.y, PLAYER_SIZE, PLAYER_SIZE);
      if (id === room.sessionId) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.strokeRect(player.x, player.y, PLAYER_SIZE, PLAYER_SIZE);
      }
    });
    countEl.textContent = String(count);
    requestAnimationFrame(render);
  };
  render();
}

main().catch((err) => {
  console.error(err);
  statusEl.textContent = "Não foi possível conectar ao servidor.";
});

declare global {
  interface Window {
    __nfbmc?: {
      sessionId: string;
      players: () => Record<string, { x: number; y: number }>;
    };
  }
}
