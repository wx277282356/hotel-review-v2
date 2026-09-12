# 城市酒店 · 客房点评系统（重构版）

技术栈：**Vue3（前端）+ .NET 10 Web API（后端）+ PostgreSQL（数据库）**，GitHub 统一管代码。

- 线上前端：https://wx277282356.github.io/hotel-review-v2/
- 完整部署与运维说明：见 [部署与运维说明.md](./部署与运维说明.md)

## 目录结构

```
hotel-review-v2/
├─ backend/     # .NET 10 Web API（端口 5188）
├─ frontend/    # Vue3 + Vite（含 scripts/ 二维码生成与旧数据迁移）
├─ scripts/     # deploy.mjs（发布）、start-all.mjs（一键启动）、backup-db.mjs（备份）
├─ backups/     # 数据备份（已 gitignore，含真实评价数据）
├─ 一键启动.bat          # ★ 日常只用双击这一个
├─ 备份数据.bat          # 定期双击一次，把评价数据备份到本地
└─ 部署与运维说明.md
```

## 日常使用（酒店本机）

**双击 `一键启动.bat`** 即可。它会自动：启动后端 → 起 Cloudflare 公网隧道 → 把公网地址写进前端配置 → 发布前端到 GitHub Pages → 打印地址汇总。

窗口保持开着；关窗口或 Ctrl+C 会一并停掉后端与隧道。

**定期双击 `备份数据.bat`**：把评价数据与后台上传的 LOGO 备份到 `backups/`（自动只保留最近 30 份）。
系统的硬承诺是「评价任何人都不可删除」，所以备份是唯一的保险——建议设为每天一次。

分步手动执行（备选）：

```
start-backend.bat      # 只启后端
start-tunnel.bat       # 只起隧道
```

## 公开接口的防护

`POST /api/review` 客人免登录即可提交，因此做了两层防护：

- **入参校验**：`type` 只接受 positive/negative；字段限长；理由去空去重（挡掉没有意义的请求）
- **按客户端 IP 防刷限流**：连提 30 条内不拦，之后每分钟回补 12 条；登录接口更严（10 次）
  - 超出返回 429 +「提交太频繁了，请稍等一会儿再试」，额度可在 `appsettings.json` 的 `ReviewRateLimit` 调整

## 首次准备

1. 安装 PostgreSQL，创建数据库 `hotel_review`，记住 superuser 密码。
2. 安装 .NET 10 SDK、Node.js（LTS）。
3. 配置密钥：把 `backend/appsettings.json` 复制为 **`backend/appsettings.Local.json`**，
   把两处 `CHANGE_ME` 换成真实值：
   - `ConnectionStrings:DefaultConnection` 里的库密码
   - `AdminToken`：一段只有你知道的强随机串（= 后台万能钥匙 / 管理员后门）

> ⚠️ 仓库是**公开**的：`appsettings.json` 只放占位符，**真实密码只写在 `appsettings.Local.json`（已 gitignore，不会提交）**。

## 本地开发

```bash
cd backend && dotnet run      # http://localhost:5188
cd frontend && npm install && npm run dev   # http://localhost:5173（走 vite 代理，无需公网）
```

## 接口（除提交外均需带 `?token=`）

- `POST /api/review` 客人提交（**开放，无删除接口**——评价一律不可删）
- `GET  /api/reviews|stats|stats/by-room|stats/by-staff` 后台数据
- `POST /api/auth/login`、`GET /api/auth/me`、`POST /api/auth/logout`、`POST /api/auth/password` 账号会话
- `GET/POST/PATCH/DELETE /api/staff` 账号管理（**仅管理员**）
- `GET/POST/DELETE /api/settings/logo` 品牌 LOGO

## 设计约束（刻意为之）

- **评价任何人都不可删除**：后端无删除接口，前端无删除按钮。
- 房间号从二维码 URL `?room=房间号` 自动识别并锁定，客人看得到、改不了。
- 数据留在**本地 PostgreSQL**（不租云服务器），经 Cloudflare 隧道公网可达，客人手机流量也能提交。
- 测试期前端用 `github.io` 二级域名；跑通后换客户自有域名。注意 **微信会拦截 github.io**，客人微信扫码流程要等换域名后才真正跑通。
