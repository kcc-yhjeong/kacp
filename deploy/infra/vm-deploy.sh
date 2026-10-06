#!/usr/bin/env bash
# KACP VM deploy (GCP VM "kacp", Ubuntu 24.04, Docker 29, /data data disk).
# Run in the VM browser SSH:  curl -fsSL https://raw.githubusercontent.com/kcc-yhjeong/kacp/main/deploy/infra/vm-deploy.sh | bash
# Idempotent: pulls main, keeps .env.vm and /data, rebuilds and restarts the stack.
set -euo pipefail

REPO=https://github.com/kcc-yhjeong/kacp.git
DIR=/opt/kacp
INFRA=$DIR/deploy/infra
C="sudo docker compose -f $INFRA/docker-compose.yml -f $INFRA/docker-compose.vm.yml --env-file $INFRA/.env.vm"

log() { printf '\n== %s\n' "$*"; }

log "checks"
mountpoint -q /data || { echo "/data is not mounted"; exit 1; }
sudo docker version --format 'docker {{.Server.Version}}'

log "code ($REPO → $DIR)"
if [ -d "$DIR/.git" ]; then
  sudo git -C "$DIR" fetch -q origin main && sudo git -C "$DIR" reset -q --hard origin/main
else
  sudo git clone -q "$REPO" "$DIR"
fi
sudo git -C "$DIR" log --oneline -1

log "secrets (.env.vm, created once)"
if [ ! -f "$INFRA/.env.vm" ]; then
  sudo cp "$INFRA/.env.vm.example" "$INFRA/.env.vm"
  sudo sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|; \
               s|^INTERNAL_TOKEN=.*|INTERNAL_TOKEN=$(openssl rand -hex 32)|; \
               s|^APP_ENCRYPTION_KEY=.*|APP_ENCRYPTION_KEY=$(openssl rand -base64 32)|" "$INFRA/.env.vm"
  sudo chmod 600 "$INFRA/.env.vm"
  echo "created $INFRA/.env.vm"
else
  echo "kept existing $INFRA/.env.vm"
fi

log "data folders"
sudo mkdir -p /data/traefik /data/postgres /data/teams /data/backups
# acme.json must exist and be 0600; an empty file must be 0 bytes (spike 07).
[ -f /data/traefik/acme.json ] || sudo touch /data/traefik/acme.json
sudo chmod 600 /data/traefik/acme.json

log "leftover spike containers"
sudo docker ps -a --format '{{.Names}}' | grep -E '^kacp(0[0-9]|-spike)' || echo "none"

log "spike networks"
# Spikes created kacp-edge with another subnet and no compose labels; compose refuses to reuse it.
for n in kacp-edge kacp-core; do
  if sudo docker network inspect "$n" >/dev/null 2>&1 && \
     [ "$(sudo docker network inspect -f '{{index .Labels "com.docker.compose.project"}}' "$n")" != "kacp" ]; then
    echo "removing old $n"; sudo docker network rm "$n"
  fi
done

log "build (team Gateway, sandbox, app runtimes, api, orchestrator, web, platform-mcp)"
$C --profile build build openclaw-image sandbox-image app-runtime-node app-runtime-python app-runtime-static
$C build api orchestrator web platform-mcp

log "up"
$C up -d
sleep 15
$C ps --format '{{.Service}}\t{{.Status}}'

log "seed demo accounts (first run only)"
if $C exec -T postgres psql -U kacp -tAc "select count(*) from users" 2>/dev/null | grep -qx 0; then
  $C exec -T api node dist/cli.js demo
else
  echo "users already exist — skipped"
fi

log "daily Postgres backup (03:30, /data/backups/postgres, 14 kept — RESTORE.md)"
sudo chmod 755 "$INFRA/backup.sh"
echo "30 3 * * * root $INFRA/backup.sh >> /var/log/kacp-backup.log 2>&1" | sudo tee /etc/cron.d/kacp-backup >/dev/null
sudo chmod 644 /etc/cron.d/kacp-backup
cat /etc/cron.d/kacp-backup

log "checks"
curl -s -o /dev/null -w 'https://app.kacp.cloud/ → %{http_code}\n' https://app.kacp.cloud/ || true
curl -s -o /dev/null -w 'https://team1.kacp.cloud/ (no login) → %{http_code} %{redirect_url}\n' -H 'accept: text/html' https://team1.kacp.cloud/ || true
echo "done"
