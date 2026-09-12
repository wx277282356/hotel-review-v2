<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { api } from '../api/http.js'
import { auth } from '../utils/auth.js'
import { settings } from '../utils/settings.js'
// LOGO 路径（默认随 GitHub Pages 子路径适配；若后台已上传自定义 LOGO 会自动替换）
import { logoUrl } from '../utils/logo.js'

// 房间号来自二维码链接 ?room=XXX（一房一码）；
// 前台模式不带该参数，此时由前台手动输入（可不填）。
const params = new URLSearchParams(window.location.search)
const roomFromUrl = params.get('room') || ''
const isRoomMode = !!roomFromUrl
const room = ref(roomFromUrl)

// type：当前选中的评价类型。
//  · null       → 初始未选，展示两个大按钮
//  · 'positive' → 好评：点一下直接保存（无"好在哪里"细分项，符合既定规则）
//  · 'negative' → 差评：弹出原因选择弹窗，且必须至少选一项才能提交
const type = ref(null)
const reasons = ref([])
const submitting = ref(false)
const done = ref(false)
const countdown = ref(0)
let cdTimer = null

// 差评弹窗是否可见（提交成功进入感谢页时隐藏）
const showNegative = computed(() => type.value === 'negative' && !done.value)

// 差评才展示原因选项；好评一键提交，不存在任何原因选择 UI
const negativeOptions = computed(() => settings.value.negativeReasons || [])
const thanksMsg = computed(() =>
  type.value === 'positive' ? settings.value.positiveMsg : settings.value.negativeMsg
)
// 感谢屏图形：好评=金色五角星、差评=机器人头像（K-16，图形与旧版一致；中英双语待 Q14）
const isPositive = computed(() => type.value === 'positive')

// K-19：客人页右上角实时时钟（仅展示，不参与评价）
const now = ref('')
let clockTimer = null
function pad(n) { return String(n).padStart(2, '0') }
function tick() {
  const d = new Date()
  now.value = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// 切换类型时清空已选原因，避免残留上一个类型的选项被提交
watch(type, () => { reasons.value = [] })
watch(done, (v) => { if (v) reasons.value = [] })

function toggleReason(r) {
  const i = reasons.value.indexOf(r)
  if (i >= 0) reasons.value.splice(i, 1)
  else reasons.value.push(r)
}

function reset() {
  done.value = false
  type.value = null
  reasons.value = []
  countdown.value = 0
  if (cdTimer) { clearInterval(cdTimer); cdTimer = null }
}

// 点「👎 差评」：弹出原因选择弹窗（强制选，不可直接跳过）
function openNegative() {
  reasons.value = []
  type.value = 'negative'
}
// 弹窗内「返回」：回到首页两个按钮
function closeNegative() {
  type.value = null
  reasons.value = []
}

async function doSubmit(t, rs) {
  if (submitting.value) return
  submitting.value = true
  try {
    await api.post('/review', {
      type: t,
      room: (room.value || '').trim() || null,
      reasons: rs,
      // 归属当班工号：与旧系统一致，取自这台设备当前的登录状态。
      // 客人用自己手机扫码时没有登录态 → 为 null，不影响提交，
      // 只是这条评价不计入「按工号统计」（旧系统也是同样表现）。
      staffUsername: auth.value.username || null
    })
    done.value = true
    // K-17：感谢页按后台配置的秒数倒计时自动返回（默认 4，范围 2–10）
    startCountdown()
  } catch (e) {
    // 优先显示后端给出的中文原因（如"提交太频繁了，请稍等一会儿再试"），
    // 否则客人只会看到 "Request failed with status code 429" 这种看不懂的话。
    alert('提交失败：' + (e.response?.data?.error || e.message || '网络错误'))
  } finally {
    submitting.value = false
  }
}

// 好评：点一下即直接保存，无任何细分项选择
function submitPositive() {
  type.value = 'positive'
  reasons.value = []
  doSubmit('positive', [])
}

// 差评：强制选原因；按钮在 reasons 为空时已禁用，这里再兜底拦截
function submitNegative() {
  if (reasons.value.length === 0) return
  doSubmit('negative', reasons.value)
}

function startCountdown() {
  if (cdTimer) clearInterval(cdTimer)
  countdown.value = settings.value.autoReturn || 4
  cdTimer = setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0) {
      clearInterval(cdTimer)
      cdTimer = null
      reset()
    }
  }, 1000)
}

onMounted(() => { tick(); clockTimer = setInterval(tick, 1000) })
onBeforeUnmount(() => {
  if (cdTimer) clearInterval(cdTimer)
  if (clockTimer) clearInterval(clockTimer)
})
</script>

