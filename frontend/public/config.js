// ============================================================
//  部署配置文件（运行时读取，改这里【无需】重新 npm run build）
//  改完把前端重新推送到 GitHub Pages 即生效。
// ============================================================
window.__APP_CONFIG__ = {
  // 后端公网地址（必须含 /api 前缀）：
  //  · 开发模式（npm run dev）：留空 ''，前端走 vite 代理 /api -> localhost:5188
  //  · 部署后：填 Cloudflare Tunnel 或客户域名给的 https 地址，例如
  //      'https://xxxx.trycloudflare.com/api'
  //      'https://review.客户域名.com/api'
  apiBase: ''
};
