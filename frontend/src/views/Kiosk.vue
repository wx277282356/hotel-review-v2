<script setup>
import { ref } from 'vue'
import { api } from '../api/http.js'

const type = ref('positive')
const room = ref('')
const reasons = ref([])
const submitting = ref(false)
const done = ref(false)

const reasonOptions = ['服务态度好', '房间干净', '设施完善', '位置方便', '性价比高']

function toggleReason(r) {
  const i = reasons.value.indexOf(r)
  if (i >= 0) reasons.value.splice(i, 1)
  else reasons.value.push(r)
}

async function submit() {
  submitting.value = true
  try {
    await api.post('/review', {
      type: type.value,
      room: room.value || null,
      reasons: type.value === 'positive' ? reasons.value : [],
      staffUsername: null
    })
    done.value = true
    setTimeout(() => { done.value = false; room.value=''; reasons.value=[] }, 2500)
  } catch (e) {
    alert('提交失败：' + (e.message || '网络错误'))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="kiosk">
    <h2>欢迎评价您的入住体验</h2>

    <div class="row">
      <button class="big positive" :class="{on:type==='positive'}" @click="type='positive'">👍 好评</button>
      <button class="big negative" :class="{on:type==='negative'}" @click="type='negative'">👎 差评</button>
    </div>

    <label>房间号（选填）
      <input v-model="room" placeholder="如 601" />
    </label>

    <div v-if="type==='positive'" class="reasons">
      <span class="tip">选择您满意的方面：</span>
      <button v-for="r in reasonOptions" :key="r" class="chip" :class="{on:reasons.includes(r)}" @click="toggleReason(r)">{{ r }}</button>
    </div>

    <button class="submit" :disabled="submitting" @click="submit">{{ submitting ? '提交中…' : '提交评价' }}</button>

    <p v-if="done" class="ok">✅ 感谢您的反馈！</p>
  </div>
</template>

<style scoped>
.kiosk { display:flex; flex-direction:column; gap:16px; }
.row { display:flex; gap:12px; }
.big { flex:1; padding:28px 0; font-size:1.2rem; border-radius:14px; border:2px solid #ddd; background:#fff; cursor:pointer; }
.big.positive.on { border-color:var(--green); background:#eafaf0; color:var(--green); }
.big.negative.on { border-color:var(--red); background:#fdecea; color:var(--red); }
label { display:flex; flex-direction:column; gap:6px; font-size:.9rem; color:#666; }
input { padding:10px; border:1px solid #ccc; border-radius:8px; font-size:1rem; }
.reasons { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.chip { padding:8px 12px; border:1px solid #ccc; border-radius:20px; background:#fff; cursor:pointer; font-size:.85rem; }
.chip.on { border-color:var(--gold); background:#fff8e6; color:#a07d1f; }
.submit { padding:14px; border:none; border-radius:10px; background:var(--gold); color:#fff; font-size:1.05rem; cursor:pointer; }
.submit:disabled { opacity:.6; }
.ok { color:var(--green); text-align:center; font-weight:600; }
</style>
