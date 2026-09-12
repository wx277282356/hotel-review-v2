<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { api } from '../api/http.js'
import { logoUrl, resolveLogo, bumpLogoVersion } from '../utils/logo.js'
import {
  auth, loadSession, login, verify, logout, changePassword, isAdmin, isLoggedIn
} from '../utils/auth.js'
import StaffAdmin from '../components/StaffAdmin.vue'
import SiteSettingsEditor from '../components/SiteSettingsEditor.vue'
import ReviewRecords from '../components/ReviewRecords.vue'
import StatsReport from '../components/StatsReport.vue'
import { settings } from '../utils/settings.js'

// ---------------- 登录 ----------------
const loginForm = ref({ username: '', password: '' })
const loginErr = ref('')
const loginBusy = ref(false)
const booting = ref(true)

async function doLogin() {
  loginErr.value = ''
  if (!loginForm.value.username || !loginForm.value.password) {
    loginErr.value = '请输入用户名和密码'
    return
  }
  loginBusy.value = true
  try {
    await login(loginForm.value.username, loginForm.value.password)
    loginForm.value = { username: '', password: '' }
    await afterLogin()
  } catch (e) {
    loginErr.value = e.response?.data?.error || '登录失败，请检查网络或账号密码'
  } finally {
    loginBusy.value = false
  }
}

// 兼容：用主令牌直接进（管理员后门）
async function doTokenLogin() {
  const t = window.prompt('输入主令牌（appsettings.json 里的 AdminToken）：')
  if (!t) return
  loginErr.value = ''
  loginBusy.value = true
  try {
    auth.value = { token: t, role: '', username: '', displayName: '' }
    const ok = await verify()
    if (!ok) {
      loginErr.value = '主令牌无效'
      return
    }
    await afterLogin()
  } finally {
    loginBusy.value = false
  }
}

async function doLogout() {
  await logout()
  stats.value = null
  statsByRoom.value = []
  statsByStaff.value = []
  page.value = 'dashboard'
}

// ---------------- 页面导航 ----------------
// 与旧系统后台的侧边导航同构（旧 admin.html 的 nav-item：数据看板 / 统计报表 / 评价记录 /
// 系统设置 / 账号管理，其中后两项仅管理员可见）。
// 旧系统页面标题栏显示的文字也按这张表来。
const PAGE_TITLES = {
  dashboard: '数据看板',
  report: '统计报表',
  records: '评价记录',
  settings: '系统设置',
  users: '账号管理'
}
const page = ref('dashboard')
const tabs = computed(() => {
  const list = [
    { key: 'dashboard', label: '数据看板', icon: '📊' },
    { key: 'report', label: '统计报表', icon: '📈' },
    { key: 'records', label: '评价记录', icon: '📋' }
  ]
  if (isAdmin()) {
    list.push({ key: 'settings', label: '系统设置', icon: '⚙️' })
    list.push({ key: 'users', label: '账号管理', icon: '👤' })
  }
  return list
})
// 非管理员（或登录态变化后）不能停在仅管理员页面
watch(page, async () => {
  if (!isAdmin() && (page.value === 'settings' || page.value === 'users')) page.value = 'dashboard'
})

// ---------------- 数据 ----------------
const stats = ref(null)
const statsByRoom = ref([])
const statsByStaff = ref([])
// 今日指标：按本地日 0 点起算（Q4 已拍板=本地日），与旧系统看板"今日"三卡一致
const today = ref(null)
const error = ref('')
const loading = ref(false)

function tk() {
  return 'token=' + encodeURIComponent(auth.value.token)
}

// 看板只取汇总数据。
// 旧系统看板是"把 localStorage 里的评价全读出来再在前端算"，评价多了会卡；
// 这里改成只问后端要汇总结果，页面上不再全量拉评价明细
// （要看明细去「评价记录」页，那里是服务端分页查询）。
async function load() {
  error.value = ''
  loading.value = true
  try {
    const now = new Date()
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const [s, byRoom, byStaff, t] = await Promise.all([
      api.get('/stats?' + tk()),
      api.get('/stats/by-room?' + tk()),
      api.get('/stats/by-staff?' + tk()),
      api.get('/stats?start=' + encodeURIComponent(dayStart.toISOString()) +
        '&end=' + encodeURIComponent(now.toISOString()) + '&' + tk())
    ])
    stats.value = s.data
    statsByRoom.value = byRoom.data
    statsByStaff.value = byStaff.data
    today.value = t.data
  } catch (e) {
    if (e.response?.status === 401) {
      error.value = '登录已失效，请重新登录'
      await logout()
    } else {
      error.value = '加载失败：' + (e.response?.data?.error || e.message || '网络错误')
    }
  } finally {
    loading.value = false
  }
}

