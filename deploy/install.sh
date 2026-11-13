#!/usr/bin/env bash
# PMS 在 VPS(Ubuntu / Debian)上的安裝腳本。可重複執行。
#   用法: sudo bash /opt/pms/deploy/install.sh [網域]
#   程式碼由 root 擁有(服務只能讀),只有 data/ 交給專用帳號 pms 寫入。
set -euo pipefail

DOMAIN="${1:-pms.123hi.org}"
PORT="${PORT:-3300}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SVC=pms

[ "$(id -u)" = 0 ] || { echo "請用 sudo 執行"; exit 1; }
say() { printf '\n== %s\n' "$*"; }

say "1/5 檢查 Node.js(需要 22.13 以上)"
node_ok() { command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; }
if ! command -v node >/dev/null; then
  echo "未安裝 Node.js,從 NodeSource 安裝 22.x"
  apt-get update -y && apt-get install -y curl ca-certificates
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! node_ok; then
  echo "目前的 Node.js 是 $(node -v),低於 22.13。"
  echo "這台主機上可能有其他專案依賴現有版本,腳本不會自動升級。"
  echo "請確認後自行升級到 22.x,再重新執行本腳本。"
  exit 1
fi
NODE_BIN="$(command -v node)"
echo "Node.js $(node -v) ($NODE_BIN)"

say "2/5 建立服務帳號與資料目錄"
id "$SVC" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --no-create-home --shell /usr/sbin/nologin "$SVC"
mkdir -p "$APP_DIR/data"
chown -R "$SVC:$SVC" "$APP_DIR/data"
chmod 700 "$APP_DIR/data"

if [ ! -f "$APP_DIR/data/pms.db" ]; then
  say "首次安裝:設定登入密碼(帳號 allanlo)"
  while :; do
    read -rsp "請輸入密碼(至少 8 碼): " PW; echo
    read -rsp "再輸入一次: " PW2; echo
    [ "$PW" = "$PW2" ] || { echo "兩次輸入不一致"; continue; }
    if printf '%s' "$PW" | runuser -u "$SVC" -- env DATA_DIR="$APP_DIR/data" "$NODE_BIN" "$APP_DIR/server.js" set-password; then break; fi
  done
  unset PW PW2
fi

say "3/5 安裝 systemd 服務"
if ss -ltn 2>/dev/null | grep -q ":$PORT " && ! systemctl is-active --quiet "$SVC"; then
  echo "埠 $PORT 已被其他程式占用。請改用其他埠,例如: sudo PORT=3301 bash $0 $DOMAIN"
  exit 1
fi
cat > /etc/systemd/system/$SVC.service <<UNIT
[Unit]
Description=PMS ($DOMAIN)
After=network.target

[Service]
User=$SVC
Group=$SVC
WorkingDirectory=$APP_DIR
Environment=PORT=$PORT HOST=127.0.0.1 TRUST_PROXY=1 DATA_DIR=$APP_DIR/data
ExecStart=$NODE_BIN $APP_DIR/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$APP_DIR/data

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable "$SVC" >/dev/null
systemctl restart "$SVC"
sleep 2
if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")" != 200 ]; then
  echo "服務沒有正常回應,請看: journalctl -u $SVC -n 50"; exit 1
fi
echo "服務已啟動於 127.0.0.1:$PORT"

say "4/5 設定反向代理($DOMAIN)"
if command -v caddy >/dev/null && [ -f /etc/caddy/Caddyfile ]; then
  if grep -q "^$DOMAIN" /etc/caddy/Caddyfile; then
    echo "Caddyfile 已有 $DOMAIN,略過"
  else
    cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%Y%m%d%H%M%S)"
    cp /etc/caddy/Caddyfile /tmp/Caddyfile.pms.orig
    printf '\n%s {\n\treverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$PORT" >> /etc/caddy/Caddyfile
    if caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
      systemctl reload caddy && echo "已加入 Caddy 設定,憑證會自動申請"
    else
      cp /tmp/Caddyfile.pms.orig /etc/caddy/Caddyfile
      echo "Caddy 設定驗證失敗,已還原。請手動加入:"; printf '%s {\n\treverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$PORT"
    fi
  fi
elif command -v nginx >/dev/null; then
  if [ -d /etc/nginx/sites-available ]; then CONF="/etc/nginx/sites-available/$DOMAIN"; else CONF="/etc/nginx/conf.d/$DOMAIN.conf"; fi
  if [ -f "$CONF" ]; then
    echo "$CONF 已存在,略過"
  else
    cat > "$CONF" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
    [ -d /etc/nginx/sites-enabled ] && ln -sf "$CONF" "/etc/nginx/sites-enabled/$DOMAIN"
    if nginx -t >/dev/null 2>&1; then
      systemctl reload nginx && echo "已加入 nginx 站台: $CONF"
    else
      rm -f "$CONF" "/etc/nginx/sites-enabled/$DOMAIN"
      echo "nginx 設定測試失敗,已移除新增的站台檔。請執行 nginx -t 檢查既有設定。"; exit 1
    fi
  fi
  if command -v certbot >/dev/null; then
    echo "申請 HTTPS 憑證(需 DNS 已指向本機)..."
    certbot --nginx -d "$DOMAIN" --redirect || echo "憑證申請失敗。DNS 生效後請再執行: sudo certbot --nginx -d $DOMAIN --redirect"
  else
    echo "未安裝 certbot。請執行: sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d $DOMAIN --redirect"
  fi
else
  echo "找不到 Caddy 或 nginx。請自行將 https://$DOMAIN 反向代理到 127.0.0.1:$PORT"
fi

say "5/5 完成"
echo "網址: https://$DOMAIN"
echo "狀態: systemctl status $SVC      日誌: journalctl -u $SVC -f"
echo "更新: sudo bash $APP_DIR/deploy/update.sh"
echo "重設密碼: sudo bash $APP_DIR/deploy/set-password.sh"
