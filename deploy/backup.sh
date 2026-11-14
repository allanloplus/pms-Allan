#!/usr/bin/env bash
# 備份資料庫到 /var/backups/pms-allan(保留 14 天)
set -euo pipefail
cd "$(dirname "$0")"
DEST=/var/backups/pms-allan
mkdir -p "$DEST"; chmod 700 "$DEST"
F="pms-$(date +%Y%m%d-%H%M%S).db"
docker compose exec -T app sh -c 'node -e "const {DatabaseSync}=require(\"node:sqlite\");new DatabaseSync(\"/app/data/pms.db\").exec(\"VACUUM INTO \x27/tmp/b.db\x27\")" 2>/dev/null && cat /tmp/b.db && rm -f /tmp/b.db' > "$DEST/$F"
[ -s "$DEST/$F" ] || { rm -f "$DEST/$F"; echo "備份失敗"; exit 1; }
gzip "$DEST/$F"
# 靈感的圖片、錄音、塗鴉(媒體檔)
if docker compose exec -T app sh -c '[ -n "$(ls -A /app/data/media 2>/dev/null)" ]'; then
  M="media-${F%.db}.tar.gz"
  docker compose exec -T app tar -C /app/data -czf - media > "$DEST/$M"
  find "$DEST" -name 'media-*.tar.gz' -mtime +14 -delete
  echo "已備份媒體檔: $DEST/$M"
fi
find "$DEST" -name 'pms-*.db.gz' -mtime +14 -delete
echo "已備份: $DEST/$F.gz"
