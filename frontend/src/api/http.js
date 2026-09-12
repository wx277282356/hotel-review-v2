import axios from 'axios'

// 开发期经 vite 代理（/api -> localhost:5188）；生产期改为后端真实地址
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/api'
})
