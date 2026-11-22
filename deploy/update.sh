#!/usr/bin/env bash
# 更新程式:先備份,再拉取新版並重建容器。在主機上: bash /opt/pms-allan/deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")"
if [ "${1:-}" != --after-pull ]; then
  bash ./backup.sh || echo "(備份失敗或系統尚未啟動,略過)"
  git -C .. pull --ff-only
  # 拉取後改用新版腳本執行後續步驟,腳本本身的修改才會在這一次就生效
  exec bash ./update.sh --after-pull
fi
bash ./write-version.sh || echo "(版本資訊產生失敗,不影響更新)"
docker compose up -d --build
docker image prune -f >/dev/null
docker compose ps
echo "更新完成,已上線版本: $(sed -n 5p ../version.txt 2>/dev/null || echo 未知)"
