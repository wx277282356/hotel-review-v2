<!--
  ============================================================
  统计报表 —— 对齐旧系统 admin.html 的 page-report (html:355-451 / js:941-1027)

  对齐点：
    · 统计周期：按天 / 按周 / 按月（旧系统 period-tab 三档）
    · 默认日期区间 = 今天往前 29 天 ~ 今天（旧系统 initReportDates）
    · 柱状图：Chart.js 柱状图，两组数据「好评」（绿 rgba(74,140,94,.75)）
      与「差评」（红 rgba(140,61,61,.75)），圆角 6，图例在上，y 轴从 0 起、只取整数
    · 汇总数据表：周期 | 好评数 | 差评数 | 合计 | 好评率
      卡片标题右侧显示 `合计：好评 X / 差评 Y / 好评率 Z%`
    · 按工号统计 / By Staff Account：工号 | 姓名 | 好评数 | 差评数 | 合计 | 好评率
    · 按房间统计 / By Room（有评价记录的房间）：房间号 | 好评数 | 差评数 | 合计 | 好评率
      房间好评率 < 60% 显示红色（旧系统就是这个阈值）
    · 房间号筛选：只过滤下方"按房间统计"表（旧系统 renderReport 里 room 也只作用于这张表）

  本版新增（B-7~B-10，均为对照清单已拍板的决策，无待定项）：
    · B-7 近 7 天趋势图：固定展示最近 7 天（MM-DD 标签、7 根柱）
    · B-8 好差评占比图：环形图（doughnut，cutout 65%，图例在下），取全量数据
    · B-9 差评原因排行：序号 + 原因 + 进度条（宽度=次数/最大值）+ 次数；全量、次数降序；空态「暂无差评数据」
    · B-10 差评房间预警：房间号/差评数/好评数/合计/差评率；取近 30 天、仅 negative>0、Top 10；
      差评数 ≥3 的行浅红底；右侧固定文案「客房部重点关注」；空态「近30天无差评记录 🎉」

  ⚠️ **未复刻的一处旧系统缺陷**：旧系统报表页的「类型筛选 / 差评原因 / 操作工号」三个下拉
  在 renderReport() 里被读进变量后**从未使用**（栅格摆设）。这里干脆不摆这三个空控件；
  要不要让它们真正生效已列入对照清单待你拍板（Q12）。
-->
<script setup>
import { ref, computed, onMounted, watch, onBeforeUnmount, nextTick } from 'vue'
import { api } from '../api/http.js'
import { auth } from '../utils/auth.js'

// Chart.js 用**动态导入**，不要写成顶层 import。
// 客人页与后台在同一个包里（没有路由按需拆），顶层 import 会让每个扫码的客人
// 都白下载 ~200KB 图表库。动态导入后它单独成一个 chunk，只有打开本页时才加载。
let ChartCtor = null
async function getChart() {
  if (!ChartCtor) {
    const mod = await import('chart.js/auto')
    ChartCtor = mod.default ?? mod
  }
  return ChartCtor
}

const period = ref('day')          // day | week | month
const startDate = ref('')
const endDate = ref('')
const room = ref('')

const byPeriod = ref([])
const byStaff = ref([])
const byRoom = ref([])
const byReason = ref([])           // B-9：差评原因排行
const trend7 = ref([])             // B-7：近 7 天
const overall = ref({ total: 0, positive: 0, negative: 0 })  // B-8：全量占比
const loading = ref(false)
const err = ref('')

const canvas = ref(null)
const canvasTrend = ref(null)
const canvasRatio = ref(null)
let chart = null
let chartTrend = null
let chartRatio = null

const PERIOD_LABEL = { day: '按天', week: '按周', month: '按月' }

function fmtDateInput(d) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function dayStart(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString()
}
function dayEnd(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString()
}

function dateParams() {
  const p = {}
  if (startDate.value) p.start = dayStart(startDate.value)
  if (endDate.value) p.end = dayEnd(endDate.value)
  return p
}

// 周期归属按**使用者本地时区**算（东八区 = 480 分钟）。
// 不传的话凌晨 0-8 点的评价会被算到前一天，与旧系统的表现对不上。
function tzMinutes() {
  return -new Date().getTimezoneOffset()
}

const rate = (pos, total) => (total > 0 ? Math.round(pos / total * 100) : 0)
const rateClass = r => (r < 60 ? 'red' : 'green')

