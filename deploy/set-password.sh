#!/usr/bin/env bash
# 設定/重設登入密碼(會登出所有裝置)
set -euo pipefail
cd "$(dirname "$0")"
while :; do
  read -rsp "新密碼(至少 8 碼): " PW; echo
  read -rsp "再輸入一次: " PW2; echo
  [ "$PW" = "$PW2" ] || { echo "兩次輸入不一致,請重試"; continue; }
  if printf '%s' "$PW" | docker compose exec -T app node server.js set-password; then break; fi
done
