#!/usr/bin/env bash
# 更新程式:先備份,再拉取新版並重建容器。在主機上: bash /opt/pms-allan/deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")"
bash ./backup.sh || echo "(備份失敗或系統尚未啟動,略過)"
git -C .. pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
docker compose ps
