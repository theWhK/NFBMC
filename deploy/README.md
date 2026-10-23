# Deploy na nfbmc-prod

Passos feitos **pelo Will**, uma vez. O agente nunca tem acesso à prod nem a estes segredos.

Pré-requisitos já feitos no bootstrap: Docker instalado, usuário de sistema `deploy` (sem login, no grupo `docker`) dono de `/opt/nfbmc`.

## 1. Copiar os arquivos (do Mac)

Na raiz do repositório:

```bash
scp docker-compose.prod.yml deploy/nfbmc-* nfbmc-prod:/tmp/
```

Na prod:

```bash
sudo install -o deploy -g deploy -m 644 /tmp/docker-compose.prod.yml /opt/nfbmc/
sudo install -o deploy -g deploy -m 755 /tmp/nfbmc-backup.sh /opt/nfbmc/
sudo install -m 644 /tmp/nfbmc-update.service /tmp/nfbmc-update.timer /tmp/nfbmc-backup.service /tmp/nfbmc-backup.timer /etc/systemd/system/
rm /tmp/docker-compose.prod.yml /tmp/nfbmc-*
```

Quando o `docker-compose.prod.yml` mudar no repositório, repita a cópia dele (é o único arquivo que não se atualiza sozinho).

## 2. Segredos (`/opt/nfbmc/.env`)

```bash
sudo install -o deploy -g deploy -m 600 /dev/null /opt/nfbmc/.env
sudo -u deploy nano /opt/nfbmc/.env
```

Conteúdo (modelo em `.env.example`):

```
POSTGRES_PASSWORD=<saída de: openssl rand -hex 24>
TUNNEL_TOKEN=<token do tunnel, do 1Password>
```

## 3. Acesso ao GHCR (só se o pacote for privado)

Crie um **classic PAT** na sua conta do GitHub com **apenas** o escopo `read:packages` (fine-grained tokens não funcionam com o GHCR). Depois:

```bash
sudo -u deploy -H docker login ghcr.io -u theWhK
```

Cole o token quando pedir a senha. Ele fica em `/opt/nfbmc/.docker/config.json`, legível só pelo `deploy`.

## 4. Ligar os timers

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nfbmc-update.timer nfbmc-backup.timer
sudo systemctl start nfbmc-update.service
```

## 5. Conferir

```bash
sudo -u deploy docker compose -f /opt/nfbmc/docker-compose.prod.yml ps
```

Os três serviços devem estar `running` (o `nfbmc-server` e o `postgres` com `healthy`). Depois abra https://nfbmc.willianhideki.com.br e https://nfbmc.willianhideki.com.br/healthz (deve mostrar `"db":"ok"`).

## Operação

| O quê | Comando |
|---|---|
| Logs do jogo | `sudo -u deploy docker compose -f /opt/nfbmc/docker-compose.prod.yml logs -f nfbmc-server` |
| Forçar atualização agora | `sudo systemctl start nfbmc-update.service` |
| Última execução do update | `journalctl -u nfbmc-update.service -n 50` |
| Backups | `ls -lh /opt/nfbmc/backups` |
| Voltar para uma versão anterior | troque `:latest` por `:sha-<commit>` no compose e rode o update |
