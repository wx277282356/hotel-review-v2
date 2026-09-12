<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api/http.js'

const token = ref(localStorage.getItem('admin_token') || '')
const stats = ref(null)
const reviews = ref([])
const error = ref('')
const loading = ref(false)

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

onMounted(() => { if (token.value) load() })
</script>

<template>
  <div class="admin">
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

    <table v-if="reviews.length">
      <thead>
        <tr><th>时间</th><th>类型</th><th>房间</th><th>原因</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in reviews" :key="r.id">
          <td>{{ new Date(r.createdAt).toLocaleString() }}</td>
          <td>{{ r.type === 'positive' ? '好评' : '差评' }}</td>
          <td>{{ r.room || '-' }}</td>
          <td>{{ (r.reasons || []).join('、') || '-' }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="!loading && stats" class="empty">暂无数据</p>
  </div>
</template>

<style scoped>
.token-bar { display:flex; gap:8px; margin-bottom:12px; }
.token-bar input { flex:1; padding:10px; border:1px solid #ccc; border-radius:8px; }
.token-bar button { padding:10px 16px; border:none; background:var(--gold); color:#fff; border-radius:8px; cursor:pointer; }
.err { color:var(--red); }
.cards { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:16px; }
.card { background:#fff; border-radius:10px; padding:14px; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,.08); }
.card b { display:block; font-size:1.4rem; }
.card span { font-size:.8rem; color:#888; }
.card.green b { color:var(--green); }
.card.red b { color:var(--red); }
table { width:100%; border-collapse:collapse; background:#fff; border-radius:10px; overflow:hidden; }
th, td { padding:10px; border-bottom:1px solid #eee; font-size:.85rem; text-align:left; }
.empty { color:#999; text-align:center; }
</style>
