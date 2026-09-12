@echo off
chcp 65001 >nul
cd /d %~dp0

echo ======================================================
echo   城市酒店点评系统 - 一键启动
echo   （后端 + 公网隧道 + 自动更新前端配置并发布）
echo ======================================================
echo.

REM ---- 清掉代理变量：本机若设了 HTTP(S)_PROXY，cloudflared 可能连不上 Cloudflare ----
set HTTP_PROXY=
set HTTPS_PROXY=
set http_proxy=
set https_proxy=
set NO_PROXY=*

REM ---- 把用户级 .NET SDK 放进 PATH（安装时写在 HKCU，新终端才生效，这里显式加上）----
set "PATH=%LOCALAPPDATA%\Microsoft\dotnet;%PATH%"

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

"%NODE%" "%~dp0scripts\start-all.mjs" %*

echo.
echo 服务已停止。
pause
