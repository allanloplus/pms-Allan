#!/usr/bin/env bash
# VPS 上更新程式:先備份資料庫,再拉取新版並重啟服務
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "請用 sudo 執行"; exit 1; }
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
mkdir -p data/backup
if [ -f data/pms.db ]; then
  B="data/backup/pms-$(date +%Y%m%d-%H%M%S).db"
  node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);d.exec("VACUUM INTO \x27"+process.argv[2]+"\x27")' data/pms.db "$B" 2>/dev/null
  chown pms:pms "$B"; echo "已備份資料庫: $B"
  ls -1t data/backup/pms-*.db | tail -n +15 | xargs -r rm -f   # 只留最近 14 份
fi
echo "目前版本: $(git log -1 --format='%h %s')"
git pull --ff-only
echo "更新後版本: $(git log -1 --format='%h %s')"
chown -R pms:pms data
systemctl restart pms
sleep 2
systemctl is-active --quiet pms && echo "服務已重新啟動" || { echo "服務啟動失敗,請看: journalctl -u pms -n 50"; exit 1; }
