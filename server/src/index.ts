// O Node 24+ roda TypeScript direto (type stripping), então o servidor não tem passo de build.
import { listen } from "colyseus";
import server from "./app.config.ts";

// Porta 2567, ou a variável PORT.
listen(server);
