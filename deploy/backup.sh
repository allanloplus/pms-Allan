#!/usr/bin/env bash
# 備份資料庫與靈感媒體檔到 /var/backups/pms-allan(各只保留最近 3 份)
set -euo pipefail
cd "$(dirname "$0")"
DEST="${BACKUP_DIR:-/var/backups/pms-allan}"
KEEP=3
# 檔名含時間戳,依名稱排序即為時間順序;刪除最新 KEEP 份以外的
prune() { { ls -1 "$DEST"/$1 2>/dev/null || true; } | sort -r | tail -n +$((KEEP + 1)) | xargs -r rm -f --; }
mkdir -p "$DEST"; chmod 700 "$DEST"
F="pms-$(date +%Y%m%d-%H%M%S).db"
docker compose exec -T app sh -c 'node -e "const {DatabaseSync}=require(\"node:sqlite\");new DatabaseSync(\"/app/data/pms.db\").exec(\"VACUUM INTO \x27/tmp/b.db\x27\")" 2>/dev/null && cat /tmp/b.db && rm -f /tmp/b.db' > "$DEST/$F"
[ -s "$DEST/$F" ] || { rm -f "$DEST/$F"; echo "備份失敗"; exit 1; }
gzip "$DEST/$F"
# 靈感的圖片、錄音、塗鴉(媒體檔)
if docker compose exec -T app sh -c '[ -n "$(ls -A /app/data/media 2>/dev/null)" ]'; then
  M="media-${F%.db}.tar.gz"
  if docker compose exec -T app tar -C /app/data -czf - media > "$DEST/$M"; then
    echo "已備份媒體檔: $DEST/$M"
  else
    rm -f "$DEST/$M"; echo "媒體檔備份失敗"; exit 1
  fi
fi
echo "已備份: $DEST/$F.gz"
# 本次備份成功後才清理舊備份
prune 'pms-*.db.gz'
prune 'media-*.tar.gz'
echo "目前保留: $(ls -1 "$DEST" | wc -l) 個檔案,共 $(du -sh "$DEST" | cut -f1)"
