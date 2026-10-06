#!/usr/bin/env bash
# KACP Postgres backup (docs/README.md 7단계). Run as root on the VM; vm-deploy.sh installs a daily cron.
#   sudo /opt/kacp/deploy/infra/backup.sh
# Writes /data/backups/postgres/kacp-YYYYMMDD-HHMM.dump (pg_dump custom format) and keeps the newest 14.
# Restore: deploy/infra/RESTORE.md
set -euo pipefail

INFRA=$(cd "$(dirname "$0")" && pwd)
OUT=/data/backups/postgres
KEEP=${KEEP:-14}
C="docker compose -f $INFRA/docker-compose.yml -f $INFRA/docker-compose.vm.yml --env-file $INFRA/.env.vm"

mkdir -p "$OUT"
chmod 700 "$OUT"
file="$OUT/kacp-$(date +%Y%m%d-%H%M).dump"
tmp="$file.part"

# -Fc: compressed, restorable table by table with pg_restore. Written to .part first so a failed
# dump never looks like a good one.
$C exec -T postgres pg_dump -U kacp -Fc kacp > "$tmp"
[ -s "$tmp" ] || { echo "empty dump" >&2; rm -f "$tmp"; exit 1; }
mv "$tmp" "$file"
chmod 600 "$file"

# keep the newest $KEEP
ls -1t "$OUT"/kacp-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "$(date -Is) backup ok: $file ($(du -h "$file" | cut -f1))"
