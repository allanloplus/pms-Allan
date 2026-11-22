#!/usr/bin/env bash
# 產生 version.txt,建置映像時一併帶入供系統顯示。各行依序為:
#   程式碼最後提交時間、Git 代碼、說明、建置時間、版本編號、首次發佈時間(最早一筆提交)
# 版本編號 allanlo-YYYYMMDD-NN:日期為最後提交日(臺北時間),NN 為當天第幾次更新
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export TZ=Asia/Taipei
DAY="$(git -C "$ROOT" log -1 --format=%cd --date=format-local:%Y%m%d)"
SEQ="$(git -C "$ROOT" log -n 500 --format=%cd --date=format-local:%Y%m%d | grep -c "^$DAY\$")"
LABEL="$(printf 'allanlo-%s-%02d' "$DAY" "$SEQ")"
{ git -C "$ROOT" log -1 --format='%cI%n%h%n%s'; date -Iseconds; echo "$LABEL"; git -C "$ROOT" log --reverse --format=%cI | sed -n 1p; } > "$ROOT/version.txt"
echo "版本: $LABEL($(git -C "$ROOT" log -1 --format=%cd --date=format-local:'%Y/%m/%d %H:%M'))"
