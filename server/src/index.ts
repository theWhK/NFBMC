// O Node 24+ roda TypeScript direto (type stripping), então o servidor não tem passo de build.
import { listen } from "colyseus";
import server from "./app.config.ts";
import { ensureSchema } from "./db.ts";
import { flushProfiles } from "./profiles.ts";

try {
  await ensureSchema();
} catch (err) {
  // Banco fora do ar não derruba o jogo: as fichas ficam só em memória até ele voltar.
  console.error("Não foi possível preparar o banco", err);
}

// Grava as fichas pendentes antes de desligar (deploy novo, restart do container).
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    flushProfiles().finally(() => process.exit(0));
  });
}

// Porta 2567, ou a variável PORT.
listen(server);