<template>
  <div class="kiosk">
    <header class="brand">
      <div class="logo"><img :src="logoUrl" alt="" /></div>
      <div class="titles">
        <div class="name">{{ settings.hotelName }}</div>
        <div v-if="settings.hotelNameEn" class="name-en">{{ settings.hotelNameEn }}</div>
        <div class="sub">{{ settings.guestPrompt }}</div>
      </div>
      <div class="clock" aria-hidden="true">{{ now }}</div>
    </header>

    <!-- 两个大按钮：好评=立即保存；差评=弹出原因选择 -->
    <div class="row">
      <button class="big positive" @click="submitPositive">👍 好评</button>
      <button class="big negative" @click="openNegative">👎 差评</button>
    </div>

    <div class="room" :class="{locked: isRoomMode}">
      <span class="label">房间号</span>
      <span v-if="isRoomMode" class="value">{{ room }}</span>
      <input
        v-else
        v-model="room"
        class="room-input"
        type="text"
        maxlength="50"
        placeholder="如 802（可不填）"
      />
    </div>

    <!-- 差评弹窗：必须至少选择一项原因才能提交（强制，不可跳过） -->
    <transition name="fade">
      <div v-if="showNegative" class="modal-mask" @click.self="closeNegative">
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-title">请告诉我们哪里需要改进</div>
          <div class="chips">
            <button
              v-for="r in negativeOptions"
              :key="r"
              class="chip"
              :class="{on: reasons.includes(r)}"
              @click="toggleReason(r)"
            >{{ r }}</button>
          </div>
          <p class="req-tip" :class="{show: reasons.length === 0}">请至少选择一项不满意的原因</p>
          <div class="modal-actions">
            <button class="ghost" :disabled="submitting" @click="closeNegative">返回</button>
            <button
              class="submit"
              :disabled="reasons.length === 0 || submitting"
              @click="submitNegative"
            >{{ submitting ? '提交中…' : '提交差评' }}</button>
          </div>
        </div>
      </div>
    </transition>

    <transition name="fade">
      <div v-if="done" class="thanks">
        <!-- 好评：金色五角星（带弹入动画）；差评：机器人头像（弹入 + 眨眼） -->
        <div class="art">
          <svg v-if="isPositive" class="star" viewBox="0 0 120 120" aria-hidden="true">
            <defs>
              <linearGradient id="starGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#ffe9a8" />
                <stop offset="100%" stop-color="#e0b53c" />
              </linearGradient>
            </defs>
            <polygon
              points="60,14 73,46 108,48 80,70 90,104 60,82 30,104 40,70 12,48 47,46"
              fill="url(#starGrad)" stroke="#caa033" stroke-width="2" stroke-linejoin="round"
            />
          </svg>
          <svg v-else class="bot" viewBox="0 0 120 120" aria-hidden="true">
            <line x1="60" y1="30" x2="60" y2="14" stroke="#b9a7dd" stroke-width="4" stroke-linecap="round" />
            <circle cx="60" cy="11" r="5" fill="#a07d1f" />
            <rect x="28" y="30" width="64" height="58" rx="16" fill="#e9e2f5" stroke="#b9a7dd" stroke-width="3" />
            <circle class="eye" cx="46" cy="54" r="7" fill="#5b4b8a" />
            <circle class="eye" cx="74" cy="54" r="7" fill="#5b4b8a" />
            <path d="M46 74 q14 12 28 0" stroke="#5b4b8a" stroke-width="4" fill="none" stroke-linecap="round" />
          </svg>
        </div>
        <div class="msg">{{ thanksMsg }}</div>
        <div class="cd">{{ countdown }} 秒后自动返回</div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.kiosk { display:flex; flex-direction:column; gap:18px; max-width:480px; margin:0 auto; }
