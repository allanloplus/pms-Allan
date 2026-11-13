#!/usr/bin/env bash
# 重設登入密碼(會登出所有裝置)
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "請用 sudo 執行"; exit 1; }
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
read -rsp "新密碼(至少 8 碼): " PW; echo
read -rsp "再輸入一次: " PW2; echo
[ "$PW" = "$PW2" ] || { echo "兩次輸入不一致"; exit 1; }
printf '%s' "$PW" | runuser -u pms -- env DATA_DIR="$APP_DIR/data" "$(command -v node)" "$APP_DIR/server.js" set-password
