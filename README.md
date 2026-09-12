# 城市酒店点评系统（重构版）

技术栈：**Vue3（前端）+ .NET 10 Web API（后端）+ PostgreSQL（数据库）**，GitHub 统一管代码。

## 目录结构
```
hotel-review-v2/
├─ backend/    # .NET 10 Web API
└─ frontend/   # Vue3 + Vite
```

## 准备
1. 安装 PostgreSQL，创建数据库 `hotel_review`，记住 superuser 密码。
2. 修改 `backend/appsettings.json`：
   - `ConnectionStrings:DefaultConnection` 的 `Password=CHANGE_ME` 改为你的密码
   - `AdminToken` 改为一段自己定的强随机串（后台拉数据用）
3. 安装 Node.js（LTS）、.NET 10 SDK。

## 运行（开发）
后端：
```
cd backend
dotnet restore
dotnet run        # 监听 http://localhost:5188
```
前端（另开终端）：
```
cd frontend
npm install
npm run dev       # http://localhost:5173
```
浏览器打开 http://localhost:5173 → 点评台提交；点「后台」→ 输入 AdminToken → 加载数据。

## 接口
- `POST /api/review` 客人提交（开放）
- `GET  /api/reviews?token=xxx` 后台拉全量
- `GET  /api/stats?token=xxx` 统计

## 部署（本地 + 公网可达）
详见后续部署文档。测试期前端可挂 GitHub Pages，后端经 Cloudflare Tunnel 暴露，数据库留本地。