// B-9：最大次数（进度条基准）
const maxReasonCount = computed(() => (byReason.value.length ? byReason.value[0].count : 0))
const reasonPct = c => (maxReasonCount.value ? Math.round(c / maxReasonCount.value * 100) : 0)

// B-10：差评房间预警（近 30 天、仅 negative>0、按差评数降序、Top 10）
const warnRooms = computed(() =>
  byRoom.value
    .filter(r => r.negative > 0)
    .sort((a, b) => b.negative - a.negative)
    .slice(0, 10)
)

// ---------------- 数据 ----------------
async function load() {
  err.value = ''
  loading.value = true
  try {
    const tk = { token: auth.value.token, ...dateParams() }
    const end = new Date()
    const s7 = new Date()
    s7.setDate(s7.getDate() - 6)
    const t7params = {
      token: auth.value.token, period: 'day', tz: tzMinutes(),
      start: dayStart(fmtDateInput(s7)), end: dayEnd(fmtDateInput(end))
    }
    const [per, stf, rm, reason, ov, t7] = await Promise.all([
      api.get('/stats/by-period', { params: { ...tk, period: period.value, tz: tzMinutes() } }),
      api.get('/stats/by-staff', { params: tk }),
      api.get('/stats/by-room', { params: tk }),
      api.get('/stats/by-reason', { params: tk }),
      api.get('/stats', { params: { token: auth.value.token } }),
      api.get('/stats/by-period', { params: t7params })
    ])
    byPeriod.value = per.data || []
    byStaff.value = stf.data || []
    byRoom.value = rm.data || []
    byReason.value = reason.data || []
    overall.value = ov.data || { total: 0, positive: 0, negative: 0 }
    trend7.value = t7.data || []
    await nextTick()
    drawCharts()
  } catch (e) {
    if (e.response?.status === 401) err.value = '登录已失效，请重新登录'
    else err.value = '加载失败：' + (e.response?.data?.error || e.message || '网络错误')
  } finally {
    loading.value = false
  }
}

function barConfig(labels, pos, neg, legendTop = true) {
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: '好评', data: pos, backgroundColor: 'rgba(74,140,94,.75)', borderRadius: 6 },
        { label: '差评', data: neg, backgroundColor: 'rgba(140,61,61,.75)', borderRadius: 6 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: legendTop ? 'top' : 'bottom' } },
      scales: {
        x: { stacked: false, grid: { display: false } },
        y: { beginAtZero: true, ticks: { precision: 0 } }
      }
    }
  }
}