.brand { position:relative; text-align:center; padding:10px 0 4px; }
.logo { width:72px; height:72px; margin:0 auto 8px; border-radius:16px; background:linear-gradient(160deg,#e8c977,#c9a84c 50%,#8b6914); border:2px solid var(--gold); padding:8px; box-sizing:border-box; display:flex; align-items:center; justify-content:center; }
.logo img { width:100%; height:100%; object-fit:contain; }
.titles { display:inline-block; }
.name { font-size:1.3rem; font-weight:700; color:#a07d1f; position:relative; display:inline-block; padding-bottom:6px; }
/* K-3/K-4：主标题下方金色装饰线，让品牌感更明确 */
.name::after { content:''; position:absolute; left:50%; bottom:0; transform:translateX(-50%); width:46px; height:3px; border-radius:2px; background:linear-gradient(90deg,var(--gold),#e8c977); }
.name-en { font-size:.9rem; color:#a07d1f; opacity:.75; margin-top:8px; letter-spacing:.02em; }
.sub { font-size:.85rem; color:#888; margin-top:4px; }
.clock { position:absolute; top:6px; right:0; font-size:.78rem; color:#bbb; font-variant-numeric:tabular-nums; letter-spacing:.03em; }
.row { display:flex; gap:12px; }
.big { flex:1; padding:30px 0; font-size:1.25rem; border-radius:16px; border:2px solid #ddd; background:#fff; cursor:pointer; transition:.15s; }
.big.positive { border-color:var(--green); background:#eafaf0; color:var(--green); }
.big.negative { border-color:var(--red); background:#fdecea; color:var(--red); }
.big:active { transform:scale(.98); }
.room { display:flex; align-items:center; gap:10px; padding:10px 14px; background:#fff; border:1px solid #eee; border-radius:10px; }
.room.locked { background:#faf8f2; }
.room .label { font-size:.8rem; color:#999; flex-shrink:0; }
.room .value { font-weight:600; color:#444; }
.room-input { flex:1; min-width:0; border:none; outline:none; background:transparent; font-size:1rem; font-weight:600; color:#444; }
.room-input::placeholder { font-weight:400; color:#bbb; }

/* 差评弹窗 */
.modal-mask { position:fixed; inset:0; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; padding:20px; z-index:20; }
.modal { width:100%; max-width:440px; background:#fff; border-radius:16px; padding:22px; box-shadow:0 12px 40px rgba(0,0,0,.25); }
.modal-title { font-size:1.05rem; font-weight:700; color:#444; margin-bottom:14px; }
.chips { display:flex; flex-wrap:wrap; gap:8px; }
.chip { padding:9px 14px; border:1px solid #ccc; border-radius:20px; background:#fff; cursor:pointer; font-size:.85rem; }
.chip.on { border-color:var(--gold); background:#fff8e6; color:#a07d1f; font-weight:600; }
.req-tip { font-size:.8rem; color:var(--red); margin:12px 0 0; height:0; opacity:0; transition:.2s; overflow:hidden; }
.req-tip.show { height:auto; opacity:1; margin-top:12px; }
.modal-actions { display:flex; gap:10px; margin-top:16px; }
.ghost { flex:0 0 auto; padding:14px 18px; border:1px solid #ddd; border-radius:12px; background:#fff; color:#888; font-size:1rem; cursor:pointer; }
.submit { flex:1; padding:14px; border:none; border-radius:12px; background:var(--red); color:#fff; font-size:1.1rem; cursor:pointer; }
.submit:disabled { opacity:.45; cursor:not-allowed; }

.thanks { position:fixed; inset:0; background:rgba(255,255,255,.96); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px; z-index:30; }
.thanks .art { width:120px; height:120px; }
.thanks .star { width:100%; height:100%; animation:starPop .6s cubic-bezier(.34,1.56,.64,1) both; filter:drop-shadow(0 6px 14px rgba(224,181,60,.35)); }
.thanks .bot { width:100%; height:100%; animation:botBounce .6s cubic-bezier(.34,1.56,.64,1) both; }
.thanks .bot .eye { transform-origin:center; animation:botBlink 3s 1s infinite; }
.thanks .msg { font-size:1.3rem; font-weight:700; color:var(--green); text-align:center; padding:0 20px; }
.thanks .cd { font-size:.95rem; color:#999; }
@keyframes starPop { 0% { transform:scale(0) rotate(-40deg); opacity:0 } 60% { transform:scale(1.18) rotate(10deg); opacity:1 } 100% { transform:scale(1) rotate(0) } }
@keyframes botBounce { 0% { transform:translateY(-36px) scale(.8); opacity:0 } 60% { transform:translateY(6px) scale(1.05); opacity:1 } 100% { transform:translateY(0) scale(1) } }
@keyframes botBlink { 0%,90%,100% { transform:scaleY(1) } 95% { transform:scaleY(.1) } }
.fade-enter-active, .fade-leave-active { transition:opacity .25s; }
.fade-enter-from, .fade-leave-to { opacity:0; }

/* K-7：移动端断点，窄屏下按钮与弹窗更紧凑 */
@media (max-width:400px) {
  .big { padding:24px 0; font-size:1.1rem; }
  .name { font-size:1.15rem; }
  .modal { padding:18px; }
  .modal-actions { flex-direction:column-reverse; }
  .ghost { width:100%; }
  .submit { width:100%; }
}
</style>
