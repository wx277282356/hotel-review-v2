<script setup>
import { ref, computed } from 'vue'
import { api } from '../api/http.js'

// 酒店名称（后续可做成后台可配置）
const HOTEL_NAME = '城市酒店'
// LOGO 路径（默认随 GitHub Pages 子路径适配；若后台已上传自定义 LOGO 会自动替换）
import { logoUrl } from '../utils/logo.js'
// 房间号来自二维码链接 ?room=XXX（客房模式）；前台模式可不带，由客人/前台手动填
const params = new URLSearchParams(window.location.search)
const roomFromUrl = params.get('room') || ''
const isRoomMode = !!roomFromUrl
const room = ref(roomFromUrl)

const type = ref('positive')
const reasons = ref([])
const submitting = ref(false)
const done = ref(false)

const positiveReasons = ['服务态度好', '房间干净', '设施完善', '位置方便', '性价比高', '早餐丰富']
const negativeReasons = ['服务态度差', '房间不干净', '设施故障', '噪音大', '网络差', '其他']
const currentOptions = computed(() => type.value === 'positive' ? positiveReasons : negativeReasons)

function toggleReason(r) {
  const i = reasons.value.indexOf(r)
  if (i >= 0) reasons.value.splice(i, 1)
  else reasons.value.push(r)
}

async function submit() {
  if (submitting.value) return
  submitting.value = true
  try {
    await api.post('/review', {
      type: type.value,
      room: room.value || null,
      reasons: reasons.value,
      staffUsername: null
    })
    done.value = true
    reasons.value = []
    setTimeout(() => { done.value = false }, 3000)
  } catch (e) {
    alert('提交失败：' + (e.message || '网络错误'))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="kiosk">
    <header class="brand">
      <div class="logo"><img :src="logoUrl" alt="城市酒店" /></div>
      <div class="name">{{ HOTEL_NAME }}</div>
      <div class="sub">请您为本次入住体验评分</div>
    </header>

    <div class="row">
      <button class="big positive" :class="{on:type==='positive'}" @click="type='positive'">👍 好评</button>
      <button class="big negative" :class="{on:type==='negative'}" @click="type='negative'">👎 差评</button>
    </div>

    <div class="room" :class="{locked: isRoomMode}">
      <span class="label">房间号</span>
      <span class="value">{{ room || '（前台/未指定）' }}</span>
    </div>

    <div class="reasons">
      <span class="tip">{{ type === 'positive' ? '您对哪些方面满意？' : '请告诉我们哪里需要改进：' }}</span>
      <div class="chips">
        <button v-for="r in currentOptions" :key="r" class="chip" :class="{on:reasons.includes(r)}" @click="toggleReason(r)">{{ r }}</button>
      </div>
    </div>

    <button class="submit" :disabled="submitting" @click="submit">{{ submitting ? '提交中…' : '提交评价' }}</button>

    <transition name="fade">
      <div v-if="done" class="thanks">
        <div class="check">✅</div>
        <div class="msg">感谢您的反馈！</div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.kiosk { display:flex; flex-direction:column; gap:18px; max-width:480px; margin:0 auto; }
.brand { text-align:center; padding:8px 0 4px; }
.logo { width:72px; height:72px; margin:0 auto 8px; border-radius:16px; background:linear-gradient(160deg,#e8c977,#c9a84c 50%,#8b6914); border:2px solid var(--gold); padding:8px; box-sizing:border-box; display:flex; align-items:center; justify-content:center; }
.logo img { width:100%; height:100%; object-fit:contain; }
.name { font-size:1.3rem; font-weight:700; color:#a07d1f; }
.sub { font-size:.85rem; color:#888; margin-top:2px; }
.row { display:flex; gap:12px; }
.big { flex:1; padding:30px 0; font-size:1.25rem; border-radius:16px; border:2px solid #ddd; background:#fff; cursor:pointer; transition:.15s; }
.big.positive.on { border-color:var(--green); background:#eafaf0; color:var(--green); }
.big.negative.on { border-color:var(--red); background:#fdecea; color:var(--red); }
.room { display:flex; align-items:center; gap:10px; padding:10px 14px; background:#fff; border:1px solid #eee; border-radius:10px; }
.room.locked { background:#faf8f2; }
.room .label { font-size:.8rem; color:#999; }
.room .value { font-weight:600; color:#444; }
.reasons { display:flex; flex-direction:column; gap:10px; }
.tip { font-size:.9rem; color:#666; }
.chips { display:flex; flex-wrap:wrap; gap:8px; }
.chip { padding:9px 14px; border:1px solid #ccc; border-radius:20px; background:#fff; cursor:pointer; font-size:.85rem; }
.chip.on { border-color:var(--gold); background:#fff8e6; color:#a07d1f; font-weight:600; }
.submit { padding:16px; border:none; border-radius:12px; background:var(--gold); color:#fff; font-size:1.1rem; cursor:pointer; }
.submit:disabled { opacity:.6; }
.thanks { position:fixed; inset:0; background:rgba(255,255,255,.96); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; }
.thanks .check { font-size:3rem; }
.thanks .msg { font-size:1.3rem; font-weight:700; color:var(--green); }
.fade-enter-active, .fade-leave-active { transition:opacity .3s; }
.fade-enter-from, .fade-leave-to { opacity:0; }
</style>
