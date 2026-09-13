<!--
  ============================================================
  评价记录（明细）—— 对齐旧系统 admin.html 的 page-records

  旧系统那个页面是纯前端算全部数据再切片；这里改成把筛选条件交给后端，
  由 /api/reviews 返回当页数据 + X-Total-Count 总数。

  对齐点（逐条对照旧系统 admin.html:1038-1087 / html:455-509）：
    · 筛选条件：开始日期、结束日期、类型、差评原因、操作工号、房间号（六个，全部生效）
    · 默认 = 全部时间（不预填日期区间）。Q12 决策：导出要"默认全部时间 + 跟随筛选 + 按钮旁标'将导出 N 条'"，
      为避免旧系统"以为导出全部、其实只有一个月"的坑，这里连页面默认都改成全量，日期框仅作可选筛选。
    · 每页 20 条（旧系统 REC_PAGE_SIZE = 20），只在总页数 > 1 时显示页码
    · 列：时间 / 房间号 / 评价 / 差评原因 / 操作工号   顺序与文案一致
    · 时间格式 `YYYY-MM-DD HH:mm`（本地时区，分钟精度）
    · 评价列：😊 好评 / 😞 差评 徽章；原因用「、」连接，空显示 "-"
    · 操作工号列：工号 + 换行 + 姓名（旧系统就是这样两行显示）
    · 计数文案：`共 N 条记录`
    · 导出 Excel：文件名 `{酒店名}_评价明细_{日期}.xlsx`，sheet 名「评价明细」，
      带标题行「{酒店名} - 服务点评明细记录」+ 导出时间行 + 7 列（含员工姓名、备注）

  与旧系统**有意不同**的两处（都属修正旧 bug，已在对照清单里记录）：
    1. 旧系统导出漏了「房间号」筛选条件（exportRecordsExcel 没传 room），这里补上 ——
       导出结果与页面所见完全一致。
    2. 旧系统默认把日期筛成最近 30 天且没有任何提示，导致"以为导出的是全部、其实只有一个月"。
       这里 Q12 改为默认就是全量（不预填日期），并新增按钮旁「将导出 N 条」提示，导出范围对前台完全可见。
-->
<script setup>
import { ref, computed, onMounted, watch, onBeforeUnmount } from 'vue'
import { api } from '../api/http.js'
import { auth, isAdmin } from '../utils/auth.js'
import { settings } from '../utils/settings.js'

// 注意：xlsx **不要**在顶层 import。
// 客人页与后台共用同一个 JS 包，顶层 import 会把 ~430KB 的表格库塞给每个扫码的客人；
// 改成点「导出 Excel」时才动态加载（单独 chunk）。
// 另：xlsx 是 CommonJS 包，某些打包器下命名导出会挂在 default 上，故做一次兜底。
async function getXlsx() {
  const mod = await import('xlsx')
  return mod.default ?? mod
}

// 与旧系统一致：每页 20 条
const REC_PAGE_SIZE = 20

// ---------------- 状态 ----------------
const startDate = ref('')
const endDate = ref('')
const type = ref('')
const reason = ref('')
const staff = ref('')
const room = ref('')

const rows = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const err = ref('')
const exporting = ref(false)

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / REC_PAGE_SIZE)))

