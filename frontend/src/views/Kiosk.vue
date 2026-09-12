<script setup>
import { ref, computed, watch } from 'vue'
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

const type = ref('positive')
const reasons = ref([])
const submitting = ref(false)
const done = ref(false)

// 选项与文案都来自后台配置（见 utils/settings.js），未配置时用内置默认值
const currentOptions = computed(() =>
  type.value === 'positive' ? settings.value.positiveReasons : settings.value.negativeReasons
)
const thanksMsg = computed(() =>
  type.value === 'positive' ? settings.value.positiveMsg : settings.value.negativeMsg
)

// 好评/差评的选项是两套不同的列表，切换时必须清空已选，
// 否则会残留上一个类型的原因（界面上看不见、也取消不掉，却会被提交上去）。
watch(type, () => { reasons.value = [] })

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
      room: (room.value || '').trim() || null,
      reasons: reasons.value,
      // 归属当班工号：与旧系统一致，取自这台设备当前的登录状态。
      // 客人用自己手机扫码时没有登录态 → 为 null，不影响提交，
      // 只是这条评价不计入「按工号统计」（旧系统也是同样表现）。
      staffUsername: auth.value.username || null
    })
    done.value = true
    reasons.value = []
    setTimeout(() => { done.value = false }, 3000)
  } catch (e) {
    // 优先显示后端给出的中文原因（如"提交太频繁了，请稍等一会儿再试"），
    // 否则客人只会看到 "Request failed with status code 429" 这种看不懂的话。
    alert('提交失败：' + (e.response?.data?.error || e.message || '网络错误'))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="kiosk">
    <header class="brand">
      <div class="logo"><img :src="logoUrl" alt="" /></div>
      <div class="name">{{ settings.hotelName }}</div>
      <div v-if="settings.hotelNameEn" class="name-en">{{ settings.hotelNameEn }}</div>
      <div class="sub">{{ settings.guestPrompt }}</div>
    </header>

    <div class="row">
      <button class="big positive" :class="{on:type==='positive'}" @click="type='positive'">👍 好评</button>
      <button class="big negative" :class="{on:type==='negative'}" @click="type='negative'">👎 差评</button>
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

    <div v-if="currentOptions.length" class="reasons">
      <span class="tip">{{ type === 'positive' ? '您对哪些方面满意？' : '请告诉我们哪里需要改进：' }}</span>
      <div class="chips">
        <button v-for="r in currentOptions" :key="r" class="chip" :class="{on:reasons.includes(r)}" @click="toggleReason(r)">{{ r }}</button>
      </div>
    </div>

    <button class="submit" :disabled="submitting" @click="submit">{{ submitting ? '提交中…' : '提交评价' }}</button>

    <transition name="fade">
      <div v-if="done" class="thanks">
        <div class="check">✅</div>
        <div class="msg">{{ thanksMsg }}</div>
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
.name-en { font-size:.9rem; color:#a07d1f; opacity:.75; margin-top:1px; letter-spacing:.02em; }
.sub { font-size:.85rem; color:#888; margin-top:2px; }
.row { display:flex; gap:12px; }
.big { flex:1; padding:30px 0; font-size:1.25rem; border-radius:16px; border:2px solid #ddd; background:#fff; cursor:pointer; transition:.15s; }
.big.positive.on { border-color:var(--green); background:#eafaf0; color:var(--green); }
.big.negative.on { border-color:var(--red); background:#fdecea; color:var(--red); }
.room { display:flex; align-items:center; gap:10px; padding:10px 14px; background:#fff; border:1px solid #eee; border-radius:10px; }
.room.locked { background:#faf8f2; }
.room .label { font-size:.8rem; color:#999; flex-shrink:0; }
.room .value { font-weight:600; color:#444; }
.room-input { flex:1; min-width:0; border:none; outline:none; background:transparent; font-size:1rem; font-weight:600; color:#444; }
.room-input::placeholder { font-weight:400; color:#bbb; }
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
