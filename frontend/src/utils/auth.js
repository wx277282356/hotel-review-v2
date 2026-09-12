// 登录会话管理：登录后拿到的令牌即后端所有接口的 ?token= 参数
// 主令牌（appsettings.json 的 AdminToken）也可直接登录，作为管理员后门
import { ref } from 'vue'
import { api } from '../api/http.js'

const KEY = 'hr_session'
const LEGACY_KEY = 'admin_token' // 旧版本只存主令牌，登录后自动迁移

const EMPTY = { token: '', role: '', username: '', displayName: '' }

export const auth = ref({ ...EMPTY })

export function isLoggedIn() {
  return !!auth.value.token
}

export function isAdmin() {
  return auth.value.role === 'admin'
}

export function saveSession(data) {
  auth.value = { ...EMPTY, ...data }
  localStorage.setItem(KEY, JSON.stringify(auth.value))
}

export function clearSession() {
  auth.value = { ...EMPTY }
  localStorage.removeItem(KEY)
}

// 从本地恢复会话；兼容旧版本的 admin_token
export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      auth.value = { ...EMPTY, ...JSON.parse(raw) }
      return auth.value
    }
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      auth.value = { ...EMPTY, token: legacy }
    }
  } catch {
    /* 本地数据损坏则视为未登录 */
  }
  return auth.value
}

// 账号密码登录
export async function login(username, password) {
  const res = await api.post('/auth/login', { username, password })
  saveSession(res.data)
  return res.data
}

// 校验会话是否仍有效（令牌过期/账号被停用会失效）
export async function verify() {
  if (!auth.value.token) return false
  try {
    const res = await api.get('/auth/me?token=' + encodeURIComponent(auth.value.token))
    saveSession({ token: auth.value.token, ...res.data })
    return true
  } catch {
    clearSession()
    return false
  }
}

export async function logout() {
  const t = auth.value.token
  clearSession()
  try {
    await api.post('/auth/logout?token=' + encodeURIComponent(t))
  } catch {
    /* 网络异常也要让本地先退出 */
  }
}

// 自助改密
export async function changePassword(oldPassword, newPassword) {
  await api.post('/auth/password?token=' + encodeURIComponent(auth.value.token), { oldPassword, newPassword })
}
