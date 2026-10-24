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
client/   cliente Vite + TypeScript + Three.js (@nfbmc/client)
e2e/      testes Playwright (duas abas = dois jogadores)
deploy/   systemd e instruções de deploy da prod (feito pelo Will, não pelo agente)
```

- O servidor roda TypeScript direto no Node 24+ (type stripping), **sem passo de build**. Por isso: imports relativos com extensão `.ts`, `import type` para tipos, e nada de sintaxe que não seja só apagável (sem `enum`, sem `namespace`, sem parameter properties). O `tsconfig.base.json` (`erasableSyntaxOnly`) acusa isso.
- O estado da sala usa a API `schema({...})` do `@colyseus/schema` 5, sem decorators.
- O servidor é autoritativo: o cliente manda só a intenção (por exemplo, a direção), e o servidor calcula as posições.
- Em produção, o servidor também entrega o build do cliente (`client/dist`), então tudo sai pela porta 2567.
- O jogo é 3D com **Three.js** (decidido com o Will). Os modelos são feitos com formas simples do próprio Three.js, sem arquivos externos. Não troque a engine nem adicione outra biblioteca grande sem combinar.
- Ambientação: paródia do Need for Speed Most Wanted (fim de tarde alaranjado, cidade, "Lista Gorda", Vigilância Sanitária no lugar da polícia). Logo em `client/src/logo.ts` (SVG feito à mão, sem copiar marca de ninguém).
- Som e música são **sintetizados no código** com Web Audio (`client/src/audio.ts` e `client/src/music.ts`), sem arquivos de áudio nem música de terceiros. Fontes: Russo One e Black Ops One (OFL), via `@fontsource`.
- A cena reduz a resolução sozinha quando o FPS cai (o Chromium headless dos testes desenha na CPU, a ~30 FPS). Ao deixar a cena mais pesada, confira que o `npm run test:e2e` não ficou muito mais lento.
- O mundo fica no plano XZ (Y para cima). A pista, a física do carro e as regras (voltas, comida, bônus) ficam em `shared/` para o servidor e o cliente usarem as mesmas contas.
- Fluxo da sala (`server/src/rooms/RaceRoom.ts`): `lobby` → alguém aperta "Começar" → `countdown` → `racing` → `results` → `lobby`. Quem entra no meio espera a próxima corrida.
- **Mundo aberto (Porto Gordo)**: a planta é desenhada à mão em `shared/src/map.ts` (cruzamentos `NODES`, ruas `EDGES` retas ou curvas com largura por tipo, bairros `DISTRICTS`, lago e cais). `shared/src/world.ts` gera o resto com semente fixa, igual no servidor e no cliente: prédios/casas/galpões/contêineres alinhados às ruas (caixas giradas, com colisão), árvores (com colisão), comida, o grafo de ruas (`NAV`, `routeBetween`) e as corridas.
- Corridas novas entram em `RACES`: o autódromo usa `splinePath`; as de rua usam `routeTrack([...cruzamentos])`, que segue as ruas e suaviza as esquinas. Ao mexer na planta, rode uma checagem (corridas só em rua, nenhuma rua cruzando outra sem cruzamento) e veja o mapa de cima antes de commitar.
- Salas: `world` (`WorldRoom`: todo mundo circula, come nas barraquinhas e dispara corridas nos pontos de encontro) e `race` (`RaceRoom`). Quem dispara uma corrida no mundo leva todos que estão no ponto: o servidor cria uma `RaceRoom` em modo **evento** (`matchMaker.createRoom`), manda `goRace` com o id da sala, ela larga sozinha e no fim manda `backToWorld`. As calorias ficam na ficha do jogador (`server/src/profiles.ts`), identificada por um token que o cliente guarda no `localStorage`.
- **Vigilância Sanitária** (a "polícia"): regras em `POLICE` (`shared/src/index.ts`), viaturas em `server/src/rooms/cops.ts` (navegam pelo grafo de ruas e vão direto quando enxergam o alvo; ficam mais rápidas com o nível) e a lógica de procurado/fuga/autuação no `WorldRoom`. Comer na rua e bater em viatura esquentam; perseguido não dispara corrida.
- **Trânsito** (`server/src/rooms/traffic.ts`): carros NPC que andam na mão direita pelo grafo de ruas, escolhem caminhos ao acaso nos cruzamentos e freiam atrás de quem está na frente. Aparecem perto dos jogadores (atrás deles, se for perto) e somem longe; bater forte neles esquenta o nível de procurado.
- Ganchos de teste no servidor só com `NFBMC_TEST_HOOKS=1` (o Playwright liga; produção nunca): as mensagens `debugHeat` (nível de procurado) e `debugCalories` (calorias da ficha).
- Corrida rápida (fora do mundo): **multiplayer** (`joinOrCreate`, a sala pública da galera) e **solo** (`create` com `{ solo: true }`: sala privada de um jogador só, que começa com bots).
- Menu principal no estilo do Most Wanted 2005 (`client/src/menu.ts`): lista à esquerda navegável por teclado (↑↓, Enter, Esc) e mouse, telas laterais (corrida rápida, Lista Gorda com os rivais `RIVALS`, Garagem, Opções, Créditos) e o carro do jogador girando na vitrine (`GameScene.setShowcase`). A cor escolhida na Garagem vai como `color` ao entrar nas salas (`pickColor` no servidor respeita se estiver livre).
- Celular (`client/src/touch.ts`): em aparelho de toque o `body` ganha a classe `touch` e aparecem os controles na tela (botões com `data-key` que viram teclas virtuais `Touch*`, multitoque). Ao entrar no jogo pede tela cheia e trava na horizontal (onde o navegador deixa); em pé, durante o jogo, aparece o aviso para girar. O layout para celular deitado fica nas regras `@media (max-height: 520px)` e `body.touch` do CSS.
- Cliente: `main.ts` cuida das trocas de sala; `world-mode.ts` e `race-mode.ts` têm a lógica de cada modo; `net.ts` tem as conexões. `?spawn=<corrida>` na URL faz nascer direto num ponto de encontro (usado nos testes).
- Bots (`server/src/rooms/bots.ts`) rodam no servidor e "apertam os mesmos botões" que um jogador: a IA devolve um `DriveInput` e a física é a mesma. Eles entram na contagem e saem quando a sala volta ao lobby (ids `bot-N`, `player.bot = true`). A dificuldade muda a velocidade e a gula (comida dá turbo e calorias). Para calibrar a IA, simule fora do jogo com `stepCar` antes de testar na sala.

## Comandos

| Comando | O que faz |
|---|---|
| `npm install` | instala tudo (workspaces) |
| `npm run dev` | servidor (2567, com `--watch`) e Vite (5173) juntos |
| `npm run db:up` / `npm run db:down` | Postgres de dev no Docker (porta `DEV_PG_PORT`, padrão 5432) |
| `npm run typecheck` | `tsc` em todos os pacotes |
| `npm run test:e2e` | builda o cliente, sobe o servidor e roda o Playwright |
| `npm run build` | build do cliente em `client/dist` |

O banco é opcional: sem `DATABASE_URL`, o servidor roda sem Postgres, o `/healthz` responde `"db":"disabled"` e as fichas dos jogadores ficam só em memória.

O esquema é criado pelo próprio servidor ao iniciar (`ensureSchema` em `server/src/db.ts`, idempotente). Hoje há uma tabela, `players` (ficha por token: calorias, corridas, vitórias, melhor corrida), gravada em lote a cada 5 s por `server/src/profiles.ts`. Mudanças de esquema entram como comandos novos no `ensureSchema`, sem apagar dados. `GET /api/lista-gorda` devolve o top 10 de todos os tempos. Com o banco de dev: `DATABASE_URL=postgres://nfbmc:nfbmc@127.0.0.1:5432/nfbmc npm run dev`.

## Preview na nfbmc-dev

O Will acessa pelo Tailscale: http://nfbmc-dev:5173 (Vite), que conecta no servidor em `nfbmc-dev:2567`. As duas portas estão liberadas no `ufw` só para a interface `tailscale0`.

## Testes com Playwright

- Os testes ficam em `e2e/`. Use um `browser.newContext()` por jogador.
- O cliente expõe `window.__nfbmc` (`sessionId`, `mode()`, `raceId()`, `phase()`, `players()`, `police()` (viaturas e trânsito) e `send()`) para os testes lerem o estado sem depender do canvas. Mantenha esse gancho funcionando quando mexer no cliente.
- Os testes rodam um de cada vez (`workers: 1`), porque compartilham o servidor e as salas públicas.
- Para entrar no jogo, o teste preenche `name-input` e clica em `world-button`/`world-solo-button`, ou abre `quick-menu` e clica em `join-button`/`solo-button` (veja `join()` em `e2e/corrida.spec.ts`).
- Prefira `expect.poll` e `toHaveText` a `waitForTimeout` para esperar a sincronização.
