# 🍔 Need for Burgers: Most Calories

Jogo de corrida multiplayer de browser, paródia de Need for Speed com tema de comida.

> **Projeto arquivado em 2026-11-20.** O site e as VMs foram desligados. Para jogar de novo numa máquina com Docker: `docker build -t nfbmc . && docker run --rm -p 2567:2567 nfbmc` e abra http://localhost:2567. Como a infra era e como reconstruí-la: [docs/infra.md](docs/infra.md).

~~**Jogar:** https://nfbmc.willianhideki.com.br~~ (fora do ar)

## Desenvolvimento

Requer Node 24+ e Docker.

```bash
npm install
npm run dev        # servidor em :2567 e cliente em :5173
npm run test:e2e   # teste de ponta a ponta com duas abas
```

Detalhes de arquitetura, regras de contribuição e comandos estão em [CLAUDE.md](CLAUDE.md). O deploy da produção está em [deploy/README.md](deploy/README.md), e a infra inteira (Proxmox, Tailscale, Cloudflare, VMs) em [docs/infra.md](docs/infra.md).

## Como chega na produção

```
PR aprovado → merge na main → GitHub Actions publica ghcr.io/thewhk/nfbmc:latest
→ nfbmc-prod puxa a imagem nova em até 5 minutos → Cloudflare Tunnel → jogadores
```
