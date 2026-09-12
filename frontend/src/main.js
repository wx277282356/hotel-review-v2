import { createApp } from 'vue'
import App from './App.vue'
import { applyConfig } from './api/http.js'

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
  createApp(App).mount('#app')
}

boot()
