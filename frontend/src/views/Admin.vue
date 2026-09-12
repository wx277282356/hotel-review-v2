<script setup>
import { ref, onMounted, computed } from 'vue'
import { api } from '../api/http.js'
import { logoUrl, resolveLogo, bumpLogoVersion } from '../utils/logo.js'

const token = ref(localStorage.getItem('admin_token') || '')
const stats = ref(null)
const reviews = ref([])
const statsByRoom = ref([])
const statsByStaff = ref([])
const error = ref('')
const loading = ref(false)
const filterType = ref('all')

// ---- 品牌 LOGO 上传 ----
const logoMsg = ref('')
const logoBusy = ref(false)

async function onLogoPick(e) {
  const file = e.target.files?.[0]
  if (!file) return
  logoMsg.value = ''
  if (!token.value) { logoMsg.value = '请先填写管理员令牌'; return }
  if (file.size > 2 * 1024 * 1024) { logoMsg.value = '图片不能超过 2MB'; return }

  logoBusy.value = true
  try {
    const fd = new FormData()
    fd.append('file', file)
    const res = await api.post('/settings/logo?token=' + encodeURIComponent(token.value), fd)
    bumpLogoVersion(res.data?.version)
    await resolveLogo()
    logoMsg.value = '✅ LOGO 已更新，客人端刷新后生效'
  } catch (err) {
    logoMsg.value = '❌ 上传失败：' + (err.response?.status === 401 ? '令牌错误' : (err.message || '网络错误'))
  } finally {
    logoBusy.value = false
    e.target.value = ''
  }
}

async function resetLogo() {
  logoMsg.value = ''
  if (!token.value) { logoMsg.value = '请先填写管理员令牌'; return }
  logoBusy.value = true
  try {
    await api.delete('/settings/logo?token=' + encodeURIComponent(token.value))
    localStorage.removeItem('logo_version')
    await resolveLogo()
    logoMsg.value = '✅ 已恢复默认 LOGO'
  } catch (err) {
    logoMsg.value = '❌ 操作失败：' + (err.response?.status === 401 ? '令牌错误' : (err.message || '网络错误'))
  } finally {
    logoBusy.value = false
  }
}

const filtered = computed(() => {
  if (filterType.value === 'all') return reviews.value
  return reviews.value.filter(r => r.type === filterType.value)
})

async function load() {
  if (!token.value) { error.value = '请先输入管理员令牌'; return }
  localStorage.setItem('admin_token', token.value)
  error.value = ''
  loading.value = true
  try {
    const [s, r, byRoom, byStaff] = await Promise.all([
      api.get('/stats?token=' + encodeURIComponent(token.value)),
      api.get('/reviews?token=' + encodeURIComponent(token.value)),
      api.get('/stats/by-room?token=' + encodeURIComponent(token.value)),
      api.get('/stats/by-staff?token=' + encodeURIComponent(token.value))
    ])
    stats.value = s.data
    reviews.value = r.data
    statsByRoom.value = byRoom.data
    statsByStaff.value = byStaff.data
  } catch (e) {
    error.value = '加载失败：' + (e.response?.status === 401 ? '令牌错误' : (e.message || '网络错误'))
  } finally {
    loading.value = false
  }
}

