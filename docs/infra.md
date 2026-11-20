# Infra do NFBMC: como era e como subir de novo

O projeto foi **arquivado em 2026-11-20**. As duas VMs (`nfbmc-prod` e `nfbmc-dev`) foram destruídas para liberar espaço no Proxmox. O código, a imagem no GHCR e este guia ficam; nada mais roda.

Este documento descreve tudo o que existia **fora** do repositório, para que dê para reconstruir do zero. A arquitetura do jogo (pastas, salas, física, testes) está no [CLAUDE.md](../CLAUDE.md); o deploy da prod passo a passo, no [deploy/README.md](../deploy/README.md).

## Visão geral

```
                    Internet
                       │
        nfbmc.willianhideki.com.br (Cloudflare)
                       │  Cloudflare Tunnel "nfbmc"
                       ▼
┌──────────── host Proxmox (whkserver, 192.168.68.67) ────────────┐
│                                                                 │
│  vmbr1 10.10.10.1/24                 vmbr2 10.10.20.1/24        │
│   └─ VM 120 nfbmc-prod 10.10.10.2      └─ VM 121 nfbmc-dev 10.10.20.2
│        docker compose:                      Node 24, Docker,    │
│        nfbmc-server + postgres              usuário claude,     │
│        + cloudflared                        Claude Remote Control
│                                                                 │
│  nfbmc-fw.sh: NAT para a internet, DROP para LAN/Tailscale/host │
└─────────────────────────────────────────────────────────────────┘
        ▲ SSH e preview (5173/2567) só pelo Tailscale (tag:nfbmc)

GitHub theWhK/NFBMC: PR → main → Actions publica ghcr.io/thewhk/nfbmc:latest
→ timer da prod puxa a cada 5 min
```

As VMs só falam com a internet. Não enxergam a LAN de casa, o host, as outras VMs nem a tailnet; quem entra nelas é o Will, pelo Tailscale.

## 1. Rede no host Proxmox

Arquivos salvos em [`deploy/proxmox/`](../deploy/proxmox/):

- `nfbmc-fw.sh` → `/usr/local/sbin/nfbmc-fw.sh` (`chmod 755`). Para cada bridge: `MASQUERADE` saindo por `vmbr0`, `DROP` de 10/8, 172.16/12, 192.168/16, 100.64/10 (Tailscale) e 169.254/16, e `DROP` de tudo que chega no host por essa bridge (IPv4 e IPv6). IPv6 não é encaminhado.
- `interfaces.vmbr1-vmbr2` → acrescentar ao `/etc/network/interfaces`. Duas bridges sem porta física, que chamam o script em `post-up`/`post-down`.

Depois: `ifreload -a`. O host tem `pve-firewall` ligado em outras VMs (100–108); nas VMs do NFBMC a opção **Firewall** da placa de rede fica **desmarcada**, porque o isolamento vem do script.

Teste de isolamento (de dentro da VM): `curl -I https://example.com` funciona; `ping 192.168.68.1`, `ping 10.10.10.1`/`10.10.20.1` e `ping` de outra VM falham. Repetir depois de reiniciar o host.

## 2. As VMs

Ubuntu Server 24.04, criadas na mão pela interface do Proxmox:

| | VM 120 `nfbmc-prod` | VM 121 `nfbmc-dev` |
|---|---|---|
| Bridge / IP fixo | vmbr1, 10.10.10.2/24, gateway 10.10.10.1 | vmbr2, 10.10.20.2/24, gateway 10.10.20.1 |
| CPU / RAM | 2 núcleos (`host`), 2 GB | 4 núcleos (`host`), 8 GB |
| Disco | 30 GB em `local-lvm` (discard, ssd, iothread) | 60 GB em `local-lvm` |
| Outros | q35, virtio-scsi-single, QEMU agent, liga no boot | igual |
| Usuário Linux | `nfbmc-prod` | `nfbmc-dev` |

DNS: qualquer resolvedor público (a VM não alcança o roteador de casa).

Sem snapshot nem backup do Proxmox: decisão do Will, os dados não são sensíveis.

Endurecimento nas duas:

- SSH só com chave, sem root: drop-in `/etc/ssh/sshd_config.d/00-nfbmc.conf` com `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no`.
- `ufw default deny incoming`; liberado só em `tailscale0`: porta 22 (e, na dev, 5173 e 2567 para o preview).
- `unattended-upgrades`.

No `~/.ssh/config` do Mac havia `Host nfbmc-prod` / `Host nfbmc-dev` com `User` igual ao nome da VM (o host é resolvido pelo MagicDNS do Tailscale).

## 3. Tailscale

- As duas VMs entram na tailnet com `tailscale up --advertise-tags=tag:nfbmc`.
- ACL (grants): só `autogroup:member` e `autogroup:shared` são origem. Ou seja, o Will chega nas VMs, mas as VMs com `tag:nfbmc` não iniciam conexão com nada da tailnet (o `homeassistant` é subnet router e exit node da LAN, e não pode virar porta dos fundos).
- Para testar o isolamento use `ping` comum; `tailscale ping` ignora a ACL.
- Na reconstrução, tirar as máquinas antigas do painel do Tailscale antes, senão os nomes viram `nfbmc-prod-1`.

## 4. Cloudflare