// ---------------- 工具 ----------------
function fmtDateInput(d) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 时间显示：YYYY-MM-DD HH:mm（本地时区）—— 与旧系统逐字一致
function fmtTime(iso) {
  const d = new Date(iso)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 把「用户选的本地日期」换算成当天的起止时刻再传给后端。
// 必须在前端算：旧系统是在浏览器里按使用者本地时区判"这一天"的，
// 若交给服务器按它自己的时区切，跨时区就会错一天。
function dayStart(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString()
}
function dayEnd(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString()
}

// 组装当前筛选条件（页面查询与导出共用同一套，保证"导出 = 所见"）
function currentFilters() {
  const p = {}
  if (startDate.value) p.start = dayStart(startDate.value)
  if (endDate.value) p.end = dayEnd(endDate.value)
  if (type.value) p.type = type.value
  if (reason.value) p.reason = reason.value
  if (staff.value) p.staff = staff.value
  const rm = room.value.trim().toUpperCase()
  if (rm) p.room = rm
  return p
}

// ---------------- 查询 ----------------
async function load() {
  err.value = ''
  loading.value = true
  try {
    const res = await api.get('/reviews', {
      params: {
        token: auth.value.token,
        ...currentFilters(),
        offset: (page.value - 1) * REC_PAGE_SIZE,
        limit: REC_PAGE_SIZE
      }
    })
    rows.value = res.data || []
    // 总数由响应头带回（后端已用 WithExposedHeaders 暴露，否则浏览器不给 JS 读）
    const t = res.headers?.['x-total-count']
    total.value = t != null ? Number(t) : rows.value.length

    // 筛选后页数变少时回到第 1 页重查（对应旧系统的 `if (recPage > totalPages) recPage = 1`）
    if (page.value > totalPages.value) {
      page.value = 1
      await load()
    }
  } catch (e) {
    if (e.response?.status === 401) err.value = '登录已失效，请重新登录'
    else err.value = '查询失败：' + (e.response?.data?.error || e.message || '网络错误')
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

// 任一筛选变化 → 回到第 1 页重查
function reload() {
  page.value = 1
  load()
}

// 房间号是手动输入的，敲一下查一次会把后端打爆 → 停 350ms 再查
let roomTimer = null
watch(room, () => {
  clearTimeout(roomTimer)
  roomTimer = setTimeout(reload, 350)
})
watch([startDate, endDate, type, reason, staff], reload)

function goto(p) {
  page.value = p
  load()
}

function clearDates() {
  startDate.value = ''
  endDate.value = ''
}

// ---------------- 下拉选项 ----------------
// 差评原因：与旧系统一样取"后台配置的（启用中的）原因列表"
const reasonOptions = computed(() => settings.value.negativeReasons || [])

// 操作工号：旧系统是从"所有评价里出现过的工号" + "用户表"两处汇总。
// 这里对应：/api/stats/by-staff（评价里出现过的）+ /api/staff（账号表，仅管理员能读）。
const staffOptions = ref([])
async function loadStaffOptions() {
  const map = {}
  try {
    const res = await api.get('/stats/by-staff', { params: { token: auth.value.token } })
    for (const s of res.data || []) {
      if (s.staff && s.staff !== '未记录') map[s.staff] = s.name || s.staff
    }
  } catch { /* 拉不到就只显示已选中的那个，不影响查询 */ }
  if (isAdmin()) {
    try {
      const res = await api.get('/staff', { params: { token: auth.value.token } })
      for (const u of res.data || []) {
        if (!map[u.username]) map[u.username] = u.displayName || u.username
      }
    } catch { /* 同上 */ }
  }
  staffOptions.value = Object.entries(map)
    .map(([username, name]) => ({ username, name }))
    .sort((a, b) => a.username.localeCompare(b.username))
}

onMounted(async () => {
  // Q12：默认「全部时间」（不预填日期区间）。
  // 旧系统把默认锁成最近 30 天且无提示，导致"以为导出全部、其实只有一个月"的坑；
  // 这里改成默认就查全部，配合「将导出 N 条」让导出范围对前台可见、可预期。
  // 想看某段区间再用日期框筛选即可，「清除日期」一键回到全量。
  await load()
  loadStaffOptions()
})

onBeforeUnmount(() => clearTimeout(roomTimer))

// ---------------- 导出 Excel ----------------
// 逻辑与旧系统 exportRecordsExcel 一致：导出**当前筛选条件下的全部记录**（不只是当前页）。
async function exportExcel() {
  if (exporting.value) return
  exporting.value = true
  err.value = ''
  try {
    // 点导出才动态加载 xlsx（单独 chunk，不拖累客人扫码包）
    const XLSX = await getXlsx()
    // 不传 limit → 后端返回符合筛选条件的全部记录
    const res = await api.get('/reviews', {
      params: { token: auth.value.token, ...currentFilters() }
    })
    const list = res.data || []
    const hotelName = settings.value.hotelName || '城市酒店'
    const pad = n => String(n).padStart(2, '0')
    const fullTime = iso => {
      const d = new Date(iso)
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
        + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    }

    const aoa = [
      [`${hotelName} - 服务点评明细记录`],
      [`导出时间：${new Date().toLocaleString('zh-CN')}`],
      [],
      ['时间', '房间号', '评价类型', '差评原因', '操作工号', '员工姓名', '备注'],
      ...list.map(r => [
        fullTime(r.createdAt),
        r.room || '',
        r.type === 'positive' ? '好评' : '差评',
        (r.reasons || []).join('、'),
        r.staffUsername || '',
        r.staffName || '',
        ''
      ])
    ]

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = [
      { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 15 }
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '评价明细')
    XLSX.writeFile(wb, `${hotelName}_评价明细_${fmtDateInput(new Date())}.xlsx`)
  } catch (e) {
    err.value = '导出失败：' + (e.response?.data?.error || e.message)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="rec">
    <!-- 筛选栏：六个条件 + 导出，顺序对齐旧系统 -->
    <div class="filter-bar">
      <div class="fg">
        <span class="fl">开始日期</span>
        <input v-model="startDate" type="date" class="fs" />
      </div>
      <div class="fg">
        <span class="fl">结束日期</span>
        <input v-model="endDate" type="date" class="fs" />
      </div>
      <div class="fg">
        <span class="fl">类型</span>
        <select v-model="type" class="fs">
          <option value="">全部</option>
          <option value="positive">好评</option>
          <option value="negative">差评</option>
        </select>
      </div>
      <div class="fg">
        <span class="fl">差评原因</span>
        <select v-model="reason" class="fs">
          <option value="">全部原因</option>
          <option v-for="r in reasonOptions" :key="r" :value="r">{{ r }}</option>
        </select>
      </div>
      <div class="fg">
        <span class="fl">操作工号</span>
        <select v-model="staff" class="fs">
          <option value="">全部工号</option>
          <option v-for="s in staffOptions" :key="s.username" :value="s.username">
            {{ s.username }}（{{ s.name }}）
          </option>
        </select>
      </div>
      <div class="fg">
        <span class="fl">房间号</span>
        <input v-model="room" class="fs room" placeholder="如 802" />
      </div>

      <button class="btn ghost" @click="clearDates">清除日期</button>
      <span class="export-hint">将导出 <b>{{ total }}</b> 条</span>
      <button v-if="isAdmin()" class="btn gold" :disabled="exporting || total === 0" @click="exportExcel">
        {{ exporting ? '导出中…' : '📥 导出 Excel' }}
      </button>
    </div>

    <p v-if="err" class="err">{{ err }}</p>

    <div class="card">
      <div class="card-head">
        <span class="card-title">评价明细记录</span>
        <span class="count">共 {{ total }} 条记录</span>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>时间</th><th>房间号</th><th>评价</th><th>差评原因</th><th>操作工号</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id">
              <td class="t">{{ fmtTime(r.createdAt) }}</td>
              <td>
                <code v-if="r.room" class="code">{{ r.room }}</code>
                <span v-else class="dash">-</span>
              </td>
              <td>
                <span class="badge" :class="r.type === 'positive' ? 'positive' : 'negative'">
                  {{ r.type === 'positive' ? '😊 好评' : '😞 差评' }}
                </span>
              </td>
              <td class="reasons">{{ (r.reasons || []).join('、') || '-' }}</td>
              <td>
                <span v-if="r.staffUsername">
                  <code class="code">{{ r.staffUsername }}</code><br />
                  <span class="sname">{{ r.staffName || '' }}</span>
                </span>
                <span v-else class="dash">-</span>
              </td>
            </tr>
            <tr v-if="!rows.length">
              <td colspan="5" class="empty">
                {{ loading ? '加载中…' : '暂无数据' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 页码：只在总页数 > 1 时出现（与旧系统一致） -->
      <div v-if="totalPages > 1" class="pager">
        <button
          v-for="i in totalPages"
          :key="i"
          class="pg-btn"
          :class="{ on: i === page }"
          @click="goto(i)"
        >{{ i }}</button>
      </div>
    </div>

    <p class="note">
      🔒 评价数据只读，任何人都不可删除。默认显示全部记录；导出按当前筛选条件导出全部匹配数据，按钮旁「将导出 N 条」即本次实际导出条数。
    </p>
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end;
  background: #fff; border: 1px solid #eee; border-radius: 10px;
  padding: 12px; margin-bottom: 12px;
}
.fg { display: flex; flex-direction: column; gap: 4px; }
.fl { font-size: .72rem; color: #999; }
.fs {
  padding: 7px 9px; border: 1px solid #ddd; border-radius: 8px;
  font-size: .82rem; background: #fff; color: #444; min-width: 120px;
}
.fs.room { min-width: 100px; }
.btn {
  padding: 7px 14px; border-radius: 8px; font-size: .82rem; cursor: pointer; border: 1px solid #ddd;
}
.btn.gold { background: var(--gold); color: #fff; border-color: var(--gold); }
.btn.ghost { background: #fff; color: #666; }
.btn:disabled { opacity: .6; cursor: default; }
.export-hint { font-size: .8rem; color: #888; align-self: center; }
.export-hint b { color: var(--gold); }
.err { color: var(--red); font-size: .8rem; margin: 0 0 10px; }

.card { background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 12px; }
.card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.card-title { font-size: .9rem; font-weight: 600; color: #555; }
.count { font-size: .8rem; color: #888; }

.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 10px; border-bottom: 1px solid #eee; font-size: .85rem; text-align: left; }
th { color: #888; font-weight: 500; background: #fafafa; white-space: nowrap; }
td.t { white-space: nowrap; color: #777; font-size: .78rem; }
.code { background: #faf6ef; padding: 2px 7px; border-radius: 4px; font-size: .8rem; color: #7a5c33; }
.sname { color: #888; font-size: .78rem; }
.dash { color: #ccc; font-size: .8rem; }
.reasons { color: #666; }
.empty { text-align: center; color: #aaa; padding: 32px; }

.badge { padding: 2px 8px; border-radius: 10px; font-size: .72rem; white-space: nowrap; }
.badge.positive { background: #eafaf0; color: var(--green); }
.badge.negative { background: #fdecea; color: var(--red); }

.pager { display: flex; justify-content: center; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
.pg-btn {
  min-width: 32px; padding: 5px 8px; border: 1px solid #ddd; background: #fff;
  border-radius: 8px; font-size: .8rem; color: #666; cursor: pointer;
}
.pg-btn.on { background: var(--gold); color: #fff; border-color: var(--gold); }

.note { font-size: .75rem; color: #999; margin: 10px 0 0; }
</style>