async function afterLogin() {
  await load()
  await resolveLogo()
}

// ---------------- LOGO（仅管理员）----------------
const logoMsg = ref('')
const logoBusy = ref(false)

async function onLogoPick(e) {
  const file = e.target.files?.[0]
  if (!file) return
  logoMsg.value = ''
  if (file.size > 2 * 1024 * 1024) { logoMsg.value = '图片不能超过 2MB'; return }
  logoBusy.value = true
  try {
    const fd = new FormData()
    fd.append('file', file)
    const res = await api.post('/settings/logo?' + tkOnly(), fd)
    bumpLogoVersion(res.data?.version)
    await resolveLogo()
    logoMsg.value = '✅ LOGO 已更新，客人端刷新后生效'
  } catch (err) {
    if (err.response?.status === 401) logoMsg.value = '❌ 登录已失效，请重新登录'
    else logoMsg.value = '❌ 上传失败：' + (err.response?.data?.error || err.message)
  } finally {
    logoBusy.value = false
    e.target.value = ''
  }
}

function tkOnly() {
  return 'token=' + encodeURIComponent(auth.value.token) + '&t=' + Date.now()
}

async function resetLogo() {
  logoMsg.value = ''
  logoBusy.value = true
  try {
    await api.delete('/settings/logo?token=' + encodeURIComponent(auth.value.token))
    localStorage.removeItem('logo_version')
    await resolveLogo()
    logoMsg.value = '✅ 已恢复默认 LOGO'
  } catch (err) {
    logoMsg.value = '❌ 操作失败：' + (err.response?.data?.error || err.message)
  } finally {
    logoBusy.value = false
  }
}

// ---------------- 改密 ----------------
const pwdMsg = ref('')
const pwdOpen = ref(false)
const pwdForm = ref({ oldPassword: '', newPassword: '' })

async function doChangePwd() {
  pwdMsg.value = ''
  try {
    await changePassword(pwdForm.value.oldPassword, pwdForm.value.newPassword)
    pwdMsg.value = '✅ 密码已修改'
    pwdForm.value = { oldPassword: '', newPassword: '' }
    pwdOpen.value = false
  } catch (e) {
    pwdMsg.value = '❌ ' + (e.response?.data?.error || e.message)
  }
}

onMounted(async () => {
  loadSession()
  if (isLoggedIn()) {
    const ok = await verify()
    if (ok) await afterLogin()
  }
  booting.value = false
})
</script>

