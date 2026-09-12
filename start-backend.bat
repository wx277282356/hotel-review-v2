@echo off
chcp 65001 >nul
cd /d %~dp0backend
echo ================================================
echo   城市酒店点评系统 · 后端启动
echo   访问地址: http://localhost:5188
echo   请保持此窗口开启（关闭即停止服务）
echo ================================================
echo.
dotnet run
pause
