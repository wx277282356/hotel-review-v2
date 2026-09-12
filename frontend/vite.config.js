import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // GitHub Pages 项目站点子路径（仓库名 hotel-review-v2）
  base: '/hotel-review-v2/',
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      // 开发期前端请求 /api 会被代理到后端 5188，避免跨域
      '/api': 'http://localhost:5188'
    }
  }
})
