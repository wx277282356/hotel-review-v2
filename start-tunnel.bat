@echo off
chcp 65001 >nul
cd /d %~dp0
set "CLOUDFLARED=cloudflared.exe"

REM 清掉代理变量：本机若设了 HTTP(S)_PROXY，cloudflared 可能连不上 Cloudflare
set HTTP_PROXY=
set HTTPS_PROXY=
set http_proxy=
set https_proxy=
set NO_PROXY=*

REM 首次运行自动下载 cloudflared（仅本机正常联网时可下载）
if not exist "%CLOUDFLARED%" (
  echo [1/2] 未找到 cloudflared.exe，正在下载（仅首次，需联网）...
  curl -sL --noproxy "*" -o "%CLOUDFLARED%" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
  if not exist "%CLOUDFLARED%" (
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%CLOUDFLARED%'"
  )
  if not exist "%CLOUDFLARED%" (
    echo 下载失败，请手动到 https://github.com/cloudflare/cloudflared/releases 下载 cloudflared-windows-amd64.exe 放到本目录后重试。
    pause
    exit /b 1
  )
)

echo [2/2] 启动 Cloudflare Tunnel，将本机后端(5188)暴露到公网...
echo.
echo  ★ 启动后终端会显示一行 https://xxxx.trycloudflare.com 的公网地址
echo  ★ 复制该地址，在 frontend/public/config.js 里把 apiBase 设为
echo      'https://xxxx.trycloudflare.com/api'  然后 npm run deploy 重新发布前端
echo  ★ 该临时地址每次重启都会变；正式上线请让客户申请自有域名（更稳定）
echo  ★ 看到 "Your quick Tunnel has been created" 即为成功；自检表里 TCP 7844 FAIL 不影响使用
echo.
"%CLOUDFLARED%" tunnel --url http://localhost:5188 --no-autoupdate
pause
