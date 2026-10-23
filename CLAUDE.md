# NFBMC: Need for Burgers: Most Calories

Jogo de browser multiplayer, paródia de Need for Speed com tema de comida, para um grupo pequeno de amigos não técnicos. Eles entram por https://nfbmc.willianhideki.com.br, sem login e sem instalar nada.

Fale com o Will em português do Brasil. Comentários de código, títulos e descrições de PR também em português.

## Regras (não negociáveis)

- **Nunca faça commit ou push na `main`.** Todo trabalho acontece em uma branch (`feat/...`, `fix/...`, `chore/...`) e chega na `main` só por PR, que o Will revisa e aprova.
- **Nunca faça merge do próprio PR**, nem tente contornar a proteção da `main`.
- **Não altere `.github/workflows/`.** O seu token não tem permissão para isso, e o pipeline é responsabilidade do Will. Se achar que um workflow precisa mudar, explique no PR.
- **Nenhum segredo no repositório**: nada de tokens, senhas ou `.env` real. O `.env.example` só tem nomes de variáveis.
- **Você não tem acesso à produção** (nfbmc-prod) e não deve tentar ter. O deploy acontece sozinho depois do merge: GitHub Actions publica a imagem no GHCR e a prod puxa.
- Antes de abrir um PR, rode `npm run typecheck` e `npm run test:e2e`, e diga no PR o que testou.

## Estrutura

```
shared/   constantes e tipos usados pelo servidor e pelo cliente (@nfbmc/shared)
server/   servidor Node + Colyseus 0.18, porta 2567 (@nfbmc/server)
client/   cliente Vite + TypeScript, canvas 2D por enquanto (@nfbmc/client)
e2e/      testes Playwright (duas abas = dois jogadores)
deploy/   systemd e instruções de deploy da prod (feito pelo Will, não pelo agente)
```

- O servidor roda TypeScript direto no Node 24+ (type stripping), **sem passo de build**. Por isso: imports relativos com extensão `.ts`, `import type` para tipos, e nada de sintaxe que não seja só apagável (sem `enum`, sem `namespace`, sem parameter properties). O `tsconfig.base.json` (`erasableSyntaxOnly`) acusa isso.
- O estado da sala usa a API `schema({...})` do `@colyseus/schema` 5, sem decorators.
- O servidor é autoritativo: o cliente manda só a intenção (por exemplo, a direção), e o servidor calcula as posições.
- Em produção, o servidor também entrega o build do cliente (`client/dist`), então tudo sai pela porta 2567.
- A engine gráfica ainda não foi escolhida (Three.js ou Phaser, depende de o jogo ser 3D ou 2D). Não introduza uma sem combinar com o Will.

## Comandos

| Comando | O que faz |
|---|---|
| `npm install` | instala tudo (workspaces) |
| `npm run dev` | servidor (2567, com `--watch`) e Vite (5173) juntos |
| `npm run db:up` / `npm run db:down` | Postgres de dev no Docker (porta `DEV_PG_PORT`, padrão 5432) |
| `npm run typecheck` | `tsc` em todos os pacotes |
| `npm run test:e2e` | builda o cliente, sobe o servidor e roda o Playwright |
| `npm run build` | build do cliente em `client/dist` |

O banco é opcional: sem `DATABASE_URL`, o servidor roda sem Postgres e o `/healthz` responde `"db":"disabled"`. Com o banco de dev: `DATABASE_URL=postgres://nfbmc:nfbmc@127.0.0.1:5432/nfbmc npm run dev`.

## Preview na nfbmc-dev

O Will acessa pelo Tailscale: http://nfbmc-dev:5173 (Vite), que conecta no servidor em `nfbmc-dev:2567`. As duas portas estão liberadas no `ufw` só para a interface `tailscale0`.

## Testes com Playwright

- Os testes ficam em `e2e/`. Use um `browser.newContext()` por jogador.
- O cliente expõe `window.__nfbmc` (`sessionId` e `players()`) para os testes lerem o estado sem depender do canvas. Mantenha esse gancho funcionando quando mexer no cliente.
- Prefira `expect.poll` e `toHaveText` a `waitForTimeout` para esperar a sincronização.
