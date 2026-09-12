@echo off
chcp 65001 >nul
cd /d %~dp0

echo ======================================================
echo   城市酒店点评系统 - 备份数据
echo   （把评价数据 + 后台上传的 LOGO 存到 backups 目录）
echo ======================================================
echo.

REM ---- 找一个可用的 Node ----
set "NODE="
where node >nul 2>nul
if not errorlevel 1 set "NODE=node"

if not defined NODE (
  for /d %%D in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
    if exist "%%D\node.exe" set "NODE=%%D\node.exe"
  )
)

if not defined NODE (
  if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
)

if not defined NODE (
  echo [错误] 没找到 Node.js。
  echo        请先安装 Node.js，或把 node.exe 所在目录加入 PATH。
  echo.
  pause
  exit /b 1
)

"%NODE%" "%~dp0scripts\backup-db.mjs" %*

echo.
pause
