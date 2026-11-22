#!/usr/bin/env bash
# 以上傳的資料庫取代主機上的資料庫(例如把本機測試資料搬上來)
#   用法: bash /opt/pms-allan/deploy/import-db.sh [來源,預設 /root/pms-upload]
#   來源可以是:
#     - 資料夾:內含 pms.db(若有 pms.db-wal、pms.db-shm、media/ 會一併帶入)
#     - 從「設定 → 下載資料庫」取得的 .db 檔;同資料夾若有 pms-media-*.tar 會一併還原媒體檔
set -euo pipefail
cd "$(dirname "$0")"
SRC="$(readlink -f "${1:-/root/pms-upload}")"
ORIG="$SRC"
if [ -f "$SRC" ]; then
  # 單一 .db 檔:整理成腳本需要的資料夾結構
  STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
  cp "$SRC" "$STAGE/pms.db"
  TAR="$(ls -1 "$(dirname "$SRC")"/pms-media-*.tar 2>/dev/null | sort | tail -n 1 || true)"
  if [ -n "$TAR" ]; then tar -xf "$TAR" -C "$STAGE" && echo "將一併還原媒體檔: $TAR"; fi
  chmod -R a+rX "$STAGE"
  SRC="$STAGE"
fi
[ -f "$SRC/pms.db" ] || { echo "找不到 $SRC/pms.db"; exit 1; }

echo "即將用 $ORIG 取代主機上現有的資料庫(現有資料會先備份)。"
read -rp "確定要繼續嗎?輸入 yes 繼續: " OK
[ "$OK" = yes ] || { echo "已取消"; exit 0; }

echo "== 1/4 備份現有資料庫"
bash ./backup.sh || echo "(現有資料庫備份失敗或尚無資料,略過)"

echo "== 2/4 停止服務並匯入"
docker compose stop app
docker compose run --rm --no-deps -T -u root -v "$SRC:/in:ro" app sh -c \
  'rm -f /app/data/pms.db /app/data/pms.db-wal /app/data/pms.db-shm && cp /in/pms.db* /app/data/ && chown node:node /app/data/pms.db* && if [ -d /in/media ]; then rm -rf /app/data/media && cp -r /in/media /app/data/media && chown -R node:node /app/data/media; fi'

echo "== 3/4 啟動服務"
docker compose up -d
for i in $(seq 1 20); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q app)" 2>/dev/null)" = healthy ] && break
  sleep 2
done
docker compose ps

echo "== 4/4 重新設定登入密碼(匯入的資料庫帶有它原本的密碼,請重新設定)"
bash ./set-password.sh

echo "匯入完成。確認網站資料正確後,請刪除上傳到主機的備份檔($ORIG)。"
