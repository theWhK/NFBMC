#!/bin/sh
# Dump diário do Postgres de produção, guardando os últimos 14 dias em /opt/nfbmc/backups.
# Restaurar: docker compose -f docker-compose.prod.yml exec -T postgres pg_restore -U nfbmc -d nfbmc --clean < backups/<arquivo>.dump
set -eu

cd /opt/nfbmc
mkdir -p backups

file="backups/nfbmc-$(date +%F).dump"
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U nfbmc -Fc nfbmc > "$file.tmp"
mv "$file.tmp" "$file"

find backups -name 'nfbmc-*.dump' -mtime +14 -delete