- Tunnel `nfbmc` (Zero Trust → Networks → Tunnels), conector rodando no compose da prod (`cloudflared` com `TUNNEL_TOKEN`).
- Rota pública: `nfbmc.willianhideki.com.br` → `http://nfbmc-server:2567` (nome do serviço na rede interna do compose).
- O token fica no 1Password do Will; nunca no repo nem no chat.
- Nenhuma porta da prod é publicada: o único caminho de entrada é o tunnel.

## 5. Produção (VM 120)

Bootstrap:

1. Docker Engine + plugin compose (repositório oficial da Docker).
2. Usuário de sistema `deploy`: `sudo useradd --system --create-home --home-dir /opt/nfbmc --shell /usr/sbin/nologin -G docker deploy` e `chmod 750 /opt/nfbmc`.
3. Swap de 2 GB (o `/swap.img` do instalador).
4. Reboot automático às 04:00 (`Unattended-Upgrade::Automatic-Reboot "true"` e `Automatic-Reboot-Time "04:00"`).
5. Seguir o [deploy/README.md](../deploy/README.md): copiar compose e timers, criar `/opt/nfbmc/.env`, `docker login ghcr.io` do `deploy` (classic PAT só com `read:packages` da conta `theWhK`) e ligar os timers.

Timers: `nfbmc-update` (pull + `up -d` a cada 5 min) e `nfbmc-backup` (`pg_dump` às 03:30, guarda 14 dias em `/opt/nfbmc/backups`).

Banco: tabelas `players` (ficha de cada jogador: nome, calorias, corridas, vitórias, melhor corrida, pela chave `token` que fica no navegador) e `synced_entries`. São criadas sozinhas pelo servidor (`server/src/db.ts`). Para restaurar um dump: veja o comentário no topo de `deploy/nfbmc-backup.sh`.

## 6. Dev (VM 121)

Era onde o Claude Code trabalhava sozinho, pelo Remote Control.

1. Node 24 (NodeSource), Docker, `git`, `tmux`, `gh`, dependências do Playwright (`npx playwright install --with-deps chromium`).
2. Usuário `claude` (grupo `docker`, **sem sudo**), com o repo clonado em `~/nfbmc`.
3. `gh` autenticado com um **classic PAT de escopo `repo` (sem `workflow`)** da conta bot do GitHub `nfbmc`, que é colaboradora **Write** do repo. Sem `workflow`, o agente não consegue mexer em `.github/workflows/`; a proteção da `main` exige PR aprovado pelo Will.
4. Claude Code instalado para o `claude`, e o serviço systemd `claude-rc.service` abrindo uma sessão tmux `rc` com `claude remote-control --spawn worktree --permission-mode auto` dentro de `~/nfbmc`.
5. Preview: `npm run dev` na dev; o Will abria `http://nfbmc-dev:5173` pelo Tailscale.

## 7. GitHub

- Repo `theWhK/NFBMC`, `main` protegida (PR com aprovação, CI obrigatório).
- `ci.yml`: typecheck + Playwright em todo PR. `release.yml`: em push na `main`, publica `ghcr.io/thewhk/nfbmc:latest` e `:sha-<commit>`.
- A última imagem continua no GHCR (`ghcr.io/thewhk/nfbmc:latest` e `:sha-*`), mas o pacote é **privado**: para puxar, `docker login ghcr.io -u theWhK` com um classic PAT `read:packages`.

## Subir de novo

**Só para jogar ou mostrar, sem VM nenhuma** (qualquer máquina com Docker, na raiz do repo):

```bash
docker build -t nfbmc .
docker run --rm -p 2567:2567 nfbmc
```

(Ou, com login no GHCR, `docker run --rm -p 2567:2567 ghcr.io/thewhk/nfbmc:latest`, sem buildar.) Abra http://localhost:2567. Sem `DATABASE_URL`, roda sem Postgres (as fichas dos jogadores ficam só no navegador).

**Desenvolvimento local:** `npm install` e `npm run dev` (ver [README](../README.md)).

**Infra completa como era:** seções 1 a 7 nesta ordem: rede no host, VMs, Tailscale, Cloudflare (o tunnel pode ser reaproveitado se não tiver sido apagado; senão crie outro e troque o token), prod, dev. Antes de abrir para a galera, confira `https://nfbmc.willianhideki.com.br/healthz` com `"db":"ok"`.

## O que foi desligado no arquivamento

Lista para conferir (marcada pelo Will):

- [ ] Último dump do banco da prod copiado para fora da VM (fica fora do repo: tem os tokens dos jogadores)
- [ ] Trabalho não enviado na dev conferido (`git log --branches --not --remotes` e `git status` nos worktrees do usuário `claude`)
- [ ] VMs 120 e 121 destruídas com os discos (`qm destroy <id> --purge --destroy-unreferenced-disks 1`)
- [ ] Bridges `vmbr1`/`vmbr2` tiradas do `/etc/network/interfaces` e `/usr/local/sbin/nfbmc-fw.sh` apagado
- [ ] Máquinas removidas do Tailscale (e a `tag:nfbmc` da ACL, se quiser)
- [ ] Tunnel `nfbmc` e o registro DNS `nfbmc.willianhideki.com.br` apagados na Cloudflare
- [ ] PATs revogados: `read:packages` (conta `theWhK`, usado pela prod) e `repo` (conta bot `nfbmc`, usado pela dev)
- [ ] Repo arquivado no GitHub (Settings → Archive), se quiser deixar só leitura
