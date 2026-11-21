#!/usr/bin/env bash
# 產生 version.txt(程式碼最後提交時間、版本代碼、說明、建置時間),建置映像時一併帶入供系統顯示
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
{ git -C "$ROOT" log -1 --format='%cI%n%h%n%s'; date -Iseconds; } > "$ROOT/version.txt"
echo "版本: $(sed -n 1p "$ROOT/version.txt") $(sed -n 2p "$ROOT/version.txt")"
