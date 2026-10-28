import { fileURLToPath } from "node:url";
import express from "express";
import { defineServer, defineRoom } from "colyseus";
import { ROOM_NAME, WORLD_ROOM_NAME } from "@nfbmc/shared";

import { RaceRoom } from "./rooms/RaceRoom.ts";
import { WorldRoom } from "./rooms/WorldRoom.ts";
import { checkDatabase } from "./db.ts";
import { onlinePilots } from "./presence.ts";
import { listaGorda, peekProfile, syncProfile } from "./profiles.ts";

// Build do Vite (client/dist). Em produção o próprio servidor entrega o cliente,
// então o jogo inteiro sai por uma porta só (a que o Cloudflare Tunnel aponta).
const clientDist = process.env.CLIENT_DIST
  ?? fileURLToPath(new URL("../../client/dist", import.meta.url));

const server = defineServer({
  rooms: {
    // A sala pública da corrida rápida é uma por pista.
    [ROOM_NAME]: defineRoom(RaceRoom).filterBy(["raceId"]),
    [WORLD_ROOM_NAME]: defineRoom(WorldRoom),
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

    // Lista Gorda de todos os tempos (o menu mostra). Liberada para outras origens
    // porque em dev o cliente roda na porta 5173.
    app.get("/api/lista-gorda", async (_req, res) => {
      res.set("Access-Control-Allow-Origin", "*");
      try {
        res.json(await listaGorda(10));
      } catch (err) {
        console.error("lista-gorda: falha no banco", err);
        res.status(503).json([]);
      }
    });

    // Quem está jogando agora e onde (o menu e o mapa do co-op mostram).
    app.get("/api/online", (_req, res) => {
      res.set("Access-Control-Allow-Origin", "*");
      res.json(onlinePilots());
    });

    // Ficha de um jogador (o menu mostra as calorias dele no rodapé).
    app.get("/api/ficha/:token", async (req, res) => {
      res.set("Access-Control-Allow-Origin", "*");
      try {
        const profile = await peekProfile(req.params.token);
        if (profile) res.json(profile);
        else res.status(404).json(null);
      } catch (err) {
        console.error("ficha: falha no banco", err);
        res.status(503).json(null);
      }
    });

    // Progresso feito offline (PWA): o aparelho manda os lançamentos guardados
    // quando a internet volta. Cada um tem id e só conta uma vez.
    app.options("/api/sync", (_req, res) => {
      res.set({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST" });
      res.sendStatus(204);
    });
    app.post("/api/sync", express.json({ limit: "64kb" }), async (req, res) => {
      res.set("Access-Control-Allow-Origin", "*");
      try {
        const name = typeof req.body?.name === "string" ? req.body.name.slice(0, 16) : "Piloto";
        const result = await syncProfile(req.body?.token, name || "Piloto", req.body?.entries);
        if (result) res.json(result);
        else res.status(400).json(null);
      } catch (err) {
        console.error("sync: falha", err);
        res.status(503).json(null);
      }
    });

    // O service worker e a página não podem ficar presos em cache (senão a
    // versão nova não chega); os arquivos com hash no nome podem.
    app.use(express.static(clientDist, {
      setHeaders: (res, path) => {
        if (/(sw\.js|index\.html|manifest\.webmanifest)$/.test(path)) res.set("Cache-Control", "no-cache");
      },
    }));
  },
});

export default server;