<template>
  <div class="admin">
    <div class="brand-head">
      <img class="brand-logo" :src="logoUrl" alt="" />
      <span>{{ settings.hotelName }} · 点评后台</span>
    </div>

    <!-- ============ 未登录：登录卡 ============ -->
    <div v-if="booting" class="login-card"><p class="empty">正在检查登录状态…</p></div>

    <div v-else-if="!isLoggedIn()" class="login-card">
      <h3>请登录后台</h3>
      <input v-model="loginForm.username" placeholder="用户名" @keyup.enter="doLogin" />
      <input v-model="loginForm.password" type="password" placeholder="密码" @keyup.enter="doLogin" />
      <button :disabled="loginBusy" @click="doLogin">{{ loginBusy ? '登录中…' : '登 录' }}</button>
      <p v-if="loginErr" class="err">{{ loginErr }}</p>
      <p class="alt">
        <a href="#" @click.prevent="doTokenLogin">用主令牌登录（管理员后门）</a>
      </p>
    </div>

    <!-- ============ 已登录：后台 ============ -->
    <template v-else>
      <div class="who">
        <span class="who-name">
          {{ auth.displayName || auth.username }}
          <span class="badge" :class="auth.role">{{ auth.role === 'admin' ? '管理员' : '查看者' }}</span>
        </span>
        <span class="who-ops">
          <button class="mini" @click="pwdOpen = !pwdOpen">修改密码</button>
          <button class="mini" @click="doLogout">退出登录</button>
        </span>
      </div>

      <div v-if="pwdOpen" class="pwd-box">
        <input v-model="pwdForm.oldPassword" type="password" placeholder="原密码" />
        <input v-model="pwdForm.newPassword" type="password" placeholder="新密码（≥6 位）" />
        <button @click="doChangePwd">确认修改</button>
        <p v-if="pwdMsg" class="msg">{{ pwdMsg }}</p>
      </div>
      <p v-else-if="pwdMsg" class="msg">{{ pwdMsg }}</p>

      <p v-if="error" class="err">{{ error }}</p>

      <!-- 页面标题 + 导航：与旧系统后台的导航同构 -->
      <div class="page-title">{{ PAGE_TITLES[page] }}</div>
      <nav class="nav">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="nav-item"
          :class="{ on: page === t.key }"
          @click="page = t.key"
        >
          <span class="nav-ico">{{ t.icon }}</span>{{ t.label }}
        </button>
      </nav>

      <!-- ============ 数据看板 ============ -->
      <div v-if="page === 'dashboard'">
        <div v-if="stats" class="cards">
          <div class="card green"><b>{{ today?.positive ?? 0 }}</b><span>今日好评</span></div>
          <div class="card red"><b>{{ today?.negative ?? 0 }}</b><span>今日差评</span></div>
          <div class="card"><b>{{ today?.total ?? 0 }}</b><span>今日合计</span></div>
          <div class="card"><b>{{ stats.total }}</b><span>累计总评价</span></div>
          <div class="card"><b>{{ stats.positiveRate }}%</b><span>累计好评率</span></div>
        </div>

        <p class="readonly">🔒 评价数据只读，任何人都不可删除</p>

        <div v-if="statsByRoom.length" class="breakdown">
          <h3>📊 按房间统计（差评优先）</h3>
          <table>
            <thead><tr><th>房间</th><th>总数</th><th>好评</th><th>差评</th></tr></thead>
            <tbody>
              <tr v-for="x in statsByRoom" :key="x.room">
                <td>{{ x.room }}</td><td>{{ x.total }}</td>
                <td class="green">{{ x.positive }}</td><td class="red">{{ x.negative }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="statsByStaff.length" class="breakdown">
          <h3>📊 按员工工号统计</h3>
          <table>
            <thead><tr><th>工号</th><th>姓名</th><th>总数</th><th>好评</th><th>差评</th></tr></thead>
            <tbody>
              <tr v-for="x in statsByStaff" :key="x.staff">
                <td>{{ x.staff }}</td><td>{{ x.name || '-' }}</td><td>{{ x.total }}</td>
                <td class="green">{{ x.positive }}</td><td class="red">{{ x.negative }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p v-if="!loading && stats && !stats.total" class="empty">暂无数据</p>
      </div>

      <!-- ============ 统计报表 ============ -->
      <StatsReport v-else-if="page === 'report'" />

      <!-- ============ 评价记录 ============ -->
      <ReviewRecords v-else-if="page === 'records'" />

      <!-- ============ 系统设置（仅管理员） ============ -->
      <div v-else-if="page === 'settings'">
        <!-- LOGO 配置 -->
        <div class="brand-set">
          <div class="brand-set-head">🏨 品牌 LOGO（酒店可自行上传更换）</div>
          <div class="brand-set-body">
            <img class="brand-preview" :src="logoUrl" alt="当前 LOGO" />
            <div class="brand-actions">
              <label class="file-btn">
                {{ logoBusy ? '处理中…' : '选择图片并上传' }}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" :disabled="logoBusy" @change="onLogoPick" />
              </label>
              <button class="ghost-btn" :disabled="logoBusy" @click="resetLogo">恢复默认</button>
            </div>
            <p class="brand-hint">支持 png / jpg / webp / gif，建议正方形、不超过 2MB。上传后客人扫码页与后台会同步生效。</p>
            <p v-if="logoMsg" class="brand-msg">{{ logoMsg }}</p>
          </div>
        </div>

        <!-- 站点设置：改的是客人扫码后看到的内容 -->
        <SiteSettingsEditor />
      </div>

      <!-- ============ 账号管理（仅管理员） ============ -->
      <StaffAdmin v-else-if="page === 'users'" />
    </template>
  </div>
</template>

<style scoped>
.brand-head { display:flex; align-items:center; gap:8px; padding:4px 0 12px; font-weight:600; color:#444; }
.brand-head .brand-logo { width:28px; height:28px; border-radius:6px; }

/* 登录卡 */
.login-card { background:#fff; border:1px solid #eee; border-radius:12px; padding:20px; margin-top:24px; max-width:360px; margin-left:auto; margin-right:auto; }
.login-card h3 { margin:0 0 14px; font-size:1rem; color:#444; text-align:center; }
.login-card input { display:block; width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; font-size:.9rem; margin-bottom:10px; box-sizing:border-box; }
.login-card button { width:100%; padding:10px; border:none; border-radius:8px; background:var(--gold); color:#fff; font-size:.9rem; cursor:pointer; }
.login-card .alt { text-align:center; font-size:.75rem; margin:12px 0 0; }
.login-card .alt a { color:#999; }

/* 身份栏 */
.who { display:flex; justify-content:space-between; align-items:center; background:#fff; border:1px solid #eee; border-radius:10px; padding:10px 12px; margin-bottom:10px; }
.who-name { font-size:.85rem; color:#444; display:flex; align-items:center; gap:8px; }
.who-ops { display:flex; gap:6px; }
.mini { padding:4px 10px; border:1px solid #ddd; background:#fff; border-radius:6px; font-size:.75rem; color:#666; cursor:pointer; }
.pwd-box { background:#fff; border:1px solid #eee; border-radius:10px; padding:10px 12px; margin-bottom:10px; display:flex; gap:8px; flex-wrap:wrap; }
.pwd-box input { padding:8px; border:1px solid #ddd; border-radius:8px; font-size:.85rem; flex:1 1 140px; }
.pwd-box button { padding:8px 16px; border:none; border-radius:8px; background:var(--gold); color:#fff; font-size:.85rem; cursor:pointer; }
.msg { flex-basis:100%; margin:0; font-size:.8rem; color:#444; }
.err { color:var(--red); font-size:.8rem; }

.cards { display:grid; grid-template-columns:repeat(5,1fr); gap:8px; margin:12px 0; }
.card { background:#fff; border:1px solid #eee; border-radius:10px; padding:12px; text-align:center; }
.card b { display:block; font-size:1.3rem; color:#333; }
.card span { font-size:.72rem; color:#999; }
.card.green b { color:var(--green); }
.card.red b { color:var(--red); }
@media (max-width:560px) { .cards { grid-template-columns:repeat(3,1fr); } }
@media (max-width:380px) { .cards { grid-template-columns:repeat(2,1fr); } }

/* 页面标题 + 导航（对应旧系统后台的侧边导航条） */
.page-title { font-size:1rem; font-weight:700; color:#4a3a28; margin:4px 0 8px; }
.nav { display:flex; gap:6px; flex-wrap:wrap; background:#fff; border:1px solid #eee; border-radius:10px; padding:6px; margin-bottom:12px; }
.nav-item { display:flex; align-items:center; gap:5px; padding:7px 13px; border:none; background:transparent; border-radius:8px; font-size:.82rem; color:#777; cursor:pointer; }
.nav-item:hover { background:#faf7f2; }
.nav-item.on { background:var(--gold); color:#fff; font-weight:600; }
.nav-ico { font-size:.9rem; }

.readonly { font-size:.75rem; color:#999; margin:6px 0 10px; }

.table-wrap { overflow-x:auto; background:#fff; border:1px solid #eee; border-radius:10px; }
table { width:100%; border-collapse:collapse; }
th, td { padding:10px; border-bottom:1px solid #eee; font-size:.85rem; text-align:left; }
th { color:#888; font-weight:500; background:#fafafa; }
td.t { white-space:nowrap; color:#777; font-size:.78rem; }
.badge { padding:2px 8px; border-radius:10px; font-size:.72rem; }
.badge.positive { background:#eafaf0; color:var(--green); }
.badge.negative { background:#fdecea; color:var(--red); }
.badge.admin { background:#fdf6e3; color:#a8801a; }
.badge.viewer { background:#eef4fd; color:#3a6ea5; }
.empty { color:#999; text-align:center; }

.breakdown { margin-top:18px; }
.breakdown h3 { font-size:.95rem; color:#444; margin:0 0 8px; }
.breakdown table { margin-bottom:6px; background:#fff; border:1px solid #eee; border-radius:10px; overflow:hidden; }
.green { color:var(--green); font-weight:600; }
.red { color:var(--red); font-weight:600; }

.brand-set { background:#fff; border:1px solid #eee; border-radius:10px; padding:12px; margin:10px 0 16px; }
.brand-set-head { font-size:.85rem; font-weight:600; color:#555; margin-bottom:10px; }
.brand-set-body { display:flex; flex-wrap:wrap; align-items:center; gap:14px; }
.brand-preview { width:56px; height:56px; border-radius:10px; object-fit:contain; background:#fafafa; border:1px solid #eee; }
.brand-actions { display:flex; gap:8px; flex-wrap:wrap; }
.file-btn { display:inline-block; padding:8px 14px; border-radius:8px; background:var(--gold); color:#fff; font-size:.85rem; cursor:pointer; }
.file-btn input { display:none; }
.ghost-btn { padding:8px 14px; border-radius:8px; border:1px solid #ddd; background:#fff; color:#666; font-size:.85rem; cursor:pointer; }
.brand-hint { flex-basis:100%; margin:0; font-size:.75rem; color:#999; line-height:1.5; }
.brand-msg { flex-basis:100%; margin:0; font-size:.8rem; color:#444; }
</style>
