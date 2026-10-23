# 🍔 Need for Burgers: Most Calories

Jogo de corrida multiplayer de browser, paródia de Need for Speed com tema de comida.

**Jogar:** https://nfbmc.willianhideki.com.br

## Desenvolvimento

Requer Node 24+ e Docker.

```bash
npm install
npm run dev        # servidor em :2567 e cliente em :5173
npm run test:e2e   # teste de ponta a ponta com duas abas
```

Detalhes de arquitetura, regras de contribuição e comandos estão em [CLAUDE.md](CLAUDE.md). O deploy da produção está em [deploy/README.md](deploy/README.md).

## Como chega na produção

```
PR aprovado → merge na main → GitHub Actions publica ghcr.io/thewhk/nfbmc:latest
→ nfbmc-prod puxa a imagem nova em até 5 minutos → Cloudflare Tunnel → jogadores
```
