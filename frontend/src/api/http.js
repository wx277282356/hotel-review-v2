import axios from 'axios'

// 默认走 vite 代理 /api（开发模式）；部署后由 public/config.js 的 apiBase 覆盖
export const api = axios.create({
  baseURL: '/api'
})

// 读取 public/config.js 设置的后端地址（含 /api 前缀），在 main.js 启动后调用
export function applyConfig() {
  const cfg = (typeof window !== 'undefined' && window.__APP_CONFIG__) || {}
  if (cfg.apiBase) api.defaults.baseURL = cfg.apiBase
}

// 当前生效的后端地址（供拼接非 axios 请求用，如 LOGO 图片）
export function getApiBase() {
  return api.defaults.baseURL || '/api'
}
