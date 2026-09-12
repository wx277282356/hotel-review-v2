// 登录会话管理：登录后拿到的令牌即后端所有接口的 ?token= 参数
// 主令牌（appsettings.json 的 AdminToken）也可直接登录，作为管理员后门
import { ref } from 'vue'
import { api } from '../api/http.js'

// ⚠️ 这个键名必须与旧系统区分开，别改回 hr_session！
// 旧系统 /hotel-review/ 与本系统 /hotel-review-v2/ 同域（wx277282356.github.io），
// 而 localStorage 只按「域名」隔离、**不按路径** → 新旧系统共用同一份存储。
// 旧系统把 { username, password, role:'manager'|'staff', name } 存在 hr_session，
// 且靠它重新登录（DB.login(user.username, user.password)）、靠 role==='manager' 决定
// 「导出 Excel」等按钮是否显示。两边若共用 hr_session 就会互相覆盖：
//   · 登录本系统 → 旧系统下次打开被踢回登录页、导出按钮不见；
//   · 回到旧系统重新登录 → 本系统会话丢失 → 前台提交的评价失去「当班工号」归属。
// 因此本系统从 2026-09-12 起改用 hrv2_session。
const KEY = 'hrv2_session'
// 旧的键名，仅为兼容与自动迁移保留
const LEGACY_SESSION_KEY = 'hr_session' // 早期版本用过（与旧系统同名，已弃用）
const LEGACY_TOKEN_KEY = 'admin_token' // 更早期版本只存主令牌

const EMPTY = { token: '', role: '', username: '', displayName: '' }

export const auth = ref({ ...EMPTY })

// 只有「长得像本系统会话」（含非空 token 字符串）才认，
// 避免把旧系统的用户对象误当成本系统会话（它没有 token 字段）。
function parseOurs(raw) {
  if (!raw) return null
  try {
    const o = JSON.parse(raw)
    return o && typeof o.token === 'string' && o.token ? o : null
  } catch {
    return null
  }
}

export function isLoggedIn() {
  return !!auth.value.token
}

export function isAdmin() {
  return auth.value.role === 'admin'
}

export function saveSession(data) {
  auth.value = { ...EMPTY, ...data }
  localStorage.setItem(KEY, JSON.stringify(auth.value))
  // 已经写下完整会话，早期那个只存令牌的键就没用了 —— 清掉，
  // 否则退出登录后刷新页面会从它那里"复活"成已登录。
  localStorage.removeItem(LEGACY_TOKEN_KEY)
}

export function clearSession() {
  auth.value = { ...EMPTY }
  localStorage.removeItem(KEY)
  localStorage.removeItem(LEGACY_TOKEN_KEY)
  // 旧会话键只在确认装的是本系统会话时才删；否则会误删旧系统的登录态。
  if (parseOurs(localStorage.getItem(LEGACY_SESSION_KEY))) {
    localStorage.removeItem(LEGACY_SESSION_KEY)
  }
}

// 从本地恢复会话；顺带把早期版本的键自动迁移过来
export function loadSession() {
  try {
    const own = parseOurs(localStorage.getItem(KEY))
    if (own) {
      auth.value = { ...EMPTY, ...own }
      return auth.value
    }
    // 一次性迁移：早期版本写在与旧系统同名的 hr_session 里
    // → 搬到自己的键下，并**删掉旧键**，从此两边不再互相覆盖。
    const legacySession = parseOurs(localStorage.getItem(LEGACY_SESSION_KEY))
    if (legacySession) {
      auth.value = { ...EMPTY, ...legacySession }
      localStorage.setItem(KEY, JSON.stringify(auth.value))
      localStorage.removeItem(LEGACY_SESSION_KEY)
      return auth.value
    }
    const legacyToken = localStorage.getItem(LEGACY_TOKEN_KEY)
    if (legacyToken) {
      auth.value = { ...EMPTY, token: legacyToken }
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
