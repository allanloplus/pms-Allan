@echo off
chcp 65001 >nul
title PMS 更新
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo [錯誤] 找不到 git,請先安裝 Git for Windows: https://git-scm.com
  pause
  exit /b 1
)

echo 目前版本:
git log -1 --format="  %%h %%s (%%cd)" --date=short
echo.
echo 正在下載更新...
git pull --ff-only
if errorlevel 1 (
  echo.
  echo [錯誤] 更新失敗。常見原因:網路無法連線,或本機程式檔被修改過。
  echo        資料庫 data\ 資料夾不受影響。
  pause
  exit /b 1
)

echo.
echo 更新後版本:
git log -1 --format="  %%h %%s (%%cd)" --date=short
echo.
echo 更新完成。資料庫 data\ 資料夾不會被更動。
echo 若 PMS 正在執行,請關閉後重新執行 start.bat 才會套用新版。
pause
