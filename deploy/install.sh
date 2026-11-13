#!/usr/bin/env bash
# 首次安裝(可重複執行)。在主機上: bash /opt/pms-allan/deploy/install.sh
# 前提:主機已有 Docker,以及另一個專案的 Caddy 容器(網路 pms_default)。
set -euo pipefail
cd "$(dirname "$0")"
DOMAIN="${1:-pms.123hi.org}"
NET="${CADDY_NETWORK:-pms_default}"

command -v docker >/dev/null || { echo "找不到 docker"; exit 1; }
docker network inspect "$NET" >/dev/null 2>&1 || { echo "找不到 Docker 網路 $NET(既有的 Caddy 是否在執行?)"; exit 1; }

echo "== 1/3 建置並啟動"
docker compose up -d --build
for i in $(seq 1 20); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q app)" 2>/dev/null)" = healthy ] && break
  sleep 2
done
docker compose ps

echo "== 2/3 登入密碼"
if docker compose exec -T app node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync("/app/data/pms.db");process.exit(d.prepare("SELECT must_change m FROM users LIMIT 1").get().m?0:1)' 2>/dev/null; then
  echo "目前仍是預設密碼,請設定新密碼(帳號 allanlo)"
  bash ./set-password.sh
else
  echo "已設定過密碼,略過"
fi

echo "== 3/3 檢查"
IP="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
[ -n "$IP" ] && echo "DNS: $DOMAIN -> $IP" || echo "注意: $DOMAIN 尚未解析到任何 IP,請先設定 DNS A 紀錄"
echo
echo "應用程式已啟動。接著讓 Caddy 載入 $DOMAIN 的設定後,即可開啟 https://$DOMAIN"
