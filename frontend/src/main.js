import { createApp, watch } from 'vue'
import App from './App.vue'
import { applyConfig } from './api/http.js'
import { resolveLogo } from './utils/logo.js'
import { loadSession } from './utils/auth.js'
import { settings, loadSettings } from './utils/settings.js'

// 运行时加载部署配置（public/config.js），自动适配 GitHub Pages 子路径；
// 改后端地址只需编辑 config.js 并重新推送，无需重新构建源码。
function loadConfig() {
  return new Promise((resolve) => {
    const s = document.createElement('script')
    s.src = import.meta.env.BASE_URL + 'config.js'
    s.onload = resolve
    s.onerror = resolve
    document.head.appendChild(s)
  })
}

async function boot() {
  await loadConfig()
  applyConfig()
  // 启动即恢复登录态。客人点评页也要用它来判断"这台设备当前登录的当班工号"，
  // 否则直接打开前台点评页时登录态为空，提交的评价不会归属到任何人。
  loadSession()
  createApp(App).mount('#app')
  // 挂载后再探测自定义 LOGO，避免阻塞首屏
  resolveLogo()
  // 浏览器标签页标题跟随酒店名称（index.html 里只放中性兜底标题，不写死酒店名）
  watch(settings, (s) => { document.title = `${s.hotelName} · 点评系统` }, { immediate: true, deep: true })
  // 站点文案/选项配置同理：先以内置默认值渲染，拿到后台配置后自动刷新
  loadSettings()
}

boot()
