<script setup>
// 站点设置（仅管理员可见）：酒店名称、各提示语文案、好评/差评原因选项
import { ref, onMounted } from 'vue'
import { api } from '../api/http.js'
import { auth } from '../utils/auth.js'

const msg = ref('')
const busy = ref(false)
const loaded = ref(false)

const form = ref({
  hotelName: '',
  hotelNameEn: '',
  guestPrompt: '',
  positiveMsg: '',
  negativeMsg: '',
  positiveReasonsText: '',
  negativeReasonsText: '',
})

function token() {
  return encodeURIComponent(auth.value.token)
}

async function load() {
  msg.value = ''
  try {
    const res = await api.get('/settings?token=' + token())
    const d = res.data || {}
    form.value = {
      hotelName: d.hotelName || '',
      hotelNameEn: d.hotelNameEn || '',
      guestPrompt: d.guestPrompt || '',
      positiveMsg: d.positiveMsg || '',
      negativeMsg: d.negativeMsg || '',
      positiveReasonsText: (d.positiveReasons || []).join('\n'),
      negativeReasonsText: (d.negativeReasons || []).join('\n'),
    }
    loaded.value = true
  } catch (e) {
    msg.value = '❌ 加载失败：' + (e.response?.status === 403
      ? '需要管理员权限'
      : (e.response?.data?.error || e.message))
  }
}

// 文本框 → 数组：每行一项，自动去空行（去重与长度校验交给后端统一处理）
function toList(text) {
  return (text || '').split('\n').map(s => s.trim()).filter(Boolean)
}

async function save() {
  msg.value = ''
  if (!form.value.hotelName.trim()) {
    msg.value = '❌ 酒店名称不能为空'
    return
  }
  busy.value = true
  try {
    const res = await api.put('/settings?token=' + token(), {
      hotelName: form.value.hotelName,
      hotelNameEn: form.value.hotelNameEn,
      guestPrompt: form.value.guestPrompt,
      positiveMsg: form.value.positiveMsg,
      negativeMsg: form.value.negativeMsg,
      positiveReasons: toList(form.value.positiveReasonsText),
      negativeReasons: toList(form.value.negativeReasonsText),
    })
    // 用后端回传的结果回填，这样能立刻看到"去重/去空"后的真实效果
    const d = res.data || {}
    form.value.positiveReasonsText = (d.positiveReasons || []).join('\n')
    form.value.negativeReasonsText = (d.negativeReasons || []).join('\n')
    msg.value = '✅ 已保存，客人页刷新后生效'
  } catch (e) {
    msg.value = '❌ ' + (e.response?.data?.error || e.message)
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="card">
    <h3>⚙️ 站点设置</h3>
    <p class="hint">
      这里改的内容就是<b>客人扫码后看到的界面</b>——酒店名、提示语，以及好评/差评的选项按钮。
      保存后客人页刷新即生效，不需要改代码或重新部署。
    </p>

    <div class="grid">
      <label>
        <span>酒店名称</span>
        <input v-model="form.hotelName" maxlength="50" placeholder="城市酒店" />
      </label>
      <label>
        <span>英文名<em>可不填，会显示在中文名下方</em></span>
        <input v-model="form.hotelNameEn" maxlength="50" placeholder="City Hotel" />
      </label>
    </div>

    <label>
      <span>客人页顶部提示语</span>
      <input v-model="form.guestPrompt" maxlength="60" placeholder="请您为本次入住体验评分" />
    </label>

    <div class="grid">
      <label>
        <span>提交好评后显示的话</span>
        <input v-model="form.positiveMsg" maxlength="60" placeholder="感谢您的反馈！" />
      </label>
      <label>
        <span>提交差评后显示的话</span>
        <input v-model="form.negativeMsg" maxlength="60" placeholder="已收到您的反馈，我们会立即改进！" />
      </label>
    </div>

    <div class="grid">
      <label>
        <span>好评选项<em>每行一个，最多 20 项、每项≤20 字</em></span>
        <textarea v-model="form.positiveReasonsText" rows="7" spellcheck="false"></textarea>
      </label>
      <label>
        <span>差评选项<em>每行一个，最多 20 项、每项≤20 字</em></span>
        <textarea v-model="form.negativeReasonsText" rows="7" spellcheck="false"></textarea>
      </label>
    </div>

    <div class="foot">
      <button class="primary" :disabled="busy || !loaded" @click="save">{{ busy ? '保存中…' : '保存设置' }}</button>
      <span v-if="msg" class="msg">{{ msg }}</span>
    </div>
  </div>
</template>

<style scoped>
.card { background:#fff; border-radius:12px; padding:18px; margin-top:14px; border:1px solid #eee; }
h3 { margin:0 0 6px; font-size:1rem; color:#444; }
.hint { margin:0 0 16px; font-size:.82rem; color:#999; line-height:1.7; }
.hint b { color:#a07d1f; font-weight:600; }
label { display:block; margin-bottom:12px; }
label > span { display:block; font-size:.82rem; color:#666; margin-bottom:5px; }
label em { font-style:normal; color:#bbb; margin-left:6px; font-size:.75rem; }
input, textarea { width:100%; padding:9px 11px; border:1px solid #ddd; border-radius:8px; font-size:.9rem; font-family:inherit; box-sizing:border-box; background:#fff; }
textarea { resize:vertical; line-height:1.7; }
input:focus, textarea:focus { outline:none; border-color:var(--gold); }
.grid { display:grid; grid-template-columns:1fr 1fr; gap:0 14px; }
@media (max-width:560px) { .grid { grid-template-columns:1fr; } }
.foot { display:flex; align-items:center; gap:12px; margin-top:6px; }
.primary { padding:10px 20px; border:none; border-radius:8px; background:var(--gold); color:#fff; font-size:.9rem; cursor:pointer; }
.primary:disabled { opacity:.6; cursor:default; }
.msg { font-size:.85rem; color:#666; }
</style>
