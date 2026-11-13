#!/usr/bin/env bash
# macOS / Linux 一鍵啟動
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null || { echo "找不到 Node.js,請先安裝 22.13 以上版本"; exit 1; }
export PORT="${PORT:-3300}"
URL="http://127.0.0.1:$PORT"
echo "PMS 啟動中: $URL(按 Ctrl+C 停止)"
(sleep 2; if command -v open >/dev/null; then open "$URL"; elif command -v xdg-open >/dev/null; then xdg-open "$URL"; fi) >/dev/null 2>&1 &
exec node server.js
