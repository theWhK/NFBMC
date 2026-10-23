import { fileURLToPath } from "node:url";
import express from "express";
import { defineServer, defineRoom } from "colyseus";
import { ROOM_NAME } from "@nfbmc/shared";

import { RaceRoom } from "./rooms/RaceRoom.ts";
import { checkDatabase } from "./db.ts";

// Build do Vite (client/dist). Em produção o próprio servidor entrega o cliente,
// então o jogo inteiro sai por uma porta só (a que o Cloudflare Tunnel aponta).
const clientDist = process.env.CLIENT_DIST
  ?? fileURLToPath(new URL("../../client/dist", import.meta.url));

const server = defineServer({
  rooms: {
    [ROOM_NAME]: defineRoom(RaceRoom),
  },

  express: (app) => {
    app.get("/healthz", async (_req, res) => {
      try {
        res.json({ status: "ok", db: await checkDatabase() });
      } catch (err) {
        console.error("healthz: falha no banco", err);
        res.status(503).json({ status: "error", db: "unreachable" });
      }
    });

    app.use(express.static(clientDist));
  },
});

export default server;
