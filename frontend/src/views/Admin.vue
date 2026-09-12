<script setup>
import { ref, onMounted, computed } from 'vue'
import { api } from '../api/http.js'

// LOGO 路径（随 GitHub Pages 子路径自动适配）
const logoUrl = import.meta.env.BASE_URL + 'logo.png'

const token = ref(localStorage.getItem('admin_token') || '')
const stats = ref(null)
const reviews = ref([])
const error = ref('')
const loading = ref(false)
const filterType = ref('all')

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
    const [s, r] = await Promise.all([
      api.get('/stats?token=' + encodeURIComponent(token.value)),
      api.get('/reviews?token=' + encodeURIComponent(token.value))
    ])
    stats.value = s.data
    reviews.value = r.data
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
</style>
