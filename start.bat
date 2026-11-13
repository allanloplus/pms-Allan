@echo off
chcp 65001 >nul
title Allan Lo的今天和明天
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [錯誤] 找不到 Node.js,請先到 https://nodejs.org 安裝 22.13 以上版本。
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo [錯誤] Node.js 版本過舊,需要 22.13 以上。目前版本:
  node -v
  pause
  exit /b 1
)

if "%PORT%"=="" set PORT=3300
echo PMS 啟動中: http://127.0.0.1:%PORT%
echo 關閉此視窗或按 Ctrl+C 即可停止。
echo.

rem 2 秒後自動開啟瀏覽器
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" http://127.0.0.1:%PORT%"

node server.js

echo.
echo PMS 已停止。若是異常結束,請檢查上方訊息(常見原因:埠號 %PORT% 已被占用)。
pause