function exportCsv() {
  if (!reviews.value.length) return
  const header = ['时间', '类型', '房间', '原因', '员工']
  const rows = reviews.value.map(r => [
    new Date(r.createdAt).toLocaleString(),
    r.type === 'positive' ? '好评' : '差评',
    r.room || '',
    (r.reasons || []).join('/'),
    r.staffUsername || ''
  ])
  const csv = [header, ...rows].map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = '评价数据_' + new Date().toISOString().slice(0, 10) + '.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}

onMounted(() => { if (token.value) load() })
</script>

<template>
  <div class="admin">
    <div class="brand-head">
      <img class="brand-logo" :src="logoUrl" alt="" />
      <span>城市酒店 · 点评后台</span>
    </div>
    <div class="token-bar">
      <input v-model="token" placeholder="管理员令牌" />
      <button @click="load">加载数据</button>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

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

    <div v-if="stats" class="cards">
      <div class="card"><b>{{ stats.total }}</b><span>总评价</span></div>
      <div class="card green"><b>{{ stats.positive }}</b><span>好评</span></div>
      <div class="card red"><b>{{ stats.negative }}</b><span>差评</span></div>
      <div class="card"><b>{{ stats.positiveRate }}%</b><span>好评率</span></div>
    </div>

    <div v-if="reviews.length" class="toolbar">
      <div class="filters">
        <button :class="{on:filterType==='all'}" @click="filterType='all'">全部</button>
        <button :class="{on:filterType==='positive'}" @click="filterType='positive'">好评</button>
        <button :class="{on:filterType==='negative'}" @click="filterType='negative'">差评</button>
      </div>
      <button class="export" @click="exportCsv">⬇ 导出 CSV</button>
    </div>

    <p class="note">🔒 评价数据只读，任何人都不可删除（系统硬约束）。</p>

    <table v-if="filtered.length">
      <thead>
        <tr><th>时间</th><th>类型</th><th>房间</th><th>原因</th><th>员工</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in filtered" :key="r.id">
          <td>{{ new Date(r.createdAt).toLocaleString() }}</td>
          <td>
            <span class="badge" :class="r.type">{{ r.type === 'positive' ? '好评' : '差评' }}</span>
          </td>
          <td>{{ r.room || '-' }}</td>
          <td>{{ (r.reasons || []).join('、') || '-' }}</td>
          <td>{{ r.staffUsername || '-' }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="!loading && stats" class="empty">暂无数据</p>

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
        <thead><tr><th>工号</th><th>总数</th><th>好评</th><th>差评</th></tr></thead>
        <tbody>
          <tr v-for="x in statsByStaff" :key="x.staff">
            <td>{{ x.staff }}</td><td>{{ x.total }}</td>
            <td class="green">{{ x.positive }}</td><td class="red">{{ x.negative }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.brand-head { display:flex; align-items:center; gap:8px; font-weight:700; color:var(--gold); margin-bottom:12px; font-size:1.05rem; }
.brand-head .brand-logo { width:28px; height:28px; border-radius:6px; }
.token-bar { display:flex; gap:8px; margin-bottom:12px; }
.token-bar input { flex:1; padding:10px; border:1px solid #ccc; border-radius:8px; }
.token-bar button { padding:10px 16px; border:none; background:var(--gold); color:#fff; border-radius:8px; cursor:pointer; }
.err { color:var(--red); }
.cards { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:14px; }
.card { background:#fff; border-radius:10px; padding:14px; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,.08); }
.card b { display:block; font-size:1.4rem; }
.card span { font-size:.8rem; color:#888; }
.card.green b { color:var(--green); }
.card.red b { color:var(--red); }
.toolbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px; }
.filters { display:flex; gap:6px; }
.filters button { padding:6px 12px; border:1px solid #ccc; background:#fff; border-radius:18px; cursor:pointer; font-size:.82rem; }
.filters button.on { border-color:var(--gold); background:#fff8e6; color:#a07d1f; }
.export { padding:8px 14px; border:1px solid var(--gold); background:#fff; color:#a07d1f; border-radius:8px; cursor:pointer; font-size:.85rem; }
.note { font-size:.8rem; color:#888; background:#f7f7f7; padding:8px 12px; border-radius:8px; margin:4px 0 10px; }
table { width:100%; border-collapse:collapse; background:#fff; border-radius:10px; overflow:hidden; }
th, td { padding:10px; border-bottom:1px solid #eee; font-size:.85rem; text-align:left; }
.badge { padding:2px 8px; border-radius:10px; font-size:.78rem; }
.badge.positive { background:#eafaf0; color:var(--green); }
.badge.negative { background:#fdecea; color:var(--red); }
.empty { color:#999; text-align:center; }
.breakdown { margin-top:18px; }
.breakdown h3 { font-size:.95rem; color:#444; margin:0 0 8px; }
.breakdown table { margin-bottom:6px; }
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