function doughnutConfig(pos, neg) {
  return {
    type: 'doughnut',
    data: {
      labels: ['好评', '差评'],
      datasets: [{
        data: [pos, neg],
        backgroundColor: ['rgba(74,140,94,.8)', 'rgba(140,61,61,.8)'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: { legend: { position: 'bottom' } }
    }
  }
}

async function drawCharts() {
  const Chart = await getChart()
  if (canvas.value) {
    if (chart) chart.destroy()
    chart = new Chart(canvas.value, barConfig(
      byPeriod.value.map(s => s.period),
      byPeriod.value.map(s => s.positive),
      byPeriod.value.map(s => s.negative)
    ))
  }
  if (canvasTrend.value) {
    if (chartTrend) chartTrend.destroy()
    chartTrend = new Chart(canvasTrend.value, barConfig(
      trend7.value.map(s => s.period.slice(5)),  // MM-DD
      trend7.value.map(s => s.positive),
      trend7.value.map(s => s.negative)
    ))
  }
  if (canvasRatio.value) {
    if (chartRatio) chartRatio.destroy()
    chartRatio = new Chart(canvasRatio.value, doughnutConfig(
      overall.value.positive, overall.value.negative
    ))
  }
}

// 汇总行：合计好评/差评/好评率（旧系统 rpt-summary 文案）
const summary = computed(() => {
  let pos = 0, neg = 0
  for (const s of byPeriod.value) { pos += s.positive; neg += s.negative }
  const total = pos + neg
  return `合计：好评 ${pos} / 差评 ${neg} / 好评率 ${rate(pos, total)}%`
})

// 房间号筛选：只作用于"按房间统计"表（与旧系统一致）
const roomRows = computed(() => {
  const kw = room.value.trim().toUpperCase()
  if (!kw) return byRoom.value
  return byRoom.value.filter(r => String(r.room || '').toUpperCase() === kw)
})

function setPeriod(p) {
  period.value = p
  load()
}

watch([startDate, endDate], load)

onMounted(() => {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 29)
  startDate.value = fmtDateInput(start)
  endDate.value = fmtDateInput(end)
  load()
})

onBeforeUnmount(() => {
  if (chart) chart.destroy()
  if (chartTrend) chartTrend.destroy()
  if (chartRatio) chartRatio.destroy()
})
</script>

<template>
  <div class="rpt">
    <div class="filter-bar">
      <div class="fg">
        <span class="fl">统计周期</span>
        <div class="tabs">
          <button
            v-for="(label, key) in PERIOD_LABEL"
            :key="key"
            class="tab"
            :class="{ on: period === key }"
            @click="setPeriod(key)"
          >{{ label }}</button>
        </div>
      </div>
      <div class="fg">
        <span class="fl">开始日期</span>
        <input v-model="startDate" type="date" class="fs" />
      </div>
      <div class="fg">
        <span class="fl">结束日期</span>
        <input v-model="endDate" type="date" class="fs" />
      </div>
      <div class="fg">
        <span class="fl">房间号</span>
        <input v-model="room" class="fs room" placeholder="如 802" />
      </div>
      <button class="btn ghost" @click="startDate = ''; endDate = ''">清除日期</button>
    </div>

    <p v-if="err" class="err">{{ err }}</p>

    <div class="card">
      <div class="card-title">统计图表（按所选周期）</div>
      <div class="chart-wrap">
        <canvas ref="canvas"></canvas>
      </div>
      <p v-if="!byPeriod.length && !loading" class="empty">暂无可统计的数据</p>
    </div>

    <div class="card">
      <div class="card-title">📅 近 7 天趋势 / Last 7 Days</div>
      <div class="chart-wrap">
        <canvas ref="canvasTrend"></canvas>
      </div>
      <p v-if="!trend7.length && !loading" class="empty">近 7 天暂无可统计的数据</p>
    </div>

    <div class="card">
      <div class="card-title">🥧 好差评占比 / Ratio</div>
      <div class="chart-wrap ratio">
        <canvas ref="canvasRatio"></canvas>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <span class="card-title">汇总数据（按所选周期）</span>
        <span class="summary">{{ summary }}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>周期</th><th>好评数</th><th>差评数</th><th>合计</th><th>好评率</th></tr>
          </thead>
          <tbody>
            <tr v-for="s in byPeriod" :key="s.period">
              <td>{{ s.period }}</td>
              <td><span class="badge positive">{{ s.positive }}</span></td>
              <td><span class="badge negative">{{ s.negative }}</span></td>
              <td>{{ s.total }}</td>
              <td><b class="green">{{ rate(s.positive, s.total) }}%</b></td>
            </tr>
            <tr v-if="!byPeriod.length"><td colspan="5" class="empty">暂无数据</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-title">🔻 差评原因排行 / Top Negative Reasons</div>
      <div v-if="byReason.length" class="rank">
        <div v-for="(r, i) in byReason" :key="r.reason" class="rank-row">
          <span class="rank-idx">{{ i + 1 }}</span>
          <span class="rank-name">{{ r.reason }}</span>
          <span class="rank-bar"><i :style="{ width: reasonPct(r.count) + '%' }"></i></span>
          <span class="rank-cnt">{{ r.count }}</span>
        </div>
      </div>
      <p v-else class="empty">暂无差评数据</p>
    </div>

    <div class="card warn-card">
      <div class="card-head">
        <span class="card-title">🚨 差评房间预警 / Room Alerts</span>
        <span class="side-note">客房部重点关注</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>房间号</th><th>差评数</th><th>好评数</th><th>合计</th><th>差评率</th></tr>
          </thead>
          <tbody>
            <tr v-for="s in warnRooms" :key="s.room" :class="{ 'warn-row': s.negative >= 3 }">
              <td><code class="code">{{ s.room }}</code></td>
              <td><span class="badge negative">{{ s.negative }}</span></td>
              <td><span class="badge positive">{{ s.positive }}</span></td>
              <td>{{ s.total }}</td>
              <td><b :class="rateClass(rate(s.positive, s.total))">{{ rate(s.positive, s.total) }}%</b></td>
            </tr>
            <tr v-if="!warnRooms.length"><td colspan="5" class="empty">近30天无差评记录 🎉</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-title">👥 按工号统计 / By Staff Account</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>工号</th><th>姓名</th><th>好评数</th><th>差评数</th><th>合计</th><th>好评率</th></tr>
          </thead>
          <tbody>
            <tr v-for="s in byStaff" :key="s.staff">
              <td><code class="code">{{ s.staff }}</code></td>
              <td class="name">{{ s.name }}</td>
              <td><span class="badge positive">{{ s.positive }}</span></td>
              <td><span class="badge negative">{{ s.negative }}</span></td>
              <td>{{ s.total }}</td>
              <td><b class="green">{{ rate(s.positive, s.total) }}%</b></td>
            </tr>
            <tr v-if="!byStaff.length">
              <td colspan="6" class="empty">暂无数据（评价记录中暂无工号信息）</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-title">🏨 按房间统计 / By Room（有评价记录的房间）</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>房间号</th><th>好评数</th><th>差评数</th><th>合计</th><th>好评率</th></tr>
          </thead>
          <tbody>
            <tr v-for="s in roomRows" :key="s.room">
              <td><code class="code">{{ s.room }}</code></td>
              <td><span class="badge positive">{{ s.positive }}</span></td>
              <td><span class="badge negative">{{ s.negative }}</span></td>
              <td>{{ s.total }}</td>
              <td><b :class="rateClass(rate(s.positive, s.total))">{{ rate(s.positive, s.total) }}%</b></td>
            </tr>
            <tr v-if="!roomRows.length"><td colspan="5" class="empty">暂无数据</td></tr>
          </tbody>
        </table>
      </div>
    </div>
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
.tabs { display: flex; gap: 4px; background: #eee; border-radius: 8px; padding: 3px; }
.tab {
  padding: 4px 12px; border: none; background: transparent; border-radius: 6px;
  font-size: .8rem; color: #666; cursor: pointer;
}
.tab.on { background: #fff; color: #333; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.btn { padding: 7px 14px; border-radius: 8px; font-size: .82rem; cursor: pointer; border: 1px solid #ddd; }
.btn.ghost { background: #fff; color: #666; }
.err { color: var(--red); font-size: .8rem; margin: 0 0 10px; }

.card { background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 12px; margin-bottom: 16px; }
.card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 6px; }
.card-title { font-size: .9rem; font-weight: 600; color: #555; margin-bottom: 8px; }
.card-head .card-title { margin-bottom: 0; }
.summary { font-size: .82rem; color: #777; }

.chart-wrap { position: relative; height: 300px; }
.chart-wrap.ratio { height: 240px; }

.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 10px; border-bottom: 1px solid #eee; font-size: .85rem; text-align: left; }
th { color: #888; font-weight: 500; background: #fafafa; white-space: nowrap; }
td.name { font-weight: 600; color: #555; }
.code { background: #faf6ef; padding: 2px 7px; border-radius: 4px; font-size: .8rem; color: #7a5c33; }
.empty { text-align: center; color: #aaa; padding: 24px; }

.badge { padding: 2px 8px; border-radius: 10px; font-size: .72rem; }
.badge.positive { background: #eafaf0; color: var(--green); }
.badge.negative { background: #fdecea; color: var(--red); }
.green { color: var(--green); }
.red { color: var(--red); }

/* B-9 差评原因排行 */
.rank { display: flex; flex-direction: column; gap: 9px; }
.rank-row { display: flex; align-items: center; gap: 10px; font-size: .82rem; }
.rank-idx { width: 18px; height: 18px; line-height: 18px; text-align: center; border-radius: 50%; background: #f0e9d8; color: #a07d1f; font-size: .7rem; flex-shrink: 0; }
.rank-name { flex: 0 0 120px; color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rank-bar { flex: 1; height: 10px; background: #f0f0f0; border-radius: 6px; overflow: hidden; }
.rank-bar i { display: block; height: 100%; background: linear-gradient(90deg, #c9a84c, #8b6914); }
.rank-cnt { width: 30px; text-align: right; color: #888; flex-shrink: 0; }

/* B-10 差评房间预警 */
.warn-card .side-note { font-size: .78rem; color: #b06a3a; }
.warn-row td { background: rgba(140, 61, 61, .12); }
</style>
