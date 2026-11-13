#!/usr/bin/env bash
# macOS / Linux 更新程式(資料庫 data/ 不受影響)
cd "$(dirname "$0")" || exit 1
command -v git >/dev/null || { echo "找不到 git"; exit 1; }
echo "目前版本: $(git log -1 --format='%h %s (%cd)' --date=short)"
git pull --ff-only || { echo "更新失敗:請檢查網路,或本機程式檔是否被修改過。"; exit 1; }
echo "更新後版本: $(git log -1 --format='%h %s (%cd)' --date=short)"
echo "更新完成。若 PMS 正在執行,請重新啟動才會套用新版。"
